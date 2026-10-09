// Hard two-phase T-P flashes with an equation of state (src/equilibrium/flash.js: successive
// substitution, then Newton's method on ln K). Points within 1e-4 to 2 % of the bubble and dew
// temperatures and up to just below the highest two-phase pressure, for four mixtures (PR and SRK);
// none below a component's melting point (docs/METHOD_SELECTION.md). Reference:
// validation/fixtures/flash-hard.json, thermo's FlashVL with the same parameters, polished with
// scipy's root on the equilibrium equations (validation/python/reference_flash_hard.py).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { system } from "../src/index.js";

const { cases } = JSON.parse(readFileSync(new URL("../validation/fixtures/flash-hard.json", import.meta.url)));

test("hard flashes: the reference covers bubble and dew sides and high pressure", () => {
  assert.ok(cases.length >= 60, `${cases.length} cases`);
  assert.ok(cases.some(c => c.VF < 1e-3) && cases.some(c => c.VF > 0.999), "near both phase boundaries");
  assert.ok(cases.some(c => c.P_kPa >= 7000), "close to the cricondenbar");
});

test("hard flashes: vapour fraction and compositions match the polished thermo solution", () => {
  for (const c of cases) {
    const r = system({ components: c.components, model: c.model }).flash({ z: c.z, T: c.T_K, P: c.P_kPa });
    const what = `${c.model} ${c.components.length} components, ${c.P_kPa} kPa, ${c.T_K.toFixed(3)} K`;
    assert.ok(Math.abs(r.VF - c.VF) < 1e-8, `${what}: VF ${r.VF} vs ${c.VF}`);
    const liq = r.phases.find(p => p.type === "liquid"), vap = r.phases.find(p => p.type === "vapour");
    c.x.forEach((v, i) => assert.ok(Math.abs(liq.composition[i] - v) < 1e-7, `${what}: x${i}`));
    c.y.forEach((v, i) => assert.ok(Math.abs(vap.composition[i] - v) < 1e-7, `${what}: y${i}`));
    // successive substitution alone needed up to 144 steps here (close to the cricondenbar); with
    // Newton's method after 10 steps no case needs more than 25
    assert.ok(r.iterations <= 25, `${what}: ${r.iterations} iterations`);
  }
});

test("P-H flash of a gas-rich feed whose bubble point is a liquid-liquid split starts from 300 K", () => {
  // nitrogen + methane + n-pentane at 991 kPa: Peng-Robinson's bubble point (about 93 K) has a liquid
  // that splits into two liquids, not a vapour-liquid boundary; the energy balance at 300 K is ordinary
  const sys = system({ components: ["nitrogen", "methane", "n-pentane"], model: "PR" });
  const z = [0.4439373601789709, 0.2044742729306488, 0.3515883668903803];
  const at300 = sys.flash({ z, T: 300, P: 991 });
  const ph = sys.flash({ z, P: 991, H: at300.H_J_mol });
  assert.ok(Math.abs(ph.T - 300) < 1e-6, `T ${ph.T}`);
  assert.ok(Math.abs(ph.VF - at300.VF) < 1e-8);
});
