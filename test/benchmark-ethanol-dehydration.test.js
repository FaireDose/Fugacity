// Proposal 0004, step 3: the pairs of the ethanol dehydration benchmark (docs/BENCHMARKS.md)
// against their open data. The T-x-y sets of ethanol + ethylene glycol and water + ethylene
// glycol are in fitted-pairs.test.js. Most comparisons here are with the data the parameters
// were fitted to (validation/python/fit_parameters.py): they guard the fits against
// regressions. Independent checks: the heterogeneous azeotrope of water + cyclohexane, the
// azeotrope and the excess enthalpy of ethanol + cyclohexane (databank parameters), and the
// older water + ethylene glycol compilation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { system, pure } from "../src/index.js";
import { binaryAzeotropes } from "../src/equilibrium/azeotrope.js";

const load = p => JSON.parse(readFileSync(new URL(`../validation/data/${p}`, import.meta.url)));
const mean = v => v.reduce((a, b) => a + b, 0) / v.length;
const col = d => Object.fromEntries(d.columns.map((c, k) => [c, k]));

/** Binary liquid-liquid split at T (Newton on the two isoactivity equations in logit
 * variables, numerical Jacobian), started from guess = [x1 in liquid I, x1 in liquid II]. */
function lle(s, T, guess) {
  const lnA = x => s.gammas(x, T).map((g, i) => Math.log(x[i] * g));
  const ex = u => 1 / (1 + Math.exp(-u));
  const F = u => { const a = ex(u[0]), b = ex(u[1]); const p = lnA([a, 1 - a]), q = lnA([b, 1 - b]); return [p[0] - q[0], p[1] - q[1]]; };
  let u = guess.map(v => Math.log(v / (1 - v)));
  for (let it = 0; it < 200; it++) {
    const f = F(u);
    if (Math.hypot(...f) < 1e-12) break;
    const h = 1e-7, J = [0, 1].map(k => { const v = u.slice(); v[k] += h; const g = F(v); return [(g[0] - f[0]) / h, (g[1] - f[1]) / h]; });
    const det = J[0][0] * J[1][1] - J[1][0] * J[0][1];
    const d = [-(f[0] * J[1][1] - f[1] * J[1][0]) / det, -(J[0][0] * f[1] - J[0][1] * f[0]) / det];
    const lam = Math.min(1, 2 / Math.max(Math.abs(d[0]), Math.abs(d[1])));
    u = u.map((v, k) => v + lam * d[k]);
  }
  const z = u.map(ex);
  assert.ok(Math.hypot(...F(u)) < 1e-9 && Math.abs(z[0] - z[1]) > 1e-3, `no liquid-liquid split at ${T} K`);
  return z;
}

/** Relative deviations of the dissolved (minor) component in each measured liquid. */
function solubilityDeviations(s, files) {
  const dev = { I: [], II: [] };
  for (const f of files) {
    const d = load(f), c = col(d);
    for (const r of d.rows) {
      const T = r[c.T_K];
      const xI = "x_1_I" in c ? r[c.x_1_I] : "x_2_I" in c ? 1 - r[c.x_2_I] : null;
      const xII = "x_1_II" in c ? r[c.x_1_II] : "x_2_II" in c ? 1 - r[c.x_2_II] : null;
      const z = lle(s, T, [xI ?? 1 - 1e-4, xII ?? 1e-3]);
      if (xI != null) dev.I.push(Math.abs((1 - z[0]) / (1 - xI) - 1));
      if (xII != null) dev.II.push(Math.abs(z[1] / xII - 1));
    }
  }
  return dev;
}

