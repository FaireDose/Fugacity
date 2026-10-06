// Flowsheet workspace (proposal 0006, step 5): the canvas edits, DOM-free. Products are
// automatic, so after any edit the structure is complete and only the specifications (the
// degrees of freedom) are left; a flowsheet built with these edits solves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { flowsheetDocStatus, runFlowsheet } from "../src/index.js";
import { emptyFlowsheet } from "../src/flowsheet/document.js";
import { initialState, applyPatch } from "../src/ui/app-logic.js";
import { WORKSPACES } from "../src/ui/workspaces.js";
import {
  addBlock, addFeedTo, connect, deleteBlock, addOutlet, removeOutlet, setSpec, moveBlock, setTear, setComponents, openInlets, endOf, streamsOf,
} from "../src/ui/flowsheet-logic.js";

const base = () => ({ ...emptyFlowsheet(), components: ["ethanol", "water"] });
const structureOk = fs => assert.deepEqual(flowsheetDocStatus(fs).structure, [], "no connection problems");

test("the Flowsheet workspace is in the navigation and keeps its document in the state", () => {
  assert.ok(WORKSPACES.some(w => w.id === "flowsheet"));
  const s = applyPatch(initialState({ components: [] }), { workspace: "flowsheet" });
  assert.equal(s.view, "flowsheet");
  assert.deepEqual(s.flowsheet.blocks, []);
  const s2 = applyPatch(s, { flowsheet: { ...base(), thermo: { model: "uniquac" } } });
  assert.equal(s2.flowsheet.thermo.model, "UNIQUAC");
});

test("placing a unit gives it product streams; the structure is always complete", () => {
  let { fs, id } = addBlock(base(), "flash");
  assert.equal(id, "V1");
  assert.deepEqual(Object.keys(streamsOf(fs, "V1")).sort(), ["liquid", "vapour"]);
  assert.equal(endOf(fs, streamsOf(fs, "V1").vapour[0]).kind, "product");
  ({ fs } = addFeedTo(fs, "V1.in"));
  structureOk(fs);
  const st = flowsheetDocStatus(fs);
  assert.equal(st.ready, false);
  assert.match(st.message, /specifications missing/);
  fs = setSpec(fs, "F1", { flow_kmol_h: { ethanol: 30, water: 70 }, T_K: 300, P_kPa: 101.325 });
  fs = setSpec(fs, "V1", { P_kPa: 101.325, duty_kW: 1200 });
  assert.ok(flowsheetDocStatus(fs).ready);
  const r = runFlowsheet(fs);
  assert.ok(Math.abs(r.energy["Q-V1"].duty_kW - 1200) < 1e-6, "the duty as given");
  assert.ok(r.blocks.V1.state.VF > 0 && r.blocks.V1.state.VF < 1);
  // a value removed by the person: the specification goes back to missing
  assert.equal(flowsheetDocStatus(setSpec(fs, "V1", { duty_kW: "" })).blocks.V1.status, "missing");
});

test("a recycle built with the edits converges", () => {
  let fs = base(), r;
  ({ fs } = addBlock(fs, "mixer"));
  ({ fs } = addFeedTo(fs, "M1.in"));
  ({ fs } = addBlock(fs, "flash"));
  ({ fs } = addBlock(fs, "splitter"));
  const mixOut = streamsOf(fs, "M1").out[0], liquid = streamsOf(fs, "V1").liquid[0];
  fs = connect(fs, mixOut, "V1.in");
  fs = connect(fs, liquid, "SP1.in");
  const back = streamsOf(fs, "SP1").out[0];
  assert.ok(openInlets(fs).includes("M1.in"), "the mixer takes more streams");
  fs = connect(fs, back, "M1.in");
  structureOk(fs);
  assert.equal(fs.blocks.filter(b => b.type === "product").length, 2, "vapour and purge leave");
  fs = setSpec(fs, "F1", { flow_kmol_h: { ethanol: 30, water: 70 }, T_K: 300, P_kPa: 101.325 });
  fs = setSpec(fs, "V1", { T_K: 360, P_kPa: 101.325 });
  fs = setSpec(fs, "SP1", { fractions: [0.7, "rest"] });
  r = runFlowsheet(fs);
  assert.equal(r.loops.length, 1);
  assert.ok(r.loops[0].iterations < 25);
  for (const v of Object.values(r.balance.material_kmol_h)) assert.ok(Math.abs(v) < 1e-6);
  // marking the recycle stream as the tear stream gives the same answer
  const r2 = runFlowsheet(setTear(fs, back, true));
  assert.deepEqual(r2.loops[0].tears, [back]);
  assert.ok(Math.abs(r2.streams[back].F_kmol_h - r.streams[back].F_kmol_h) < 1e-6);
  // sending the recycle out again leaves it as a product
  const open = connect(fs, back, null);
  assert.equal(endOf(open, back).kind, "product");
  structureOk(open);
});

