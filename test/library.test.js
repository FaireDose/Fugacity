// The CHEPTA Library, engine (proposal 0003, step 2): choosing between parameter sets with
// `sets` and `prefer`, info.pairs, warnings, and CHEPTA.library.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { system, library, findComponent } from "../src/index.js";

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const binaries = load("../src/data/binaries.json").pairs;
const sourcesJson = load("../src/data/sources.json").sources;
const MAC = ["methanol", "acetone", "chloroform"];
const CHEMSEP = { "acetone+chloroform": "chemsep", "Acetone + Methanol": "chemsep", "67-66-3+methanol": "chemsep" };

test("defaults: no sets or prefer gives the default set of every pair, with the fields of earlier versions", () => {
  const ids = [...new Set(binaries.flatMap(p => [p.i, p.j]))];
  for (const p of binaries.filter(q => q.default)) {
    const s = system({ components: [p.i, p.j], model: p.model });
    const info = s.info.pairs[0];
    assert.equal(info.set, p.set, `${p.model} ${p.i}-${p.j}`);
    assert.equal(info.default, true);
    assert.equal(info.chosenBy, "default");
    assert.equal(info.source, p.source, "text source as before");
    assert.equal(info.tier, p.tier);
    assert.deepEqual(info.T_range_K, p.T_range_K ?? null);
    assert.deepEqual(info.source_ids, p.source_ids);
    assert.ok(info.sources.every((src, k) => src.id === p.source_ids[k] && src.title === sourcesJson[src.id].title));
    // naming the default set, or an empty choice, changes nothing
    for (const cfg of [{ sets: { [`${p.i}+${p.j}`]: p.set } }, { sets: {} }, { sets: { [`${p.j}+${p.i}`]: "" } }]) {
      const t = system({ components: [p.i, p.j], model: p.model, ...cfg });
      for (const x of [0.1, 0.5, 0.9]) {
        assert.deepEqual(t.gammas([x, 1 - x], 340), s.gammas([x, 1 - x], 340), `${p.model} ${p.i}-${p.j} ${JSON.stringify(cfg)}`);
      }
    }
  }
  assert.ok(ids.length >= 10);
});

test("ChemSep sets reproduce the pre-refit saddle azeotropes of methanol + acetone + chloroform (PR #18)", () => {
  // Values recorded in pull request #18 (before the refit), 101.325 kPa:
  //   UNIQUAC 60.05 °C, x = 0.553 / 0.280 / 0.167;  NRTL 57.14 °C, x = 0.432 / 0.350 / 0.217
  const before = { UNIQUAC: [60.05, [0.553, 0.280, 0.167]], NRTL: [57.14, [0.432, 0.350, 0.217]] };
  for (const [model, [T_C, x]] of Object.entries(before)) {
    for (const cfg of [{ sets: CHEMSEP }, { prefer: ["databank"] }]) {
      const s = system({ components: MAC, model, ...cfg });
      assert.deepEqual(s.info.pairs.map(p => p.set), ["chemsep", "chemsep", "chemsep"]);
      assert.ok(s.info.pairs.every(p => p.tier === "databank" && p.default === false && p.alternatives[0].set.startsWith("fitted-")));
      const z = s.findAzeotrope([0.441, 0.317, 0.242], 101.325);
      assert.ok(Math.abs(z.T - 273.15 - T_C) < 0.006, `${model}: ${(z.T - 273.15).toFixed(3)} °C`);
      z.x.forEach((v, k) => assert.ok(Math.abs(v - x[k]) < 0.0006, `${model}: x ${z.x.map(u => u.toFixed(4))}`));
    }
  }
  // and the default (refitted) sets give the values after the refit
  const after = system({ components: MAC, model: "UNIQUAC" }).findAzeotrope([0.441, 0.317, 0.242], 101.325);
  assert.ok(Math.abs(after.T - 273.15 - 57.06) < 0.006, `after: ${(after.T - 273.15).toFixed(3)}`);
});

