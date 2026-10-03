// Proposal 0001, step 1: dew points for activity-coefficient systems, input checks, and
// errors with codes. The dew points are compared with validation/fixtures/dew_points.json,
// written by validation/python/reference_dew.py from an independent Python implementation
// that was itself checked against the thermo library's FlashVL (see the script).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { system, dewT, dewP, createSystem, FugacityError, ERROR_CODES, isFugacityError, pure, steam } from "../src/index.js";

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url)));

test("dew points of NRTL and UNIQUAC systems match the independent reference", () => {
  const { cases } = load("../validation/fixtures/dew_points.json");
  assert.ok(cases.length >= 20);
  const cache = new Map();
  for (const c of cases) {
    const key = c.model + c.components.join();
    if (!cache.has(key)) cache.set(key, createSystem({ components: c.components, model: c.model }));
    const s = cache.get(key);
    const t = dewT(s, c.y, c.dewT.P_kPa);
    assert.ok(Math.abs(t.T - c.dewT.T_K) < 1e-4, `${key} y=${c.y}: dew T ${t.T} vs ${c.dewT.T_K}`);
    t.x.forEach((v, i) => assert.ok(Math.abs(v - c.dewT.x[i]) < 1e-6, `${key} y=${c.y}: x ${t.x} vs ${c.dewT.x}`));
    const p = dewP(s, c.y, c.dewP.T_K);
    assert.ok(Math.abs(p.P / c.dewP.P_kPa - 1) < 1e-8, `${key} y=${c.y}: dew P ${p.P} vs ${c.dewP.P_kPa}`);
    p.x.forEach((v, i) => assert.ok(Math.abs(v - c.dewP.x[i]) < 1e-6, `${key} y=${c.y}: x at dew P`));
  }
});

test("a dew point is the bubble point of its liquid (round trip, acetic acid included)", () => {
  for (const [ids, model] of [[["water", "acetic acid"], "NRTL"], [["methanol", "acetone", "chloroform"], "UNIQUAC"], [["ethanol", "water"], "ideal"]]) {
    const s = system({ components: ids, model });
    const y = ids.length === 2 ? [0.4, 0.6] : [0.2, 0.5, 0.3];
    const d = s.dewT(y, 101.325);
    const b = s.bubbleT(d.x, 101.325);
    assert.ok(Math.abs(b.T - d.T) < 1e-5, `${ids}: ${b.T} vs ${d.T}`);
    b.y.forEach((v, i) => assert.ok(Math.abs(v - y[i]) < 1e-8, `${ids}: y ${b.y}`));
    const dp = s.dewP(y, 350);
    const bp = s.bubbleP(dp.x, 350);
    assert.ok(Math.abs(bp.P / dp.P - 1) < 1e-9, `${ids}: P ${bp.P} vs ${dp.P}`);
  }
});

test("partly miscible pair: the dew point takes the stable first drop (water + ethyl acetate)", () => {
  // Both liquids are possible first drops near the heterogeneous azeotrope; the dew curve
  // must be continuous and every returned liquid stable.
  const s = system({ components: ["water", "ethyl acetate"], model: "NRTL" });
  let prev = null;
  for (let k = 1; k < 20; k++) {
    const y = [k / 20, 1 - k / 20];
    const d = s.dewT(y, 101.325);
    assert.ok(s.isLiquidStable(d.x, d.T), `y=${y}: liquid ${d.x} is not stable`);
    if (prev) assert.ok(Math.abs(d.T - prev) < 4, `y=${y}: dew T jumps from ${prev} to ${d.T}`);
    prev = d.T;
  }
});

test("vapours with a missing component: pure vapours dew at the boiling point", () => {
  const s = system({ components: ["ethanol", "water"], model: "NRTL" });
  const tb = s.boilingPoints(101.325);
  assert.ok(Math.abs(s.dewT([1, 0], 101.325).T - tb[0]) < 1e-5);
  assert.ok(Math.abs(s.dewT([0, 1], 101.325).T - tb[1]) < 1e-5);
  const t = system({ components: ["methanol", "acetone", "chloroform"], model: "UNIQUAC" });
  for (const y of [[0.5, 0.5, 0], [0, 0.3, 0.7], [0.2, 0, 0.8]]) {
    const d = t.dewT(y, 101.325);
    const b = t.bubbleT(d.x, 101.325);
    assert.ok(Math.abs(b.T - d.T) < 1e-5, `y=${y}`);
    y.forEach((v, i) => { if (v === 0) assert.ok(d.x[i] < 1e-15, `y=${y}: x ${d.x}`); });
    const p = t.dewP(y, 330);
    assert.ok(p.P > 0, `y=${y}`);
  }
});

