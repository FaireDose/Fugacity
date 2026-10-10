// The flowsheet example the AI instructions give (ai/instructions/use-chepta.md, the skill) and
// the example file must pass CHEPTA.checkProject and solve: an assistant copies them.
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

for (const file of ["ai/instructions/use-chepta.md", "ai/skills/chepta/SKILL.md"]) {
  test(`${file}: the flowsheet example checks and solves`, () => {
    const p = projectIn(read(file));
    const c = checkProject(p);
    assert.ok(c.ok, c.problems.join("; "));
    const r = runFlowsheet(p);
    assert.equal(r.loops.length, 1, "the recycle");
    for (const v of Object.values(r.balance.material_kmol_h)) assert.ok(Math.abs(v) < 1e-6);
  });
}

test("examples/flowsheet-recycle.chepta.json is the same project, and solves", () => {
  const file = JSON.parse(read("examples/flowsheet-recycle.chepta.json"));
  assert.deepEqual(file, projectIn(read("ai/instructions/use-chepta.md")));
  assert.ok(checkProject(file).ok);
});

// The instructions send the assistant to the workbench's own export buttons instead of making files
// itself; the names they give must be the names on the buttons.
const BUTTONS = { "src/ui/flowsheet-view.js": ["Download Excel", "Excel concept model", "Download CSV", "Copy CSV"],
  "src/ui/app.js": ["Excel"], "src/ui/app-views.js": ["Download CSV", "Copy CSV"] };
for (const file of ["ai/instructions/use-chepta.md", "ai/skills/chepta/SKILL.md"]) {
  test(`${file}: points to the workbench's export buttons by their names`, () => {
    const md = read(file);
    assert.match(md, /\*\*Let the workbench do the work\.\*\*/);
    assert.match(md, /Do not make the file yourself/);
    for (const [src, names] of Object.entries(BUTTONS)) {
      const code = read(src);
      for (const n of names) {
        assert.ok(code.includes(`"${n}")`), `${src} has a button "${n}"`);
        assert.ok(md.includes(`**${n}**`), `${file} names "${n}"`);
      }
    }
    assert.ok(md.includes("**File > Save**"));
  });
}
