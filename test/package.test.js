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

test("a package with an invented CAS number, no open source and unchecked numbers is rejected", () => {
  const bad = {
    fugacity_package: 1, type: "pair-data", summary: "x", checked_by_human: false,
    components: [{ name: "Water", cas: "7732-18-4" }],
    source: { citation: "somewhere" },
    data: [{ kind: "isobaric-txy", columns: ["x_1", "T_C"], rows: [[1.2, 100]] }],
  };
  const { errors } = checkPackage(bad, known);
  const text = errors.join("\n");
  assert.match(text, /checked_by_human/);
  assert.match(text, /CAS number "7732-18-4"/);
  assert.match(text, /open_copy/);
  assert.match(text, /outside 0..1/);
  assert.match(text, /pressure/);
});
