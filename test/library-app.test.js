// The CHEPTA Library in the workbench (proposal 0003, step 3): the DOM-free part
// (state, rules, per-pair choices, source search).
import { test } from "node:test";
import assert from "node:assert/strict";
import { system, library } from "../src/index.js";
import {
  LEGACY_TABS, VIEWS, initialState, applyPatch, viewAvailability, resolveView, RULES, ruleOf, normalizeSets, normalizePrefer, setsFor,
  setChoices, pairKeyOf, filterSources, sourceUsedFor,
} from "../src/ui/app-logic.js";

test("Library tab and sources view; the defaults leave sets and prefer empty", () => {
  // the Library and the sources are supporting panels over a workspace, not views
  assert.ok(LEGACY_TABS.includes("library"));
  assert.equal(VIEWS.sources, undefined);
  assert.equal(applyPatch(initialState(), { tab: "library" }).utility, "library");
  for (const start of ["sources", "library"]) {
    const s = initialState({ start, components: ["water", "ethanol"] });
    assert.equal(s.utility, "sources", start);
    assert.equal(s.view, resolveView(null, ["water", "ethanol"]), "over the first workspace");
  }
  assert.equal(viewAvailability("txy", ["water", "ethanol"]).enabled, true);
  const s = initialState();
  assert.deepEqual(s.sets, {});
  assert.equal(s.prefer, null);
  assert.equal(ruleOf(s.prefer), "best");
});

test("sets and prefer are part of the state: normalized, merged, cleared", () => {
  const s0 = initialState({ sets: { "Chloroform + Acetone": "chemsep" }, prefer: "databank" });
  assert.deepEqual(s0.sets, { "acetone+chloroform": "chemsep" });
  assert.deepEqual(s0.prefer, ["databank"]);
  assert.equal(ruleOf(s0.prefer), "databank");
  const s1 = applyPatch(s0, { sets: { "methanol+acetone": "chemsep" } });
  assert.deepEqual(s1.sets, { "acetone+chloroform": "chemsep", "acetone+methanol": "chemsep" }, "merged");
  assert.deepEqual(s0.sets, { "acetone+chloroform": "chemsep" }, "input not modified");
  assert.deepEqual(applyPatch(s1, { sets: { "acetone+chloroform": null } }).sets, { "acetone+methanol": "chemsep" });
  assert.deepEqual(applyPatch(s1, { sets: null }).sets, {});
  assert.equal(applyPatch(s1, { prefer: "best" }).prefer, null);
  assert.deepEqual(applyPatch(s1, { prefer: ["fitted", "databank"] }).prefer, ["fitted", "databank"]);
  assert.equal(ruleOf(["fitted", "databank"]), "fitted");
  assert.equal(ruleOf(["user"]), "custom");
  assert.throws(() => applyPatch(s1, { prefer: "newest" }), /unknown tier "newest"/);
  assert.throws(() => normalizeSets({ acetone: "chemsep" }), /not a pair/);
  assert.throws(() => normalizeSets({ "acetone+xenon": "chemsep" }), /Unknown component/);
  assert.equal(pairKeyOf("CHCl3", "acetone"), "acetone+chloroform");
  assert.deepEqual(RULES.map(r => normalizePrefer(r.id)), [null, ["fitted", "databank"], ["databank"]]);
});

test("setsFor passes only the choices that exist for the model; the views get the same system", () => {
  const s = initialState({ sets: { "water+acetic acid": "chemsep-uniquac-curve", "acetone+chloroform": "chemsep" } });
  assert.deepEqual(setsFor(s, "NRTL").sets, { "acetic-acid+water": "chemsep-uniquac-curve", "acetone+chloroform": "chemsep" });
  assert.deepEqual(setsFor(s, "UNIQUAC").sets, { "acetone+chloroform": "chemsep" }, "NRTL-only set name dropped for UNIQUAC");
  assert.deepEqual(setsFor(s, "ideal").sets, {});
  const sys = system({ components: ["methanol", "acetone", "chloroform"], model: "UNIQUAC", ...setsFor(s, "UNIQUAC") });
  assert.deepEqual(sys.info.pairs.map(p => p.set), ["fitted-li2018", "fitted-li2014", "chemsep"]);
});

test("pair selectors list the default first and mark the set in use", () => {
  const p = system({ components: ["acetone", "chloroform"], model: "NRTL", sets: { "acetone+chloroform": "chemsep" } }).info.pairs[0];
  const c = setChoices(p);
  assert.deepEqual(c.map(x => [x.set, x.default, x.current]), [["fitted-gao2018", true, false], ["chemsep", false, true]]);
  assert.equal(c[0].label, "fitted-gao2018 (default)");
  assert.deepEqual(setChoices(system({ components: ["water", "methanol"] }).info.pairs[0]), [], "one set: no selector");
});

test("source search: text, kind and the selected components", () => {
  const all = library.sources();
  assert.equal(filterSources(all, "").length, all.length);
  assert.deepEqual(filterSources(all, "10.3390/app8091519").map(s => s.id), ["gao2018-acetone-chloroform"]);
  assert.ok(filterSources(all, "", "standard").every(s => s.kind === "standard"));
  assert.ok(filterSources(all, "kamihama").some(s => s.id === "kamihama2012-ethanol-water"));
  const gao = all.find(s => s.id === "gao2018-acetone-chloroform");
  assert.equal(sourceUsedFor(gao, ["acetone", "chloroform"], ["Acetone", "Chloroform"]), true);
  assert.equal(sourceUsedFor(gao, ["water", "ethanol"], ["Water", "Ethanol"]), false);
});