test("ChemSep sets reproduce the pre-refit fit quality of ethanol + water and ethyl acetate + ethanol (PR #19)", () => {
  // Pull request #19, "before" column (ChemSep), AAD in T (K) and y, pure-component rows left out.
  // (Its "before" row for Calvar et al. 2005, 0.12 K / 0.0030 and 0.12 K / 0.0028, is the AAD over
  // the Calvar and Zhang files together, as fit_parameters.py prints it; Calvar alone gives
  // 0.15 K. The Zhang row is checked here.)
  const before = [
    ["ethanol_water_101kPa.json", "NRTL", 0.16, 0.0051], ["ethanol_water_101kPa.json", "UNIQUAC", 0.16, 0.0058],
    ["ethyl-acetate_ethanol_101kPa_zhang2017.json", "NRTL", 0.07, 0.0027], ["ethyl-acetate_ethanol_101kPa_zhang2017.json", "UNIQUAC", 0.07, 0.0026],
  ];
  for (const [file, model, aT, aY] of before) {
    const d = load(`../validation/data/${file}`);
    const col = Object.fromEntries(d.columns.map((c, k) => [c, k]));
    const pts = d.rows.map(r => ({ x: r[col.x_1], T: r[col.T_K], y: r[col.y_1] })).filter(p => p.x > 0 && p.x < 1);
    const s = system({ components: d.components, model, sets: { [d.components.join("+")]: "chemsep" } });
    const dev = pts.map(p => { const b = s.bubbleT([p.x, 1 - p.x], d.P_kPa); return [Math.abs(b.T - p.T), Math.abs(b.y[0] - p.y)]; });
    const mT = dev.reduce((a, v) => a + v[0], 0) / dev.length, mY = dev.reduce((a, v) => a + v[1], 0) / dev.length;
    assert.ok(Math.abs(mT - aT) <= 0.005 + 1e-9, `${file} ${model}: AAD ${mT.toFixed(4)} K`);
    assert.ok(Math.abs(mY - aY) <= 0.00005 + 1e-9, `${file} ${model}: AAD ${mY.toFixed(5)} in y`);
  }
});

test("sets: any pair order and component name; clear errors for unknown sets, pairs and tiers", () => {
  const forms = ["acetone+chloroform", "Chloroform + Acetone", "CHCl3+acetone", "67-66-3 + 67-64-1"];
  const ref = system({ components: ["acetone", "chloroform"], model: "UNIQUAC", sets: { [forms[0]]: "chemsep" } });
  for (const f of forms) {
    const s = system({ components: ["chloroform", "acetone"], model: "UNIQUAC", sets: { [f]: "chemsep" } });
    assert.equal(s.info.pairs[0].set, "chemsep", f);
    assert.deepEqual(s.gammas([0.3, 0.7], 330), ref.gammas([0.7, 0.3], 330).reverse(), f);
  }
  // a choice for a pair not in the system is ignored (one settings object serves several systems)
  assert.equal(system({ components: ["ethanol", "water"], sets: CHEMSEP }).info.pairs[0].set, "fitted-kamihama2012");
  assert.throws(() => system({ components: MAC, sets: { "acetone+chloroform": "dechema" } }), /No NRTL parameter set "dechema" for Acetone \+ Chloroform\. Sets: "fitted-gao2018" \(fitted, default\), "chemsep" \(databank\)/);
  assert.throws(() => system({ components: MAC, sets: { acetone: "chemsep" } }), /not a pair/);
  assert.throws(() => system({ components: MAC, sets: { "acetone+unobtainium": "chemsep" } }), /Unknown component "unobtainium"/);
  assert.throws(() => system({ components: MAC, sets: { "acetone+acetone": "chemsep" } }), /same component twice/);
  assert.throws(() => system({ components: MAC, sets: [["acetone", "chloroform"]] }), /sets must be an object/);
  assert.throws(() => system({ components: MAC, sets: { "acetone+chloroform": 3 } }), /must be a set name/);
  assert.throws(() => system({ components: MAC, prefer: ["fitted", "measured"] }), /unknown tier "measured"/);
  assert.throws(() => system({ components: MAC, model: "ideal", prefer: "best" }), /unknown tier/, "checked for every model");
});

test("prefer: per pair the first tier that has a set; otherwise the default, with a note", () => {
  const s = system({ components: ["water", "ethanol", "ethylene glycol"], model: "NRTL", prefer: ["databank"] });
  const by = Object.fromEntries(s.info.pairs.map(p => [p.pair.join(" + "), p]));
  assert.equal(by["Water + Ethanol"].set, "chemsep");
  assert.equal(by["Water + Ethanol"].chosenBy, "prefer");
  assert.equal(by["Ethanol + Ethylene glycol"].set, "chemsep");
  assert.equal(by["Ethanol + Ethylene glycol"].chosenBy, "prefer", "databank set kept as an alternative");
  const weg = s.info.pairs.find(p => p.pair.includes("Ethylene glycol") && p.pair.includes("Water"));
  assert.equal(weg.tier, "fitted", "no databank set for water + ethylene glycol: the default");
  assert.match(weg.note, /No databank NRTL set for Water \+ Ethylene glycol: the default set "fitted-kamihama2012" \(fitted\) is used/);
  assert.ok(s.bubbleT([0.3, 0.3, 0.4], 101.325).warnings.includes(weg.note), "the note travels with the results");
  // fitted first = today's defaults for the current data
  const f = system({ components: MAC, model: "NRTL", prefer: ["fitted", "databank"] });
  assert.deepEqual(f.info.pairs.map(p => p.set), system({ components: MAC, model: "NRTL" }).info.pairs.map(p => p.set));
});

