// Flash workspace of the workbench (proposal 0001, step 6): settings, the request sent to the
// engine, the stream table and its CSV export (roadmap B1). DOM-free. The flash itself is
// validated in flash.test.js and three-phase.test.js; here the workspace must pass the engine's
// numbers through unchanged and balance.
import { test } from "node:test";
import assert from "node:assert/strict";
import { system, pure } from "../src/index.js";
import { initialState, applyPatch, VIEWS } from "../src/ui/app-logic.js";
import { WORKSPACES, checkInputs } from "../src/ui/workspaces.js";
import {
  FLASH_DEFAULTS, FLASH_SPECS, normalizeFlash, dutyKW, molarFlow, flowIn, FLOW_UNITS, feedComposition, convertBasis, runFlash, flashTable, flashCsv, csvField, phaseName,
} from "../src/ui/flash-logic.js";

const units = { T: "K", P: "kPa" };
const MW = ids => ids.map(id => pure(id).MW);

test("the Flash workspace: in the navigation, with its own inputs and settings", () => {
  assert.ok(WORKSPACES.some(w => w.id === "flash" && w.views.includes("flash")));
  assert.equal(VIEWS.flash.workspace, "flash");
  let s = applyPatch(initialState(), { workspace: "flash" });
  assert.equal(s.view, "flash");
  assert.deepEqual(s.components, ["methanol", "acetone", "chloroform"], "seeded from the components");
  assert.deepEqual(s.flash, { ...FLASH_DEFAULTS });
  s = applyPatch(s, { flash: { spec: "tp", T_K: 340, z: [1, 1, 2] } });
  assert.equal(s.flash.spec, "TP");
  assert.equal(s.flash.T_K, 340);
  assert.deepEqual(feedComposition(s.flash, 3), [0.25, 0.25, 0.5]);
  // a new list of components resets the feed to equimolar; other settings stay
  s = applyPatch(s, { inputs: { flash: ["ethanol", "water"] } });
  assert.equal(s.flash.z, null);
  assert.equal(s.flash.T_K, 340);
  assert.deepEqual(s.components, ["ethanol", "water"]);
  // the model of the Model group applies; gases need an equation of state
  assert.equal(checkInputs("flash", ["methane", "ethane"]).ok, false);
  assert.equal(checkInputs("flash", ["methane", "ethane"], "PR").ok, true);
  assert.equal(checkInputs("flash", ["methane"], "SRK").ok, true, "one component with an equation of state");
  assert.equal(checkInputs("flash", ["water"]).ok, false, "two with an activity model");
  assert.equal(initialState({ start: "flash", flash: { spec: "PH", Q_J_mol: -500 } }).flash.Q_J_mol, -500);
});

test("flash settings are checked: no silent fallback", () => {
  assert.throws(() => normalizeFlash({ spec: "PS" }), /not one of: TP, PH, PVF, TVF/);
  assert.throws(() => normalizeFlash({ VF: 1.2 }), /between 0 and 1/);
  assert.throws(() => normalizeFlash({ T_K: -5 }), /positive/);
  assert.throws(() => normalizeFlash({ z: [0, 0] }), /positive sum/);
  assert.throws(() => normalizeFlash({ temperature: 300 }), /unknown key "temperature"/);
  assert.equal(normalizeFlash({ spec: "p-vf" }).spec, "PVF");
  assert.deepEqual(FLASH_SPECS.map(s => s.id), ["TP", "PH", "PVF", "TVF"]);
});

