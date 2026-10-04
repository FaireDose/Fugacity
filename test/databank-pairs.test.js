// Proposal 0004, step 3: the ChemSep NRTL / UNIQUAC sets imported for every pair among the
// components that had no set (validation/python/chemsep_pairs.py --all). Where the Python
// import found that a set predicts two liquid phases (convex hull of the Gibbs energy of
// mixing, validation/python/fit_parameters.py phase_splits), its record says so; the engine's
// own global tangent-plane test (not the spinodal test isLiquidStable, which passes metastable
// liquids) must agree inside each stated range, and find one liquid for the sets without a note.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { system } from "../src/index.js";
import { liquidTangentPlane } from "../src/equilibrium/stability.js";

const binaries = JSON.parse(readFileSync(new URL("../src/data/binaries.json", import.meta.url))).pairs;
const imported = binaries.filter(p => p.tier === "databank" && p.data_wanted?.startsWith("open experimental data to fit (proposal 0004 step 3"));

test("the imported databank sets are ChemSep sets with a source and a data-wanted note", () => {
  assert.ok(imported.length >= 100, `${imported.length} sets`);
  for (const p of imported) {
    assert.match(p.source, /^ChemSep (NRTL|UNIQUAC) databank \(via the open-source thermo library\)\./);
    assert.deepEqual(p.source_ids, ["chemsep-ipd"]);
  }
});

test("two-liquid notes of the import agree with the engine's stability test", () => {
  let checked = 0;
  for (const p of imported) {
    const s = system({ components: [p.i, p.j], model: p.model, sets: { [`${p.i}+${p.j}`]: p.set } });
    const ranges = [...p.source.matchAll(/([\d.]+) K: x\([^)]+\) ([\d.e-]+)-([\d.e-]+)/g)].map(m => m.slice(1).map(Number));
    for (const [T, a, b] of ranges) {
      const mid = 0.5 * (a + b);
      assert.equal(liquidTangentPlane(s, [mid, 1 - mid], T).stable, false, `${p.model} ${p.i}+${p.j} ${T} K x=${mid}`);
      checked++;
    }
    if (!ranges.length) {
      for (const x of [0.1, 0.3, 0.5, 0.7, 0.9]) assert.equal(liquidTangentPlane(s, [x, 1 - x], 298.15).stable, true, `${p.model} ${p.i}+${p.j} x=${x}`);
    }
  }
  assert.ok(checked > 50, `${checked} ranges checked`);
});