test("warnings: a set's valid range; the ChemSep alternative of water + ethyl acetate has none", () => {
  const def = system({ components: ["water", "ethyl acetate"], model: "NRTL" });
  assert.deepEqual(def.info.pairs[0].valid, { T_K: def.info.pairs[0].T_range_K });
  assert.match(def.bubbleP([0.5, 0.5], 380).warnings.join(" "), /^NRTL parameters of Water \+ Ethyl acetate come from data at 273.35-343.55 K; 380.00 K is outside that range\.$/);
  const alt = system({ components: ["water", "ethyl acetate"], model: "NRTL", sets: { "water+ethyl acetate": "chemsep" } });
  assert.equal(alt.info.pairs[0].valid, null);
  assert.deepEqual(alt.bubbleP([0.5, 0.5], 380).warnings, []);
  // k_ij: the PR default for hydrogen + toluene carries its data range, the ChemSep value does not
  const pr = system({ components: ["hydrogen", "toluene"], model: "PR" });
  assert.equal(pr.info.pairs[0].kij, 0.3989);
  assert.match(pr.bubbleP([0.01, 0.99], 400).warnings.join(" "), /k_ij of Hydrogen \+ Toluene \(0.3989\) comes from data at 293-333 K/);
  const cs = system({ components: ["hydrogen", "toluene"], model: "PR", sets: { "H2+toluene": "chemsep" } });
  assert.equal(cs.info.pairs[0].kij, -0.51);
  assert.equal(cs.info.pairs[0].tier, "databank");
  assert.deepEqual(cs.info.pairs[0].alternatives.map(a => a.set), ["fitted-tsuji2005"]);
  assert.equal(system({ components: ["hydrogen", "toluene"], model: "PR", prefer: "databank" }).info.pairs[0].kij, -0.51);
  assert.throws(() => system({ components: ["hydrogen", "toluene"], model: "SRK", sets: { "H2+toluene": "fitted-tsuji2005" } }), /No SRK parameter set "fitted-tsuji2005"/);
});

test("library.sources, source, usedBy, sets", () => {
  const all = library.sources();
  assert.equal(all.length, Object.keys(sourcesJson).length);
  for (const s of all) assert.ok(s.id && s.kind && s.access && Array.isArray(s.usedBy), s.id);
  const cs = library.source("chemsep-ipd");
  assert.equal(cs.title, sourcesJson["chemsep-ipd"].title);
  const sets = cs.usedBy.filter(u => u.type === "pair-set");
  assert.equal(sets.length, binaries.filter(p => p.source_ids.includes("chemsep-ipd")).length);
  assert.ok(sets.some(u => u.default === false && u.set === "chemsep" && u.pair.join() === "Acetone,Chloroform"));
  assert.ok(library.usedBy("coolprop").some(u => u.type === "component" && u.component === "water"));
  assert.ok(library.usedBy("iapws-g7-04").some(u => u.type === "henry" && u.gas === "oxygen"));
  assert.ok(library.usedBy("iapws-r7-97").some(u => u.type === "file" && u.file === "src/thermo/iapws/if97.js"));
  assert.throws(() => library.source("dechema"), /Unknown source "dechema"/);
  assert.throws(() => library.usedBy("nope"), /Unknown source/);

  const ac = library.sets("chloroform", "acetone", "UNIQUAC");
  assert.deepEqual(ac.map(s => [s.set, s.default, s.tier]), [["fitted-gao2018", true, "fitted"], ["chemsep", false, "databank"]]);
  assert.deepEqual(ac[1].params, { a_ij: 0, a_ji: 0, b_ij: -788.0452616738485, b_ji: 393.31019778237334 });
  assert.equal(ac[1].sources[0].id, "chemsep-ipd");
  assert.deepEqual(library.sets("acetone", "chloroform").map(s => s.model), ["NRTL", "NRTL", "UNIQUAC", "UNIQUAC"]);
  assert.deepEqual(library.sets("hydrogen", "toluene", "pr").map(s => [s.set, s.params.kij]), [["fitted-tsuji2005", 0.3989], ["chemsep", -0.51]]);
  assert.deepEqual(library.sets("acetone", "ethyl acetate", "NRTL"), []);
  assert.throws(() => library.sets("acetone", "chloroform", "Wilson"), /Unknown model "Wilson"/);
  // the data is not changed by reading it
  library.sets("acetone", "chloroform", "UNIQUAC")[0].params.b_ij = 0;
  assert.equal(library.sets("acetone", "chloroform", "UNIQUAC")[0].params.b_ij, 104.66495584649239);
});

