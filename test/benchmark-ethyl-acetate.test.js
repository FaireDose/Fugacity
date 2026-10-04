// Proposal 0004, step 3: the pairs of the ethyl acetate by esterification benchmark
// (docs/BENCHMARKS.md) against their open data. Comparisons with the data a set was fitted to
// guard the fit against regressions; the independent checks are the other data sets of each
// pair (named below). Acetic acid dimerizes in the vapour: the activity models use the
// chemical theory for it, as in the fits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { system } from "../src/index.js";

const load = p => JSON.parse(readFileSync(new URL(`../validation/data/${p}`, import.meta.url)));
const mean = v => v.reduce((a, b) => a + b, 0) / v.length;
const col = d => Object.fromEntries(d.columns.map((c, k) => [c, k]));

/** AAD in T (K) and y over the binary points of an isobaric T-x-y file. */
function txyDev(s, file) {
  const d = load(file), c = col(d);
  const pts = d.rows.filter(r => r[c.x_1] > 0 && r[c.x_1] < 1);
  const dev = pts.map(r => { const b = s.bubbleT([r[c.x_1], 1 - r[c.x_1]], d.P_kPa); return [Math.abs(b.T - r[c.T_K]), Math.abs(b.y[0] - r[c.y_1])]; });
  return { T: mean(dev.map(v => v[0])), y: mean(dev.map(v => v[1])) };
}

/** AARD (%) of the total pressure of an isothermal P-x file, the activity coefficients of the
 * engine and the pure-component pressures measured in the same set (as in the fit): with
 * chemical theory for a dimerizing component the partial pressures are not linear in the
 * vapour pressure, so the engine's own bubble pressure is rescaled per component. */
function pxDev(s, file) {
  const d = load(file), c = col(d);
  const pure = {};
  for (const r of d.rows) if (r[c.x_1] === 0 || r[c.x_1] === 1) (pure[r[c.T_K]] ??= [])[r[c.x_1] === 1 ? 0 : 1] = r[c.P_kPa];
  const dev = [];
  for (const r of d.rows) {
    const x = r[c.x_1];
    if (x <= 0 || x >= 1) continue;
    const T = r[c.T_K];
    // the engine's pure-component pressures at T, to compare like with like
    const p1 = s.bubbleP([1, 0], T).P, p2 = s.bubbleP([0, 1], T).P;
    const ps = pure[T];
    // engine bubble pressure with the databank vapour pressures, scaled by the measured pure
    // pressures (exact for ideal vapours; for these two files it agrees with the exact Python
    // calculation of fit_parameters.py within 0.01 % of the AARD)
    const b = s.bubbleP([x, 1 - x], T);
    const scaled = b.P * (b.y[0] * ps[0] / p1 + b.y[1] * ps[1] / p2);
    dev.push(Math.abs(scaled / r[c.P_kPa] - 1) * 100);
  }
  return mean(dev);
}

test("water + acetic acid: Chang et al. (2005), fitted, and Calvar et al. (2005), a check", () => {
  for (const model of ["NRTL", "UNIQUAC"]) {
    const s = system({ components: ["water", "acetic acid"], model });
    assert.equal(s.info.pairs[0].tier, "fitted");
    const fit = txyDev(s, "water_acetic-acid_101kPa_chang2005.json");
    assert.ok(fit.T < 0.3 && fit.y < 0.01, `${model}: Chang ${fit.T.toFixed(2)} K, ${fit.y.toFixed(4)}`);
    const chk = txyDev(s, "water_acetic-acid_101kPa_calvar2005.json");
    assert.ok(chk.T < 0.5 && chk.y < 0.035, `${model}: Calvar ${chk.T.toFixed(2)} K, ${chk.y.toFixed(4)}`);
  }
});

test("ethyl acetate + acetic acid: static P-x at 323 K, fitted; the 1-atm T-x-y and the excess enthalpy, checks", () => {
  for (const [model, aadHE] of [["NRTL", 19], ["UNIQUAC", 108]]) {
    const s = system({ components: ["ethyl acetate", "acetic acid"], model });
    assert.equal(s.info.pairs[0].tier, "fitted");
    assert.ok(pxDev(s, "ethyl-acetate_acetic-acid_px_brandt2014.json") < 0.3, model);
    const chk = txyDev(s, "ethyl-acetate_acetic-acid_101kPa.json");
    assert.ok(chk.T < 0.3, `${model}: 1-atm T ${chk.T.toFixed(2)} K`);
    const he = load("ethyl-acetate_acetic-acid_HE_brandt2014.json");
    const dh = mean(he.rows.map(([x, h]) => Math.abs(s.excessEnthalpy([x, 1 - x], he.T_K) - 1000 * h)));
    assert.ok(Math.abs(dh - aadHE) < 3, `${model}: excess enthalpy AAD ${dh.toFixed(0)} J/mol, fit reported ${aadHE}`);
  }
});

test("ethanol + acetic acid: 1-atm T-x-y and static P-x fitted together (they disagree)", () => {
  for (const model of ["NRTL", "UNIQUAC"]) {
    const s = system({ components: ["ethanol", "acetic acid"], model });
    assert.equal(s.info.pairs[0].tier, "fitted");
    const t = txyDev(s, "ethanol_acetic-acid_101kPa.json");
    // the fit reports 1.25 K (NRTL) and 1.44 K (UNIQUAC): the price of following the P-x data
    assert.ok(t.T < 1.5, `${model}: 1-atm T ${t.T.toFixed(2)} K`);
    assert.ok(pxDev(s, "ethanol_acetic-acid_px_brandt2014.json") < 1.0, model);
  }
});

test("equation of state (second model): fitted k_ij of ethanol + ethyl acetate against Calvar et al. (2005)", () => {
  // AAD in T reported by validation/python/eos_fit_kij.py (independent Python implementation);
  // the acetic acid pairs have no k_ij (no vapour dimerization in a cubic equation of state)
  const d = load("ethyl-acetate_ethanol_101kPa.json"), c = col(d);
  const pts = d.rows.filter(r => r[c.x_1] > 0 && r[c.x_1] < 1);
  for (const [model, aad] of [["PR", 0.40], ["SRK", 0.26]]) {
    const s = system({ components: d.components, model });
    assert.equal(s.info.pairs[0].tier, "fitted");
    const dT = pts.map(r => Math.abs(s.bubbleT([r[c.x_1], 1 - r[c.x_1]], d.P_kPa).T - r[c.T_K]));
    assert.ok(Math.abs(mean(dT) - aad) < 0.02, `${model}: AAD ${mean(dT).toFixed(3)} K, fit reported ${aad}`);
  }
});
