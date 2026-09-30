import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { system, createSystem, bubbleT } from "../src/index.js";

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url)));

test("bubble points match the independent Python implementation", () => {
  const { cases } = load("../validation/fixtures/bubble_T_101kPa.json");
  const cache = new Map();
  for (const c of cases) {
    const key = c.model + c.components.join();
    if (!cache.has(key)) cache.set(key, createSystem({ components: c.components, model: c.model }));
    const r = bubbleT(cache.get(key), c.x, c.P_kPa);
    assert.ok(Math.abs(r.T - c.T_K) < 1e-4, `${key} x=${c.x}: T ${r.T} vs ${c.T_K}`);
    r.y.forEach((y, i) => assert.ok(Math.abs(y - c.y[i]) < 1e-6, `${key} x=${c.x}: y`));
  }
});

test("pure-component boiling points at 101.325 kPa", () => {
  const s = system({ components: ["water", "acetic acid", "ethylene glycol"] });
  const tb = s.boilingPoints(101.325);
  [373.124, 391.05, 470.313].forEach((ref, i) => assert.ok(Math.abs(tb[i] - ref) < 0.15, `${s.names[i]}: ${tb[i]}`));
});

test("acetic acid + ethylene glycol reproduces Schmid et al. (2007) P-x at 363.15 K", () => {
  // Uses the pure-component pressures measured in the same paper, as the parameter fit did.
  // Schmid's pure EG value (1.380 kPa) is about 13 % above the databank vapour pressure
  // (1.214 kPa, consistent with the NIST Antoine equation), which matters only at very low
  // acetic acid content.
  const d = load("../validation/data/schmid2007_acetic_acid_ethylene_glycol.json");
  const pure = [d.px.at(-1).P_kPa, d.px[0].P_kPa];
  for (const model of ["NRTL", "UNIQUAC"]) {
    const s = system({ components: ["acetic acid", "ethylene glycol"], model, psat: pure });
    const dev = d.px.map(p => Math.abs(s.bubbleP([p.x1, 1 - p.x1], d.T_K).P / p.P_kPa - 1) * 100);
    const aad = dev.reduce((a, b) => a + b) / dev.length;
    assert.ok(aad < 1.5, `${model}: AAD ${aad.toFixed(2)} %`);
  }
});

test("water + ethylene glycol follows the 760 mmHg data within the data scatter", () => {
  const d = load("../validation/data/water_ethylene_glycol_760mmHg.json");
  for (const model of ["NRTL", "UNIQUAC"]) {
    const s = system({ components: ["water", "ethylene glycol"], model });
    const dT = d.txy.map(p => Math.abs(s.bubbleT([p.x_water, 1 - p.x_water], d.P_kPa).T - 273.15 - p.T_C));
    const aad = dT.reduce((a, b) => a + b) / dT.length;
    assert.ok(aad < 3.5, `${model}: AAD ${aad.toFixed(2)} K`);
  }
});

test("residue curves run from water to ethylene glycol with rising temperature", () => {
  const s = system({ components: ["water", "acetic acid", "ethylene glycol"] });
  const c = s.residueCurve([0.3, 0.3, 0.4], 101.325);
  assert.ok(c[0].x[0] > 0.98, "starts near water");
  assert.ok(c.at(-1).x[2] > 0.97, "ends near ethylene glycol");
  for (let k = 1; k < c.length; k++) assert.ok(c[k].T >= c[k - 1].T - 1e-6, "temperature rises");
});

test("clear errors for unknown components and missing parameters", () => {
  assert.throws(() => system({ components: ["water", "unobtainium"] }), /Unknown component "unobtainium"/);
  assert.throws(() => system({ components: ["water", "water"] }), /appears twice/);
  assert.throws(() => system({ components: ["water", "acetic acid"], model: "Wilson" }), /Unknown model/);
});

test("components can be named by id, alias or CAS number", () => {
  const s = system({ components: ["H2O", "HOAc", "107-21-1"] });
  assert.deepEqual(s.ids, ["water", "acetic-acid", "ethylene-glycol"]);
});
