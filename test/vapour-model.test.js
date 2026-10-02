// Proposal 0001, step 2: activity-coefficient liquids with a Peng-Robinson or SRK vapour.
// Reference: validation/fixtures/gamma_phi_vapour.json, written by
// validation/python/reference_gamma_phi.py (independent implementation, checked there against
// the thermo library's FlashVL to 1e-8 K).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { system, FugacityError } from "../src/index.js";

const { cases } = JSON.parse(readFileSync(new URL("../validation/fixtures/gamma_phi_vapour.json", import.meta.url)));

test("bubble and dew points with a PR or SRK vapour match the independent reference", () => {
  assert.ok(cases.length >= 25);
  const cache = new Map();
  for (const c of cases) {
    const key = [c.model, c.vapour, ...c.components].join();
    if (!cache.has(key)) cache.set(key, system({ components: c.components, model: c.model, vapour: c.vapour }));
    const s = cache.get(key);
    const tag = `${key} z=${c.z}`;
    if (c.bubbleT) {
      const b = s.bubbleT(c.z, c.P_kPa);
      assert.ok(Math.abs(b.T - c.bubbleT.T_K) < 1e-4, `${tag} P=${c.P_kPa}: bubble T ${b.T} vs ${c.bubbleT.T_K}`);
      b.y.forEach((v, i) => assert.ok(Math.abs(v - c.bubbleT.y[i]) < 1e-6, `${tag}: y`));
      const d = s.dewT(c.z, c.P_kPa);
      assert.ok(Math.abs(d.T - c.dewT.T_K) < 1e-4, `${tag} P=${c.P_kPa}: dew T ${d.T} vs ${c.dewT.T_K}`);
      d.x.forEach((v, i) => assert.ok(Math.abs(v - c.dewT.x[i]) < 1e-6, `${tag}: x`));
    } else {
      const b = s.bubbleP(c.z, c.T_K);
      assert.ok(Math.abs(b.P / c.bubbleP.P_kPa - 1) < 1e-8, `${tag} T=${c.T_K}: bubble P ${b.P} vs ${c.bubbleP.P_kPa}`);
    }
  }
});

test("the default vapour is the ideal gas, with results exactly as before", () => {
  const a = system({ components: ["ethanol", "water"], model: "NRTL" });
  const b = system({ components: ["ethanol", "water"], model: "NRTL", vapour: "ideal" });
  assert.equal(a.vapour, "ideal");
  assert.equal(a.bubbleT([0.3, 0.7], 101.325).T, b.bubbleT([0.3, 0.7], 101.325).T);
  assert.equal(a.info.vapour, "ideal gas");
});

test("the vapour correction is small at 1 atm and grows with pressure", () => {
  const ideal = system({ components: ["methanol", "water"], model: "NRTL" });
  const pr = system({ components: ["methanol", "water"], model: "NRTL", vapour: "PR" });
  const d1 = Math.abs(pr.bubbleT([0.5, 0.5], 101.325).T - ideal.bubbleT([0.5, 0.5], 101.325).T);
  const d20 = Math.abs(pr.bubbleT([0.5, 0.5], 2000).T - ideal.bubbleT([0.5, 0.5], 2000).T);
  assert.ok(d1 < 0.1, `1 atm: ${d1} K`);
  assert.ok(d20 > d1 * 3, `20 bar: ${d20} K vs 1 atm ${d1} K`);
  const e = pr.equilibrium([0.5, 0.5], 400);
  assert.ok(e.phi.every(v => v > 0.8 && v < 1) && e.phiSat.every(v => v > 0.8 && v < 1), `${e.phi} ${e.phiSat}`);
  // Poynting: above 1 for the component whose vapour pressure is below P, below 1 for the other
  assert.ok(e.poynting.every(v => Math.abs(v - 1) < 0.01), String(e.poynting));
});

test("diagrams and azeotropes work with a cubic vapour", () => {
  const s = system({ components: ["ethanol", "water"], model: "NRTL", vapour: "SRK" });
  const az = s.azeotropes(101.325);
  assert.equal(az.length, 1);
  assert.ok(Math.abs(az[0].T - 351.3) < 0.5, String(az[0].T));
  assert.equal(s.txy(101.325, 11).length, 11);
  const t = system({ components: ["methanol", "acetone", "chloroform"], model: "UNIQUAC", vapour: "PR" });
  const g = t.ternaryGrid(101.325, 6);
  assert.ok(g.nodes.length > 20 && g.nodes.every(q => Number.isFinite(q.T)), "ternary grid");
});

test("vapour options are checked", () => {
  const err = (fn, code, re) => assert.throws(fn, e => e instanceof FugacityError && e.code === code && re.test(e.message));
  err(() => system({ components: ["ethanol", "water"], model: "NRTL", vapour: "virial" }), "BAD_INPUT", /Unknown vapour model "virial"/);
  err(() => system({ components: ["methane", "ethane"], model: "PR", vapour: "SRK" }), "BAD_INPUT", /describes both phases/);
  err(() => system({ components: ["water", "acetic acid"], model: "NRTL", vapour: "PR" }), "NOT_AVAILABLE", /dimerizes/);
  // PR for both phases may also name its own vapour
  assert.equal(system({ components: ["methane", "ethane"], model: "PR", vapour: "PR" }).model, "PR");
  // a missing vapour k_ij is reported in info, not hidden
  const s = system({ components: ["toluene", "chloroform"], model: "NRTL", vapour: "PR" });
  assert.match(s.info.vapour, /k_ij = 0 for Toluene \+ Chloroform/);
  assert.equal(s.info.vapourPairs[0].tier, "none");
});

test("the workbench keeps the vapour model in its state and passes it to activity models only", async () => {
  const { initialState, applyPatch, setsFor } = await import("../src/ui/app-logic.js");
  const s0 = initialState({ components: ["ethanol", "water"] });
  assert.equal(s0.vapour, "ideal");
  const s1 = applyPatch(s0, { vapour: "srk" });
  assert.equal(s1.vapour, "SRK");
  assert.equal(initialState({ vapour: "PR" }).vapour, "PR");
  assert.throws(() => applyPatch(s0, { vapour: "virial" }), /Unknown vapour model/);
  assert.equal(setsFor(s1, "NRTL").vapour, "SRK");
  assert.equal("vapour" in setsFor(s1, "PR"), false);
});