test("runFlash sends the engine the request of each specification", () => {
  const sys = system({ components: ["methanol", "water"], model: "NRTL" });
  const f = normalizeFlash({ T_K: 350, P_kPa: 101.325, VF: 0.3, z: [0.4, 0.6] });
  const direct = {
    TP: sys.flash({ z: [0.4, 0.6], T: 350, P: 101.325 }),
    PVF: sys.flash({ z: [0.4, 0.6], P: 101.325, VF: 0.3 }),
    TVF: sys.flash({ z: [0.4, 0.6], T: 350, VF: 0.3 }),
  };
  for (const spec of ["TP", "PVF", "TVF"]) {
    const { result } = runFlash(sys, { ...f, spec });
    assert.equal(result.T, direct[spec].T, spec);
    assert.equal(result.P, direct[spec].P, spec);
    assert.equal(result.VF, direct[spec].VF, spec);
  }
  // P-H: the feed at its own T and P, plus Q; the engine's duty is Q back
  for (const Q of [0, 5000, -2000]) {
    const { result: r } = runFlash(sys, { ...f, spec: "PH", P_kPa: 50, feedT_K: 360, feedP_kPa: 500, Q_J_mol: Q });
    assert.ok(Math.abs(r.duty_J_mol - Q) < 1e-6, `Q = ${Q}`);
    assert.ok(Math.abs(dutyKW(r.duty_J_mol, 36) - Q / 100) < 1e-8, "36 kmol/h = 10 mol/s: kW = Q / 100");
    assert.equal(r.P, 50);
  }
  // with the duty option, the other specifications report Q = H_out - H_feed
  const { result: d } = runFlash(sys, { ...f, spec: "TP", duty: true, feedT_K: 298.15, feedP_kPa: 101.325 });
  const Hf = sys.flash({ z: [0.4, 0.6], T: 298.15, P: 101.325 }).H_J_mol;
  assert.ok(Math.abs(d.duty_J_mol - (d.H_J_mol - Hf)) < 1e-9);
});

