// Proposal 0001, step 5: flashes with two liquids (activity models). Reference:
// validation/fixtures/three_phase.json from validation/python/reference_three_phase.py
// (binary: the liquid-liquid equilibrium and bubble pressure of an independent Python model
// with the lever rule; ternary: minimum of the Gibbs energy polished by the equal-fugacity
// equations; thermo's FlashVLN on the same states for comparison).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { system, pure, FugacityError } from "../src/index.js";

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const ref = load("../validation/fixtures/three_phase.json");

/** G/RT of a result, the same definition as the reference (sum beta x ln f). */
function gibbs(s, r) {
  return r.phases.reduce((g, p) => {
    const lf = s.phase(p.type, r.T, r.P, p.composition).lnFugacity;
    return g + p.fraction * p.composition.reduce((a, x, i) => a + (x > 0 ? x * lf[i] : 0), 0);
  }, 0);
}

/** Match the phases of a result with those of a reference case (type and composition). */
function samePhases(tag, r, phases, tol) {
  const want = phases.filter(p => p.fraction > 1e-12);
  const got = r.phases.filter(p => p.fraction > 1e-12);
  assert.equal(got.length, want.length, `${tag}: ${got.length} phases vs ${want.length}`);
  for (const w of want) {
    const g = got.filter(p => p.type === w.type)
      .sort((a, b) => Math.abs(a.composition[0] - w.x[0]) - Math.abs(b.composition[0] - w.x[0]))[0];
    assert.ok(g, `${tag}: no ${w.type}`);
    assert.ok(Math.abs(g.fraction - w.fraction) < tol, `${tag}: ${w.type} fraction ${g.fraction} vs ${w.fraction}`);
    g.composition.forEach((v, i) => assert.ok(Math.abs(v - w.x[i]) < tol, `${tag}: ${w.type} x${i} ${v} vs ${w.x[i]}`));
  }
}

test("binary water + ethyl acetate: two liquids, three-phase point and lever rule match the independent reference", () => {
  const s = system({ components: ["water", "ethyl acetate"], model: "NRTL" });
  for (const c of ref.binary) {
    const tag = `${JSON.stringify(c.spec)} z=${c.z}`;
    const r = s.flash({ z: c.z, ...c.spec });
    assert.ok(Math.abs(r.T - c.T_K) < 1e-6, `${tag}: T ${r.T} vs ${c.T_K}`);
    assert.ok(Math.abs(r.P / c.P_kPa - 1) < 1e-7, `${tag}: P ${r.P} vs ${c.P_kPa}`);
    samePhases(tag, r, c.phases, 1e-6);
    assert.ok(Math.abs(r.H_J_mol - c.H_J_mol) < 0.5, `${tag}: H ${r.H_J_mol} vs ${c.H_J_mol}`);
  }
  const b = s.flash({ z: [0.5, 0.5], P: 101.325, VF: 0 });
  assert.ok(Math.abs(b.T - ref.three_phase_point.T3_K) < 1e-6);
  assert.ok(Math.abs(b.incipient.composition[0] - ref.three_phase_point.y_water) < 1e-6);
});

test("ternary ethanol + water + ethyl acetate: two liquids and vapour + two liquids at the Gibbs-energy minimum", () => {
  for (const c of ref.ternary) {
    const s = system({ components: c.components, model: c.model });
    const tag = `${c.model} ${JSON.stringify(c.spec)}`;
    const r = s.flash({ z: c.z, ...c.spec });
    assert.ok(Math.abs(r.T - c.T_K) < 1e-6, `${tag}: T ${r.T} vs ${c.T_K}`);
    samePhases(tag, r, c.phases, 1e-6);
    // never above the Gibbs energy of the reference, nor of thermo's FlashVLN (which, near the
    // boundaries, returns two liquids where vapour + two liquids have a lower Gibbs energy)
    const g = gibbs(s, r);
    assert.ok(g <= c.G_RT + 1e-9, `${tag}: G ${g} vs reference ${c.G_RT}`);
    assert.ok(g <= c.thermo_FlashVLN.G_RT + 1e-9, `${tag}: G ${g} vs thermo ${c.thermo_FlashVLN.G_RT}`);
  }
});

