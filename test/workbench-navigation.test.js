// Workbench navigation (CHEPTA.app): workspaces, the inputs of each view, their checks,
// the supporting panels, and the seven acceptance workflows at the state level (DOM-free).
// The same workflows are checked in a browser with Playwright (see the pull request).
import { test } from "node:test";
import assert from "node:assert/strict";
import { HENRY_GASES, listComponents } from "../src/index.js";
import { VIEWS, PRESETS, initialState, applyPatch } from "../src/ui/app-logic.js";
import {
  WORKSPACES, SECTIONS, sectionOf, UTILITIES, INPUTS, workspaceOf, checkInputs, normalizeInputs, seedInputs, examplesFor, rotateInputs, solventsFor, HENRY_PAIRS, needsFor,
} from "../src/ui/workspaces.js";

const MAC = ["methanol", "acetone", "chloroform"];
const go = (s, ...patches) => patches.reduce(applyPatch, s);

test("one navigation: six task workspaces holding every view; four supporting panels", () => {
  assert.deepEqual(WORKSPACES.map(w => w.id), ["equilibrium", "steam", "solubility", "properties", "flash", "flowsheet"]);
  assert.deepEqual(WORKSPACES.map(w => w.label), ["Phase equilibrium", "Steam", "Solubility", "Properties", "Flash", "Flowsheet"]);
  // the top navigation: File, then three sections holding every workspace once, in order
  assert.deepEqual(SECTIONS.map(x => x.label), ["Properties & Equilibria", "Unit models", "Flowsheet"]);
  assert.deepEqual(SECTIONS.flatMap(x => x.workspaces), WORKSPACES.map(w => w.id));
  assert.equal(sectionOf("steam"), "thermo"); assert.equal(sectionOf("flash"), "units"); assert.equal(sectionOf("flowsheet"), "flowsheet");
  assert.deepEqual(SECTIONS.find(x => x.id === "units").locked.map(l => l.label), ["Reaction", "Distillation"]);
  assert.deepEqual(UTILITIES.map(u => u.id), ["project", "library", "sources", "settings", "feedback"]);
  // every view is in exactly one workspace, and every workspace view has its inputs defined
  const all = WORKSPACES.flatMap(w => w.views);
  assert.deepEqual(all.slice().sort(), Object.keys(VIEWS).sort());
  assert.equal(new Set(all).size, all.length);
  for (const v of all) {
    assert.equal(workspaceOf(v), VIEWS[v].workspace, v);
    assert.ok(INPUTS[v], v);
  }
  assert.deepEqual(WORKSPACES.find(w => w.id === "equilibrium").views, ["txy", "ternary", "azeotropes", "pxy", "envelope"]);
  assert.throws(() => workspaceOf("column"), /Unknown view/);
});

test("solids: the Solubility workspace holds gases, a solid in a solvent and the solid-liquid diagram", () => {
  assert.deepEqual(WORKSPACES.find(w => w.id === "solubility").views, ["henry", "solid", "sle"]);
  let st = initialState({ start: "sle" });
  assert.equal(st.workspace, "solubility"); assert.equal(st.view, "sle");
  assert.deepEqual(st.components, ["benzene", "naphthalene"]);
  st = go(st, { view: "solid" });
  assert.deepEqual(st.components, ["benzoic-acid", "ethanol"]);
  // the solid needs melting data; the solvent does not
  let c = checkInputs("solid", ["mdea", "water"], "NRTL");
  assert.equal(c.ok, false); assert.match(c.problems[0].message, /no melting temperature/); assert.equal(c.problems[0].slot, 0);
  assert.ok(checkInputs("solid", ["naphthalene", "mdea"], "ideal").ok);
  // a component without activity-model data: said so, without suggesting an equation of state
  c = checkInputs("solid", ["naphthalene", "2-methoxyethanol"], "ideal");
  assert.equal(c.ok, false); assert.doesNotMatch(c.problems[0].message, /equation of state/);
  // the diagram needs melting data for both
  c = checkInputs("sle", ["naphthalene", "mdea"], "ideal");
  assert.equal(c.ok, false); assert.equal(c.problems[0].slot, 1);
  // an equation of state cannot describe the solid's liquid side here: an activity model is asked for
  c = checkInputs("sle", ["benzene", "naphthalene"], "PR");
  assert.equal(c.ok, false); assert.match(c.problems.at(-1).message, /activity model/);
  // the readout temperature
  st = go(st, { sleT_K: 310 });
  assert.equal(st.sleT_K, 310);
  assert.throws(() => go(st, { sleT_K: -1 }), /positive/);
});

