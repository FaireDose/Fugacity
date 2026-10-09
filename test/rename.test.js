// The rename from Fugacity to CHEPTA (version 0.3.0) keeps what was written for the old name working:
// the script's old global, the old error class and test, project files saved by Fugacity.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";
import * as CHEPTA from "../src/index.js";
import { readProject, projectFileName, PROJECT_FORMAT } from "../src/ui/project.js";

test("the old error names are the same class and function", () => {
  assert.equal(CHEPTA.FugacityError, CHEPTA.CheptaError);
  assert.equal(CHEPTA.isFugacityError, CHEPTA.isCheptaError);
  try { CHEPTA.system({ components: ["water", "not-a-component"] }); assert.fail("no error"); } catch (e) {
    assert.ok(e instanceof CHEPTA.FugacityError && CHEPTA.isFugacityError(e) && e instanceof CHEPTA.CheptaError);
  }
});

test("a project file saved by Fugacity opens unchanged; file names drop either extension", () => {
  const old = { fugacity_project: PROJECT_FORMAT, saved_with: "fugacity 0.3.0", saved_at: "2026-10-01T00:00:00.000Z", workbench: { inputs: { txy: ["ethanol", "water"] } } };
  const state = readProject(JSON.stringify(old));
  assert.ok(state);
  assert.equal(projectFileName({ title: "Column feed.fugacity.json" }), "Column feed.chepta.json");
  assert.equal(projectFileName({ title: "Column feed.chepta.json" }), "Column feed.chepta.json");
});

test("the browser script defines CHEPTA and, for pages written before the rename, Fugacity", { skip: !existsSync(new URL("../dist/chepta.js", import.meta.url)) && "run npm run build first" }, () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL("../dist/chepta.js", import.meta.url), "utf8"), ctx);
  assert.equal(typeof ctx.CHEPTA.system, "function");
  assert.equal(ctx.Fugacity, ctx.CHEPTA);
});