test("every result with two liquids: mass balance, equal fugacities in all phases, labels", () => {
  const t = system({ components: ["ethanol", "water", "ethyl acetate"], model: "NRTL" });
  const b = t.flash({ z: [0.1, 0.4, 0.5], P: 101.325, VF: 0 }).T;
  for (const [s, z, T] of [
    [system({ components: ["water", "ethyl acetate"], model: "UNIQUAC" }), [0.5, 0.5], 320],
    [t, [0.1, 0.4, 0.5], b + 0.002],
  ]) {
    const r = s.flash({ z, T, P: 101.325 });
    const L = r.phases.filter(p => p.type === "liquid");
    assert.equal(L.length, 2);
    assert.deepEqual(L.map(p => p.label).sort(), ["Ethyl acetate-rich", "Water-rich"]);
    z.forEach((zi, i) => assert.ok(Math.abs(r.phases.reduce((a, p) => a + p.fraction * p.composition[i], 0) - zi) < 1e-10));
    const lf = r.phases.map(p => s.phase(p.type, T, 101.325, p.composition).lnFugacity);
    for (let k = 1; k < lf.length; k++) lf[k].forEach((v, i) => assert.ok(Math.abs(v - lf[0][i]) < 1e-8, `phase ${k} component ${i}`));
    assert.ok(Math.abs(r.H_J_mol - r.phases.reduce((a, p) => a + p.fraction * p.h_J_mol, 0)) < 1e-6);
  }
});

test("round trips across the three-phase temperature: VF and H give back the same state", () => {
  const s = system({ components: ["water", "ethyl acetate"], model: "NRTL" });
  const z = [0.5, 0.5];
  for (const VF of [0, 0.25, 0.6, 0.9]) {
    const r = s.flash({ z, P: 101.325, VF });
    const back = s.flash({ z, P: 101.325, H: r.H_J_mol });
    assert.ok(Math.abs(back.T - r.T) < 1e-6 && Math.abs(back.VF - VF) < 1e-7, `VF ${VF}: ${back.T} ${back.VF}`);
  }
  // heater: from the two liquids at 300 K to the three-phase point, a duty that boils 40 %
  const out = s.flash({ z, P: 101.325, VF: 0.4 }, { feed: { T: 300, P: 101.325 } });
  assert.ok(out.duty_J_mol > 0);
  assert.ok(Math.abs(out.duty_J_mol - (out.H_J_mol - s.flash({ z, T: 300, P: 101.325 }).H_J_mol)) < 1e-9);
});

test("against open data: mutual solubilities (Xu 2017, not used in the fit) and the heterogeneous azeotrope", () => {
  // The model, not the flash, sets these deviations: the fit (src/data/binaries.json) reports
  // AAD 0.0034 against Xu et al. (2017) and the azeotrope at 70.61 degC, y_water 0.313 (NRTL),
  // against the handbook 70.4 degC, 0.301 (a fit target, so a consistency check).
  const s = system({ components: ["water", "ethyl acetate"], model: "NRTL" });
  const ester = T => Math.min(...s.flash({ z: [0.6, 0.4], T, P: 101.325 }).phases.map(p => p.composition[1]));
  const xu = load("../validation/data/water_ethyl-acetate_lle_xu2017.json").rows;
  const aad = xu.reduce((a, [T, x2]) => a + Math.abs(ester(T) - x2), 0) / xu.length;
  assert.ok(Math.abs(aad - 0.0034) < 0.0005, `AAD ${aad}`);
  const az = load("../validation/data/water_ethyl-acetate_azeotrope_101kPa.json").rows[0];
  const b = s.flash({ z: [0.5, 0.5], P: 101.325, VF: 0 });
  assert.ok(Math.abs(b.T - 273.15 - az[0]) < 0.3, `T3 ${b.T - 273.15} degC vs ${az[0]}`);
  const [Mw, Me] = [pure("water").MW, pure("ethyl acetate").MW];
  const yData = (100 - az[1]) / Mw / ((100 - az[1]) / Mw + az[1] / Me);
  assert.ok(Math.abs(b.incipient.composition[0] - yData) < 0.015, `y ${b.incipient.composition[0]} vs ${yData}`);
});

