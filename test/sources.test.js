// The Fugacity Library, data (proposal 0003, step 1): src/data/sources.json and the source_ids,
// set names and default flags of the parameter records (validation/python/make_sources.py).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const { sources } = load("../src/data/sources.json");
const binaries = load("../src/data/binaries.json").pairs;
const kij = load("../src/data/kij.json").pairs;
const henry = load("../src/data/henry.json");
const components = load("../src/data/components.json").components;
const issues = load("../src/data/known-issues.json").issues;
const KINDS = ["standard", "open-source library", "databank", "thermoml", "open-access article", "free book", "handbook via open compilation"];

/** Every record that refers to sources: [where, source_ids]. */
function referencing() {
  const out = [];
  for (const p of binaries) out.push([`binaries ${p.model} ${p.i}-${p.j} ${p.set}`, p.source_ids]);
  for (const p of kij) {
    out.push([`kij ${p.model} ${p.i}-${p.j}`, p.source_ids]);
    if (p.replaced) out.push([`kij ${p.model} ${p.i}-${p.j} (replaced)`, p.replaced.source_ids]);
  }
  for (const p of henry.pairs) out.push([`henry ${p.gas}`, p.source_ids]);
  out.push(["henry water vapour pressure", henry.solvents.water.vapourPressure.source_ids]);
  for (const [id, c] of Object.entries(components)) {
    for (const k of ["vapourPressure", "uniquac", "association"]) if (c[k]) out.push([`${id}.${k}`, c[k].source_ids]);
    for (const [k, r] of Object.entries(c.properties ?? {})) out.push([`${id}.properties.${k}`, r.source_ids]);
    for (const f of ["constants_source", "omega_source"]) if (c[f]) out.push([`${id}.${f}`, c[f + "_ids"]]);
  }
  for (const k of issues) out.push([`known issue ${k.model} ${k.components.join("+")}`, k.source_ids]);
  return out;
}

test("every record with a source refers to sources.json, and every source_id resolves", () => {
  const refs = referencing();
  assert.ok(refs.length > 250, `${refs.length} records`);
  for (const [where, ids] of refs) {
    assert.ok(Array.isArray(ids) && ids.length, `${where}: no source_ids`);
    for (const id of ids) assert.ok(sources[id], `${where}: unknown source "${id}"`);
  }
  // the text source stays for old readers
  for (const p of binaries) assert.ok(typeof p.source === "string" && p.source.length > 10, `${p.i}-${p.j}`);
});

test("every source has a kind, why it is open and a link; the files it names exist", () => {
  const ids = Object.keys(sources);
  assert.ok(ids.length >= 25, `${ids.length} sources`);
  for (const [id, s] of Object.entries(sources)) {
    assert.match(id, /^[a-z0-9][a-z0-9.-]*$/, `${id}: id`);
    assert.ok(KINDS.includes(s.kind), `${id}: kind ${s.kind}`);
    assert.ok(s.title && s.access, `${id}: title and access`);
    assert.ok(/^https?:\/\//.test(s.url ?? "") || s.doi, `${id}: a link`);
    if (s.year != null) assert.ok(Number.isInteger(s.year) && s.year > 1900 && s.year < 2100, `${id}: year`);
    if (s.doi) assert.match(s.doi, /^10\.\d{4,}\//, `${id}: doi`);
    for (const f of s.files ?? []) assert.ok(existsSync(new URL(`../${f}`, import.meta.url)), `${id}: ${f}`);
  }
  // each validation data file with a source block is listed under its source
  const listed = new Set(Object.values(sources).flatMap(s => s.files ?? []));
  for (const f of ["acetone_chloroform_101kPa.json", "ethanol_water_101kPa.json", "eos/tsuji2005_hydrogen_toluene.json", "azeotropes_101kPa.json"]) {
    assert.ok(listed.has(`validation/data/${f}`), f);
  }
});

test("exactly one default parameter set per pair and model; set names unique", () => {
  for (const [file, recs] of [["binaries", binaries], ["kij", kij]]) {
    const groups = new Map();
    for (const p of recs) {
      const key = `${p.model} ${[p.i, p.j].sort().join("+")}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
      if (p.replaced) groups.get(key).push(p.replaced);
    }
    for (const [key, sets] of groups) {
      assert.equal(sets.filter(s => s.default === true).length, 1, `${file} ${key}: one default`);
      assert.ok(sets.every(s => typeof s.default === "boolean" && typeof s.set === "string" && s.set), `${file} ${key}: set and default on every set`);
      assert.equal(new Set(sets.map(s => s.set)).size, sets.length, `${file} ${key}: set names`);
    }
  }
  for (const p of henry.pairs) assert.ok(p.default === true && p.set, p.gas);
});

test("the replaced ChemSep sets of the refitted pairs are ordinary non-default sets", () => {
  const refitted = [["methanol", "acetone"], ["methanol", "chloroform"], ["acetone", "chloroform"], ["water", "ethanol"], ["ethanol", "ethyl-acetate"], ["water", "ethyl-acetate"]];
  for (const model of ["NRTL", "UNIQUAC"]) {
    for (const [a, b] of refitted) {
      const sets = binaries.filter(p => p.model === model && [p.i, p.j].sort().join() === [a, b].sort().join());
      assert.equal(sets.length, 2, `${model} ${a}-${b}`);
      const [def, alt] = [sets.find(s => s.default), sets.find(s => !s.default)];
      assert.equal(def.tier, "fitted");
      assert.equal(alt.tier, "databank");
      assert.equal(alt.set, "chemsep");
      assert.deepEqual(alt.source_ids, ["chemsep-ipd"]);
      assert.ok(binaries.indexOf(def) < binaries.indexOf(alt), "the default comes first, for readers that take the first match");
      assert.equal(def.replaced, undefined);
    }
  }
  // a temperature range of the data is also stored as the set's valid range
  const w = binaries.find(p => p.model === "NRTL" && p.i === "water" && p.j === "ethyl-acetate" && p.default);
  assert.deepEqual(w.valid, { T_K: w.T_range_K });
});

test("LICENSES.md lists every source of sources.json (generated table)", () => {
  const md = readFileSync(new URL("../src/data/LICENSES.md", import.meta.url), "utf8");
  const table = md.split("<!-- sources table")[1].split("<!-- end of sources table -->")[0];
  for (const id of Object.keys(sources)) assert.ok(table.includes("`" + id + "`"), id);
  assert.ok(md.includes("## Artistic License 2.0"), "license text kept");
});