test("equation-of-state systems keep their dew points", () => {
  const s = system({ components: ["methane", "ethane"], model: "PR" });
  const d = s.dewT([0.5, 0.5], 2000);
  assert.ok(d.T > 150 && d.T < 300 && d.x.length === 2);
});

test("inputs are checked before any solver runs", () => {
  const s = system({ components: ["ethanol", "water"], model: "NRTL" });
  const bad = (fn, re) => assert.throws(fn, e => e instanceof FugacityError && e.code === "BAD_INPUT" && re.test(e.message), String(re));
  bad(() => s.dewT([0.5], 101.325), /Vapour composition: give 2 mole fractions \(got 1\)/);
  bad(() => s.bubbleT([0.5, 0.5, 0], 101.325), /Liquid composition: give 2 mole fractions \(got 3\)/);
  bad(() => s.bubbleT([1.2, -0.2], 101.325), /must not be negative/);
  bad(() => s.dewP([0, 0], 350), /positive sum/);
  bad(() => s.bubbleT([0.5, "x"], 101.325), /not a number/);
  bad(() => s.bubbleT([0.5, 0.5], ""), /Pressure must be/);
  // numeric strings (an input field's value) and typed arrays are accepted, as before
  assert.equal(s.bubbleT(["0.5", "0.5"], "101.325").T, s.bubbleT([0.5, 0.5], 101.325).T);
  assert.equal(s.dewT(new Float64Array([0.5, 0.5]), 101.325).T, s.dewT([0.5, 0.5], 101.325).T);
  bad(() => s.bubbleT([0.5, 0.5], -5), /Pressure must be a positive number of kPa/);
  bad(() => s.dewP([0.5, 0.5], NaN), /Temperature must be a positive number of kelvin/);
  // rounding below zero is accepted and the composition is normalized, as before
  const t = system({ components: ["methanol", "acetone", "chloroform"], model: "NRTL" });
  const r = t.bubbleT([0.5, 0.5, -1e-12], 101.325);
  assert.ok(r.T > 320 && r.T < 340, String(r.T));
  assert.deepEqual(s.bubbleT([3, 7], 101.325).T, s.bubbleT([0.3, 0.7], 101.325).T);
});

test("errors carry codes and keep their class", () => {
  assert.deepEqual([...ERROR_CODES], ["BAD_INPUT", "OUT_OF_RANGE", "MISSING_DATA", "NO_CONVERGENCE", "PHASE_SPLIT", "NOT_AVAILABLE"]);
  const code = (fn, c, cls = Error) => assert.throws(fn, e => {
    assert.ok(e instanceof FugacityError, `not a FugacityError: ${e.message}`);
    assert.ok(e instanceof cls, `${e.message}: not a ${cls.name}`);
    assert.equal(e.code, c, e.message);
    assert.ok(isFugacityError(e, c));
    return true;
  });
  code(() => system({ components: ["water", "unobtainium"] }), "BAD_INPUT");
  code(() => system({ components: ["benzene", "ethylene glycol"], model: "NRTL" }), "MISSING_DATA");
  code(() => system({ components: ["water", "methane"], model: "NRTL" }), "MISSING_DATA");
  code(() => pure("water").property("liquidDensity", 2000), "OUT_OF_RANGE", RangeError);
  code(() => steam(5000, 100), "OUT_OF_RANGE", RangeError);
  code(() => steam({ T_K: 5000 }), "BAD_INPUT", RangeError);
  code(() => system({ components: ["benzene", "water"], model: "PR" }).bubbleT([0.5, 0.5], 101.325), "PHASE_SPLIT");
  code(() => system({ components: ["methane", "ethane"], model: "PR" }).bubbleP([0.9, 0.1], 260), "NO_CONVERGENCE");
  code(() => system({ components: ["methane", "ethane"], model: "PR" }).gammas([0.5, 0.5], 200), "NOT_AVAILABLE");
  code(() => pure("acetic acid").liquidEnthalpy(330), "NOT_AVAILABLE");
  // messages are unchanged, so pages that show e.message keep working
  assert.throws(() => system({ components: ["water", "water"] }), /appears twice/);
  // a plain Error is not a FugacityError
  assert.ok(!(new Error("x") instanceof FugacityError));
  assert.ok(new FugacityError("BAD_INPUT", "x") instanceof FugacityError);
});
