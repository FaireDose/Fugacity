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
  "ethanol_water_101kPa.json",
  "ethyl-acetate_ethanol_101kPa.json",
  "ethyl-acetate_ethanol_101kPa_zhang2017.json", // independent check, not fitted
  "ethanol_ethylene-glycol_101kPa.json",
  "water_ethylene-glycol_101kPa_kamihama2012.json",
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

// Water + ethyl acetate (partially miscible): fitted to mutual solubilities and to activity
// coefficients at infinite dilution. The liquid-liquid split is solved here independently of
// the Python fit (Newton on the two isoactivity equations, numerical Jacobian).
function lleBinary(s, T, guess) {
  const lnA = x => s.gammas(x, T).map((g, i) => Math.log(x[i] * g));
  const F = ([a, b]) => { const p = lnA([a, 1 - a]), q = lnA([b, 1 - b]); return [p[0] - q[0], p[1] - q[1]]; };
  let u = guess.slice();
  for (let it = 0; it < 100; it++) {
    const f = F(u);
    if (Math.hypot(...f) < 1e-11) break;
    const h = 1e-7, J = [0, 1].map(k => { const v = u.slice(); v[k] += h; const g = F(v); return [(g[0] - f[0]) / h, (g[1] - f[1]) / h]; });
    const det = J[0][0] * J[1][1] - J[1][0] * J[0][1];
    let d = [-(f[0] * J[1][1] - f[1] * J[1][0]) / det, -(J[0][0] * f[1] - J[0][1] * f[0]) / det];
    let lam = 1;
    while (u.some((v, k) => v + lam * d[k] <= 0 || v + lam * d[k] >= 1)) lam /= 2;
    u = u.map((v, k) => v + lam * d[k]);
  }
  assert.ok(Math.hypot(...F(u)) < 1e-9 && Math.abs(u[0] - u[1]) > 1e-3, `no liquid-liquid split at ${T} K`);
  return u;
}

test("water + ethyl acetate: both models follow the mutual solubilities (298-333 K)", () => {
  for (const model of ["NRTL", "UNIQUAC"]) {
    const s = system({ components: ["water", "ethyl acetate"], model });
    assert.equal(s.info.pairs[0].tier, "fitted");
    const dI = [], dII = [];
    for (const f of ["water_ethyl-acetate_lle_grande2005.json", "water_ethyl-acetate_lle_cehreli2006.json"]) {
      const d = load(`../validation/data/${f}`);
      assert.deepEqual(d.components, ["water", "ethyl-acetate"]);
      for (const [T, a, b] of d.rows) {
        const [za, zb] = lleBinary(s, T, [a, b]);
        dI.push(Math.abs(za - a)); dII.push(Math.abs(zb - b));
      }
    }
    const mean = v => v.reduce((p, q) => p + q, 0) / v.length;
    assert.ok(mean(dI) < 0.003, `${model}: water-rich liquid AAD ${mean(dI).toFixed(4)}`);
    // The 1-atm azeotrope target costs about 0.03 in the ester-rich liquid; the two LLE sources
    // themselves differ by 0.041 there at 298 K.
    assert.ok(mean(dII) < 0.035, `${model}: ester-rich liquid AAD ${mean(dII).toFixed(4)}`);
    // independent check (not fitted): ethyl acetate in the water-rich liquid, Xu et al. (2017)
    for (const [T, x2] of load("../validation/data/water_ethyl-acetate_lle_xu2017.json").rows) {
      const [za] = lleBinary(s, T, [1 - x2, 0.2]);
      assert.ok(Math.abs(1 - za - x2) < 0.005, `${model}: ${T} K ethyl acetate ${(1 - za).toFixed(4)} vs ${x2}`);
    }
  }
});

test("water + ethyl acetate: activity coefficient of ethyl acetate at infinite dilution in water (273-343 K)", () => {
  for (const model of ["NRTL", "UNIQUAC"]) {
    const s = system({ components: ["water", "ethyl acetate"], model });
    const dev = [];
    for (const f of ["water_ethyl-acetate_gamma_inf_fenclova2014.json", "water_ethyl-acetate_gamma_inf_atik2004.json"]) {
      for (const [T, g] of load(`../validation/data/${f}`).rows) dev.push(Math.abs(s.gammas([1 - 1e-9, 1e-9], T)[1] / g - 1));
    }
    const aard = dev.reduce((p, q) => p + q, 0) / dev.length;
    assert.ok(aard < 0.06, `${model}: AARD ${(aard * 100).toFixed(1)} %`);
  }
});

test("water + ethyl acetate: the two liquids boil near 101.325 kPa at the handbook azeotrope, 70.4 °C (fit target, regression guard)", () => {
  const [[T_C, wt2]] = load("../validation/data/water_ethyl-acetate_azeotrope_101kPa.json").rows;
  const T = T_C + 273.15;
  for (const model of ["NRTL", "UNIQUAC"]) {
    const s = system({ components: ["water", "ethyl acetate"], model });
    const [xa] = lleBinary(s, T, [0.985, 0.2]);
    const b = s.bubbleP([xa, 1 - xa], T);
    // 0.5 kPa is about 0.15 K at this point
    assert.ok(Math.abs(b.P - 101.325) < 3, `${model}: two-liquid bubble pressure ${b.P.toFixed(2)} kPa at ${T_C} °C`);
    const yw = (100 - wt2) / 18.01528 / ((100 - wt2) / 18.01528 + wt2 / 88.10512);
    assert.ok(Math.abs(b.y[0] - yw) < 0.03, `${model}: vapour water ${b.y[0].toFixed(3)} vs ${yw.toFixed(3)}`);
  }
});

test("water + ethyl acetate: parameters carry their data range and calculations outside it warn", () => {
  for (const model of ["NRTL", "UNIQUAC"]) {
    const s = system({ components: ["water", "ethyl acetate"], model });
    const [lo, hi] = s.info.pairs[0].T_range_K;
    assert.ok(lo < 275 && hi > 343, `${model}: range ${lo}-${hi} K`);
    assert.ok(s.info.pairs[0].source.includes(`${lo}-${hi} K`), "range stated in source");
    assert.deepEqual(s.bubbleP([0.5, 0.5], 330).warnings, []);
    assert.match(s.bubbleP([0.5, 0.5], hi + 30).warnings.join(" "), /outside that range/);
  }
  // pairs fitted without temperature dependence carry no range and never warn
  const e = system({ components: ["ethanol", "water"], model: "NRTL" });
  assert.equal(e.info.pairs[0].T_range_K, null);
  assert.deepEqual(e.bubbleT([0.5, 0.5], 101.325).warnings, []);
});

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