test("library.add: a set for this page only (tier user), with clear errors", () => {
  const base = { model: "NRTL", i: "acetone", j: "ethyl acetate", params: { b_ij: 100, b_ji: -50 }, source: { title: "Test set, not data", url: "https://example.org/test" } };
  // before: no parameters for this pair
  assert.throws(() => system({ components: ["acetone", "ethyl acetate"] }), /No NRTL parameters for: Acetone \+ Ethyl acetate/);
  const bad = [
    [null, /needs an object/],
    [{ ...base, model: "Wilson" }, /Unknown model/],
    [{ ...base, j: "acetone" }, /two different components/],
    [{ ...base, set: "" }, /give the set a name/],
    [{ ...base, set: "t", params: undefined }, /params is required/],
    [{ ...base, set: "t", params: { b_ij: 1 } }, /needs b_ij and b_ji/],
    [{ ...base, set: "t", params: { b_ij: 1, b_ji: 2, bij: 3 } }, /unknown NRTL parameter "bij"/],
    [{ ...base, set: "t", params: { b_ij: "1", b_ji: 2 } }, /params.b_ij must be a finite number/],
    [{ ...base, set: "t", params: { b_ij: 1, b_ji: 2, alpha: 1.5 } }, /alpha must be between 0 and 1/],
    [{ ...base, set: "t", source: undefined }, /give source/],
    [{ ...base, set: "t", source: { title: "x" } }, /needs a url or a doi/],
    [{ ...base, set: "t", source: { title: "x", url: "ftp://x" } }, /must start with http/],
    [{ ...base, set: "t", source_ids: ["nope"], source: undefined }, /unknown source "nope"/],
    [{ ...base, set: "t", valid: { T_K: [350, 300] } }, /low <= high/],
    [{ ...base, model: "PR", set: "t", params: { kij: 1.2 } }, /outside -1 < k_ij < 1/],
    [{ ...base, i: "acetone", j: "chloroform", set: "chemsep" }, /already has a set "chemsep"/],
  ];
  for (const [spec, re] of bad) assert.throws(() => library.add(spec), re, JSON.stringify(spec));

  const added = library.add({ ...base, set: "test-page", valid: { P_kPa: [90, 110] } });
  assert.equal(added.tier, "user");
  assert.equal(added.default, false);
  assert.deepEqual(added.params, { a_ij: 0, a_ji: 0, b_ij: 100, b_ji: -50, alpha: 0.3 });
  assert.match(added.source_ids[0], /^user-test-set-not-data/);
  assert.equal(library.source(added.source_ids[0]).kind, "user");
  assert.equal(library.sources().length, Object.keys(sourcesJson).length + 1);
  // the only set of the pair: used without asking; outside its pressure range it warns
  const s = system({ components: ["ethyl acetate", "acetone"] });
  assert.equal(s.info.pairs[0].tier, "user");
  assert.deepEqual(s.gammas([0.4, 0.6], 330), system({ components: ["ethyl acetate", "acetone"], sets: { "acetone+ethyl acetate": "test-page" } }).gammas([0.4, 0.6], 330));
  assert.deepEqual(s.bubbleT([0.5, 0.5], 101.325).warnings, []);
  assert.match(s.bubbleT([0.5, 0.5], 300).warnings.join(" "), /\(set "test-page"\) come from data at 90-110 kPa; 300 kPa is outside that range/);
  // next to data sets it is used only when chosen
  library.add({ model: "UNIQUAC", i: "chloroform", j: "acetone", set: "test-page", params: { b_ij: -10, b_ji: 100 }, source_ids: ["gao2018-acetone-chloroform"] });
  assert.equal(system({ components: MAC, model: "UNIQUAC" }).info.pairs[2].set, "fitted-gao2018");
  const u = system({ components: MAC, model: "UNIQUAC", sets: { "acetone+chloroform": "test-page" } });
  assert.equal(u.info.pairs[2].tier, "user");
  assert.equal(system({ components: MAC, model: "UNIQUAC", prefer: ["user", "fitted"] }).info.pairs[2].set, "test-page");
  assert.ok(library.usedBy("gao2018-acetone-chloroform").some(x => x.set === "test-page"));
  assert.equal(findComponent("CHCl3"), "chloroform");
});
