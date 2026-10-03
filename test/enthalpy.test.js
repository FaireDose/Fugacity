// Proposal 0001, step 3: mixture enthalpy, excess enthalpy and the state of one phase.
// Reference: validation/fixtures/enthalpy.json from validation/python/reference_enthalpy.py
// (heat capacities integrated with scipy, IAPWS-IF97 from the iapws package, residual
// enthalpies from the independent cubic, excess enthalpies from the thermo library).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { system, pure, FugacityError } from "../src/index.js";

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const { cases } = load("../validation/fixtures/enthalpy.json");

test("mixture enthalpies match the independent reference", () => {
  assert.ok(cases.length >= 25);
  for (const c of cases) {
    const s = system({ components: c.components, model: c.model, ...(c.kind === "activity" ? { vapour: c.vapour } : {}) });
    const tag = `${c.kind} ${c.model}${c.vapour ? "/" + c.vapour : ""} ${c.components.join("+")} ${c.phase ?? ""} z=${c.z} T=${c.T_K}`;
    if (c.kind === "excess") {
      const he = s.excessEnthalpy(c.z, c.T_K);
      assert.ok(Math.abs(he - c.hE_J_mol) < 0.01, `${tag}: hE ${he} vs ${c.hE_J_mol}`);
      continue;
    }
    const p = s.phase(c.phase, c.T_K, c.P_kPa, c.z);
    // 0.05 J/mol: quadrature and finite-difference differences between the two codes
    assert.ok(Math.abs(p.h_J_mol - c.h_J_mol) < 0.05, `${tag}: h ${p.h_J_mol} vs ${c.h_J_mol}`);
    if (c.hE_J_mol !== undefined) assert.ok(Math.abs(p.hE_J_mol - c.hE_J_mol) < 0.01, `${tag}: hE`);
    assert.equal(s.enthalpy(c.phase, c.T_K, c.P_kPa, c.z), p.h_J_mol);
  }
});

test("liquid heat-capacity basis: exact latent heat at 25 °C, Kirchhoff's law above it", () => {
  for (const vapour of ["ideal", "PR", "SRK"]) {
    const s = system({ components: ["water", "ethanol"], model: "NRTL", vapour });
    for (const i of [0, 1]) {
      const z = i === 0 ? [1, 0] : [0, 1];
      const P0 = s.psat(298.15)[i];
      const d0 = s.enthalpy("vapour", 298.15, P0, z) - s.enthalpy("liquid", 298.15, P0, z);
      const r0 = pure(s.ids[i]).property("heatOfVaporization", 298.15);
      assert.ok(Math.abs(d0 - r0) < 1e-6 * r0, `${vapour} ${s.names[i]} at 25 °C: ${d0} vs ${r0}`);
      // at the normal boiling point h_V - h_L follows Kirchhoff's law: within 2 % of the record
      const T = s.boilingPoints(101.325)[i];
      const d = s.enthalpy("vapour", T, 101.325, z) - s.enthalpy("liquid", T, 101.325, z);
      const r = pure(s.ids[i]).property("heatOfVaporization", T);
      assert.ok(Math.abs(d / r - 1) < 0.02, `${vapour} ${s.names[i]} at Tb: ${d} vs ${r}`);
    }
  }
});

test("the liquid's sensible heat follows the measured heat capacity (CoolProp, 300 K to 400 K)", () => {
  const { sensible_heat } = load("../validation/fixtures/enthalpy.json");
  const other = { water: "ethanol", methanol: "water", ethanol: "water", acetone: "methanol", benzene: "toluene", toluene: "benzene" };
  for (const r of sensible_heat) {
    const s = system({ components: [r.component, other[r.component]], model: "NRTL", allowMissingPairs: true });
    const dh = s.enthalpy("liquid", r.T2_K, 101.325, [1, 0]) - s.enthalpy("liquid", r.T1_K, 101.325, [1, 0]);
    assert.ok(Math.abs(dh - r.cpL_integral_J_mol) < 0.05, `${r.component}: ${dh} vs integral ${r.cpL_integral_J_mol}`);
    assert.ok(Math.abs(dh / r.coolprop_dh_J_mol - 1) < 0.01, `${r.component}: ${dh} vs CoolProp ${r.coolprop_dh_J_mol}`);
  }
});

test("above the end of a heat-capacity record the liquid enthalpy continues smoothly, with a warning", () => {
  const s = system({ components: ["chloroform", "acetone"], model: "NRTL" });
  const Tend = pure("chloroform").record("liquidHeatCapacity").Tmax_K;
  const h = T => s.phase("liquid", T, 500, [1, 0]);
  assert.ok(Math.abs(h(Tend + 1e-6).h_J_mol - h(Tend - 1e-6).h_J_mol) < 1e-2, "continuous");
  assert.equal(h(Tend - 1).warnings.some(w => /heat-capacity record ends/.test(w)), false);
  assert.ok(h(Tend + 10).warnings.some(w => /heat-capacity record ends/.test(w)));
});

