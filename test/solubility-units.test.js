// Units of a solid solubility (src/ui/solubility-units.js): the definitions, checked by hand
// with round numbers, and the workbench state that chooses one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { solidIn, SOLID_UNITS } from "../src/ui/solubility-units.js";
import { initialState, applyPatch } from "../src/ui/app-logic.js";

const close = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} vs ${b}`);

test("solubility units: x = 0.5 of a solid twice as heavy as the solvent", () => {
  // 1 mol solid (100 g) per 1 mol solvent (50 g)
  const MW = [100, 50];
  close(solidIn("mole", 0.5, MW), 0.5);
  close(solidIn("mass", 0.5, MW), 100 * 100 / 150);
  close(solidIn("g100g", 0.5, MW), 200);
  close(solidIn("gL", 0.5, MW, 800), 1600);    // 800 g of solvent per litre carry 1600 g of solid
});

test("solubility units: dilute limit, zero, and errors", () => {
  const MW = [122.12, 46.07];
  const x = 1e-4, w = x * MW[0] / (x * MW[0] + (1 - x) * MW[1]);
  close(solidIn("mass", x, MW), 100 * w);
  close(solidIn("g100g", x, MW), 100 * w / (1 - w));
  close(solidIn("gL", x, MW, 789), 789 * w / (1 - w));
  assert.equal(solidIn("g100g", 0, MW), 0);
  assert.throws(() => solidIn("gL", 0.1, MW), /density/);
  assert.throws(() => solidIn("ppm", 0.1, MW), /Unknown solubility unit/);
  assert.deepEqual(SOLID_UNITS.map(u => u.id), ["mole", "mass", "g100g", "gL"]);
});

test("workbench state: solidUnit defaults to mole fraction and is checked", () => {
  let st = initialState({ components: ["benzoic-acid", "ethanol"] });
  assert.equal(st.solidUnit, "mole");
  st = applyPatch(st, { solidUnit: "gL" });
  assert.equal(st.solidUnit, "gL");
  assert.throws(() => applyPatch(st, { solidUnit: "kg" }), /Unknown solubility unit/);
  assert.equal(initialState({ components: ["water"], solidUnit: "g100g" }).solidUnit, "g100g");
});
