// Liquid-phase stability at EOS bubble and dew points (Michelsen tangent plane), k_ij
// warnings, and the enthalpy construction of pure() (liquid and vapour join at saturation).
import { test } from "node:test";
import assert from "node:assert/strict";
import { system, pure, cubicEos } from "../src/index.js";
import { tpdStability } from "../src/equilibrium/eos-stability.js";

test("benzene + water: the liquid splits, and bubble/dew points say so instead of returning a value", () => {
  for (const model of ["PR", "SRK"]) {
    const s = system({ components: ["benzene", "water"], model });
    assert.throws(() => s.bubbleT([0.5, 0.5], 101.325), /liquid splits into two liquid phases.*three-phase equilibrium is not supported yet/);
    assert.throws(() => s.bubbleT([0.001, 0.999], 101.325), /liquid splits into two liquid phases/);
    assert.throws(() => s.dewT([0.5, 0.5], 101.325), /incipient liquid splits into two liquid phases/);
    assert.throws(() => system({ components: ["toluene", "water"], model }).bubbleP([0.5, 0.5], 350), /splits into two liquid phases/);
    // the tangent-plane test on its own: a water-rich second liquid, tm well below 0
    const st = tpdStability(s.eos, 340, 101.325, [0.5, 0.5], "liquid");
    assert.equal(st.stable, false);
    assert.ok(st.tm < -0.5 && st.trial[1] > 0.99, JSON.stringify(st));
    // a liquid that is only slightly beyond its solubility is stable at very low benzene content
    assert.equal(tpdStability(s.eos, 340, 101.325, [1e-7, 1 - 1e-7], "liquid").stable, true);
  }
});

test("stable mixtures pass the stability test and return their bubble and dew points", () => {
  const cases = [
    [["methanol", "water"], "bubbleT", [0.4, 0.6], 101.325],
    [["benzene", "toluene"], "bubbleT", [0.4, 0.6], 101.325],
    [["methane", "ethane"], "bubbleP", [0.5, 0.5], 200],
    [["methane", "ethane"], "dewP", [0.5, 0.5], 200],
    [["nitrogen", "methane"], "bubbleP", [0.3, 0.7], 150],
    [["hydrogen", "toluene"], "bubbleP", [0.01, 0.99], 303.15],
    [["methane", "water"], "dewT", [0.99, 0.01], 5000],
  ];
  for (const model of ["PR", "SRK"]) {
    for (const [comps, kind, z, given] of cases) {
      const r = system({ components: comps, model })[kind](z, given);
      assert.equal(r.stability.stable, true, `${model} ${comps.join("+")} ${kind}`);
      assert.ok(r.stability.tm > -1e-6);
    }
  }
});

test("warnings: pairs with k_ij = 0, and temperatures outside a k_ij's data range", () => {
  const bt = system({ components: ["benzene", "toluene"], model: "PR" }).bubbleT([0.4, 0.6], 101.325);
  assert.match(bt.warnings.join(" "), /No PR k_ij for Benzene \+ Toluene: k_ij = 0 used/);
  const mw = system({ components: ["methane", "water"], model: "PR" }).dewT([0.99, 0.01], 5000);
  assert.match(mw.warnings.join(" "), /Methane \+ Water/);
  // methane + benzene: ChemSep k_ij from data at 421-501 K
  const mb = system({ components: ["methane", "benzene"], model: "PR" });
  assert.match(mb.bubbleP([0.05, 0.95], 350).warnings.join(" "), /421-501 K; 350.00 K is outside/);
  assert.deepEqual(mb.bubbleP([0.05, 0.95], 450).warnings, []);
  // nitrogen + methane inside its range: no warning
  assert.deepEqual(system({ components: ["nitrogen", "methane"], model: "PR" }).bubbleP([0.3, 0.7], 150).warnings, []);
});

