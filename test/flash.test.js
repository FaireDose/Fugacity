// Proposal 0001, step 4: the two-phase flash. Reference: validation/fixtures/flash.json from
// validation/python/reference_flash.py (thermo's FlashVL for the split; independent
// enthalpies and scipy brentq for the enthalpy flashes).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { system, rachfordRice, FugacityError, pure } from "../src/index.js";

const { cases } = JSON.parse(readFileSync(new URL("../validation/fixtures/flash.json", import.meta.url)));

test("flashes match the independent reference (thermo FlashVL and independent enthalpies)", () => {
  assert.ok(cases.length >= 18);
  for (const c of cases) {
    const s = system({ components: c.components, model: c.model, ...(c.vapour ? { vapour: c.vapour } : {}) });
    const r = s.flash({ z: c.z, ...c.spec });
    const tag = `${c.model}${c.vapour ? "/" + c.vapour : ""} ${c.components.join("+")} ${JSON.stringify(c.spec)}`;
    assert.ok(Math.abs(r.T - c.T_K) < 1e-3, `${tag}: T ${r.T} vs ${c.T_K}`);
    assert.ok(Math.abs(r.P / c.P_kPa - 1) < 1e-6, `${tag}: P ${r.P} vs ${c.P_kPa}`);
    assert.ok(Math.abs(r.VF - c.VF) < 1e-5, `${tag}: VF ${r.VF} vs ${c.VF}`);
    assert.ok(Math.abs(r.H_J_mol - c.H_J_mol) < 0.5, `${tag}: H ${r.H_J_mol} vs ${c.H_J_mol}`);
    const L = r.phases.find(p => p.type === "liquid"), V = r.phases.find(p => p.type === "vapour");
    if (L && c.x && c.VF < 1) L.composition.forEach((v, i) => assert.ok(Math.abs(v - c.x[i]) < 1e-5, `${tag}: x`));
    if (V && c.y && c.VF > 0) V.composition.forEach((v, i) => assert.ok(Math.abs(v - c.y[i]) < 1e-5, `${tag}: y`));
  }
});

test("mass balance, phase equilibrium and enthalpy of every two-phase result", () => {
  for (const [ids, model, vapour, z, T, P] of [
    [["ethanol", "water"], "NRTL", "ideal", [0.4, 0.6], 357, 101.325],
    [["methanol", "acetone", "chloroform"], "UNIQUAC", "SRK", [0.3, 0.3, 0.4], 400, 800],
    [["methane", "ethane"], "PR", undefined, [0.5, 0.5], 220, 2000],
  ]) {
    const s = system({ components: ids, model, ...(vapour ? { vapour } : {}) });
    const r = s.flash({ z, T, P });
    const [Vp, Lp] = [r.phases.find(p => p.type === "vapour"), r.phases.find(p => p.type === "liquid")];
    z.forEach((zi, i) => assert.ok(Math.abs(Vp.fraction * Vp.composition[i] + Lp.fraction * Lp.composition[i] - zi) < 1e-10, `${ids}: balance`));
    const fL = s.phase("liquid", T, P, Lp.composition).lnFugacity, fV = s.phase("vapour", T, P, Vp.composition).lnFugacity;
    fL.forEach((v, i) => assert.ok(Math.abs(v - fV[i]) < 1e-8, `${ids}: fugacity ${i}`));
    assert.ok(Math.abs(r.H_J_mol - (Vp.fraction * Vp.h_J_mol + Lp.fraction * Lp.h_J_mol)) < 1e-6);
  }
});

test("round trips: T-P to P-H and P-VF give back the temperature", () => {
  const s = system({ components: ["methanol", "acetone", "chloroform"], model: "UNIQUAC" });
  const z = [0.3, 0.3, 0.4];
  for (const T of [320, 330.5, 340]) {
    const r = s.flash({ z, T, P: 101.325 });
    assert.ok(Math.abs(s.flash({ z, P: 101.325, H: r.H_J_mol }).T - T) < 1e-6, `H round trip at ${T}`);
    if (r.VF > 0 && r.VF < 1) assert.ok(Math.abs(s.flash({ z, P: 101.325, VF: r.VF }).T - T) < 1e-6, `VF round trip at ${T}`);
  }
  const b = s.bubbleT(z, 101.325), d = s.dewT(z, 101.325);
  assert.ok(Math.abs(s.flash({ z, P: 101.325, VF: 0 }).T - b.T) < 1e-6);
  assert.ok(Math.abs(s.flash({ z, P: 101.325, VF: 1 }).T - d.T) < 1e-6);
});

test("pure water: an enthalpy flash at 1 atm lands at the boiling point with the lever rule", () => {
  const s = system({ components: ["water", "ethanol"], model: "NRTL" });
  // the boiling point of the system's water (its vapour-pressure record; IAPWS-IF97 gives 2 mK less)
  const P = 101.325, Tb = s.boilingPoints(P)[0];
  assert.ok(Math.abs(Tb - pure("water").tsat(P)) < 0.01);
  const hL = s.enthalpy("liquid", Tb, P, [1, 0]), hV = s.enthalpy("vapour", Tb, P, [1, 0]);
  for (const q of [0.1, 0.5, 0.9]) {
    const r = s.flash({ z: [1, 0], P, H: hL + q * (hV - hL) });
    assert.ok(Math.abs(r.T - Tb) < 1e-3, `T ${r.T}`);
    assert.ok(Math.abs(r.VF - q) < 1e-6, `VF ${r.VF}`);
  }
});