test("water + cyclohexane: mutual solubilities 295-446 K (fitted) and the 1-atm heterogeneous azeotrope (independent)", () => {
  const files = ["water_cyclohexane_lle_marche2006.json", "water_cyclohexane_lle_marche2003.json", "water_cyclohexane_lle_danon2018.json"];
  const az = load("water_cyclohexane_azeotrope_101kPa.json");
  const [T_C, wt2] = az.rows[0];
  const n1 = (100 - wt2) / pure("water").MW, n2 = wt2 / pure("cyclohexane").MW;
  const yWater = n1 / (n1 + n2);
  for (const model of ["NRTL", "UNIQUAC"]) {
    const s = system({ components: ["water", "cyclohexane"], model });
    assert.equal(s.info.pairs[0].tier, "fitted");
    // the fit reports 20-21 % (cyclohexane in water) and 14 % (water in cyclohexane)
    const dev = solubilityDeviations(s, files);
    assert.ok(mean(dev.I) < 0.25, `${model}: cyclohexane in water, AARD ${(100 * mean(dev.I)).toFixed(1)} %`);
    assert.ok(mean(dev.II) < 0.18, `${model}: water in cyclohexane, AARD ${(100 * mean(dev.II)).toFixed(1)} %`);
    // three-phase point at 1 atm from the engine's own flash (two liquids + vapour)
    const r = s.flash({ z: [0.5, 0.5], P: az.P_kPa, VF: 0 });
    assert.ok(Math.abs(r.T - 273.15 - T_C) < 1.0, `${model}: ${(r.T - 273.15).toFixed(2)} °C vs ${T_C} °C`);
    assert.ok(Math.abs(r.incipient.composition[0] - yWater) < 0.02, `${model}: vapour x_water ${r.incipient.composition[0].toFixed(3)} vs ${yWater.toFixed(3)}`);
  }
});

test("ethylene glycol + cyclohexane: mutual solubilities at 280-333 K (fitted)", () => {
  const d = load("ethylene-glycol_cyclohexane_lle_lindemann2014.json");
  for (const model of ["NRTL", "UNIQUAC"]) {
    const s = system({ components: ["ethylene glycol", "cyclohexane"], model });
    assert.equal(s.info.pairs[0].tier, "fitted");
    for (const [T, a, b] of d.rows) {
      const z = lle(s, T, [a, b]);
      assert.ok(Math.abs((1 - z[0]) / (1 - a) - 1) < 0.1, `${model} ${T} K: cyclohexane in glycol ${(1 - z[0]).toExponential(3)} vs ${(1 - a).toExponential(3)}`);
      assert.ok(Math.abs(z[1] / b - 1) < 0.2, `${model} ${T} K: glycol in cyclohexane ${z[1].toExponential(3)} vs ${b.toExponential(3)}`);
    }
  }
});

test("water + ethylene glycol: the older compilation, to which the pair was fitted before, as a check", () => {
  // The compilation scatters (its source note says so); the fit to Kamihama et al. (2012) is
  // 3.1 K off it on average, as the former fit to the compilation was off itself (3.0 K).
  const d = load("water_ethylene_glycol_760mmHg.json");
  for (const model of ["NRTL", "UNIQUAC"]) {
    const s = system({ components: ["water", "ethylene glycol"], model });
    const dT = d.txy.map(p => Math.abs(s.bubbleT([p.x_water, 1 - p.x_water], d.P_kPa).T - 273.15 - p.T_C));
    assert.ok(mean(dT) < 3.5, `${model}: AAD ${mean(dT).toFixed(2)} K`);
  }
});

