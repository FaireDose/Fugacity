// Pure-component properties: correlation equations and the pure() interface.
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../src/thermo/correlations.js";
import { pure, listComponents } from "../src/index.js";

// Expected values computed independently with the open-source `chemicals` library
// (chemicals.dippr EQ100-EQ107), with the same arbitrary coefficients, at T = 350 K.
const CASES = [
  ["DIPPR100", { A: 1, B: 2e-3, C: 3e-6, D: 4e-9, E: 5e-12 }, undefined, 2.31403125],
  ["DIPPR101", { A: 70, B: -7000, C: -6, D: 4e-6, E: 2 }, undefined, 4603838.974579646],
  ["DIPPR102", { A: 1e-6, B: 0.5, C: 300, D: 1000 }, undefined, 1.0029606780739778e-05],
  ["DIPPR104", { A: 0.1, B: -50, C: -1e6, D: -1e18, E: -1e20 }, undefined, -0.0718902848015544],
  ["DIPPR105", { A: 1.2, B: 0.27, C: 600, D: 0.28 }, undefined, 12.383209879373544],
  ["DIPPR106", { A: 5e7, B: 0.4, C: 0.1, D: 0.05, E: 0.01 }, 600, 32921752.452741615],
  ["DIPPR107", { A: 33000, B: 25000, C: 1500, D: 12000, E: 700 }, undefined, 36739.32583752347],
];

test("DIPPR correlations match the chemicals library", () => {
  for (const [equation, coefficients, Tc_K, want] of CASES) {
    const got = evaluate({ equation, coefficients, Tc_K }, 350);
    assert.ok(Math.abs(got / want - 1) < 1e-12, `${equation}: ${got} vs ${want}`);
  }
});

test("correlations refuse temperatures outside their range", () => {
  const rec = { equation: "DIPPR100", coefficients: { A: 1 }, Tmin_K: 300, Tmax_K: 400 };
  assert.throws(() => evaluate(rec, 450), /outside the range/);
  assert.equal(evaluate(rec, 450, { extrapolate: true }), 1);
});

test("pure() vapour pressure and boiling point agree with the VLE data", () => {
  for (const c of listComponents().filter(c => c.activity)) {
    const p = pure(c.id);
    const tb = p.tsat(101.325);
    assert.ok(Math.abs(tb - p.Tb_K) < 0.2, `${c.name}: ${tb.toFixed(2)} vs ${p.Tb_K}`);
    assert.ok(Math.abs(p.psat(tb) / 101.325 - 1) < 1e-9);
  }
});

test("every component has critical constants and an acentric factor", () => {
  assert.equal(listComponents().length, 94);
  for (const c of listComponents()) {
    const p = pure(c.id);
    for (const k of ["MW", "Tc_K", "Pc_kPa", "omega"]) assert.ok(Number.isFinite(p[k]), `${c.name} ${k}`);
    // a normal boiling point, except for carbon dioxide, which has no liquid at 1 atm (it sublimes)
    if (c.id === "carbon-dioxide") assert.equal(p.Tb_K, null);
    else assert.ok(Number.isFinite(p.Tb_K), `${c.name} Tb_K`);
  }
});

test("missing data is reported, not guessed", () => {
  const p = pure("oxygen");
  // Since the v0.2 property data every property of oxygen has a record; asking for the liquid
  // viscosity above the critical point (outside the record's range) must still throw, not extrapolate.
  assert.throws(() => p.property("liquidViscosity", 300), /not in the databank|No open data|outside the range/);
  assert.throws(() => p.property("density", 80), /Unknown property/);
  const s = pure("water").props(300, 101.325);
  assert.equal(s.phase, "liquid");
  for (const [k, v] of Object.entries(s)) if (v === null) assert.ok(s.notes.length > 0, k);
});
