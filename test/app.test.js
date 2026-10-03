// Workbench (Fugacity.app): the DOM-free part (state, which views can run, units, search).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as Fugacity from "../src/index.js";
import {
  LEGACY_TABS, VIEWS, PRESETS, MAX_COMPONENTS, initialState, applyPatch, viewAvailability, resolveView, toggleComponent, rotate,
  filterComponents, normalizeComposition, knownIssuesFor, tierCounts, tierSummary, fmtP, fmtTemp, parseP, parseT, interpolate,
  normalizeComponents, liquids, henryGases, autoTemperature, pxyTemperature,
} from "../src/ui/app-logic.js";
import { pure, listComponents, findComponent, HENRY_GASES } from "../src/index.js";
import { WORKSPACES } from "../src/ui/workspaces.js";

const MAC = ["methanol", "acetone", "chloroform"];

test("the public interface exports app, system and the earlier views unchanged", () => {
  assert.equal(typeof Fugacity.app, "function");
  assert.equal(typeof Fugacity.mount, "function");
  assert.equal(typeof Fugacity.mountProperties, "function");
  const s = Fugacity.system({ components: ["ethanol", "water"] });
  assert.ok(s.bubbleT([0.5, 0.5], 101.325).T > 350);
  const e = Fugacity.system({ components: ["methane", "ethane"], model: "PR" });
  assert.equal(typeof e.dewT, "function");
});

test("initial state: defaults, normalization and errors for typos", () => {
  const s = initialState();
  assert.deepEqual(s.components, MAC);
  assert.equal(s.view, "ternary");
  assert.equal(s.workspace, "equilibrium");
  assert.equal(s.model, "NRTL");
  assert.equal(s.eos, "PR");
  assert.equal(s.P_kPa, 101.325);
  assert.equal(s.T_K, null, "no temperature set: the P-x-y view picks one");
  assert.equal(s.basis, "mole");
  assert.deepEqual(s.panels, { left: true, right: true });
  assert.equal(s.background, true);
  assert.equal(s.units.T, "C");
  assert.equal(s.units.P, "kPa");

  const t = initialState({ components: ["Water", "64-19-7"], model: "ideal", units: { T: "K", P: "bar", energy: "J/mol" }, basis: "mass" });
  assert.deepEqual(t.components, ["water", "acetic-acid"]);
  assert.equal(t.model, "ideal");
  assert.equal(t.view, "txy", "two liquids: T-x-y");
  assert.equal(t.units.T, "K");
  assert.equal(t.units.P, "bar");
  assert.equal(t.units.basis, "molar");
  assert.equal(t.basis, "mass");

  assert.throws(() => initialState({ components: ["unobtainium"] }), /Unknown component/);
  assert.throws(() => initialState({ model: "Wilson" }), /Unknown model "WILSON"/);
  assert.throws(() => initialState({ units: { T: "F" } }), /Unknown T unit/);
  assert.throws(() => initialState({ P_kPa: -1 }), /positive/);
  // duplicates dropped, at most MAX_COMPONENTS kept
  assert.deepEqual(initialState({ components: ["water", "H2O", "methanol"] }).components, ["water", "methanol"]);
  // (state.components is what the current view uses; the phase envelope takes the whole list)
  assert.equal(initialState({ components: listComponents().map(c => c.id) }).inputs.envelope.length, MAX_COMPONENTS);
});

test("start view and the equation-of-state model in the configuration", () => {
  assert.equal(initialState({ start: "steam" }).view, "steam");
  assert.equal(initialState({ start: "properties" }).workspace, "properties");
  assert.equal(initialState({ start: "eos", components: ["methane", "ethane"] }).view, "pxy");
  assert.equal(initialState({ start: "eos", components: ["methane", "ethane", "nitrogen"] }).view, "envelope");
  // one model for every diagram (maintainer's decision, 0.3): an equation of state as `model` is the model
  const pr = initialState({ model: "SRK", components: ["methane", "ethane"] });
  assert.equal(pr.eos, "SRK");
  assert.equal(pr.model, "SRK");
  assert.equal(pr.view, "pxy");
  // without `model`, the equation of state is chosen when the start view or the components ask for it
  assert.equal(initialState({ start: "eos", components: ["methane", "ethane"] }).model, "PR");
  assert.equal(initialState({ eos: "SRK", components: ["methane", "ethane"] }).model, "SRK");
  assert.equal(initialState({ components: ["methane", "ethane"] }).model, "PR", "gases need an equation of state");
  assert.equal(initialState({ components: ["ethanol", "water"] }).model, "NRTL");
  assert.equal(initialState({ start: "pxy", components: ["ethanol", "water"], model: "NRTL" }).model, "NRTL", "P-x-y with an activity model");
  // a view that cannot run falls back to one that can
  assert.equal(initialState({ start: "ternary", components: ["ethanol", "water"] }).view, "txy");
  assert.equal(initialState({ start: "txy", components: ["oxygen", "nitrogen"] }).view, "txy", "with Peng–Robinson, gases have a T-x-y diagram");
  assert.equal(initialState({ start: "txy", components: ["oxygen", "nitrogen"], model: "NRTL" }).view, "envelope", "not with NRTL: the envelope explains why");
  assert.equal(initialState({ components: [] }).view, "properties");
});

