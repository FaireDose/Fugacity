import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { system, listComponents } from "../src/index.js";
import { binaryAzeotropes, findAzeotrope } from "../src/equilibrium/azeotrope.js";
import { isLiquidStable } from "../src/equilibrium/stability.js";

const lit = JSON.parse(readFileSync(new URL("../validation/data/azeotropes_101kPa.json", import.meta.url)));

for (const model of ["NRTL", "UNIQUAC"]) {
  test(`${model}: binary azeotropes match literature (±1 K, ±0.05 mole fraction)`, () => {
    for (const a of lit.binary) {
      const s = system({ components: a.components, model });
      const found = binaryAzeotropes(s, lit.P_kPa);
      assert.ok(found.length > 0, `${a.components.join(" + ")}: no azeotrope found`);
      const z = found.sort((p, q) => Math.abs(p.x - a.x_first) - Math.abs(q.x - a.x_first))[0];
      assert.ok(Math.abs(z.T - 273.15 - a.T_C) < 1.0, `${a.components.join(" + ")}: T ${(z.T - 273.15).toFixed(2)} vs ${a.T_C}`);
      assert.ok(Math.abs(z.x - a.x_first) < 0.05, `${a.components.join(" + ")}: x ${z.x.toFixed(3)} vs ${a.x_first}`);
      assert.equal(z.type, a.type, `${a.components.join(" + ")}: type`);
    }
  });
}

test("NRTL: methanol + acetone + chloroform saddle azeotrope near 57.5 °C", () => {
  const t = lit.ternary[0];
  const M = [32.042, 58.08, 119.378];
  const mol = t.wt_pct.map((w, i) => w / M[i]);
  const x0 = mol.map(v => v / mol.reduce((a, b) => a + b));
  const s = system({ components: t.components, model: "NRTL" });
  const z = findAzeotrope(s, x0, lit.P_kPa);
  assert.ok(z, "not found");
  assert.ok(Math.abs(z.T - 273.15 - t.T_C) < 1.0, `T ${(z.T - 273.15).toFixed(2)}`);
  z.x.forEach((v, i) => assert.ok(Math.abs(v - x0[i]) < 0.05, `x ${z.x.map(u => u.toFixed(3))}`));
});

test("every component with activity-model data boils at its normal boiling point", () => {
  for (const c of listComponents().filter(c => c.activity)) {
    const other = c.id === "water" ? "acetic acid" : "water";
    const s = system({ components: [c.id, other], model: "ideal" });
    const tb = s.boilingPoints(101.325)[0];
    const ref = JSON.parse(readFileSync(new URL("../src/data/components.json", import.meta.url))).components[c.id].Tb_K;
    assert.ok(Math.abs(tb - ref) < 0.2, `${c.name}: ${tb.toFixed(2)} vs ${ref}`);
  }
});

test("phase-split check flags water + ethyl acetate and not water + ethanol", () => {
  const split = system({ components: ["water", "ethyl acetate"], model: "NRTL" });
  const x = [0.7, 0.3];
  assert.equal(isLiquidStable(split, x, split.bubbleT(x, 101.325).T), false);
  const ok = system({ components: ["water", "ethanol"], model: "NRTL" });
  for (let k = 1; k < 20; k++) {
    const y = [k / 20, 1 - k / 20];
    assert.equal(isLiquidStable(ok, y, ok.bubbleT(y, 101.325).T), true);
  }
});
