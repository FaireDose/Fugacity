// Peng-Robinson and SRK: the engine against an independent Python implementation and the
// thermo library (validation/python/reference_eos.py -> validation/data/eos/fixtures.json),
// thermodynamic consistency, k_ij data and the programming interface.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { system, createSystem, MODELS, EOS_MODELS, cubicEos, pure, listComponents } from "../src/index.js";
import kij from "../src/data/kij.json" with { type: "json" };

const fixtures = JSON.parse(readFileSync(new URL("../validation/data/eos/fixtures.json", import.meta.url)));
const coolprop = JSON.parse(readFileSync(new URL("../validation/data/eos/coolprop_reference.json", import.meta.url)));
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);

test("Z, ln phi and residual enthalpy match the Python reference and thermo", () => {
  for (const s of fixtures.states) {
    const sys = system({ components: s.components, model: s.model });
    const st = sys.state(s.T_K, s.P_kPa, s.x, s.phase);
    const tag = `${s.model} ${s.components.join("+")} ${s.T_K} K ${s.P_kPa} kPa ${s.phase}`;
    assert.ok(rel(st.Z, s.Z) < 1e-9, `${tag}: Z ${st.Z} vs ${s.Z}`);
    assert.ok(rel(st.Z, s.thermo.Z) < 1e-9, `${tag}: Z vs thermo ${s.thermo.Z}`);
    assert.equal(st.roots, s.roots, `${tag}: number of roots`);
    st.lnPhi.forEach((v, i) => {
      assert.ok(Math.abs(v - s.lnPhi[i]) < 1e-7, `${tag}: ln phi ${i} ${v} vs ${s.lnPhi[i]}`);
      assert.ok(Math.abs(v - s.thermo.lnPhi[i]) < 1e-9, `${tag}: ln phi ${i} vs thermo ${s.thermo.lnPhi[i]}`);
    });
    assert.ok(Math.abs(st.hR_J_mol - s.hR_J_mol) < 1e-6 * Math.max(1, Math.abs(s.hR_J_mol)), `${tag}: H_R ${st.hR_J_mol} vs ${s.hR_J_mol}`);
    assert.ok(Math.abs(st.hR_J_mol - s.thermo.hR) < 1e-6 * Math.max(1, Math.abs(s.thermo.hR)), `${tag}: H_R vs thermo`);
  }
});

test("bubble and dew points match the Python reference and thermo's flash to 1e-6", () => {
  for (const p of fixtures.points) {
    const sys = system({ components: p.components, model: p.model });
    const r = sys[p.kind](p.z, p.given);
    const got = p.kind.endsWith("P") ? r.P : r.T;
    const w = p.kind.startsWith("bubble") ? r.y : r.x;
    const tag = `${p.model} ${p.components.join("+")} ${p.kind} at ${p.given}`;
    assert.ok(rel(got, p.value) < 1e-6, `${tag}: ${got} vs ${p.value}`);
    assert.ok(rel(got, p.thermo.value) < 1e-6, `${tag}: ${got} vs thermo ${p.thermo.value}`);
    w.forEach((v, i) => assert.ok(Math.abs(v - p.thermo.incipient[i]) < 1e-6, `${tag}: composition ${i}`));
  }
});

test("pure-component saturation pressure from the EOS matches the Python reference", () => {
  for (const r of coolprop.psat) {
    const c = pure(r.component);
    for (const model of ["PR", "SRK"]) {
      const e = cubicEos(model, [{ name: c.name, Tc_K: c.Tc_K, Pc_Pa: c.Pc_kPa * 1000, omega: c.omega }]);
      const got = e.psat(0, r.T_K), want = r[`${model}_kPa`];
      assert.ok(rel(got, want) < 1e-7, `${model} ${r.component} ${r.T_K} K: ${got} vs ${want}`);
    }
  }
});

test("thermodynamic consistency: G_R/RT = sum x ln phi, cp_R = dH_R/dT", () => {
  const R = 8.314462618;
  for (const model of EOS_MODELS) {
    const sys = system({ components: ["hydrogen", "methane", "ethane", "benzene"], model });
    const x = [0.05, 0.15, 0.2, 0.6];
    for (const [T, P, ph] of [[300, 3000, "liquid"], [400, 500, "vapour"], [250, 8000, "vapour"]]) {
      const s = sys.state(T, P, x, ph);
      const gR = (s.hR_J_mol - T * s.sR_J_molK) / (R * T);
      const sumLnPhi = x.reduce((a, v, i) => a + v * s.lnPhi[i], 0);
      assert.ok(Math.abs(gR - sumLnPhi) < 1e-10, `${model} ${T} ${P}: G_R/RT ${gR} vs ${sumLnPhi}`);
      const h = 1e-3;
      const dH = (sys.state(T + h, P, x, ph).hR_J_mol - sys.state(T - h, P, x, ph).hR_J_mol) / (2 * h);
      assert.ok(Math.abs(dH - s.cpR_J_molK) < 1e-5 * Math.max(1, Math.abs(dH)), `${model} ${T} ${P}: cp_R ${s.cpR_J_molK} vs dH_R/dT ${dH}`);
    }
  }
});

