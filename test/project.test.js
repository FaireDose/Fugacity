// Project files of the workbench (src/ui/project.js): what is saved, that opening a file gives
// back the same workbench, and that a wrong file is refused with the reason. DOM-free.
import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState, applyPatch } from "../src/ui/app-logic.js";
import { PROJECT_FORMAT, projectOf, projectText, projectFileName, readProject, stateFromProject, checkProject } from "../src/ui/project.js";
import { runFlowsheet } from "../src/index.js";

// the state a person sets, without the read-only summary fields and the open panel
const settings = ({ components, propComponent, utility, ...rest }) => rest;

function worked() {
  let s = initialState({
    components: ["ethanol", "water", "methanol"], start: "flash", model: "UNIQUAC", vapour: "PR",
    units: { T: "K", P: "bar" }, basis: "mass", sets: { "ethanol+water": "chemsep" }, prefer: "databank",
    flash: { spec: "TP", T_K: 355, P_kPa: 120, z: [0.2, 0.5, 0.3], flow: 12, flowUnit: "t/h", duty: true, feedT_K: 300 },
    title: "Column feed", henryT_K: 310, steamP_kPa: [50, 500], grid: 60, residueCurves: false,
  });
  s = applyPatch(s, { view: "pxy", z: [0.3, 0.7], T_K: 340 });
  s = applyPatch(s, { inputs: { ternary: ["acetone", "chloroform", "methanol"], henry: { gas: "nitrogen" } }, propComponent: "water" });
  return applyPatch(s, { view: "flash", panels: { right: false } });
}

test("a project keeps the settings of every workspace and opens to the same workbench", () => {
  const s = worked();
  const doc = projectOf(s, { version: "9.9.9", now: new Date("2026-10-06T12:00:00Z") });
  assert.equal(doc.fugacity_project, PROJECT_FORMAT);
  assert.equal(doc.saved_with, "fugacity 9.9.9");
  assert.equal(doc.saved_at, "2026-10-06T12:00:00.000Z");
  assert.equal(doc.title, "Column feed");
  assert.equal(doc.workbench.view, "flash");
  assert.deepEqual(doc.workbench.flash.z, [0.2, 0.5, 0.3]);
  assert.ok(!("steam" in doc.workbench.inputs), "steam takes no inputs");
  assert.ok(!("results" in doc), "no results unless given");

  const back = stateFromProject(projectText(doc));
  assert.deepEqual(settings(back), settings(s));
  assert.deepEqual(back.components, s.components);
  assert.equal(back.utility, null);
  // the document object works as well as its text, and saving again gives the same document
  assert.deepEqual(projectOf(stateFromProject(doc), { now: new Date(doc.saved_at), version: "9.9.9" }), doc);
});

test("opening a project restores each view and its compositions", () => {
  for (const view of ["txy", "ternary", "pxy", "envelope", "henry", "properties", "steam"]) {
    const s = applyPatch(worked(), { view });
    const back = stateFromProject(projectOf(s));
    assert.equal(back.view, view);
    assert.equal(back.workspace, s.workspace);
    assert.deepEqual(back.z, s.z);
    assert.equal(back.diagram, s.diagram);
  }
  // an empty workbench round-trips too
  const e = initialState({ components: [] });
  assert.deepEqual(settings(stateFromProject(projectOf(e))), settings(e));
});

test("the results record travels with the project and is not read back", () => {
  const rec = { columns: ["Feed", "Vapour"], rows: [{ key: "flow", label: "Molar flow", unit: "kmol/h", values: [10, 4] }] };
  const doc = projectOf(worked(), { results: { flash: rec } });
  assert.deepEqual(JSON.parse(projectText(doc)).results.flash, rec);
  assert.deepEqual(settings(stateFromProject(doc)), settings(worked()));
});

test("a wrong file is refused with the reason", () => {
  const ok = projectOf(worked());
  const bad = [
    ["{", /not valid JSON/],
    ["[]", /expected a JSON object/],
    [JSON.stringify({ workbench: {} }), /"fugacity_project" key is missing/],
    [JSON.stringify({ fugacity_package: 1, type: "pair-data" }), /contribution package/],
    [JSON.stringify({ ...ok, fugacity_project: 3 }), /format 3.*reads formats 1 to 2/],
    [JSON.stringify({ ...ok, fugacity_project: "1" }), /format number/],
    [JSON.stringify({ fugacity_project: 1 }), /no "workbench"/],
    [JSON.stringify({ ...ok, workbench: { ...ok.workbench, modle: "NRTL" } }), /unknown key "modle"/],
    [JSON.stringify({ ...ok, workbench: { ...ok.workbench, model: "Wilson" } }), /Unknown model/],
    [JSON.stringify({ ...ok, workbench: { ...ok.workbench, view: "mccabe" } }), /unknown view "mccabe"/],
    [JSON.stringify({ ...ok, workbench: { ...ok.workbench, P_kPa: -1 } }), /positive/],
    [JSON.stringify({ ...ok, workbench: { ...ok.workbench, flash: { ...ok.workbench.flash, VF: 2 } } }), /VF must be between 0 and 1/],
    [JSON.stringify({ ...ok, workbench: { ...ok.workbench, inputs: { mccabe: [] } } }), /unknown view "mccabe"/],
  ];
  for (const [text, re] of bad) assert.throws(() => stateFromProject(text), re, text.slice(0, 80));
  // a byte-order mark (files saved by some editors) is accepted
  assert.equal(readProject("\uFEFF" + projectText(ok)).fugacity_project, PROJECT_FORMAT);
});