test("which views are enabled for which selection", () => {
  const gas = ["oxygen", "nitrogen"];
  assert.deepEqual(liquids(["water", "oxygen", "ethanol"]), ["water", "ethanol"]);
  assert.deepEqual(henryGases(["water", "oxygen", "methane"]), ["oxygen", "methane"]);

  let a = viewAvailability("txy", ["water"]);
  assert.equal(a.enabled, false);
  assert.match(a.reason, /two liquids; one selected/);
  a = viewAvailability("txy", ["water", "oxygen", "ethanol", "methanol"]);
  assert.deepEqual(a.use, ["water", "ethanol"], "first two liquids; gases skipped");
  assert.match(a.note, /First two of three/);

  assert.equal(viewAvailability("ternary", ["water", "ethanol"]).enabled, false);
  assert.deepEqual(viewAvailability("ternary", MAC).use, MAC);
  assert.equal(viewAvailability("ternary", MAC).note, undefined);
  assert.equal(viewAvailability("azeotropes", ["water"]).enabled, false);
  assert.equal(viewAvailability("azeotropes", ["water", "ethanol", "methanol", "acetone", "benzene"]).use.length, 4);

  // with an equation of state every component fits every diagram; with an activity model, liquids only
  assert.equal(viewAvailability("pxy", gas).enabled, false);
  assert.equal(viewAvailability("pxy", gas, "PR").enabled, true);
  assert.deepEqual(viewAvailability("pxy", [...gas, "methane"], "PR").use, gas, "first two");
  assert.equal(viewAvailability("txy", gas, "SRK").enabled, true);
  assert.deepEqual(viewAvailability("ternary", ["methane", "ethane", "nitrogen"], "PR").use, ["methane", "ethane", "nitrogen"]);
  assert.equal(viewAvailability("envelope", []).enabled, false);
  assert.equal(viewAvailability("envelope", ["methane"], "PR").enabled, true);
  assert.equal(viewAvailability("envelope", ["water"]).enabled, false, "an activity model needs two liquids");
  assert.equal(viewAvailability("envelope", ["water", "ethanol"]).enabled, true);

  assert.deepEqual(viewAvailability("henry", ["water", "oxygen"]).use, ["oxygen"]);
  const all = viewAvailability("henry", MAC);
  assert.deepEqual(all.use, HENRY_GASES, "no gas selected: all gases with a Henry's law constant");
  assert.ok(all.note);

  assert.deepEqual(viewAvailability("properties", []).use, ["water"]);
  assert.deepEqual(viewAvailability("properties", ["ethanol", "water"]).use, ["ethanol"]);
  assert.deepEqual(viewAvailability("steam", MAC).use, ["water"]);
  assert.throws(() => viewAvailability("flowsheet", MAC), /Unknown view/);

  // every view and preset is consistent
  for (const v of Object.keys(VIEWS)) assert.ok(WORKSPACES.some(w => w.id === VIEWS[v].workspace && w.views.includes(v)), v);
  for (const p of PRESETS) {
    assert.deepEqual(normalizeComponents(p.components), p.components);
    assert.equal(viewAvailability(p.view, p.components, p.model).enabled, true, p.label);
    assert.equal(resolveView(p.view, p.components, p.model), p.view);
  }
});