test("ethanol + water: the default set stays the T-x-y fit; the vapour-liquid + excess-enthalpy set is an alternative", () => {
  const he = [];
  for (const f of ["ethanol_water_HE_nagamachi2006.json", "water_ethanol_HE_fang2014.json"]) {
    const d = load(f), c = col(d);
    const flip = d.components[0] === "water";
    for (const r of d.rows) {
      const x = flip ? r[c.x_1] : 1 - r[c.x_1];   // mole fraction of water
      he.push({ T: "T_K" in c ? r[c.T_K] : d.T_K, x, h: 1000 * r[c.HE_kJ_mol] });
    }
  }
  const tx = load("ethanol_water_101kPa.json");
  for (const [model, aadHE] of [["NRTL", 141], ["UNIQUAC", 65]]) {
    const def = system({ components: ["water", "ethanol"], model });
    assert.equal(def.info.pairs[0].set, "fitted-kamihama2012");
    const alt = system({ components: ["water", "ethanol"], model, sets: { "water+ethanol": "fitted-kamihama2012-etal" } });
    assert.equal(alt.info.pairs[0].tier, "fitted");
    const devAlt = he.map(p => Math.abs(alt.excessEnthalpy([p.x, 1 - p.x], p.T) - p.h));
    const devDef = he.map(p => Math.abs(def.excessEnthalpy([p.x, 1 - p.x], p.T) - p.h));
    assert.ok(Math.abs(mean(devAlt) - aadHE) < 5, `${model}: excess enthalpy AAD ${mean(devAlt).toFixed(0)} J/mol, fit reported ${aadHE}`);
    assert.ok(mean(devDef) > 3 * mean(devAlt), `${model}: the default set misses the excess enthalpy (${mean(devDef).toFixed(0)} J/mol)`);
    // ... and the alternative pays for it in the T-x-y data (fit reports AAD 0.8-0.9 K)
    const dT = tx.rows.map(([x1, T]) => Math.abs(alt.bubbleT([1 - x1, x1], tx.P_kPa).T - T));
    assert.ok(mean(dT) > 0.5 && mean(dT) < 1.0, `${model}: T-x-y AAD ${mean(dT).toFixed(2)} K`);
  }
});

test("ethanol + cyclohexane: databank sets against the open azeotrope and excess enthalpy (independent)", () => {
  const az = load("ethanol_cyclohexane_azeotrope_101kPa.json");
  const [T_C, wt2] = az.rows[0];
  const n1 = (100 - wt2) / pure("ethanol").MW, n2 = wt2 / pure("cyclohexane").MW;
  const xAz = n1 / (n1 + n2);
  const n = system({ components: ["ethanol", "cyclohexane"], model: "NRTL" });
  assert.equal(n.info.pairs[0].tier, "databank");
  const [z] = binaryAzeotropes(n, az.P_kPa);
  assert.ok(Math.abs(z.T - 273.15 - T_C) < 0.5 && Math.abs(z.x - xAz) < 0.01, `NRTL: ${(z.T - 273.15).toFixed(2)} °C, x ${z.x.toFixed(3)}`);
  assert.equal(z.type, "minimum-boiling");
  // one liquid over the whole range at 323.15 K, as measured (Lien et al. 2003)
  const he = load("ethanol_cyclohexane_HE_lien2003.json");
  for (const [x] of he.rows) assert.ok(n.isLiquidStable([x, 1 - x], he.T_K, 101.325), `NRTL: x = ${x} splits at ${he.T_K} K`);
  // UNIQUAC (databank) predicts two liquids there: a known deviation shown to users
  const u = system({ components: ["ethanol", "cyclohexane"], model: "UNIQUAC" });
  assert.equal(u.isLiquidStable([0.45, 0.55], he.T_K, 101.325), false);
  const known = JSON.parse(readFileSync(new URL("../src/data/known-issues.json", import.meta.url))).issues;
  assert.ok(known.some(k => k.model === "UNIQUAC" && k.kind === "phase-split" && k.components.join() === "ethanol,cyclohexane"));
});

test("equation of state (second model): fitted k_ij of the three miscible pairs against Kamihama et al. (2012)", () => {
  // AAD in T reported by validation/python/eos_fit_kij.py (independent Python implementation)
  const cases = [
    ["ethanol_water_101kPa.json", { PR: 0.72, SRK: 1.12 }],
    ["ethanol_ethylene-glycol_101kPa.json", { PR: 0.31, SRK: 0.25 }],
    ["water_ethylene-glycol_101kPa_kamihama2012.json", { PR: 1.88, SRK: 2.01 }],
  ];
  for (const [file, aad] of cases) {
    const d = load(file), c = col(d);
    for (const model of ["PR", "SRK"]) {
      const s = system({ components: d.components, model });
      const dT = d.rows.map(r => Math.abs(s.bubbleT([r[c.x_1], 1 - r[c.x_1]], d.P_kPa).T - r[c.T_K]));
      assert.ok(Math.abs(mean(dT) - aad[model]) < 0.02, `${model} ${file}: AAD ${mean(dT).toFixed(3)} K, fit reported ${aad[model]}`);
    }
  }
});
