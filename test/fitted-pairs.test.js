import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { system } from "../src/index.js";
import { findAzeotrope } from "../src/equilibrium/azeotrope.js";

// Pairs fitted to open isobaric T-x-y data (validation/python/fit_parameters.py, "txy-file").
// Each data file is compared with both models; rows of pure components are left out, as in the fit.
// These T-x-y tests compare each model with the same data it was fitted to: they guard the fit
// quality against regressions, they are not independent validation. The independent checks are
// the handbook binary azeotropes (azeotropes.test.js) and the ternary saddle azeotrope below,
// which is not in the fit objective.
const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const TXY_FILES = [
  "acetone_methanol_101kPa.json",
  "chloroform_methanol_101kPa.json",
  "acetone_chloroform_101kPa.json",
];

for (const file of TXY_FILES) {
  test(`${file}: both models follow the isobaric T-x-y data (AAD < 0.3 K in T, < 0.01 in y)`, () => {
    const d = load(`../validation/data/${file}`);
    assert.equal(d.kind, "isobaric-txy");
    assert.ok(d.source.citation && d.source.doi && d.source.open_copy && d.source.access && d.source.tables, "source block");
    const col = Object.fromEntries(d.columns.map((c, k) => [c, k]));
    const pts = d.rows.map(r => ({ x: r[col.x_1], T: r[col.T_K], y: r[col.y_1] })).filter(p => p.x > 0 && p.x < 1);
    for (const model of ["NRTL", "UNIQUAC"]) {
      const s = system({ components: d.components, model });
      const dev = pts.map(p => { const b = s.bubbleT([p.x, 1 - p.x], d.P_kPa); return [Math.abs(b.T - p.T), Math.abs(b.y[0] - p.y)]; });
      const aadT = dev.reduce((a, v) => a + v[0], 0) / dev.length, aadY = dev.reduce((a, v) => a + v[1], 0) / dev.length;
      assert.ok(aadT < 0.3, `${model}: AAD ${aadT.toFixed(3)} K`);
      assert.ok(aadY < 0.01, `${model}: AAD ${aadY.toFixed(4)} in y`);
      assert.equal(s.info.pairs.length, 1);
      assert.equal(s.info.pairs[0].tier, "fitted", `${model}: tier`);
    }
  });
}

test("UNIQUAC: methanol + acetone + chloroform saddle azeotrope near 57.5 °C", () => {
  const t = load("../validation/data/azeotropes_101kPa.json").ternary[0];
  const M = [32.042, 58.08, 119.378];
  const mol = t.wt_pct.map((w, i) => w / M[i]);
  const x0 = mol.map(v => v / mol.reduce((a, b) => a + b));
  const s = system({ components: t.components, model: "UNIQUAC" });
  const z = findAzeotrope(s, x0, 101.325);
  assert.ok(z, "not found");
  assert.ok(Math.abs(z.T - 273.15 - t.T_C) < 1.0, `T ${(z.T - 273.15).toFixed(2)}`);
  z.x.forEach((v, i) => assert.ok(Math.abs(v - x0[i]) < 0.05, `x ${z.x.map(u => u.toFixed(3))}`));
});