test("state changes return a new state and keep the view valid", () => {
  const s0 = initialState();
  const s1 = applyPatch(s0, { model: "uniquac", P_kPa: 50 });
  assert.equal(s0.model, "NRTL", "input not modified");
  assert.equal(s1.model, "UNIQUAC");
  assert.equal(s1.P_kPa, 50);
  assert.equal(s1.view, "ternary");

  // removing a component turns the ternary map into a T-x-y diagram
  const s2 = applyPatch(s1, { components: ["methanol", "acetone"] });
  assert.equal(s2.view, "txy");
  assert.equal(s2.workspace, "equilibrium");
  // the ribbon tabs of earlier versions: "view" now opens the Settings panel, the view stays
  assert.ok(LEGACY_TABS.includes("view"));
  const s3 = applyPatch(s2, { tab: "view" });
  assert.equal(s3.utility, "settings");
  assert.equal(s3.view, "txy");
  assert.throws(() => applyPatch(s2, { tab: "macros" }), /Unknown tab/);

  // an equation of state as model is the model of every diagram; `eos` selects one too
  const s4 = applyPatch(s2, { model: "SRK" });
  assert.equal(s4.eos, "SRK");
  assert.equal(s4.model, "SRK");
  assert.equal(s4.view, "txy", "the diagram stays");
  assert.equal(applyPatch(s4, { model: "UNIQUAC" }).eos, "SRK", "the last equation of state is remembered");
  assert.equal(applyPatch(s2, { eos: "PR" }).model, "PR");

  // units merge, panels merge, booleans
  const s5 = applyPatch(s4, { units: { T: "K" }, panels: { left: false }, background: false });
  assert.equal(s5.units.T, "K");
  assert.equal(s5.units.P, "kPa");
  assert.deepEqual(s5.panels, { left: false, right: true });
  assert.equal(s5.background, false);
  assert.equal(applyPatch(s5, { grid: 33 }).grid, s5.grid, "only the offered resolutions");
  assert.equal(applyPatch(s5, { grid: 60 }).grid, 60);

  // feed composition (P-x-y and phase envelope, each its own) is normalized and dropped when the components change
  const s5p = applyPatch(s5, { view: "pxy" });
  const s6 = applyPatch(s5p, { z: [1, 3] });
  assert.deepEqual(s6.z.pxy, [0.25, 0.75]);
  assert.equal(s6.z.envelope, null, "the envelope keeps its own feed");
  assert.equal(applyPatch(s6, { components: ["water", "ethanol"] }).z.pxy, null);
  assert.equal(applyPatch(s6, { inputs: { pxy: ["methane", "ethane"] } }).z.pxy, null);
  assert.throws(() => applyPatch(s5p, { z: [-1, 2] }), /non-negative/);
  assert.throws(() => applyPatch(s5, { z: [1, 3] }), /feed of the P-x-y and phase-envelope views/, "the T-x-y diagram has no feed");

  // the property component: one, kept per workspace; `components` re-seeds it when it leaves the list
  const s7 = applyPatch(initialState({ components: ["water", "ethanol"] }), { propComponent: "ethanol", view: "properties" });
  assert.equal(s7.propComponent, "ethanol");
  assert.deepEqual(s7.components, ["ethanol"]);
  assert.equal(applyPatch(s7, { components: ["water"] }).propComponent, "water");
  assert.equal(applyPatch(s7, { components: ["water", "ethanol"] }).propComponent, "ethanol", "kept while it is in the list");
  assert.equal(applyPatch(s7, { components: ["water"] }).view, "properties");

  // temperature: set, then back to automatic
  const s8 = applyPatch(s0, { T_K: 200 });
  assert.equal(s8.T_K, 200);
  assert.equal(applyPatch(s8, { T_K: null }).T_K, null);
});

test("selection helpers: toggle, rotate, search", () => {
  assert.deepEqual(toggleComponent(["water"], "ethanol"), ["water", "ethanol"]);
  assert.deepEqual(toggleComponent(["water", "ethanol"], "water"), ["ethanol"]);
  const full = listComponents().slice(0, MAX_COMPONENTS).map(c => c.id);
  assert.deepEqual(toggleComponent(full, "ethylene"), full, "no seventh component");
  assert.deepEqual(rotate(MAC), ["acetone", "chloroform", "methanol"]);
  assert.deepEqual(rotate(["water"]), ["water"]);

  const all = listComponents();
  assert.deepEqual(filterComponents(all, "").length, all.length);
  assert.deepEqual(filterComponents(all, "eth").map(c => c.id).sort(),
    ["diethyl-ether", "dimethyl-ether", "ethane", "ethanol", "ethyl-acetate", "ethylbenzene", "ethylene", "ethylene-glycol",
      "methane", "methanol", "methyl-acetate"].sort());
  assert.deepEqual(filterComponents(all, "7732-18-5").map(c => c.id), ["water"]);
  assert.deepEqual(filterComponents(all, "chcl3").map(c => c.id), ["chloroform"]);
  assert.deepEqual(filterComponents(all, "zzz"), []);
});