test("a component this library does not know is refused by name", () => {
  const ok = projectOf(worked());
  const doc = { ...ok, workbench: { ...ok.workbench, view: "txy", inputs: { ...ok.workbench.inputs, txy: ["unobtainium", "water"] } } };
  assert.throws(() => stateFromProject(doc), /Unknown component "unobtainium"/);
});

test("file names", () => {
  // a name given by the person is kept as typed, without characters that file systems refuse
  assert.equal(projectFileName(worked()), "Column feed.fugacity.json");
  assert.equal(projectFileName({ title: "Run 2: ethanol/water?  " }), "Run 2- ethanol-water.fugacity.json");
  assert.equal(projectFileName({ title: "flash.fugacity.json" }), "flash.fugacity.json");
  assert.equal(projectFileName({ title: " ... ", components: ["water"] }), "fugacity-water.fugacity.json");
  assert.equal(projectFileName(initialState({ components: ["ethanol", "water"] })), "fugacity-ethanol-water.fugacity.json");
  assert.equal(projectFileName(initialState({ components: [] })), "fugacity-workbench.fugacity.json", "the empty workbench (no components chosen)");
});

// ---- format 2: the flowsheet (proposal 0006, step 4)

const FLOWSHEET = {
  components: ["Ethanol", "water"],
  thermo: { model: "nrtl" },
  blocks: [
    { id: "F1", type: "feed", x: 40, y: 120, spec: { flow_kmol_h: { ethanol: 30, water: 70 }, T_K: 300, P_kPa: 101.325 } },
    { id: "E1", type: "heater", x: 160, y: 120, spec: { VF: 0.4 }, energy: "Q1" },
    { id: "V1", type: "flash", x: 280, y: 120, spec: { P_kPa: 101.325, duty_kW: 0 } },
    { id: "P1", type: "product", x: 400, y: 60 }, { id: "P2", type: "product", x: 400, y: 180 },
  ],
  streams: [
    { id: "S1", from: "F1.out", to: "E1.in" }, { id: "S2", from: "E1.out", to: "V1.in" },
    { id: "S3", from: "V1.vapour", to: "P1.in" }, { id: "S4", from: "V1.liquid", to: "P2.in" },
  ],
};

test("format 2: the flowsheet is saved, opened and solved from the file", () => {
  const s = initialState({ components: [], flowsheet: FLOWSHEET });
  assert.deepEqual(s.flowsheet.components, ["ethanol", "water"], "names as ids");
  assert.equal(s.flowsheet.thermo.model, "NRTL");
  const doc = projectOf(s);
  assert.equal(doc.fugacity_project, 2);
  const back = stateFromProject(JSON.parse(projectText(doc)));
  assert.deepEqual(back.flowsheet, s.flowsheet);
  // the file can be solved directly, as an AI assistant would
  const r = runFlowsheet(doc);
  assert.ok(Math.abs(r.streams.S2.VF - 0.4) < 1e-9);
  assert.ok(r.energy.Q1.duty_kW > 0, "the heater's energy stream, kW");
  assert.ok(Math.abs(r.energy["Q-V1"].duty_kW) < 1e-6, "adiabatic drum");
  assert.ok(Math.abs(r.balance.energy_kW) < 1e-6);
  // without a flowsheet nothing is written for it
  assert.ok(!("flowsheet" in projectOf(initialState({ components: [] }))));
});

test("format 1 files still open", () => {
  const v1 = { ...projectOf(initialState({ components: ["ethanol", "water"] })), fugacity_project: 1 };
  const s = stateFromProject(v1);
  assert.deepEqual(s.components, ["ethanol", "water"]);
  assert.deepEqual(s.flowsheet.blocks, []);
});

test("checkProject lists every problem without throwing", () => {
  const good = projectOf(initialState({ components: [], flowsheet: FLOWSHEET }));
  const ok = checkProject(good);
  assert.ok(ok.ok, ok.problems.join("; "));
  assert.equal(ok.flowsheet.dof, 0);
  assert.match(ok.flowsheet.message, /Degrees of freedom: 0/);
  const fs = JSON.parse(JSON.stringify(FLOWSHEET));
  fs.blocks[1].spec = {};                                   // heater: nothing given
  fs.blocks[2].spec = { P_kPa: 101.325, T_K: 350, VF: 0.5 };  // drum: one too many
  fs.streams.pop();                                         // drum liquid not connected
  const bad = checkProject({ ...good, flowsheet: fs });
  assert.equal(bad.ok, false);
  assert.ok(bad.problems.some(p => /V1: connect a stream to its liquid outlet/.test(p)), bad.problems.join("\n"));
  assert.ok(bad.problems.some(p => /Heater \/ cooler E1: missing: the outlet temperature/.test(p)));
  assert.ok(bad.problems.some(p => /Flash drum V1: too many specifications/.test(p)));
  assert.deepEqual(checkProject("{").problems.length, 1);
  assert.throws(() => runFlowsheet(fs), /not ready to solve/);
});