test("heat duty: Q = H_out - H_feed, and a heater with that duty gives back the outlet", () => {
  const s = system({ components: ["ethanol", "water"], model: "NRTL" });
  const z = [0.4, 0.6];
  const r = s.flash({ z, T: 358, P: 101.325 }, { feed: { T: 300, P: 101.325 } });
  const feed = s.flash({ z, T: 300, P: 101.325 });
  assert.ok(Math.abs(r.duty_J_mol - (r.H_J_mol - feed.H_J_mol)) < 1e-9);
  assert.ok(r.duty_J_mol > 0);
  const back = s.flash({ z, P: 101.325, H: feed.H_J_mol + r.duty_J_mol });
  assert.ok(Math.abs(back.T - 358) < 1e-6 && Math.abs(back.VF - r.VF) < 1e-8);
  // a valve: P-H flash from a hot liquid at 5 bar down to 1 atm, no duty
  const hot = s.flash({ z, T: 400, P: 500 });
  assert.equal(hot.phases.length, 1);
  const valve = s.flash({ z, P: 101.325, H: hot.H_J_mol }, { feed: { T: 400, P: 500 } });
  assert.ok(Math.abs(valve.duty_J_mol) < 1e-6 && valve.VF > 0 && valve.VF < 1 && valve.T < 400);
});

test("Rachford-Rice", () => {
  const V = rachfordRice([0.5, 0.5], [2, 0.5]);
  assert.ok(Math.abs(V - 0.5) < 1e-14);
  assert.equal(rachfordRice([0.5, 0.5], [0.5, 0.8]), -Infinity);
});

test("speed: a two-phase T-P flash of a ternary under 5 ms", () => {
  const s = system({ components: ["methanol", "acetone", "chloroform"], model: "UNIQUAC" });
  s.flash({ z: [0.3, 0.3, 0.4], T: 331, P: 101.325 });
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) s.flash({ z: [0.3, 0.3, 0.4], T: 330.6 + i * 0.03, P: 101.325 });
  const ms = (performance.now() - t0) / 20;
  assert.ok(ms < 5, `${ms.toFixed(2)} ms`);
});

test("flash errors: specification, acetic acid enthalpy, liquid split", () => {
  const s = system({ components: ["ethanol", "water"], model: "NRTL" });
  const code = (fn, c, re) => assert.throws(fn, e => e instanceof FugacityError && e.code === c && re.test(e.message), String(re));
  code(() => s.flash({ z: [0.5, 0.5], T: 350 }), "BAD_INPUT", /two of T, P, H, VF/);
  code(() => s.flash({ z: [0.5, 0.5], T: 350, P: 100, H: 0 }), "BAD_INPUT", /two of T, P, H, VF/);
  code(() => s.flash({ z: [0.5, 0.5], P: 100, VF: 1.5 }), "BAD_INPUT", /VF must be between 0 and 1/);
  code(() => s.flash({ z: [0.5], T: 350, P: 100 }), "BAD_INPUT", /Feed composition/);
  // acetic acid: T-P flash works, the enthalpy is null with the reason; P-H is refused
  const a = system({ components: ["water", "acetic acid"], model: "NRTL" });
  const r = a.flash({ z: [0.5, 0.5], T: 378, P: 101.325 });
  assert.ok(r.VF > 0 && r.VF < 1 && r.H_J_mol === null && r.warnings.some(w => /dimerizes/.test(w)));
  code(() => a.flash({ z: [0.5, 0.5], P: 101.325, H: 0 }), "NOT_AVAILABLE", /dimerizes/);
  // a liquid that splits into two liquids is resolved (step 5, test/three-phase.test.js)
  const w = system({ components: ["water", "ethyl acetate"], model: "NRTL" });
  assert.equal(w.flash({ z: [0.5, 0.5], T: 300, P: 101.325 }).phases.filter(p => p.type === "liquid").length, 2);
});