test("speed: two liquids under 5 ms (T-P); binary P-H and P-VF across the three-phase point under 20 ms", () => {
  const s = system({ components: ["water", "ethyl acetate"], model: "NRTL" });
  const t = system({ components: ["ethanol", "water", "ethyl acetate"], model: "NRTL" });
  const median = f => { f(0); f(1); const a = []; for (let i = 0; i < 7; i++) { const t0 = performance.now(); f(i); a.push(performance.now() - t0); } return a.sort((x, y) => x - y)[3]; };
  for (const [what, f, budget] of [
    ["T-P binary", i => s.flash({ z: [0.5, 0.5], T: 300 + i, P: 101.325 }), 5],
    ["T-P ternary", i => t.flash({ z: [0.1, 0.4, 0.5], T: 300 + i, P: 101.325 }), 5],
    ["P-VF binary", i => s.flash({ z: [0.5, 0.5], P: 101.325, VF: 0.1 * i }), 20],
    ["P-H binary", i => s.flash({ z: [0.5, 0.5], P: 101.325, H: -20000 + 100 * i }), 20],
    // vapour + two liquids of a ternary: slower (successive substitution), stated in the docs
    ["P-H ternary", i => t.flash({ z: [0.1, 0.4, 0.5], P: 101.325, H: -25000 + 100 * i }), 60],
  ]) {
    const ms = median(f);
    assert.ok(ms < budget, `${what}: ${ms.toFixed(1)} ms (budget ${budget})`);
  }
});

test("still refused: two liquids with the acid chemical theory (no K-values to split them)", async () => {
  const { flash } = await import("../src/equilibrium/flash.js");
  // a system object whose liquid splits but that has no lnKValues (as with the chemical theory)
  const s = system({ components: ["water", "ethyl acetate"], model: "NRTL" });
  const noK = { ...s, lnKValues: null };
  assert.throws(() => flash(noK, { z: [0.5, 0.5], T: 300, P: 101.325 }),
    e => e instanceof FugacityError && e.code === "PHASE_SPLIT" && /acid chemical theory/.test(e.message));
});

test("the known-issue messages quote the flash's own three-phase results", () => {
  const known = load("../src/data/known-issues.json").issues;
  const ids = ["ethanol", "water", "ethyl acetate"], w = [7.8, 9.0, 83.2];
  const mol = w.map((v, i) => v / pure(ids[i]).MW), x = mol.map(v => v / mol.reduce((a, b) => a + b));
  for (const model of ["NRTL", "UNIQUAC"]) {
    const t = system({ components: ids, model }).flash({ z: x, P: 101.325, VF: 0 });
    const b = system({ components: ["water", "ethyl acetate"], model }).flash({ z: [0.5, 0.5], P: 101.325, VF: 0 });
    const msg = c => known.find(k => k.model === model && k.components.length === c).message;
    assert.ok(msg(3).includes(`${(t.T - 273.15).toFixed(2)} °C for the handbook liquid`), `${model} ternary ${(t.T - 273.15).toFixed(2)}`);
    assert.ok(msg(2).includes(`${(b.T - 273.15).toFixed(2)} °C, vapour water mole fraction ${b.incipient.composition[0].toFixed(3)}`), `${model} binary`);
  }
});