test("stream table: the engine's numbers, balanced, in display units", () => {
  const ids = ["water", "ethyl-acetate", "ethanol"];
  const sys = system({ components: ids, model: "NRTL" });
  const f = normalizeFlash({ spec: "TP", T_K: 343, P_kPa: 101.325, z: [0.5, 0.4, 0.1], duty: true });
  const { result: r, z } = runFlash(sys, f);
  const t = flashTable(r, { names: sys.names, MW: MW(ids), z, units: { T: "C", P: "bar" } });
  assert.deepEqual(t.columns, ["Feed", ...r.phases.map(phaseName)]);
  assert.equal(r.phases.length, 2);
  assert.ok(t.columns.every(c => c === "Feed" || /^Liquid \(/.test(c)), "two liquids, named by what they are rich in");
  const row = key => t.rows.find(x => x.key === key).values;
  assert.ok(Math.abs(row("T")[1] - (343 - 273.15)) < 1e-12);
  assert.ok(Math.abs(row("P")[1] - 1.01325) < 1e-12);
  // component balance: sum over phases of fraction * x = z (and the same in mass)
  for (let i = 0; i < 3; i++) {
    const xs = row(`x${i}`), fr = row("fraction");
    assert.ok(Math.abs(xs.slice(1).reduce((a, v, k) => a + fr[k + 1] * v, 0) - xs[0]) < 1e-9, `component ${i}`);
  }
  // enthalpy balance: H_out = sum of phase fraction * h
  const fr = row("fraction"), hs = row("h");
  assert.ok(Math.abs(hs.slice(1).reduce((a, v, k) => a + fr[k + 1] * v, 0) - r.H_J_mol) < 1e-6);
  // mass fractions from mole fractions and back
  const w = convertBasis(z, MW(ids), true);
  assert.deepEqual(row("w0")[0], w[0]);
  convertBasis(w, MW(ids)).forEach((v, i) => assert.ok(Math.abs(v - z[i]) < 1e-12));
  // flows: the phase flows add up to the feed, in moles and in mass
  const tf = flashTable(r, { names: sys.names, MW: MW(ids), z, units, flow: 100 });
  const flows = tf.rows.find(x => x.key === "flow").values, mflows = tf.rows.find(x => x.key === "mflow").values;
  assert.equal(flows[0], 100);
  assert.ok(Math.abs(flows[1] + flows[2] - 100) < 1e-9);
  assert.ok(Math.abs(mflows[1] + mflows[2] - mflows[0]) < 1e-7);
  assert.equal(t.rows.some(x => x.key === "flow"), false, "no flows without a feed flow");
  // component flows add up to the stream flows; in a mass unit when the feed flow is one
  const fl = i => tf.rows.find(x => x.key === `f${i}`).values;
  for (let k = 0; k < 3; k++) assert.ok(Math.abs([0, 1, 2].reduce((a, i) => a + fl(i)[k], 0) - flows[k]) < 1e-9, `column ${k}`);
  const tt = flashTable(r, { names: sys.names, MW: MW(ids), z, units, flow: 100, flowUnit: "t/h" });
  const mT = tt.rows.find(x => x.key === "mflow");
  assert.equal(mT.unit, "t/h");
  assert.ok(Math.abs(mT.values[0] * 1000 - mflows[0]) < 1e-9, "t/h = kg/h / 1000");
  const fT = i => tt.rows.find(x => x.key === `f${i}`);
  assert.equal(fT(0).unit, "t/h");
  assert.ok(Math.abs([0, 1, 2].reduce((a, i) => a + fT(i).values[0], 0) - mT.values[0]) < 1e-12, "component mass flows add up");
  // without a feed state: no feed T, P, h
  const { result: r2, z: z2 } = runFlash(sys, { ...f, duty: false });
  const t2 = flashTable(r2, { names: sys.names, MW: MW(ids), z: z2, units });
  assert.equal(t2.rows.find(x => x.key === "T").values[0], null);
});

test("CSV: standard quoting, decimal points, every row of the table", () => {
  assert.equal(csvField("Methanol, Water"), '"Methanol, Water"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField(0.1 + 0.2), "0.3");
  assert.equal(csvField(-40528.847051234), "-40528.84705");
  assert.equal(csvField(null), "");
  assert.equal(csvField(NaN), "");
  const sys = system({ components: ["methanol", "water"], model: "NRTL" });
  const { result: r, z } = runFlash(sys, normalizeFlash({ spec: "TP", T_K: 350, z: [0.5, 0.5] }));
  const table = flashTable(r, { names: sys.names, MW: MW(["methanol", "water"]), z, units });
  const csv = flashCsv(table, { title: "Methanol, water", model: "NRTL", summary: [["Vapour fraction", r.VF, "mol/mol"]], version: "test" });
  const lines = csv.split("\r\n");
  assert.equal(lines.at(-1), "", "ends with a line break");
  assert.equal(lines[0], 'Fugacity flash,"Methanol, water"');
  const head = lines.findIndex(l => l.startsWith("Quantity,Unit,"));
  assert.equal(lines[head], "Quantity,Unit,Feed,Vapour,Liquid");
  assert.equal(lines.length - head - 2, table.rows.length);
  const xRow = lines.find(l => l.startsWith("Mole fraction Methanol,")).split(",");
  assert.equal(Number(xRow[3]), Number(r.phases[0].composition[0].toPrecision(10)));
});

test("feed flow in kmol/h, kg/h or t/h", () => {
  assert.deepEqual(FLOW_UNITS, ["kmol/h", "kg/h", "t/h"]);
  assert.deepEqual([FLASH_DEFAULTS.flow, FLASH_DEFAULTS.flowUnit], [100, "kmol/h"]);
  const MWmix = 25;   // kg/kmol
  assert.equal(molarFlow({ flow: 100, flowUnit: "kmol/h" }, MWmix), 100);
  assert.equal(molarFlow({ flow: 2500, flowUnit: "kg/h" }, MWmix), 100);
  assert.equal(molarFlow({ flow: 2.5, flowUnit: "t/h" }, MWmix), 100);
  // a unit change keeps the flow
  const f = { flow: 100, flowUnit: "kmol/h" };
  assert.equal(flowIn(f, "kg/h", MWmix), 2500);
  assert.equal(flowIn(f, "t/h", MWmix), 2.5);
  assert.equal(molarFlow({ flow: flowIn(f, "t/h", MWmix), flowUnit: "t/h" }, MWmix), 100);
  // settings: checked, and the key of 0.2.x still accepted
  assert.equal(normalizeFlash({ flowUnit: "tonnes/h" }).flowUnit, "t/h");
  assert.throws(() => normalizeFlash({ flowUnit: "lb/h" }), /not one of: kmol\/h, kg\/h, t\/h/);
  assert.deepEqual([normalizeFlash({ flow_kmol_h: 40, flowUnit: "kg/h" }).flow, normalizeFlash({ flow_kmol_h: 40 }).flowUnit], [40, "kmol/h"]);
});