test("two liquids are found at the true liquid-liquid boundary (independent binodal)", async () => {
  const { liquidTangentPlane } = await import("../src/equilibrium/stability.js");
  const { binodal } = JSON.parse(readFileSync(new URL("../validation/fixtures/flash.json", import.meta.url)));
  const s = system({ components: ["water", "ethyl acetate"], model: "NRTL" });
  for (const b of binodal) {
    const [lo, hi] = b.x1;
    for (const [x, stable] of [[lo - 0.005, true], [lo + 0.005, false], [0.5, false], [hi - 0.002, false], [hi + 0.002, true]]) {
      assert.equal(liquidTangentPlane(s, [x, 1 - x], b.T_K).stable, stable, `T=${b.T_K} x=${x}`);
    }
  }
  // two liquids, not vapour + liquid (step 4 threw PHASE_SPLIT here; step 5 resolves them)
  const liquids = r => r.phases.filter(p => p.type === "liquid").length;
  assert.equal(liquids(s.flash({ z: [0.3, 0.7], T: 340, P: 101.325 })), 2);     // inside the binodal, outside the spinodal
  assert.equal(liquids(s.flash({ z: [0.98, 0.02], T: 340, P: 101.325 })), 2);   // vapour + water-rich liquid would be wrong
  assert.equal(liquids(s.flash({ z: [0.98, 0.02], P: 101.325, VF: 0 })), 2);
  assert.equal(liquids(s.flash({ z: [0.3, 0.7], P: 101.325, H: -20000 })), 2);
  // outside the two-liquid region the vapour-liquid flash is fine
  const r = s.flash({ z: [0.995, 0.005], T: 360, P: 101.325 });
  assert.ok(r.VF > 0 && r.VF < 1);
});

test("vapour-fraction flashes of a pure component and an azeotrope keep the vapour fraction asked for", () => {
  const w = system({ components: ["water", "ethanol"], model: "NRTL" });
  for (const VF of [0, 0.3, 0.5, 1]) {
    const r = w.flash({ z: [1, 0], T: 373.15, VF });
    assert.ok(Math.abs(r.VF - VF) < 1e-12, `water T-VF ${VF}: ${r.VF}`);
    assert.ok(Math.abs(r.P / w.psat(373.15)[0] - 1) < 1e-6);
  }
  const e = system({ components: ["ethanol", "water"], model: "NRTL" });
  const a = e.azeotropes(101.325)[0];
  for (const VF of [0.3, 1]) assert.ok(Math.abs(e.flash({ z: [a.x, 1 - a.x], T: a.T, VF }).VF - VF) < 1e-12);
  // VF = 0 and 1 report the first bubble or drop
  const b = e.flash({ z: [0.4, 0.6], P: 101.325, VF: 0 }), bub = e.bubbleT([0.4, 0.6], 101.325);
  b.incipient.composition.forEach((v, i) => assert.ok(Math.abs(v - bub.y[i]) < 1e-9));
  const d = e.flash({ z: [0.4, 0.6], P: 101.325, VF: 1 }), dew = e.dewT([0.4, 0.6], 101.325);
  assert.equal(d.incipient.type, "liquid");
  d.incipient.composition.forEach((v, i) => assert.ok(Math.abs(v - dew.x[i]) < 1e-9));
});

test("P-H flashes without a two-phase region at that pressure, and cold liquids", () => {
  const g = system({ components: ["methane", "ethane"], model: "PR" });
  const h = g.flash({ z: [0.5, 0.5], T: 250, P: 7000 }).H_J_mol; // above the highest two-phase pressure
  assert.ok(Math.abs(g.flash({ z: [0.5, 0.5], P: 7000, H: h }).T - 250) < 1e-6);
  const n = system({ components: ["nitrogen", "methane"], model: "SRK" });
  const hl = n.flash({ z: [0.4, 0.6], T: 130, P: 3000 }).H_J_mol;
  assert.ok(Math.abs(n.flash({ z: [0.4, 0.6], P: 3000, H: hl }).T - 130) < 1e-6);
});

test("speed: a two-phase T-P flash with an SRK vapour under 5 ms", () => {
  const s = system({ components: ["methanol", "acetone", "chloroform"], model: "UNIQUAC", vapour: "SRK" });
  s.flash({ z: [0.3, 0.3, 0.4], T: 400, P: 800 });
  const t0 = performance.now();
  for (let i = 0; i < 10; i++) s.flash({ z: [0.3, 0.3, 0.4], T: 399 + i * 0.2, P: 800 });
  const ms = (performance.now() - t0) / 10;
  assert.ok(ms < 5, `${ms.toFixed(2)} ms`);
});

test("speed: P-H flashes of up to 4 components under 20 ms (budget decided on #35)", () => {
  for (const [ids, z, H, vapour] of [
    [["ethanol", "water"], [0.4, 0.6], -20000, "ideal"],
    [["methanol", "acetone", "chloroform"], [0.3, 0.3, 0.4], -15000, "ideal"],
    [["methanol", "ethanol", "water", "acetone"], [0.25, 0.25, 0.25, 0.25], -20000, "ideal"],
    [["methanol", "acetone", "chloroform"], [0.3, 0.3, 0.4], -10000, "SRK"],
  ]) {
    const s = system({ components: ids, model: ids.length === 3 ? "UNIQUAC" : "NRTL", vapour });
    const P = vapour === "SRK" ? 800 : 101.325;
    s.flash({ z, P, H });
    const times = [];
    for (let i = 0; i < 5; i++) { const t0 = performance.now(); s.flash({ z, P, H: H + i }); times.push(performance.now() - t0); }
    const median = times.sort((a, b) => a - b)[2];
    assert.ok(median < 20, `${ids.join("+")} ${vapour}: ${median.toFixed(1)} ms`);
  }
});