test("k_ij data: 126 pairs for PR and SRK (ChemSep for the 49 components, one PR pair refitted, four fitted for the proposal 0004 benchmarks), each with a source", () => {
  const ids = new Set(listComponents().map(c => c.id));
  for (const model of ["PR", "SRK"]) {
    const pairs = kij.pairs.filter(p => p.model === model);
    assert.equal(pairs.length, 126, model);
    for (const p of pairs) {
      assert.ok(ids.has(p.i) && ids.has(p.j), `${p.i} ${p.j}`);
      assert.ok(Math.abs(p.kij) < 0.6);
      if (p.tier === "fitted") {
        // fitted to open data; where it replaces a databank value contradicted by the data, the
        // old value and the reason are kept
        assert.ok(p.source.fit && p.source.data.length && p.source.T_range_K, `${p.i}-${p.j}`);
        if (p.replaced) assert.ok(p.replaced.reason && p.replaced.tier === "databank", `${p.i}-${p.j}`);
        continue;
      }
      assert.equal(p.tier, "databank");
      assert.ok(Number(p.source.printed) === p.kij && p.source.conditions && p.alternatives.length === p.source.entries_in_file - 1, `${p.i}-${p.j}: printed ${p.source.printed}`);
    }
  }
  const fitted = kij.pairs.filter(p => p.tier === "fitted").map(p => `${p.model} ${p.i}-${p.j}`);
  assert.deepEqual(fitted, ["PR hydrogen-toluene", "PR ethanol-water", "SRK ethanol-water", "PR ethanol-ethylene-glycol", "SRK ethanol-ethylene-glycol", "PR water-ethylene-glycol", "SRK water-ethylene-glycol", "PR ethyl-acetate-ethanol", "SRK ethyl-acetate-ethanol"]);
  assert.equal(kij.pairs.find(p => p.tier === "fitted" && p.j === "toluene").replaced.kij, -0.51);
  const sys = system({ components: ["methane", "nitrogen", "water"], model: "PR" });
  const byPair = Object.fromEntries(sys.info.pairs.map(p => [p.pair.join("+"), p]));
  assert.equal(byPair["Methane+Nitrogen"].kij, 0.0289);
  assert.equal(byPair["Methane+Nitrogen"].tier, "databank");
  assert.equal(byPair["Methane+Water"].kij, 0);
  assert.equal(byPair["Methane+Water"].tier, "none");
  assert.deepEqual(sys.info.missingPairs, [["Methane", "Water"], ["Nitrogen", "Water"]]);
});

test("interface: model PR/SRK, argument orders, density, user k_ij, clear errors", () => {
  assert.deepEqual(MODELS, ["NRTL", "UNIQUAC", "ideal"]);
  assert.deepEqual(EOS_MODELS, ["PR", "SRK"]);
  const s = system({ components: ["methane", "ethane"], model: "pr" });
  assert.equal(s.model, "PR");
  for (const m of ["bubbleT", "bubbleP", "dewT", "dewP", "Z", "lnPhi", "density"]) assert.equal(typeof s[m], "function", m);
  const x = [0.5, 0.5];
  assert.equal(s.Z(300, 5000, x), s.Z(x, 300, 5000));
  assert.deepEqual(s.lnPhi(200, 2000, x, "liquid"), s.lnPhi(x, 200, 2000, "liquid"));
  const MW = 0.5 * pure("methane").MW + 0.5 * pure("ethane").MW;
  const v = s.state(300, 5000, x, "vapour").v_m3_mol;
  assert.ok(rel(s.density(x, 300, 5000), MW / 1000 / v) < 1e-12);
  assert.ok(s.density(x, 200, 2000, "liquid") > 5 * s.density(x, 200, 2000, "vapour") || s.state(200, 2000, x, "liquid").roots === 1);
  // gamma-phi-only methods (the diagrams use the equation of state's own bubble point)
  for (const m of ["gammas", "equilibrium"]) {
    assert.throws(() => s[m](101.325), /equation-of-state|gamma-phi/, m);
  }
  // above the critical region
  assert.throws(() => s.bubbleP([0.9, 0.1], 260), /no two-phase solution found/);
  // user k_ij
  const u = system({ components: ["methane", "ethane"], model: "PR", kij: [[0, 0.05], [0.05, 0]] });
  assert.equal(u.info.pairs[0].tier, "user");
  assert.ok(u.bubbleP(x, 200).P > s.bubbleP(x, 200).P);
  assert.throws(() => system({ components: ["methane", "ethane"], model: "PR", kij: [[0, 1], [2, 0]] }), /symmetric/);
  // activity-model systems are unchanged
  const a = createSystem({ components: ["water", "ethanol"], model: "NRTL" });
  assert.equal(a.kind, undefined);
  assert.throws(() => createSystem({ components: ["water", "ethanol"], model: "BWR" }), /Unknown model/);
});

test("pure(): vapour and supercritical states use Peng-Robinson", () => {
  for (const [id, T, P] of [["nitrogen", 300, 10000], ["methane", 250, 5000], ["benzene", 400, 101.325], ["methanol", 400, 101.325]]) {
    const c = pure(id);
    const st = c.props(T, P);
    assert.ok(["vapour", "supercritical"].includes(st.phase), `${id} ${st.phase}`);
    const e = cubicEos("PR", [{ name: c.name, Tc_K: c.Tc_K, Pc_Pa: c.Pc_kPa * 1000, omega: c.omega }]).state(T, P, [1], "vapour");
    assert.ok(rel(st.rho_kg_m3, c.MW / 1000 / e.v_m3_mol) < 1e-12, id);
    assert.ok(rel(st.Z, e.Z) < 1e-12 && rel(st.hResidual_J_mol, e.hR_J_mol) < 1e-12, id);
    assert.match(st.sources.rho_kg_m3.source, /Peng-Robinson/);
  }
  // a gas below its critical temperature without a vapour-pressure record: phase from PR
  const ethane = pure("ethane");
  if (!ethane.has("vapourPressure")) {
    assert.equal(ethane.props(300, 1000).phase, "vapour");
    assert.equal(ethane.props(300, 6000).phase, "liquid");
  }
});