test("each view asks for what it needs: one, two, three components, a list, or a gas and a solvent", () => {
  assert.equal(INPUTS.properties.kind, "slots"); assert.equal(INPUTS.properties.n, 1);
  assert.equal(INPUTS.txy.n, 2); assert.equal(INPUTS.txy.liquid, true);
  assert.equal(INPUTS.ternary.n, 3); assert.equal(INPUTS.ternary.roles.length, 3);
  assert.equal(INPUTS.pxy.n, 2); assert.equal(INPUTS.pxy.liquid, true, "liquids with an activity model");
  // every diagram takes gases with an equation of state; the envelope then takes one component
  for (const v of ["txy", "ternary", "azeotropes", "pxy", "envelope"]) {
    assert.equal(needsFor(v, "NRTL").liquid, true, v);
    assert.equal(needsFor(v, "PR").liquid, false, v);
  }
  assert.deepEqual([needsFor("envelope", "UNIQUAC").min, needsFor("envelope", "SRK").min], [2, 1]);
  assert.deepEqual([INPUTS.azeotropes.min, INPUTS.azeotropes.max], [2, 4]);
  assert.deepEqual([INPUTS.envelope.min, INPUTS.envelope.max], [1, 6]);
  assert.equal(INPUTS.henry.kind, "henry");
  assert.equal(INPUTS.steam.kind, "none");
  for (const v of ["txy", "ternary", "pxy", "properties"]) assert.equal(INPUTS[v].roles.length, INPUTS[v].n, v);
});

test("inputs are normalized but never silently changed", () => {
  assert.deepEqual(normalizeInputs("ternary", ["Water", "64-17-5"]), ["water", "ethanol", null], "an empty slot stays empty");
  assert.deepEqual(normalizeInputs("txy", ["water", "water", "ethanol"]), ["water", "water"], "duplicates kept, extra cut");
  assert.deepEqual(normalizeInputs("properties", "ethanol"), ["ethanol"]);
  assert.deepEqual(normalizeInputs("azeotropes", MAC), MAC);
  assert.deepEqual(normalizeInputs("henry", { gas: "O2", solvent: "H2O" }), { gas: "oxygen", solvent: "water" });
  assert.throws(() => normalizeInputs("txy", ["unobtainium"]), /Unknown component/);
});