test("deleting blocks, outlets and components keeps the flowsheet consistent", () => {
  let fs = base();
  ({ fs } = addBlock(fs, "heater"));
  ({ fs } = addFeedTo(fs, "E1.in"));
  ({ fs } = addBlock(fs, "separator"));
  fs = connect(fs, streamsOf(fs, "E1").out[0], "X1.in");
  fs = addOutlet(fs, "X1");
  assert.equal(streamsOf(fs, "X1").out.length, 3);
  assert.deepEqual(fs.blocks.find(b => b.id === "X1").spec.fractions.ethanol, [0.5, 0, "rest"]);
  fs = removeOutlet(fs, "X1");
  assert.equal(streamsOf(fs, "X1").out.length, 2);
  structureOk(fs);
  // deleting the separator gives the heater its product back
  const d = deleteBlock(fs, "X1");
  assert.equal(endOf(d, streamsOf(d, "E1").out[0]).kind, "product");
  structureOk(d);
  // deleting the heater removes its feed too
  const d2 = deleteBlock(d, "E1");
  assert.equal(d2.blocks.length, 0);
  // components: a removed one leaves the feeds and separators; a new one starts at zero
  fs = setSpec(fs, "F1", { flow_kmol_h: { ethanol: 30, water: 70 } });
  const c = setComponents(fs, ["water", "methanol"]);
  assert.deepEqual(c.fs.blocks.find(b => b.id === "F1").spec.flow_kmol_h, { water: 70 });
  assert.deepEqual(Object.keys(c.fs.blocks.find(b => b.id === "X1").spec.fractions).sort(), ["methanol", "water"]);
  assert.match(c.note, /Removed ethanol/);
  assert.equal(moveBlock(fs, "E1", 10.4, 20.6).blocks.find(b => b.id === "E1").x, 10);
});

test("a recycle back into a separator (feed → separator → drum → back to the separator) converges", () => {
  let fs = base();
  ({ fs } = addBlock(fs, "separator"));
  ({ fs } = addFeedTo(fs, "X1.in"));
  ({ fs } = addBlock(fs, "flash"));
  const [top] = streamsOf(fs, "X1").out;
  fs = connect(fs, top, "V1.in");
  const liquid = streamsOf(fs, "V1").liquid[0];
  assert.ok(openInlets(fs).includes("X1.in"), "the separator takes another inlet");
  fs = connect(fs, liquid, "X1.in");
  structureOk(fs);
  fs = setSpec(fs, "F1", { flow_kmol_h: { ethanol: 30, water: 70 }, T_K: 300, P_kPa: 101.325 });
  fs = setSpec(fs, "X1", { fractions: { ethanol: [0.9, "rest"], water: [0.3, "rest"] } });
  fs = setSpec(fs, "V1", { T_K: 355, P_kPa: 101.325 });
  const r = runFlowsheet(fs);
  assert.equal(r.loops.length, 1);
  for (const v of Object.values(r.balance.material_kmol_h)) assert.ok(Math.abs(v) < 1e-6, `balance ${v}`);
});