// Methane + water with PR: as in gas processing for the water content of a gas (docs/METHOD_SELECTION.md
// lists it); these tests check the messages and the refusal of a second liquid, not liquid accuracy.
test("a gas-rich 'liquid' gets a message about gases, not about the critical region", () => {
  assert.throws(() => system({ components: ["methane", "water"], model: "PR" }).bubbleT([0.5, 0.5], 101.325),
    /Methane \(Tc = 190.564 K\) is a gas at ambient conditions.*Henry's law/);
});

// Synthetic records, only to exercise the enthalpy construction (not data):
// cp_IG = 100 J/(mol K); dHvap = 30000 (1 - T/Tc)^0.38 J/mol (DIPPR106 form).
const synthetic = Tc => ({
  idealGasHeatCapacity: { equation: "DIPPR100", coefficients: { A: 100 }, units: "J/mol/K", Tmin_K: 200, Tmax_K: 800, tier: "user", source: "synthetic test record" },
  heatOfVaporization: { equation: "DIPPR106", coefficients: { A: 30000, B: 0.38, C: 0, D: 0, E: 0 }, units: "J/mol", Tc_K: Tc, Tmin_K: 200, Tmax_K: Tc - 1, tier: "user", source: "synthetic test record" },
});

test("enthalpy: liquid and vapour join at saturation (h_V - h_L = dHvap), with the PR residual of the saturated vapour", () => {
  for (const id of ["benzene", "toluene", "methanol"]) {
    const c0 = pure(id);
    const c = pure(id, { properties: synthetic(c0.Tc_K) });
    const pr = cubicEos("PR", [{ name: c.name, Tc_K: c.Tc_K, Pc_Pa: c.Pc_kPa * 1000, omega: c.omega }]);
    for (const T of [320, 360, 400]) {
      const s = c.saturation(T);
      assert.ok(Math.abs(s.hV_J_mol - s.hL_J_mol - s.dHvap_J_mol) < 1e-8, `${id} ${T}`);
      const hR = pr.state(T, s.P_kPa, [1], "vapour").hR_J_mol;
      assert.ok(Math.abs(s.hL_J_mol - (100 * (T - 298.15) + hR - s.dHvap_J_mol)) < 1e-6, `${id} ${T}: h_L`);
      // props() on both sides of the saturation pressure meets these values
      const L = c.props(T, s.P_kPa * 1.0001), V = c.props(T, s.P_kPa * 0.9999);
      assert.equal(L.phase, "liquid"); assert.equal(V.phase, "vapour");
      assert.ok(Math.abs(L.h_J_mol - s.hL_J_mol) < 1e-6, `${id} ${T}: liquid h ${L.h_J_mol}`);
      assert.ok(Math.abs(V.h_J_mol - s.hV_J_mol) < 0.5, `${id} ${T}: vapour h ${V.h_J_mol} vs ${s.hV_J_mol}`);
    }
  }
});

test("enthalpy of a dimerizing component (acetic acid) is null with a note; vapour density from the chemical theory", () => {
  const a = pure("acetic-acid", { properties: synthetic(pure("acetic-acid").Tc_K) });
  const L = a.props(330, 101.325);
  assert.equal(L.phase, "liquid");
  assert.equal(L.h_J_mol, null);
  assert.match(L.notes.join(" "), /dimerizes in the vapour; enthalpy is not given/);
  const V = a.props(400, 50);
  assert.equal(V.phase, "vapour");
  assert.equal(V.h_J_mol, null);
  assert.ok(V.dimerFraction > 0.05 && V.dimerFraction < 1);
  // more mass per volume than the ideal gas of monomers, at most twice as much
  const ideal = a.MW / 1000 * 50000 / (8.314462618 * 400);
  assert.ok(V.rho_kg_m3 > ideal && V.rho_kg_m3 < 2 * ideal);
  assert.match(V.sources.rho_kg_m3.source, /Chemical theory/);
  assert.throws(() => a.liquidEnthalpy(330), /dimerizes/);
});

test("props() notes are not repeated", () => {
  const s = pure("nitrogen").props(300, 1000);
  assert.equal(new Set(s.notes).size, s.notes.length);
});
