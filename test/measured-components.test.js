// Components built from measured data only (proposal 0008, Part B; validation/python/measured_components.py):
// dichloromethane and 2-methoxyethanol are neither CoolProp fluids nor in the ChemSep databank.
// test/properties.test.js checks every record against the measured values it was fitted to; this file
// checks what is particular to these components, against values that were not fitted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pure } from "../src/index.js";

const components = JSON.parse(readFileSync(new URL("../src/data/components.json", import.meta.url))).components;
const MEASURED = ["dichloromethane", "2-methoxyethanol"];
const thermoml = id => JSON.parse(readFileSync(new URL(`../validation/data/pure/measured/thermoml_${id}.json`, import.meta.url)));

test("measured components: every record is fitted to cited measurements, every value left out says why", () => {
  for (const id of MEASURED) {
    const c = components[id];
    assert.match(c.constants_source, /NIST Chemistry WebBook/, id);
    assert.equal(c.vapourPressure.tier, "fitted", id);
    assert.ok(c.uniquac_missing, `${id}: no UNIQUAC r and q (no open data) is stated`);
    for (const [p, r] of Object.entries(c.properties)) {
      if (r.available === false) { assert.ok(r.searched.length >= 4, `${id} ${p}: sources searched`); continue; }
      assert.equal(r.tier, "fitted", `${id} ${p}`);
      assert.match(r.source.name, /ThermoML|WebBook/, `${id} ${p}`);
      for (const e of r.source.excluded ?? []) assert.ok(e.why && e.reference && Number.isFinite(e.deviation_percent), `${id} ${p}`);
    }
    for (const e of c.vapourPressure.excluded ?? []) assert.ok(e.why && e.reference, id);
  }
});

test("measured components: the normal boiling point agrees with the measured ones within 0.2 K", () => {
  // 2-methoxyethanol: the normal boiling temperatures of the ThermoML Archive (not used in the fit)
  const tb = thermoml("2-methoxyethanol").rows.filter(r => r.property === "Normal boiling temperature, K").map(r => r.value);
  assert.ok(tb.length >= 2);
  const p = pure("2-methoxyethanol");
  for (const t of tb) assert.ok(Math.abs(p.tsat(101.325) - t) < 0.2, `2-methoxyethanol Tb ${p.tsat(101.325).toFixed(2)} vs ${t} K`);
  // dichloromethane: the WebBook average of the measured normal boiling points, 313 ± 1 K
  assert.ok(Math.abs(pure("dichloromethane").tsat(101.325) - 313) < 1);
});

test("measured components: the vapour pressure agrees with the measured Antoine sets that were not fitted", () => {
  for (const id of MEASURED) {
    for (const x of components[id].vapourPressure.crossCheck ?? []) {
      assert.ok(Math.abs(x.max_deviation_percent) < 3, `${id}: ${x.reference} ${x.max_deviation_percent} %`);
    }
  }
});

test("measured components: outside the measured range the engine refuses instead of extrapolating", () => {
  const p = pure("dichloromethane");
  const rho = components.dichloromethane.properties.liquidDensity;
  assert.ok(Number.isFinite(p.property("liquidDensity", 298.15)));
  assert.throws(() => p.property("liquidDensity", rho.Tmax_K + 10), /outside the range/);
  // no open data: an error that says so, not a number
  assert.throws(() => p.property("liquidViscosity", 298.15), /No open data/);
  assert.throws(() => pure("2-methoxyethanol").property("idealGasHeatCapacity", 400), /No open data/);
});