test("units: display, parsing, exact definitions", () => {
  const C = initialState().units, K = { ...C, T: "K", P: "bar" };
  assert.equal(fmtP(101.325, C), "101.325 kPa");
  assert.equal(fmtP(101.325, K), "1.01325 bar");
  assert.equal(fmtTemp(373.15, C), "100 °C");
  assert.equal(fmtTemp(373.15, K), "373.15 K");
  assert.equal(parseP("1,5", K), 150);                     // decimal comma, bar -> kPa
  assert.equal(parseP("250", C), 250);
  assert.equal(parseP("-3", C), null);
  assert.equal(parseP("abc", C), null);
  assert.ok(Math.abs(parseT("25", C) - 298.15) < 1e-12);    // 0 °C = 273.15 K
  assert.equal(parseT("300", K), 300);
  assert.equal(parseT("-300", C), null, "below 0 K");
  assert.equal(parseT("", C), null);
});

test("composition, interpolation, tiers, known deviations", () => {
  assert.deepEqual(normalizeComposition(null, 3).map(v => +v.toFixed(12)), [1 / 3, 1 / 3, 1 / 3].map(v => +v.toFixed(12)));
  assert.deepEqual(normalizeComposition([2, 2], 2), [0.5, 0.5]);
  assert.deepEqual(normalizeComposition([1, 1, 1], 2), [0.5, 0.5], "wrong length: equimolar");
  assert.throws(() => normalizeComposition([0, 0], 2), /positive sum/);

  assert.equal(interpolate([{ x: 0, y: 0 }, { x: 2, y: 4 }], 1), 2);
  assert.equal(interpolate([{ x: 0, y: 0 }, { x: 2, y: 4 }], 3), null);
  assert.equal(interpolate([{ x: 2, y: 4 }, { x: 0, y: 0 }], 0.5), 1, "either direction");

  const counts = tierCounts([{ tier: "databank" }, { tier: "fitted" }, { tier: "fitted" }], [["A", "B"]]);
  assert.deepEqual(counts, [{ tier: "fitted", count: 2 }, { tier: "databank", count: 1 }, { tier: "none", count: 1 }]);
  assert.equal(tierSummary(counts), "4 pairs: 2 fitted, 1 databank, 1 no data");
  assert.equal(tierSummary([{ tier: "standard", count: 1 }], "gas", "gases"), "1 gas: 1 standard");
  assert.equal(tierSummary([]), "");
  // EOS systems list pairs without k_ij both in pairs (tier "none") and in missingPairs: counted once
  const eos = Fugacity.system({ components: ["benzene", "toluene"], model: "PR" }).info;
  assert.deepEqual(tierCounts(eos.pairs, eos.missingPairs), [{ tier: "none", count: 1 }]);

  const ids = ["ethanol", "water", "ethyl-acetate"].map(findComponent);
  assert.equal(knownIssuesFor(ids, "NRTL").length, 1);
  assert.equal(knownIssuesFor([ids[1], ids[2], ids[0]], "UNIQUAC").length, 1, "any order");
  assert.equal(knownIssuesFor(ids.slice(0, 2), "NRTL").length, 0);
  assert.equal(knownIssuesFor(MAC, "NRTL").length, 0);
});

test("P-x-y temperature: set, or 85 % of the lowest critical temperature rounded to 5 °C", () => {
  const T = autoTemperature(["methane", "ethane"]);
  const Tc = Math.min(pure("methane").Tc_K, pure("ethane").Tc_K);
  assert.ok(Math.abs(T - 0.85 * Tc) <= 2.5 + 1e-9);
  assert.ok(Math.abs(((T - 273.15) / 5) - Math.round((T - 273.15) / 5)) < 1e-9);
  assert.ok(T < Tc);
  assert.equal(autoTemperature([]), 298.15);
  assert.equal(pxyTemperature(initialState({ components: ["methane", "ethane"] })), T);
  assert.equal(pxyTemperature(initialState({ components: ["methane", "ethane"], T_K: 150 })), 150);
});
