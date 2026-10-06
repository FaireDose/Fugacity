// Project files of the workbench (src/ui/project.js): what is saved, that opening a file gives
// back the same workbench, and that a wrong file is refused with the reason. DOM-free.
import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState, applyPatch } from "../src/ui/app-logic.js";
import { PROJECT_FORMAT, projectOf, projectText, projectFileName, readProject, stateFromProject } from "../src/ui/project.js";

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
    [JSON.stringify({ ...ok, fugacity_project: 2 }), /format 2.*reads format 1/],
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
  assert.equal(readProject("﻿" + projectText(ok)).fugacity_project, 1);
});

test("a component this library does not know is refused by name", () => {
  const ok = projectOf(worked());
  const doc = { ...ok, workbench: { ...ok.workbench, view: "txy", inputs: { ...ok.workbench.inputs, txy: ["unobtainium", "water"] } } };
  assert.throws(() => stateFromProject(doc), /Unknown component "unobtainium"/);
});

test("file names", () => {
  assert.equal(projectFileName(worked()), "fugacity-column-feed.fugacity.json");
  assert.equal(projectFileName(initialState({ components: ["ethanol", "water"] })), "fugacity-ethanol-water.fugacity.json");
  assert.equal(projectFileName(initialState({ components: [] })), "fugacity-workbench.fugacity.json", "the empty workbench (no components chosen)");
});
