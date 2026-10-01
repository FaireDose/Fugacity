import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { checkPackage, validCas } from "../src/contrib/package-check.js";

const known = JSON.parse(readFileSync(new URL("../src/data/components.json", import.meta.url))).components;

test("CAS numbers of all databank components pass the check digit", () => {
  for (const c of Object.values(known)) assert.ok(validCas(c.cas), c.cas);
  assert.equal(validCas("64-19-8"), false);
  assert.equal(validCas("water"), false);
});

test("example contribution packages are complete", () => {
  const dir = new URL("../ai/examples/", import.meta.url);
  for (const f of readdirSync(dir).filter(n => n.endsWith(".json"))) {
    const { errors } = checkPackage(JSON.parse(readFileSync(new URL(f, dir))), known);
    assert.deepEqual(errors, [], f);
  }
});

test("a package with an invented CAS number and no open source is rejected", () => {
  const bad = {
    fugacity_package: 1, type: "pair-data", summary: "x",
    components: [{ name: "Water", cas: "7732-18-4" }],
    source: { citation: "somewhere" },
    data: [{ kind: "isobaric-txy", columns: ["x_1", "T_C"], rows: [[1.2, 100]] }],
  };
  const { errors } = checkPackage(bad, known);
  const text = errors.join("\n");
  assert.match(text, /CAS number "7732-18-4"/);
  assert.match(text, /open_copy/);
  assert.match(text, /outside 0..1/);
  assert.match(text, /pressure/);
});

// Intended interface change (v0.2): the person confirms the check in the Data issue form,
// so "checked_by_human" is no longer required; old packages that still carry it stay valid.
test("checked_by_human is optional and ignored", () => {
  const example = JSON.parse(readFileSync(new URL("../ai/examples/acetic-acid_ethylene-glycol.json", import.meta.url)));
  assert.equal("checked_by_human" in example, false);
  for (const value of [undefined, true, false]) {
    const pkg = value === undefined ? example : { ...example, checked_by_human: value };
    assert.deepEqual(checkPackage(pkg, known).errors, [], String(value));
  }
});
