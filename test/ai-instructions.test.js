// The flowsheet example the AI instructions give (ai/instructions/use-fugacity.md, the skill) and
// the example file must pass Fugacity.checkProject and solve: an assistant copies them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkProject, runFlowsheet } from "../src/index.js";

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
/** The `const project = { ... };` of a page in a Markdown file, as an object. */
function projectIn(md) {
  const m = /const project = (\{[\s\S]*?\n {2}\});/.exec(md);
  assert.ok(m, "a project in the instructions");
  return Function(`"use strict"; return (${m[1]});`)();
}

for (const file of ["ai/instructions/use-fugacity.md", "ai/skills/fugacity/SKILL.md"]) {
  test(`${file}: the flowsheet example checks and solves`, () => {
    const p = projectIn(read(file));
    const c = checkProject(p);
    assert.ok(c.ok, c.problems.join("; "));
    const r = runFlowsheet(p);
    assert.equal(r.loops.length, 1, "the recycle");
    for (const v of Object.values(r.balance.material_kmol_h)) assert.ok(Math.abs(v) < 1e-6);
  });
}

test("examples/flowsheet-recycle.fugacity.json is the same project, and solves", () => {
  const file = JSON.parse(read("examples/flowsheet-recycle.fugacity.json"));
  assert.deepEqual(file, projectIn(read("ai/instructions/use-fugacity.md")));
  assert.ok(checkProject(file).ok);
});
