// Pure-component temperature correlations (proposal 0002): the records in
// src/data/components.json against the source points stored in validation/data/pure/.
//
// The points were sampled from each record's source (CoolProp 8.0.0, the NIST WebBook tables,
// or the ChemSep v8.3 correlations) by validation/python/fit_properties.py, which is the
// independent calculation; this test needs neither CoolProp nor Python.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { evaluate } from "../src/thermo/correlations.js";
import { pure, listComponents, PROPERTIES, PROPERTY_NAMES } from "../src/index.js";

const components = JSON.parse(readFileSync(new URL("../src/data/components.json", import.meta.url))).components;
const POINTS_DIR = new URL("../validation/data/pure/", import.meta.url);
const points = Object.fromEntries(readdirSync(POINTS_DIR).filter(f => f.endsWith(".json"))
  .map(f => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(new URL(f, POINTS_DIR)))]));

const GASES = ["oxygen", "nitrogen", "hydrogen", "methane", "ethane", "ethylene"];
const TRANSPORT = new Set(["liquidViscosity", "vapourViscosity", "liquidThermalConductivity", "vapourThermalConductivity"]);
const TIERS = new Set(["standard", "fitted", "databank", "predicted"]);

/** The record as correlations.js evaluates it (the gases' vapour pressure is stored flat). */
function recordOf(id, name) {
  const c = components[id];
  if (name !== "vapourPressure") return c.properties[name];
  const v = c.vapourPressure;
  return { equation: v.equation, units: "Pa", coefficients: { A: v.A, B: v.B, C: v.C, D: v.D, E: v.E },
    Tmin_K: v.Tmin_K, Tmax_K: v.Tmax_K, source: v.source };
}

/** Maximum deviation stated in the record, as a fraction. */
function statedMaxDeviation(rec) {
  const text = typeof rec.source === "string" ? rec.source : rec.source.fit;
  const m = /(?:max deviation|within) ([0-9.]+) %/.exec(text);
  assert.ok(m, `no maximum deviation stated in: ${text}`);
  return Number(m[1]) / 100;
}

test("every component has every property, as a record or an explicit 'no open data' marker", () => {
  assert.equal(listComponents().length, 16);
  for (const { id, name } of listComponents()) {
    const props = components[id].properties;
    assert.ok(props, `${name}: no properties object`);
    for (const p of PROPERTY_NAMES) {
      const r = props[p];
      assert.ok(r, `${name}: ${p} is neither a record nor a "no open data" marker`);
      if (r.available === false) {
        assert.ok(Array.isArray(r.searched) && r.searched.length > 0, `${name} ${p}: list the sources searched`);
      }
    }
    for (const p of Object.keys(props)) assert.ok(PROPERTIES[p], `${name}: unknown property ${p}`);
    pure(id); // the loader also refuses wrong units
  }
});

test("records are complete: units, range, tier, source and stated fit quality", () => {
  for (const { id, name } of listComponents()) {
    for (const [p, r] of Object.entries(components[id].properties)) {
      if (r.available === false) continue;
      const where = `${name} ${p}`;
      assert.equal(r.units, PROPERTIES[p].recordUnits, `${where}: units`);
      assert.ok(r.Tmin_K > 0 && r.Tmax_K > r.Tmin_K, `${where}: range`);
      assert.ok(TIERS.has(r.tier), `${where}: tier ${r.tier}`);
      for (const k of ["name", "reference", "access", "fit"]) assert.ok(r.source?.[k], `${where}: source.${k}`);
      if (r.equation === "DIPPR106") assert.ok(r.Tc_K > r.Tmax_K - 1e-9, `${where}: Tc_K`);
      // targets of the task: 1 % for thermodynamic properties, 3 % for transport properties
      const target = TRANSPORT.has(p) ? 0.03 : 0.01;
      assert.ok(statedMaxDeviation(r) <= target, `${where}: stated deviation above the ${target * 100} % target`);
    }
  }
});

test("stored coefficients reproduce the source points within the stated maximum deviation", () => {
  let n = 0;
  for (const { id, name } of listComponents()) {
    const file = points[id];
    assert.ok(file, `${name}: no validation/data/pure/${id}.json`);
    for (const [p, pts] of Object.entries(file.records)) {
      const rec = recordOf(id, p);
      assert.ok(rec, `${name}: points for ${p} but no record`);
      assert.equal(pts.units, rec.units, `${name} ${p}: units of the points`);
      // stored points are rounded to 8 significant digits
      const tol = statedMaxDeviation(rec) + 2e-7;
      pts.T_K.forEach((T, i) => {
        const got = evaluate(rec, T);
        const dev = Math.abs(got / pts.values[i] - 1);
        assert.ok(dev <= tol, `${name} ${p} at ${T} K: ${got} vs ${pts.values[i]} (${(dev * 100).toFixed(3)} %)`);
        n++;
      });
    }
    for (const p of PROPERTY_NAMES) {
      if (components[id].properties[p].available !== false) assert.ok(file.records[p], `${name}: no source points for ${p}`);
    }
  }
  assert.ok(n > 5000, `only ${n} points checked`);
});

test("correlations are finite and positive over their whole range", () => {
  for (const { id, name } of listComponents()) {
    const names = [...PROPERTY_NAMES, ...(GASES.includes(id) ? ["vapourPressure"] : [])];
    for (const p of names) {
      const rec = recordOf(id, p);
      if (!rec || rec.available === false) continue;
      for (let k = 0; k <= 400; k++) {
        const T = rec.Tmin_K + (rec.Tmax_K - rec.Tmin_K) * k / 400;
        const v = evaluate(rec, T);
        assert.ok(Number.isFinite(v) && v > 0, `${name} ${p} at ${T} K: ${v}`);
      }
    }
  }
});

test("the gases' vapour pressures give their normal boiling points within 0.1 K", () => {
  for (const id of GASES) {
    const p = pure(id);
    const vp = components[id].vapourPressure;
    assert.equal(vp.equation, "DIPPR101");
    assert.equal(vp.tier, "fitted");
    const tb = p.tsat(101.325);
    assert.ok(Math.abs(tb - p.Tb_K) < 0.1, `${p.name}: Tb ${tb.toFixed(3)} K vs ${p.Tb_K} K`);
    assert.ok(Math.abs(tb - points[id].records.vapourPressure.Tb_K_at_101325Pa) < 0.1);
  }
});

test("props() returns liquid and vapour properties for every component at a typical state", () => {
  for (const { id, name } of listComponents()) {
    const p = pure(id);
    const isGas = GASES.includes(id);
    // liquid: 25 °C for the liquids (acetic acid: 30 °C, above its melting point), Tb - 5 K for the gases
    const TL = isGas ? p.Tb_K - 5 : id === "acetic-acid" ? 303.15 : 298.15;
    const L = p.props(TL, isGas ? 101.325 : 101.325);
    assert.equal(L.phase, "liquid", name);
    for (const k of ["rho_kg_m3", "cp_J_molK", "dHvap_J_mol", "h_J_mol", "mu_Pa_s", "k_W_mK"]) {
      assert.ok(Number.isFinite(L[k]), `${name} liquid ${k}: ${L.notes.join(" ")}`);
    }
    // vapour: 10 K above the normal boiling point at 1 kPa
    const V = p.props(p.Tb_K + 10, 1);
    assert.equal(V.phase, "vapour", name);
    for (const k of ["cp_J_molK", "h_J_mol", "mu_Pa_s", "k_W_mK"]) {
      assert.ok(Number.isFinite(V[k]), `${name} vapour ${k}: ${V.notes.join(" ")}`);
    }
  }
});
