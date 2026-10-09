// The method advisor (src/thermo/method-advice.js, docs/METHOD_SELECTION.md): a note when the property
// method is not the one the selection rules recommend for the components or the pressure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { system } from "../src/index.js";
import { isPolar } from "../src/thermo/method-advice.js";

test("polar for the choice of method: heteroatoms, except the light gases", () => {
  assert.equal(isPolar("ethanol", "C2H6O"), true);
  assert.equal(isPolar("chloroform", "CHCl3"), true);
  assert.equal(isPolar("n-hexane", "C6H14"), false);
  assert.equal(isPolar("carbon-dioxide", "CO2"), false);
  assert.equal(isPolar("hydrogen-sulfide", "H2S"), false);
});

test("an equation of state with polar liquids gets a note; hydrocarbons and activity models do not", () => {
  const polar = system({ components: ["ethanol", "water"], model: "PR" });
  assert.equal(polar.info.advice.length, 1);
  assert.match(polar.info.advice[0], /Ethanol, Water/);
  assert.match(polar.info.advice[0], /NRTL or UNIQUAC/);
  // and the results carry it
  assert.ok(polar.bubbleT([0.5, 0.5], 101.325).warnings.some(w => /not the recommended method/.test(w)));
  assert.deepEqual(system({ components: ["propane", "n-butane"], model: "PR" }).info.advice, []);
  assert.deepEqual(system({ components: ["methane", "carbon-dioxide"], model: "SRK" }).info.advice, []);
  assert.deepEqual(system({ components: ["ethanol", "water"], model: "NRTL" }).info.advice, []);
});

test("an activity model above 10 bar gets a note at that pressure, not below", () => {
  const s = system({ components: ["ethanol", "water"], model: "NRTL" });
  assert.ok(!s.bubbleT([0.5, 0.5], 101.325).warnings.some(w => /10 bar/.test(w)));
  assert.ok(s.bubbleT([0.5, 0.5], 2000).warnings.some(w => /above about 10 bar/.test(w)));
});