test("checkInputs explains what does not fit, per slot, and passes what does", () => {
  let c = checkInputs("ternary", MAC);
  assert.equal(c.ok, true); assert.deepEqual(c.use, MAC); assert.deepEqual(c.problems, []);

  c = checkInputs("ternary", ["water", "ethanol", null]);
  assert.equal(c.ok, false); assert.deepEqual(c.use, []);
  assert.deepEqual(c.problems.map(p => p.slot), [2]);
  assert.match(c.problems[0].message, /Component 3 is empty: choose a liquid/);

  c = checkInputs("txy", ["oxygen", "water"]);
  assert.equal(c.ok, false);
  assert.equal(c.problems[0].slot, 0);
  assert.match(c.problems[0].message, /Oxygen, has no activity-model data .* a T-x-y diagram with NRTL cannot use it.*equation of state/);
  assert.equal(checkInputs("pxy", ["oxygen", "water"]).ok, false, "not with an activity model");
  assert.equal(checkInputs("pxy", ["oxygen", "water"], "PR").ok, true, "an equation of state takes gases");
  assert.equal(checkInputs("txy", ["oxygen", "water"], "SRK").ok, true);

  c = checkInputs("txy", ["ethanol", "ethanol"]);
  assert.match(c.problems[0].message, /Components 1 and 2 are both Ethanol/);
  assert.equal(c.problems[0].slot, 1);

  assert.match(checkInputs("azeotropes", ["water"]).problems[0].message, /at least two liquids; one chosen/);
  assert.equal(checkInputs("envelope", ["methane"], "PR").ok, true);
  assert.match(checkInputs("envelope", ["water"]).problems.at(-1).message, /at least two liquids with an activity model/);
  assert.equal(checkInputs("properties", [null]).ok, false);
  assert.deepEqual(checkInputs("steam", []).use, ["water"]);

  assert.deepEqual(checkInputs("henry", { gas: "nitrogen", solvent: "water" }).use, ["nitrogen"]);
  c = checkInputs("henry", { gas: "ethanol", solvent: "water" });
  assert.equal(c.problems[0].slot, 0);
  assert.match(c.problems[0].message, /Ethanol has no Henry's law constant/);
  c = checkInputs("henry", { gas: "oxygen", solvent: "ethanol" });
  assert.equal(c.problems[0].slot, 1);
  assert.match(c.problems[0].message, /No Henry's law constant for Oxygen in Ethanol\. Solvents with one for Oxygen: Water/);
});

test("Henry's law selectors offer only what the table has", () => {
  assert.deepEqual([...new Set(HENRY_PAIRS.map(p => p.gas))].sort(), HENRY_GASES.slice().sort());
  assert.deepEqual(solventsFor("oxygen"), ["water"]);
  assert.deepEqual(solventsFor(null), ["water"]);
  assert.deepEqual(solventsFor("ethanol"), []);
});

test("one list of components seeds every view; examples fit their view", () => {
  const seed = seedInputs(["water", "oxygen", "ethanol", "methanol"]);
  assert.deepEqual(seed.txy, ["water", "ethanol"], "liquids only");
  assert.deepEqual(seed.ternary, ["water", "ethanol", "methanol"]);
  assert.deepEqual(seed.pxy, ["water", "oxygen"], "any component");
  assert.deepEqual(seed.envelope, ["water", "oxygen", "ethanol", "methanol"]);
  assert.deepEqual(seed.henry, { gas: "oxygen", solvent: "water" });
  assert.deepEqual(seed.properties, ["water"]);
  assert.deepEqual(seedInputs([]).ternary, [null, null, null]);
  assert.deepEqual(seedInputs([]).properties, ["water"]);
  assert.deepEqual(seedInputs(["ethanol"], { propComponent: "acetone" }).properties, ["acetone"]);

  for (const v of ["txy", "ternary", "azeotropes", "pxy", "envelope"]) {
    const ex = examplesFor(v, PRESETS);
    assert.ok(ex.length > 0, v);
    for (const p of ex) assert.equal(checkInputs(v, normalizeInputs(v, p.components)).ok, true, `${v}: ${p.label}`);
  }
  assert.deepEqual(examplesFor("txy", PRESETS).map(p => p.label), ["Ethanol, water", "Benzene, toluene"]);
  assert.deepEqual(rotateInputs(MAC), ["acetone", "chloroform", "methanol"]);
  assert.deepEqual(rotateInputs(["water", null]), [null, "water"]);
});

test("the configuration keys of earlier versions still work; old start names map to the workspaces", () => {
  const map = { txy: "equilibrium", ternary: "equilibrium", azeotropes: "equilibrium", pxy: "equilibrium", envelope: "equilibrium",
    eos: "equilibrium", henry: "solubility", gases: "solubility", solubility: "solubility", properties: "properties", explorer: "properties", steam: "steam" };
  for (const [start, ws] of Object.entries(map)) {
    const s = initialState({ start, components: ["methane", "ethane", "ethanol", "water", "methanol"] });
    assert.equal(s.workspace, ws, start);
    assert.equal(s.utility, null, start);
  }
  const s = initialState({ components: ["ethanol", "water"], model: "UNIQUAC", P_kPa: 50, propComponent: "water", property: "viscosity",
    henryP_kPa: 200, steamP_kPa: [100, 1000], sets: { "ethanol+water": "chemsep" }, prefer: "fitted", panels: { left: false }, background: false, units: { T: "K" } });
  assert.equal(s.view, "txy");
  assert.deepEqual(s.components, ["ethanol", "water"]);
  assert.equal(s.propComponent, "water");
  assert.equal(s.property, "viscosity");
  assert.equal(s.henryP_kPa, 200);
  assert.deepEqual(s.steamP_kPa, [100, 1000]);
  assert.deepEqual(s.sets, { "ethanol+water": "chemsep" });
  assert.equal(s.panels.left, false);
  assert.equal(s.units.T, "K");
  // the old `tab` patch
  // "eos" now selects the equation of state for the diagram on screen (every diagram takes either model)
  assert.equal(applyPatch(s, { tab: "eos" }).model, "PR");
  assert.equal(applyPatch(s, { tab: "eos" }).view, "txy");
  assert.equal(applyPatch(applyPatch(s, { tab: "eos" }), { tab: "vle" }).model, "NRTL");
  assert.equal(applyPatch(s, { tab: "steam" }).workspace, "steam");
  assert.equal(applyPatch(s, { tab: "components" }).panels.left, true);
  assert.equal(applyPatch(s, { tab: "library" }).utility, "library");
  // new keys are checked
  assert.throws(() => applyPatch(s, { workspace: "column" }), /Unknown workspace/);
  assert.throws(() => applyPatch(s, { utility: "help" }), /Unknown panel/);
  assert.throws(() => applyPatch(s, { inputs: { steam: ["water"] } }), /unknown view "steam"/);
  assert.throws(() => applyPatch(s, { view: "sankey" }), /Unknown view/);
});

// ---- the acceptance workflows, at the state level

test("workflow 1: opening and closing the sources panel preserves workspace, inputs, settings", () => {
  const s0 = go(initialState(), { model: "UNIQUAC", P_kPa: 50, inputs: { ternary: ["ethanol", "water", "methanol"] } });
  const open = applyPatch(s0, { utility: "sources" });
  assert.equal(open.utility, "sources");
  const closed = applyPatch(open, { utility: null });
  assert.deepEqual({ ...closed, utility: undefined }, { ...s0, utility: undefined });
  assert.equal(closed.utility, null);
  // and the calculation continues
  const next = applyPatch(closed, { P_kPa: 80 });
  assert.equal(next.P_kPa, 80);
  assert.deepEqual(next.components, ["ethanol", "water", "methanol"]);
});

test("workflow 2: Properties after a ternary diagram has exactly one component", () => {
  const s = applyPatch(initialState(), { workspace: "properties" });
  assert.equal(s.view, "properties");
  assert.equal(s.inputs.properties.length, 1);
  assert.deepEqual(s.components, ["methanol"]);
  assert.equal(INPUTS[s.view].n, 1);
});

test("workflow 3: changing the property component stays in Properties and leaves the others alone", () => {
  const s0 = applyPatch(initialState(), { workspace: "properties" });
  const s1 = applyPatch(s0, { inputs: { properties: ["ethanol"] } });
  assert.equal(s1.workspace, "properties");
  assert.deepEqual(s1.components, ["ethanol"]);
  assert.deepEqual(s1.inputs.ternary, MAC, "the ternary map keeps its components");
  assert.equal(applyPatch(s0, { propComponent: "benzene" }).propComponent, "benzene");
});

test("workflow 4: gas and solvent are chosen inside Gas solubility", () => {
  let s = applyPatch(initialState(), { workspace: "solubility" });
  assert.equal(s.view, "henry");
  s = go(s, { gas: "nitrogen" }, { solvent: "water" }, { henryT_K: 313.15, henryP_kPa: 200 });
  assert.equal(s.workspace, "solubility");
  assert.deepEqual(s.inputs.henry, { gas: "nitrogen", solvent: "water" });
  assert.deepEqual(s.components, ["nitrogen"]);
  assert.equal(checkInputs("henry", s.inputs.henry).ok, true);
  assert.deepEqual(s.inputs.ternary, MAC, "no other workspace touched");
});

test("workflow 5: every workspace restores its own inputs and settings; incompatible ones stay and are explained", () => {
  let s = initialState();
  s = go(s, { view: "txy" }, { inputs: { txy: ["ethanol", "water"] }, P_kPa: 60 });
  s = go(s, { workspace: "properties" }, { propComponent: "ethanol", property: "viscosity" });
  s = go(s, { workspace: "solubility" }, { gas: "nitrogen", henryT_K: 313.15 });
  s = go(s, { workspace: "steam" }, { steamP_kPa: [50, 500] });
  s = applyPatch(s, { workspace: "equilibrium" });
  assert.equal(s.view, "txy", "the diagram it was on");
  assert.deepEqual(s.components, ["ethanol", "water"]);
  assert.equal(s.P_kPa, 60);
  assert.deepEqual(applyPatch(s, { view: "ternary" }).components, MAC);
  s = applyPatch(s, { workspace: "properties" });
  assert.deepEqual([s.components, s.property], [["ethanol"], "viscosity"]);
  s = applyPatch(s, { workspace: "solubility" });
  assert.deepEqual([s.inputs.henry.gas, s.henryT_K], ["nitrogen", 313.15]);
  s = applyPatch(s, { workspace: "steam" });
  assert.deepEqual(s.steamP_kPa, [50, 500]);

  // an incompatible selection is restored as it was and explained
  s = go(s, { workspace: "equilibrium" }, { inputs: { txy: ["ethanol", "ethanol"] } }, { workspace: "steam" }, { workspace: "equilibrium" });
  assert.equal(s.view, "txy");
  assert.deepEqual(s.inputs.txy, ["ethanol", "ethanol"]);
  assert.deepEqual(s.components, [], "nothing to calculate");
  assert.match(checkInputs("txy", s.inputs.txy).problems[0].message, /both Ethanol/);
  // navigating to a diagram does not fall back to another one either
  const t = go(initialState({ components: ["ethanol", "water"] }), { view: "ternary" });
  assert.equal(t.view, "ternary");
  assert.match(checkInputs("ternary", t.inputs.ternary).problems[0].message, /Component 3 is empty/);
});

test("workflow 6: navigating dismisses temporary panels", () => {
  for (const u of UTILITIES.map(x => x.id)) {
    const open = applyPatch(initialState(), { utility: u });
    assert.equal(applyPatch(open, { workspace: "steam" }).utility, null, `${u}: workspace change`);
    assert.equal(applyPatch(open, { view: "txy" }).utility, null, `${u}: diagram change`);
    assert.equal(applyPatch(open, { workspace: "equilibrium", utility: null }).utility, null, `${u}: the current workspace's tab`);
    assert.equal(applyPatch(open, { P_kPa: 90 }).utility, u, `${u}: a setting does not close it`);
  }
  assert.equal(applyPatch(applyPatch(initialState(), { utility: "library" }), { utility: "sources" }).utility, "sources", "Library leads to Sources");
  assert.equal(applyPatch(initialState(), { workspace: "steam", utility: "sources" }).utility, "sources", "a patch may navigate and open one");
});

test("workflow 7: every view stays reachable from the navigation", () => {
  let s = initialState({ components: ["methane", "ethane", "ethanol", "water", "methanol"] });
  const reached = new Set();
  for (const w of WORKSPACES) {
    s = applyPatch(s, { workspace: w.id });
    for (const v of w.views) {
      s = applyPatch(s, { view: v });
      assert.equal(s.workspace, w.id);
      reached.add(s.view);
    }
  }
  assert.deepEqual([...reached].sort(), Object.keys(VIEWS).sort());
  for (const u of UTILITIES) assert.equal(applyPatch(s, { utility: u.id }).utility, u.id);
  assert.ok(listComponents().every(c => INPUTS.properties.liquid === false || c.activity), "Properties offers every component");
});