test("water against the steam tables: the liquid enthalpy follows IAPWS-IF97", () => {
  // Same reference (ideal gas at 298.15 K) on both sides: pure("water").saturation() is IF97.
  const w = pure("water");
  const s = system({ components: ["water", "ethanol"], model: "NRTL" });
  // The anchor at 25 °C leaves out the residual enthalpy of saturated steam there (ideal-gas
  // vapour), a constant offset; above it, cp along saturation instead of dh'/dT adds a drift.
  const offset = -(w.saturation(298.15).hV_J_mol - w.hIdealGas(298.15));
  for (const T of [298.15, 323.15, 373.15, 423.15]) {
    const sat = w.saturation(T);
    const hL = s.enthalpy("liquid", T, sat.P_kPa, [1, 0]);
    assert.ok(Math.abs(hL - sat.hL_J_mol - offset) < 10, `T=${T}: ${hL - sat.hL_J_mol} vs offset ${offset}`);
  }
  assert.ok(Math.abs(offset) < 30, `offset ${offset} J/mol`);
});

test("fugacities of the two phases are equal at a computed bubble point", () => {
  for (const vapour of ["ideal", "PR"]) {
    const s = system({ components: ["methanol", "acetone", "chloroform"], model: "UNIQUAC", vapour });
    const x = [0.3, 0.3, 0.4], P = vapour === "ideal" ? 101.325 : 800;
    const b = s.bubbleT(x, P);
    const L = s.phase("liquid", b.T, P, x), V = s.phase("vapour", b.T, P, b.y);
    L.lnFugacity.forEach((v, i) => assert.ok(Math.abs(v - V.lnFugacity[i]) < 1e-8, `${vapour}: component ${i}`));
  }
  const g = system({ components: ["methane", "ethane"], model: "PR" });
  const b = g.bubbleP([0.3, 0.7], 200);
  const L = g.phase("liquid", 200, b.P, [0.3, 0.7]), V = g.phase("vapour", 200, b.P, b.y);
  L.lnFugacity.forEach((v, i) => assert.ok(Math.abs(v - V.lnFugacity[i]) < 1e-8, `PR: component ${i}`));
});

test("the pressure effect on the liquid, neglected, is small (stated size)", () => {
  // v_L (P - P_sat) for water 10 bar above its vapour pressure at 373 K
  const vL = pure("water").MW / 1000 / pure("water").property("liquidDensity", 373.15);
  const neglected = vL * 1000e3;
  assert.ok(neglected > 15 && neglected < 20, `${neglected} J/mol`);
  const s = system({ components: ["water", "ethanol"], model: "NRTL" });
  assert.equal(s.enthalpy("liquid", 373.15, 101.325, [1, 0]), s.enthalpy("liquid", 373.15, 1101.325, [1, 0]));
});

test("excess enthalpy of acetic acid + ethylene glycol against Schmid et al. (2007), which the fit used", () => {
  // Consistency, not an independent check: the parameters were fitted to these data
  // (AAD 30 J/mol NRTL, 24 J/mol UNIQUAC, src/data/binaries.json).
  const data = load("../validation/data/schmid2007_acetic_acid_ethylene_glycol.json").HE_323K;
  for (const [model, aad] of [["NRTL", 30], ["UNIQUAC", 24]]) {
    const s = system({ components: ["acetic acid", "ethylene glycol"], model });
    const dev = data.map(p => Math.abs(s.excessEnthalpy([p.x1, 1 - p.x1], 323.15) - p.HE_J_mol));
    const mean = dev.reduce((a, b) => a + b, 0) / dev.length;
    assert.ok(Math.abs(mean - aad) < 3, `${model}: AAD ${mean.toFixed(1)} J/mol, fit reported ${aad}`);
  }
});

test("errors: dimerizing acid, phase name, above the critical temperature", () => {
  const code = (fn, c, re) => assert.throws(fn, e => e instanceof FugacityError && e.code === c && re.test(e.message));
  const a = system({ components: ["acetic acid", "ethylene glycol"], model: "NRTL" });
  code(() => a.enthalpy("liquid", 350, 101.325, [0.5, 0.5]), "NOT_AVAILABLE", /dimerizes.*excessEnthalpy/);
  assert.ok(Number.isFinite(a.enthalpy("liquid", 350, 101.325, [0, 1])), "pure glycol has an enthalpy");
  const s = system({ components: ["ethanol", "water"], model: "NRTL" });
  code(() => s.phase("solid", 300, 101.325, [0.5, 0.5]), "BAD_INPUT", /Phase must be/);
  code(() => s.enthalpy("liquid", 500, 101.325, [0.5, 0.5]), "OUT_OF_RANGE", /Ethanol, heat of vaporization/);
  const p = system({ components: ["ethanol", "water"], model: "NRTL", vapour: "PR" });
  code(() => p.enthalpy("liquid", 520, 5000, [0.5, 0.5]), "OUT_OF_RANGE", /above its critical temperature/);
  // a vapour above the critical temperature is fine
  assert.ok(Number.isFinite(p.enthalpy("vapour", 520, 101.325, [0.5, 0.5])));
});

test("acetic acid enthalpies are refused also when the chemical theory is switched off", () => {
  const s = system({ components: ["acetic acid", "ethylene glycol"], model: "NRTL", association: false });
  assert.throws(() => s.enthalpy("liquid", 350, 101.325, [0.5, 0.5]), e => e instanceof FugacityError && e.code === "NOT_AVAILABLE");
  assert.ok(Number.isFinite(s.excessEnthalpy([0.5, 0.5], 323.15)));
});
