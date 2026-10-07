/**
 * Flowsheet workspace (proposal 0006, step 5): the canvas, the Inputs panel (setup, block and
 * stream forms with their degrees of freedom) and the results (stream table, energy streams).
 *
 * A view (layer 6): it edits the flowsheet document with flowsheet-logic.js and calculates
 * only through the public functions of the layers below (flowsheetDocStatus, runFlowsheet).
 * The person's selection and the last solution live in `ui.fs` (not in the saved state):
 *   ui.fs = { sel: null | { kind: "block" | "stream", id }, auto: true, solveKey, cache, note }
 */
import { h, s as svgEl } from "./dom.js";
import { icon } from "./icons.js";
import { listComponents } from "../thermo/system.js";
import { componentPicker } from "./component-picker.js";
import { unitType } from "../units/units.js";
import { flowsheetDocStatus, runFlowsheet } from "../flowsheet/document.js";
import {
  PALETTE, addBlock, addFeedTo, connect, deleteBlock, addOutlet, removeOutlet, setSpec, moveBlock, setTear,
  setComponents, streamsOf, endOf, openInlets, deleteStream,
} from "./flowsheet-logic.js";
import { tToDisplay, pToDisplay, fmtShort } from "./properties-logic.js";
import { flowsheetXlsx } from "./flowsheet-excel.js";
import pkg from "../../package.json" with { type: "json" };
import { parseP, parseT, fmtTemp, fmtP } from "./app-logic.js";

const byId = () => new Map(listComponents().map(c => [c.id, c]));
const nameOf = id => byId().get(id)?.name ?? id;
const LABEL = { feed: "Feed", mixer: "Mixer", splitter: "Splitter", separator: "Separator", flash: "Flash drum", heater: "Heater / cooler", product: "Product" };
const HINT = {
  feed: "A stream entering the flowsheet: its flows and two of T, P and vapour fraction.",
  mixer: "Joins streams; adiabatic, at the lowest inlet pressure unless you set one.",
  splitter: "Divides a stream: the same state in every outlet, a fraction of the flow each. Several inlets are mixed first.",
  separator: "Sends a fraction of each component to each outlet (a black box); each outlet flashes at its T and P. Several inlets are mixed first.",
  flash: "Vapour and liquid at equilibrium: two of T, P, vapour fraction and duty.",
  heater: "Heats or cools: outlet T, duty or vapour fraction; pressure drop optional. Several inlets are mixed first.",
};
/** Blocks on the roadmap, shown in the toolbar but not available yet. */
const COMING = [
  { id: "pump", label: "Pump", icon: "pump", note: "roadmap v0.4" },
  { id: "compressor", label: "Compressor", icon: "compressor", note: "roadmap v0.6" },
  { id: "valve", label: "Valve", icon: "valve", note: "roadmap v0.4" },
  { id: "reactor", label: "Reactor", icon: "flask", note: "roadmap v0.6 and A13" },
  { id: "column", label: "Distillation", icon: "column", note: "roadmap v0.5" },
  { id: "extraction", label: "Extraction", icon: "extract", note: "after liquid-liquid equilibria in the flash" },
];
const SIZE = { feed: [44, 26], mixer: [40, 44], splitter: [40, 44], separator: [46, 62], flash: [34, 72], heater: [40, 40], product: [0, 0] };

export const ensureUi = ui => (ui.fs ??= { sel: null, auto: true, solveKey: null, cache: null, note: "" });

/** Delete what is selected (a block, or a stream as far as the flowsheet allows) and say what happened. */
export function deleteSelected(state, set, ui) {
  const f = ensureUi(ui), fs = state.flowsheet;
  if (!f.sel) return;
  if (f.sel.kind === "block") {
    const id = f.sel.id;
    f.sel = null; f.note = `Deleted ${id}. Streams that went into it now leave the flowsheet.`;
    set({ flowsheet: deleteBlock(fs, id) });
    return;
  }
  const r = deleteStream(fs, f.sel.id);
  f.note = r.note;
  if (r.fs !== fs) { if (!r.fs.streams.some(x => x.id === f.sel.id)) f.sel = null; set({ flowsheet: r.fs }); }
  else set({});
}

// ---------------------------------------------------------------------------------------
// Solving (cached by the flowsheet's text)

/** The status and, when it can be had, the solution of the flowsheet in the state. */
export function solution(state, ui) {
  const f = ensureUi(ui), fs = state.flowsheet;
  let status;
  try { status = flowsheetDocStatus(fs); } catch (e) { return { status: { ready: false, message: e.message, structure: [], blocks: {} }, result: null, error: e.message }; }
  const key = JSON.stringify(fs);
  if (!status.ready) return { status, result: null, error: null, stale: false };
  if (!(f.auto || f.solveKey === key)) return { status, result: null, error: null, stale: true };
  if (f.cache?.key !== key) {
    const t0 = typeof performance !== "undefined" ? performance.now() : 0;
    try { f.cache = { key, result: runFlowsheet(fs), error: null, ms: (typeof performance !== "undefined" ? performance.now() : 0) - t0 }; }
    catch (e) { f.cache = { key, result: null, error: e.message, loop: e.details?.loop ?? null }; }
  }
  return { status, result: f.cache.result, error: f.cache.error, loop: f.cache.loop, ms: f.cache.ms, stale: false };
}

// ---------------------------------------------------------------------------------------
// Ribbon

/** The toolbar groups of the Flowsheet workspace (helpers from app.js: group, bigButton, smallButton). */
export function flowsheetRibbon({ state, set, ui, group, bigButton, smallButton }) {
  const f = ensureUi(ui), fs = state.flowsheet;
  const ready = fs.components.length > 0;
  const place = type => () => {
    const r = addBlock(fs, type);
    f.sel = { kind: "block", id: r.id };
    set({ flowsheet: r.fs });
  };
  const method = fs.thermo.model + (["PR", "SRK"].includes(fs.thermo.model) || fs.thermo.vapour === "ideal" ? "" : ` + ${fs.thermo.vapour}`);
  return [
    group("Setup",
      bigButton({ ico: "flask", label: "Components", fk: "fs-setup", pressed: !f.sel && !ready,
        title: "1. Choose the components of the simulation", note: ready ? `${fs.components.length} chosen` : "start here",
        onClick: () => { f.sel = null; set({}); } }),
      bigButton({ ico: "cubic", label: "Method", fk: "fs-method", title: "2. The property method of the whole flowsheet", note: method,
        onClick: () => { f.sel = null; set({}); } })),
    group("Blocks", ...PALETTE.map(type => {
      const b = bigButton({ ico: type === "flash" ? "drum" : type, label: LABEL[type].replace(" / cooler", ""), fk: `fs-add-${type}`,
        title: ready ? `Place a ${LABEL[type].toLowerCase()}: ${HINT[type]}` : "Choose the components first", onClick: place(type) });
      b.disabled = !ready;
      return b;
    })),
    group("Run",
      bigButton({ ico: "solve", label: "Solve", fk: "fs-solve", title: "Calculate the flowsheet now",
        onClick: () => { f.solveKey = JSON.stringify(fs); set({}); } }),
      smallButton({ ico: "check", label: "Solve on change", pressed: f.auto, fk: "fs-auto",
        title: "Recalculate whenever the flowsheet is complete and changes", onClick: () => { f.auto = !f.auto; set({}); } })),
    group("Canvas", h("div", { class: "fa-canvas-grid" },
      smallButton({ ico: "plus", label: "Zoom in", fk: "fs-zoom-in", title: "Zoom in (Ctrl + mouse wheel)", onClick: () => { f.zoom = Math.min(3, (f.zoom ?? 1) * 1.25); set({}); } }),
      (() => {
        const what = f.sel ? `${f.sel.kind === "block" ? "" : "stream "}${f.sel.id}` : "";
        const b = smallButton({ ico: "trash", label: f.sel ? `Delete ${f.sel.id}` : "Delete", fk: "fs-delete",
          title: f.sel ? `Delete ${what} (Delete key)` : "Select a block or a stream on the canvas first", onClick: () => deleteSelected(state, set, ui) });
        b.disabled = !f.sel;
        return b;
      })(),
      smallButton({ ico: "minus", label: "Zoom out", fk: "fs-zoom-out", title: "Zoom out (Ctrl + mouse wheel)", onClick: () => { f.zoom = Math.max(0.4, (f.zoom ?? 1) / 1.25); set({}); } }),
      smallButton({ ico: "search", label: `Fit, ${Math.round((f.zoom ?? 1) * 100)} %`, fk: "fs-zoom-fit", title: "Back to the whole drawing at 100 %", onClick: () => { f.zoom = 1; set({}); } }))),
    group("Coming later", h("div", { class: "fa-soon-grid" }, ...COMING.map(c => {
      const b = smallButton({ ico: c.icon, label: c.label, fk: `fs-soon-${c.id}`, title: `${c.label}: not available yet (${c.note})`, onClick: () => {} });
      b.disabled = true; b.classList.add("is-locked");
      return b;
    })))
  ];
}

// ---------------------------------------------------------------------------------------
// Inputs panel

function numberField(label, value, onCommit, { id, uid, unit, placeholder, title } = {}) {
  const inp = h("input", { type: "text", inputmode: "decimal", id: `fa-fs-${id}-${uid}`, value: value ?? "", placeholder: placeholder ?? "", style: "width:7em", title,
    "data-fk": `fs-field-${id}`, on: { change: ev => { if (onCommit(ev.target.value.trim()) === false) ev.target.value = value ?? ""; } } });
  return h("label", { class: "fa-field", for: inp.id }, h("span", {}, label, unit ? h("small", {}, unit) : null), inp);
}
const num = t => { if (t === "") return null; const v = Number(String(t).replace(",", ".")); return Number.isFinite(v) ? v : undefined; };
const segRow = (label, choices, current, onPick, fk) => h("div", { class: "fug-seg fa-seg", role: "group", "aria-label": label },
  ...choices.map(([v, text]) => h("button", { type: "button", "aria-pressed": String(current === v), "data-fk": `${fk}-${v}`, on: { click: () => onPick(v) } }, text)));

function dofBadge(st) {
  if (!st) return null;
  if (st.ok) return h("div", { class: "fa-dof is-ok", role: "status" }, icon("check", 14), `Fully specified${st.needed ? ` (${st.given} of ${st.needed})` : ""}`);
  return h("div", { class: "fa-dof is-bad", role: "status" }, st.message.replace(/^[^:]+: /, ""));
}

/** The sections of the Inputs panel. env: { state, set, ui, uid, inputsSection } */
export function flowsheetInputs(env) {
  const f = ensureUi(env.ui);
  const note = f.note; f.note = "";
  const secs = inputsFor(env);
  return note ? [h("div", { class: "fug-warn", role: "note" }, note), ...secs] : secs;
}

function inputsFor({ state, set, ui, uid, inputsSection }) {
  const f = ensureUi(ui), fs = state.flowsheet, u = state.units;
  let st = null;
  try { st = flowsheetDocStatus(fs); } catch { /* shown on the canvas */ }
  const put = next => set({ flowsheet: next });
  const sel = f.sel && (f.sel.kind === "block" ? fs.blocks.find(b => b.id === f.sel.id) : fs.streams.find(s => s.id === f.sel.id));
  if (!sel) { f.sel = null; return setupSections({ state, set, ui, uid, inputsSection, st }); }
  const back = h("button", { type: "button", class: "fa-mini", "data-fk": "fs-back", on: { click: () => { f.sel = null; set({}); } } }, icon("chevronUp", 14), "Setup and status");
  if (f.sel.kind === "stream") return streamSections({ fs, put, sel, f, inputsSection, back, set });
  const b = sel, bst = st?.blocks?.[b.id];
  const secs = [inputsSection(`${LABEL[b.type]} ${b.id}`, h("p", { class: "fa-in-hint" }, HINT[b.type] ?? ""), dofBadge(bst))];
  const spec = b.spec ?? {};
  const setS = patch => put(setSpec(fs, b.id, patch));
  const T = (key, label = "Temperature") => numberField(label, spec[key] == null ? "" : String(+tToDisplay(spec[key], u).toFixed(3)),
    t => { if (t === "") return setS({ [key]: null }); const v = parseT(t, u); if (v == null) return false; setS({ [key]: v }); }, { id: `${b.id}-${key}`, uid, unit: u.T === "K" ? "K" : "°C" });
  const P = (key, label = "Pressure") => numberField(label, spec[key] == null ? "" : fmtShort(pToDisplay(spec[key], u), 6),
    t => { if (t === "") return setS({ [key]: null }); const v = parseP(t, u); if (v == null) return false; setS({ [key]: v }); }, { id: `${b.id}-${key}`, uid, unit: u.P });
  const plain = (key, label, unit, ph) => numberField(label, spec[key] == null ? "" : String(spec[key]),
    t => { const v = num(t); if (v === undefined) return false; setS({ [key]: v }); }, { id: `${b.id}-${key}`, uid, unit, placeholder: ph });
  /** Choose which two (or one) state variables are given: keeps their values, drops the others. */
  const modeSeg = (modes, keys) => {
    const cur = modes.find(([m]) => m.split("+").every(k => spec[k] != null) && keys.filter(k => !m.split("+").includes(k)).every(k => spec[k] == null))?.[0]
      ?? f.mode?.[b.id] ?? null;
    return segRow("Specification", modes.map(([m, l]) => [m, l]), cur, m => {
      const want = m.split("+");
      f.mode = { ...(f.mode ?? {}), [b.id]: m };   // before the redraw, which shows this mode's fields
      setS(Object.fromEntries(keys.map(k => [k, want.includes(k) ? spec[k] ?? null : null])));
    }, `fs-mode-${b.id}`);
  };
  const shown = (modes, keys) => {
    const cur = modes.find(([m]) => m.split("+").every(k => spec[k] != null))?.[0] ?? f.mode?.[b.id] ?? modes[0][0];
    return cur.split("+");
  };
  const fieldFor = key => key === "T_K" ? T("T_K") : key === "P_kPa" ? P("P_kPa") : key === "VF" ? plain("VF", "Vapour fraction", "mol/mol", "0 to 1")
    : key === "duty_kW" ? plain("duty_kW", "Duty", "kW", "+ heat in") : null;

  if (b.type === "feed") {
    const mass = spec.flow_kg_h != null;
    const key = mass ? "flow_kg_h" : "flow_kmol_h";
    const flows = spec[key] ?? {};
    secs.push(inputsSection("Flows",
      segRow("Flow unit", [["kmol_h", "kmol/h"], ["kg_h", "kg/h"]], mass ? "kg_h" : "kmol_h", v => {
        const to = v === "kg_h" ? "flow_kg_h" : "flow_kmol_h";
        if (to !== key) setS({ [to]: spec[key] ?? {}, [key]: null });
      }, `fs-funit-${b.id}`),
      ...fs.components.map(c => numberField(nameOf(c), flows[c] == null ? "" : String(flows[c]), t => {
        const v = num(t); if (v === undefined || (v != null && v < 0)) return false;
        const next = { ...flows }; if (v == null) delete next[c]; else next[c] = v;
        setS({ [key]: next });
      }, { id: `${b.id}-f-${c}`, uid, unit: mass ? "kg/h" : "kmol/h", placeholder: "0" }))));
    const modes = [["T_K+P_kPa", "T, P"], ["P_kPa+VF", "P, VF"], ["T_K+VF", "T, VF"]];
    secs.push(inputsSection("State", modeSeg(modes, ["T_K", "P_kPa", "VF"]), ...shown(modes, ["T_K", "P_kPa", "VF"]).map(fieldFor)));
  } else if (b.type === "flash") {
    const modes = [["T_K+P_kPa", "T, P"], ["P_kPa+duty_kW", "P, Q"], ["P_kPa+VF", "P, VF"], ["T_K+VF", "T, VF"]];
    secs.push(inputsSection("Conditions", modeSeg(modes, ["T_K", "P_kPa", "VF", "duty_kW"]), ...shown(modes, ["T_K", "P_kPa", "VF", "duty_kW"]).map(fieldFor),
      h("p", { class: "fa-in-hint" }, "P and Q = 0: an adiabatic drum.")));
  } else if (b.type === "heater") {
    const modes = [["T_K", "T"], ["duty_kW", "Duty"], ["VF", "VF"], ["T_K+VF", "T, VF"]];
    const keys = shown(modes, ["T_K", "duty_kW", "VF"]);
    secs.push(inputsSection("Outlet", modeSeg(modes, ["T_K", "duty_kW", "VF"]), ...keys.map(fieldFor)));
    if (!(keys.includes("T_K") && keys.includes("VF"))) {
      secs.push(inputsSection("Pressure", spec.P_kPa != null ? P("P_kPa", "Outlet pressure") : P("dP_kPa", "Pressure drop"),
        h("button", { type: "button", class: "fa-mini", "data-fk": `fs-pmode-${b.id}`, on: { click: () => setS(spec.P_kPa != null ? { P_kPa: null } : { dP_kPa: null, P_kPa: 101.325 }) } },
          spec.P_kPa != null ? "Give a pressure drop instead" : "Give the outlet pressure instead"),
        h("p", { class: "fa-in-hint" }, "Empty pressure drop: none.")));
    }
  } else if (b.type === "mixer") {
    secs.push(inputsSection("Outlet", P("P_kPa", "Outlet pressure"), h("p", { class: "fa-in-hint" }, "Empty: the lowest inlet pressure.")));
  } else if (b.type === "splitter" || b.type === "separator") {
    const outs = streamsOf(fs, b.id).out ?? [];
    const outletTools = h("div", { class: "fa-in-actions" },
      h("button", { type: "button", class: "fa-mini", "data-fk": `fs-addout-${b.id}`, on: { click: () => put(addOutlet(fs, b.id)) } }, icon("plus", 14), "Outlet"),
      h("button", { type: "button", class: "fa-mini", "data-fk": `fs-rmout-${b.id}`, disabled: outs.length <= 2,
        on: { click: () => { try { put(removeOutlet(fs, b.id)); } catch (e) { f.note = e.message; set({}); } } } }, icon("minus", 14), "Outlet"));
    /** One row of fractions over the outlets, with a "rest" choice. */
    const fracRow = (list, onChange, tag) => h("div", { class: "fa-frac-row" }, ...outs.map((sid, k) => {
      const isRest = list[k] === "rest";
      const inp = h("input", { type: "text", inputmode: "decimal", value: isRest ? "" : list[k] ?? "", placeholder: isRest ? "rest" : "0", disabled: isRest, style: "width:4.6em",
        "aria-label": `Fraction to ${sid}`, "data-fk": `fs-fr-${b.id}-${tag}-${k}`,
        on: { change: ev => { const v = num(ev.target.value.trim()); if (v === undefined || v == null || v < 0 || v > 1) { ev.target.value = list[k] ?? ""; return; } const l = list.slice(); l[k] = v; onChange(l); } } });
      const rest = h("input", { type: "radio", name: `fa-rest-${b.id}-${tag}-${uid}`, checked: isRest, title: `${sid} takes the rest`, "aria-label": `${sid} takes the rest`,
        "data-fk": `fs-rest-${b.id}-${tag}-${k}`, on: { change: () => { const l = list.map((v, i) => (i === k ? "rest" : v === "rest" ? 0 : v)); onChange(l); } } });
      return h("label", { class: "fa-frac" }, h("span", {}, sid), inp, rest);
    }));
    if (b.type === "splitter") {
      const list = Array.isArray(spec.fractions) ? outs.map((_, k) => spec.fractions[k] ?? 0) : outs.map((_, k) => (k === outs.length - 1 ? "rest" : 0));
      secs.push(inputsSection("Fractions of the flow", fracRow(list, l => setS({ fractions: l }), "all"),
        h("p", { class: "fa-in-hint" }, "The dot marks the outlet that takes the rest."), outletTools));
    } else {
      const fr = spec.fractions ?? {};
      secs.push(inputsSection("Fraction of each component to each outlet",
        ...fs.components.map(c => {
          const list = Array.isArray(fr[c]) ? outs.map((_, k) => fr[c][k] ?? 0) : outs.map((_, k) => (k === outs.length - 1 ? "rest" : 0));
          return h("div", { class: "fa-frac-comp" }, h("div", { class: "fa-frac-name" }, nameOf(c)), fracRow(list, l => setS({ fractions: { ...fr, [c]: l } }), c));
        }),
        h("p", { class: "fa-in-hint" }, "Each outlet is flashed at the inlet's T and P."), outletTools));
    }
  }
  // inlets: add a feed to an inlet that takes one more stream
  const ins = unitType(b.type).inlets;
  if (ins.length) {
    const open = openInlets(fs).filter(x => x.startsWith(`${b.id}.`));
    const connected = (streamsOf(fs, b.id).in ?? []);
    secs.push(inputsSection("Connections",
      h("p", { class: "fa-in-hint" }, connected.length ? `In: ${connected.join(", ")}.` : "No stream comes in yet."),
      open.length ? h("button", { type: "button", class: "fa-mini", "data-fk": `fs-feed-${b.id}`, on: { click: () => {
        const r = addFeedTo(fs, open[0]); f.sel = { kind: "block", id: r.id }; put(r.fs);
      } } }, icon("feed", 14), "Add a feed to this inlet") : null,
      h("p", { class: "fa-in-hint" }, "To connect: drag from an outlet dot (●, where a stream leaves a block) to an inlet ring (○ on the left of a block). The rings that can take the stream light up while you drag. A recycle is the same: drag a later block's outlet back to an earlier block, usually a mixer.")));
  }
  secs.push(inputsSection("Block", h("div", { class: "fa-in-actions" }, back,
    h("button", { type: "button", class: "fa-mini", "data-fk": `fs-del-${b.id}`, on: { click: () => deleteSelected(state, set, ui) } }, icon("trash", 14), `Delete ${b.id}`))));
  return secs;
}

function setupSections({ state, set, ui, uid, inputsSection, st }) {
  const f = ensureUi(ui), fs = state.flowsheet;
  const all = listComponents();
  const eos = ["PR", "SRK"].includes(fs.thermo.model);
  const usable = all.filter(c => eos || c.activity);
  const changeComps = ids => { const r = setComponents(fs, ids); f.note = r.note; set({ flowsheet: r.fs }); };
  // type a name, formula or CAS number (component-picker.js); gases need an equation of state
  const add = componentPicker({
    id: `fa-fs-addcomp-${uid}`, fk: "fs-addcomp", label: "Add a component", clearOnPick: true,
    components: all.filter(c => !fs.components.includes(c.id)),
    status: c => (usable.includes(c) ? {} : { disabled: true, note: "gas: choose Peng–Robinson or SRK" }),
    group: c => (c.activity ? "Liquids" : "Gases"),
    placeholder: fs.components.length ? "Add: name, formula, CAS…" : "Choose: name, formula, CAS…",
    onPick: id => { if (id) changeComps([...fs.components, id]); },
  });
  const chips = fs.components.map(c => h("li", { class: "fa-chip" }, h("span", {}, nameOf(c)),
    h("button", { type: "button", class: "fa-chip-x", "aria-label": `Remove ${nameOf(c)}`, "data-fk": `fs-rm-${c}`, on: { click: () => changeComps(fs.components.filter(x => x !== c)) } }, "×")));
  const setThermo = patch => {
    const thermo = { ...fs.thermo, ...patch };
    const nowEos = ["PR", "SRK"].includes(thermo.model);
    const dropped = nowEos ? [] : fs.components.filter(c => !byId().get(c)?.activity);
    f.note = dropped.length ? `${dropped.map(nameOf).join(", ")} need${dropped.length === 1 ? "s" : ""} an equation of state (no activity-model data); keep Peng–Robinson or SRK, or remove ${dropped.length === 1 ? "it" : "them"}.` : "";
    set({ flowsheet: { ...fs, thermo } });
  };
  const secs = [];

  secs.push(inputsSection("1. Components",
    h("p", { class: "fa-in-hint" }, "The components of the whole simulation. Every feed lists exactly these."),
    chips.length ? h("ol", { class: "fa-chips", "aria-label": "Components of the flowsheet" }, ...chips) : h("div", { class: "fa-empty" }, "None chosen yet."),
    h("div", { class: "fa-add" }, add)));
  secs.push(inputsSection("2. Method",
    h("p", { class: "fa-in-hint" }, "One property method for every block and stream."),
    h("div", { class: "fa-fs-model" }, h("span", { class: "fa-in-hint" }, "Activity model"),
      segRow("Activity model", [["NRTL", "NRTL"], ["UNIQUAC", "UNIQUAC"], ["ideal", "Ideal"]], eos ? null : fs.thermo.model, m => setThermo({ model: m }), "fs-model")),
    eos ? null : h("div", { class: "fa-fs-model" }, h("span", { class: "fa-in-hint" }, "with vapour"),
      segRow("Vapour model", [["ideal", "Ideal gas"], ["PR", "PR"], ["SRK", "SRK"]], fs.thermo.vapour ?? "ideal", v => setThermo({ vapour: v }), "fs-vap")),
    h("div", { class: "fa-fs-model" }, h("span", { class: "fa-in-hint" }, "or an equation of state"),
      segRow("Equation of state", [["PR", "Peng–Robinson"], ["SRK", "SRK"]], eos ? fs.thermo.model : null, m => setThermo({ model: m }), "fs-model"))));
  const units = fs.blocks.filter(b => b.type !== "product");
  secs.push(inputsSection("3. Flowsheet",
    !fs.components.length ? h("p", { class: "fa-in-hint" }, "Choose the components first; then place blocks from the toolbar.")
      : !units.length ? h("p", { class: "fa-in-hint" }, "Place a block from the toolbar (for example a Flash drum), then add a feed to it. Its outlets leave the flowsheet until you connect them: drag from an outlet dot (●) to another block's inlet ring (○).")
        : h("div", {}, st ? h("div", { class: `fa-dof ${st.ready ? "is-ok" : "is-bad"}`, role: "status" }, st.message) : null,
          h("ul", { class: "fa-dof-list" }, ...(st ? [...st.structure.map(p => h("li", {}, p.message)),
            ...Object.entries(st.blocks).filter(([, b]) => !b.ok).map(([id, b]) => h("li", {}, h("button", { type: "button", class: "fa-link", "data-fk": `fs-go-${id}`,
              on: { click: () => { f.sel = { kind: "block", id }; set({}); } } }, id), ": ", b.message.replace(/^[^:]+: /, "")))] : [])))));
  if (fs.components.length) secs.push(...solverSection({ fs, set, uid, inputsSection }));
  return secs;
}

/** The solver settings of the flowsheet: method, tolerance, maximum iterations. */
function solverSection({ fs, set, uid, inputsSection }) {
  const sv = { method: "wegstein", tolerance: 1e-8, maxIterations: 50, ...(fs.solver ?? {}) };
  const put = patch => set({ flowsheet: { ...fs, solver: { ...(fs.solver ?? {}), ...patch } } });
  return [inputsSection("4. Recycle solver",
    h("p", { class: "fa-in-hint" }, "Recycles are solved by tearing them: the solver picks the fewest streams that break every loop (or the ones you mark as tear streams), guesses them (no flow at first), and calculates around the loop until they stop changing."),
    segRow("Method", [["wegstein", "Wegstein"], ["direct", "Direct substitution"]], sv.method, m => put({ method: m }), "fs-solver-method"),
    h("p", { class: "fa-in-hint" }, sv.method === "wegstein" ? "Wegstein: two plain steps, then each flow is extrapolated from its last two values (bounded). Usually much faster." : "Direct substitution: the next guess is the last result. Slower, but it never overshoots."),
    numberField("Tolerance", String(sv.tolerance), t => { const v = num(t); if (!(v > 0 && v < 0.1)) return false; put({ tolerance: v }); },
      { id: "solver-tol", uid, unit: "relative", title: "Converged when every flow and temperature of the tear streams changes by less than this, relative" }),
    numberField("Maximum iterations", String(sv.maxIterations), t => { const v = num(t); if (!(Number.isInteger(v) && v >= 1 && v <= 1000)) return false; put({ maxIterations: v }); },
      { id: "solver-iter", uid }))];
}

function streamSections({ fs, put, sel, f, inputsSection, back, set }) {
  const s = sel, from = s.from.split("."), end = endOf(fs, s.id);
  const opts = ["", ...openInlets(fs, from[0]), ...(end.kind === "unit" ? [s.to] : [])];
  const goes = h("select", { "data-fk": `fs-to-${s.id}`, "aria-label": "Goes to", on: { change: ev => { try { put(connect(fs, s.id, ev.target.value || null)); } catch (e) { f.note = e.message; set({}); } } } },
    ...[...new Set(opts)].map(o => h("option", { value: o, selected: o === (end.kind === "unit" ? s.to : "") }, o ? o.replace(".", " · ") : "Leaves the flowsheet (product)")));
  return [
    inputsSection(`Stream ${s.id}`, h("p", { class: "fa-in-hint" }, `From ${from[0]} (${from[1]}).`),
      h("label", { class: "fa-field fa-field-stack" }, h("span", {}, "Goes to"), goes),
      end.kind === "unit" ? h("label", { class: "fa-field" }, h("span", {}, "Tear stream (recycle)"),
        h("input", { type: "checkbox", checked: !!s.tear, "data-fk": `fs-tear-${s.id}`, on: { change: ev => put(setTear(fs, s.id, ev.target.checked)) } })) : null,
      h("p", { class: "fa-in-hint" }, "The solver chooses the tear stream of a recycle itself; mark one only to choose it.")),
    inputsSection("Stream", h("div", { class: "fa-in-actions" }, back,
      h("button", { type: "button", class: "fa-mini", "data-fk": `fs-delstream-${s.id}`, on: { click: () => {
        const r = deleteStream(fs, s.id); f.note = r.note;
        if (r.fs !== fs) { if (!r.fs.streams.some(x => x.id === s.id)) f.sel = null; put(r.fs); } else set({});
      } } }, icon("trash", 14), `Delete ${s.id}`))),
  ];
}

// ---------------------------------------------------------------------------------------
// Canvas

/** Port positions of a block: inlets on the left, outlets on the right (drum: vapour up, liquid down). */
function ports(fs, b) {
  const [w, hh] = SIZE[b.type] ?? [40, 40];
  const x = b.x ?? 0, y = b.y ?? 0;
  const at = {};
  const spread = (list, side) => list.forEach((sid, k) => { at[sid] = { x: x + side * w / 2, y: y + (k - (list.length - 1) / 2) * 16, dir: [side, 0] }; });
  const st = streamsOf(fs, b.id);
  if (b.type === "product") { for (const sid of st.in ?? []) at[sid] = { x, y, dir: [1, 0] }; return at; }
  spread(st.in ?? [], -1);
  if (b.type === "flash") {
    for (const sid of st.vapour ?? []) at[sid] = { x, y: y - hh / 2, dir: [0, -1] };
    for (const sid of st.liquid ?? []) at[sid] = { x, y: y + hh / 2, dir: [0, 1] };
    for (const sid of st.liquid2 ?? []) at[sid] = { x: x + w / 2, y: y + hh / 2 - 10, dir: [1, 0] };
  } else spread(st.out ?? [], 1);
  return at;
}

/** An orthogonal route from s (leaving in s.dir) to e (entering from the left). */
function route(s, e) {
  const a = { x: s.x + 16 * s.dir[0], y: s.y + 16 * s.dir[1] };
  const b = { x: e.x - 16, y: e.y };
  if (b.x >= a.x) { const mx = (a.x + b.x) / 2; return [s, a, { x: mx, y: a.y }, { x: mx, y: b.y }, b, e]; }
  const yb = Math.max(a.y, e.y, s.y) + 70;   // a recycle: back along the bottom
  return [s, a, { x: a.x, y: yb }, { x: b.x, y: yb }, b, e];
}

function shape(type, w, hh) {
  switch (type) {
    case "feed": return svgEl("rect", { x: -w / 2, y: -hh / 2, width: w, height: hh, rx: 13, class: "fs-shape" });
    case "mixer": return svgEl("path", { d: `M${-w / 2} ${-hh / 2} L${w / 2} 0 L${-w / 2} ${hh / 2} Z`, class: "fs-shape" });
    case "splitter": return svgEl("path", { d: `M${w / 2} ${-hh / 2} L${-w / 2} 0 L${w / 2} ${hh / 2} Z`, class: "fs-shape" });
    case "separator": { const g = svgEl("g", {}); g.append(svgEl("rect", { x: -w / 2, y: -hh / 2, width: w, height: hh, rx: 4, class: "fs-shape" }), svgEl("path", { d: `M${-w / 2} ${hh / 2 - 8} L${w / 2} ${-hh / 2 + 8}`, class: "fs-detail" })); return g; }
    case "flash": return svgEl("rect", { x: -w / 2, y: -hh / 2, width: w, height: hh, rx: w / 2, class: "fs-shape" });
    case "heater": { const g = svgEl("g", {}); g.append(svgEl("circle", { r: w / 2, class: "fs-shape" }), svgEl("path", { d: "M-12 4 L-6 -6 L0 6 L6 -6 L12 4", class: "fs-detail" })); return g; }
    default: return svgEl("g", {});
  }
}

/** Draw the flowsheet (canvas, results panel and stream table). ctx from app-views renderView. */
export function flowsheetView(ctx) {
  const { state, set, plot, side, below, notes, ui } = ctx;
  const f = ensureUi(ui), fs = state.flowsheet, u = state.units;
  if (!fs.components.length) {
    plot.replaceChildren(h("div", { class: "fa-need is-start", role: "status" },
      h("h3", {}, "Start by choosing the components of the simulation"),
      h("p", {}, "1. Components and 2. Method are in the Inputs panel (or the Setup group of the toolbar). Then place blocks from the toolbar: a Flash drum, a Heater, a Splitter… Every outlet leaves the flowsheet as a product until you connect it to another block.")));
    side.replaceChildren(h("div", { class: "fa-empty" }, "No flowsheet yet."));
    return { data: "Setup: choose the components" };
  }
  const sol = solution(state, ui);
  const res = sol.result;
  if (sol.error) notes.append(h("div", { class: "fug-err", role: "alert" }, h("strong", {}, "Not solved. "), sol.error,
    sol.loop ? h("div", { class: "fa-in-hint" }, "The blocks of that recycle are outlined in red. The solver settings are in the Inputs panel (with nothing selected): 4. Recycle solver.") : null));
  if (sol.stale) notes.append(h("div", { class: "fug-warn", role: "note" }, "The results are not up to date: press Solve."));

  // ---- the drawing
  const pos = new Map(fs.blocks.map(b => [b.id, b]));
  const xs = fs.blocks.length ? fs.blocks.map(b => b.x ?? 0) : [120], ys = fs.blocks.length ? fs.blocks.map(b => b.y ?? 0) : [160];
  // the view fits the drawing (with room for labels and recycles), at least 520 x 300
  let minX = Math.min(...xs) - 90, maxX = Math.max(...xs) + 110, minY = Math.min(...ys) - 80, maxY = Math.max(...ys) + 120;
  if (maxX - minX < 520) { const c = (maxX + minX) / 2; minX = c - 260; maxX = c + 260; }
  if (maxY - minY < 300) { const c = (maxY + minY) / 2; minY = c - 150; maxY = c + 150; }
  const zoom = f.zoom ?? 1;
  const svg = svgEl("svg", { class: "fs-canvas", viewBox: `${minX} ${minY} ${maxX - minX} ${maxY - minY}`, role: "group", "aria-label": "Flowsheet drawing",
    style: zoom === 1 ? undefined : `width:${zoom * 100}%; max-height:none` });
  // Ctrl + mouse wheel zooms
  svg.addEventListener("wheel", ev => {
    if (!ev.ctrlKey) return;
    ev.preventDefault();
    f.zoom = Math.min(3, Math.max(0.4, zoom * (ev.deltaY < 0 ? 1.15 : 1 / 1.15)));
    set({});
  }, { passive: false });
  const defs = svgEl("defs", {});
  const mk = (id, cls) => { const m = svgEl("marker", { id, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }); m.append(svgEl("path", { d: "M0 0 L10 5 L0 10 z", class: cls })); return m; };
  const uidM = `fsm-${ctx.uid}`;
  defs.append(mk(`${uidM}-a`, "fs-arrow"), mk(`${uidM}-q`, "fs-qarrow"));
  svg.append(defs);
  const layer = svgEl("g", {});
  svg.append(layer);
  const selected = (kind, id) => f.sel?.kind === kind && f.sel.id === id;
  const select = (kind, id) => { f.sel = kind ? { kind, id } : null; set({}); };

  const draw = doc => {
    layer.replaceChildren();
    const P = new Map();
    for (const b of doc.blocks) for (const [sid, p] of Object.entries(ports(doc, b))) P.set(`${sid}@${b.id}`, p);
    // streams
    for (const s of doc.streams) {
      const fb = s.from.split(".")[0], tb = s.to.split(".")[0];
      const a = P.get(`${s.id}@${fb}`), e = P.get(`${s.id}@${tb}`);
      if (!a || !e) continue;
      const pts = route(a, e);
      const d = pts.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
      const g = svgEl("g", { class: "fs-stream" + (selected("stream", s.id) ? " is-sel" : "") + (s.tear ? " is-tear" : ""), "data-stream": s.id,
        tabindex: 0, role: "button", "aria-label": `Stream ${s.id}` });
      g.append(svgEl("path", { d, class: "fs-hit" }), svgEl("path", { d, class: "fs-line", "marker-end": `url(#${uidM}-a)` }));
      // label on the longest segment
      let best = 1, len = 0;
      for (let i = 1; i < pts.length; i++) { const l = Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y); if (l > len) { len = l; best = i; } }
      const lx = (pts[best].x + pts[best - 1].x) / 2, ly = (pts[best].y + pts[best - 1].y) / 2;
      // the name on the drawing; flow and temperature on hover and in the stream table
      const st = res?.streams?.[s.id];
      const t = svgEl("text", { x: lx, y: ly - 6, class: "fs-label", "text-anchor": "middle" });
      t.textContent = s.id;
      const tip = svgEl("title", {});
      tip.textContent = st ? `${s.id}: ${fmtShort(st.F_kmol_h, 5)} kmol/h${st.T_K != null ? `, ${fmtTemp(st.T_K, u, 2)}` : ""}${st.VF != null ? `, VF ${fmtShort(st.VF, 3)}` : ""}` : `${s.id} (not calculated)`;
      g.append(tip);
      g.append(t);
      // the end of every stream is a handle: drag it onto another inlet to reconnect, or into
      // empty space to disconnect (the stream then leaves the flowsheet)
      const leaves = doc.blocks.find(b => b.id === tb)?.type === "product";
      const hnd = svgEl("circle", { cx: leaves ? e.x : e.x - 9, cy: e.y, r: leaves ? 7 : 4.5, class: "fs-handle" + (leaves ? "" : " is-end"), "data-handle": s.id, "data-end": "1" });
      const tt = svgEl("title", {});
      tt.textContent = leaves ? `${s.id} leaves the flowsheet. Drag this end onto a block to connect it.`
        : `${s.id} goes into ${tb}. Drag this end onto another inlet to reconnect it, or into empty space to disconnect it.`;
      hnd.append(tt);
      g.append(hnd);
      layer.append(g);
    }
    // blocks
    for (const b of doc.blocks) {
      if (b.type === "product") continue;
      const [w, hh] = SIZE[b.type];
      const g = svgEl("g", { class: `fs-block fs-${b.type}` + (selected("block", b.id) ? " is-sel" : "") + (sol.loop?.includes(b.id) ? " is-failed" : "") + (sol.status?.blocks?.[b.id] && !sol.status.blocks[b.id].ok ? " is-incomplete" : ""),
        transform: `translate(${b.x ?? 0} ${b.y ?? 0})`, "data-block": b.id, tabindex: 0, role: "button",
        "aria-label": `${LABEL[b.type]} ${b.id}${sol.status?.blocks?.[b.id]?.ok === false ? ", not fully specified" : ""}` });
      g.append(shape(b.type, w, hh));
      // inlet ports: a ring on the left; an open one takes another stream
      for (const ip of unitType(b.type).inlets) {
        const key = `${b.id}.${ip.port}`, n = doc.streams.filter(x => x.to === key).length;
        if (n >= ip.max) continue;   // full: nothing more to drop here
        // empty: at the middle; with streams in (a mixer, a drum): just below the last one
        const ring = svgEl("circle", { cx: -w / 2, cy: n ? ((n - 1) / 2) * 16 + 16 : 0, r: 5, class: "fs-port-in is-open", "data-inlet": key });
        const tt = svgEl("title", {}); tt.textContent = `Inlet of ${b.id}${n ? ` (${n} stream${n > 1 ? "s" : ""} in)` : ""}${n < ip.max ? ": drop a stream here" : ": full"}`; ring.append(tt);
        g.append(ring);
      }
      // the drum's liquid leaves at the bottom: its name goes on the right
      const t = b.type === "flash" ? svgEl("text", { x: w / 2 + 6, y: 4, class: "fs-name", "text-anchor": "start" })
        : svgEl("text", { y: hh / 2 + 15, class: "fs-name", "text-anchor": "middle" });
      t.textContent = b.id; g.append(t);
      if (sol.status?.blocks?.[b.id] && !sol.status.blocks[b.id].ok) {
        const warn = svgEl("circle", { cx: w / 2, cy: -hh / 2, r: 5, class: "fs-warn-dot" });
        const tt = svgEl("title", {}); tt.textContent = sol.status.blocks[b.id].message; warn.append(tt); g.append(warn);
      }
      // energy stream
      if (unitType(b.type).duty) {
        const name = b.energy || `Q-${b.id}`, q = res?.energy?.[name]?.duty_kW;
        const x0 = -w / 2 - 6, y0 = hh / 2 + 2, x1 = x0 - 26, y1 = y0 + 30;
        const into = q == null || q >= 0;
        const ln = svgEl("path", { d: into ? `M${x1} ${y1} L${x0} ${y0}` : `M${x0} ${y0} L${x1} ${y1}`, class: "fs-q", "marker-end": `url(#${uidM}-q)` });
        const qt = svgEl("text", { x: x1 - 4, y: y1 + 4, class: "fs-qlabel", "text-anchor": "end" });
        qt.textContent = q == null ? name : `${name} ${q >= 0 ? "+" : "−"}${fmtShort(Math.abs(q), 4)} kW`;
        g.append(ln, qt);
      }
      layer.append(g);
    }
    // outlet ports (drawn last, on top of the blocks): a dot where each stream leaves a unit; drag it onto an inlet to connect
    const OUT_LABEL = { vapour: "vapour", liquid: "liquid", liquid2: "liquid 2" };
    for (const st of doc.streams) {
      const [fb, port] = st.from.split(".");
      const src = doc.blocks.find(b => b.id === fb);
      const a = P.get(`${st.id}@${fb}`);
      if (!a || !src || src.type === "product") continue;
      const dot = svgEl("circle", { cx: a.x, cy: a.y, r: 4.5, class: "fs-port-out", "data-handle": st.id });
      const tt = svgEl("title", {}); tt.textContent = `${src.id} ${OUT_LABEL[port] ?? "outlet"} (stream ${st.id}): drag onto an inlet to connect it`; dot.append(tt);
      layer.append(dot);
      if (OUT_LABEL[port]) {
        const lb = svgEl("text", { x: a.x + (a.dir[0] ? 4 : 7), y: a.y + (a.dir[1] < 0 ? -6 : a.dir[1] > 0 ? 13 : -6), class: "fs-port-label" });
        lb.textContent = OUT_LABEL[port]; layer.append(lb);
      }
    }
  };
  draw(fs);

  // ---- interaction: select, move, connect
  const toSvg = ev => { const m = svg.getScreenCTM(); if (!m) return { x: 0, y: 0 }; const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse()); return { x: p.x, y: p.y }; };
  let drag = null;
  svg.addEventListener("pointerdown", ev => {
    const hnd = ev.target.closest?.("[data-handle]"), blk = ev.target.closest?.("[data-block]"), str = ev.target.closest?.("[data-stream]");
    if (hnd) { drag = { kind: "connect", sid: hnd.dataset.handle, start: toSvg(ev), moved: false, fromEnd: !!hnd.dataset.end }; svg.setPointerCapture?.(ev.pointerId); ev.preventDefault(); return; }
    if (blk) { const b = pos.get(blk.dataset.block); drag = { kind: "move", id: b.id, start: toSvg(ev), x0: b.x ?? 0, y0: b.y ?? 0, moved: false, doc: fs }; svg.setPointerCapture?.(ev.pointerId); ev.preventDefault(); return; }
    if (str) { select("stream", str.dataset.stream); return; }
    if (f.sel) select(null);
  });
  svg.addEventListener("pointermove", ev => {
    if (!drag) return;
    const p = toSvg(ev), dx = p.x - drag.start.x, dy = p.y - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    if (drag.kind === "move") { drag.doc = moveBlock(fs, drag.id, drag.x0 + dx, drag.y0 + dy); draw(drag.doc); }
    else {
      draw(fs);
      svg.classList.add("is-connecting");
      const src = fs.streams.find(x => x.id === drag.sid)?.from.split(".")[0];
      const valid = new Set(openInlets(fs, src));
      for (const el of svg.querySelectorAll("[data-inlet]")) el.classList.toggle("is-target", valid.has(el.dataset.inlet));
      const ln = svgEl("path", { d: `M${drag.start.x} ${drag.start.y} L${p.x} ${p.y}`, class: "fs-drag", "marker-end": `url(#${uidM}-a)` });
      layer.append(ln);
    }
  });
  svg.addEventListener("pointerup", ev => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.kind === "move") {
      if (d.moved) set({ flowsheet: d.doc }); else select("block", d.id);
      return;
    }
    svg.classList.remove("is-connecting");
    if (!d.moved) { select("stream", d.sid); return; }
    const hit = document.elementFromPoint(ev.clientX, ev.clientY);
    const valid = openInlets(fs, fs.streams.find(s => s.id === d.sid)?.from.split(".")[0]);
    const ring = hit?.closest?.("[data-inlet]");
    if (ring && valid.includes(ring.dataset.inlet)) { f.sel = { kind: "stream", id: d.sid }; set({ flowsheet: connect(fs, d.sid, ring.dataset.inlet) }); return; }
    const under = hit?.closest?.("[data-block]");
    if (under) {
      const inlet = valid.find(x => x.startsWith(`${under.dataset.block}.`));
      if (inlet) { f.sel = { kind: "stream", id: d.sid }; set({ flowsheet: connect(fs, d.sid, inlet) }); return; }
      f.note = under.dataset.block === fs.streams.find(s => s.id === d.sid)?.from.split(".")[0]
        ? "A stream cannot go back into the block it leaves; send it through another block (a recycle goes back to an earlier block, for example a mixer)."
        : `${under.dataset.block} takes no more streams: its inlet is full.`;
      set({});
      return;
    }
    // dropped in the open: a product end moves there; a connected stream is disconnected there
    const p = toSvg(ev), end = endOf(fs, d.sid);
    if (end?.kind === "product") set({ flowsheet: moveBlock(fs, end.block, p.x, p.y) });
    else if (end?.kind === "unit" && d.fromEnd) {
      const out = connect(fs, d.sid, null), e2 = endOf(out, d.sid);
      f.sel = { kind: "stream", id: d.sid };
      f.note = `${d.sid} no longer goes to ${end.block}: it now leaves the flowsheet. Drag its end onto another inlet to connect it again.`;
      set({ flowsheet: moveBlock(out, e2.block, p.x, p.y) });
    } else draw(fs);
  });
  svg.addEventListener("keydown", ev => {
    const str = ev.target.closest?.("[data-stream]");
    if (str) {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select("stream", str.dataset.stream); }
      else if (ev.key === "Delete" || ev.key === "Backspace") { ev.preventDefault(); f.sel = { kind: "stream", id: str.dataset.stream }; deleteSelected(state, set, ui); }
      return;
    }
    const blk = ev.target.closest?.("[data-block]");
    if (!blk) return;
    const b = pos.get(blk.dataset.block);
    const step = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[ev.key];
    if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select("block", b.id); }
    else if (step) { ev.preventDefault(); f.sel = { kind: "block", id: b.id }; set({ flowsheet: moveBlock(fs, b.id, (b.x ?? 0) + step[0], (b.y ?? 0) + step[1]) }); }
    else if (ev.key === "Delete" || ev.key === "Backspace") { ev.preventDefault(); f.sel = { kind: "block", id: b.id }; deleteSelected(state, set, ui); }
  });

  const units = fs.blocks.filter(b => b.type !== "product");
  plot.replaceChildren(h("div", { class: "fs-wrap" }, svg,
    units.length ? null : h("div", { class: "fs-empty-hint" }, "Place a block from the toolbar: Flash drum, Heater, Mixer, Splitter, Separator or Feed.")));

  // ---- results panel
  side.replaceChildren(...resultsPanel({ state, f, sol, u }));
  // ---- stream table
  if (res) below.replaceChildren(streamTable({ fs, res, u, state }), ...csvTools(ctx, fs, res, u));
  const it = res?.loops?.reduce((a, l) => a + l.iterations, 0);
  if (sol.error) return { data: "Not solved: see the message above the drawing" };
  return { data: res ? `Solved${res.loops.length ? `, ${res.loops.length} recycle${res.loops.length > 1 ? "s" : ""} in ${it} iterations` : ""}` : sol.status.message };
}

function kvList(rows) {
  return h("table", { class: "fa-kv" }, h("tbody", {}, ...rows.filter(Boolean).map(([k, v]) =>
    h("tr", {}, h("th", { scope: "row" }, k), h("td", { class: "fug-num" }, v ?? "–")))));
}

function resultsPanel({ state, f, sol, u }) {
  const res = sol.result, fs = state.flowsheet;
  const out = [];
  if (f.sel?.kind === "block") {
    const b = fs.blocks.find(x => x.id === f.sel.id), r = res?.blocks?.[f.sel.id];
    out.push(h("div", { class: "fug-eyebrow" }, `${LABEL[b?.type] ?? ""} ${f.sel.id}`));
    if (r) {
      out.push(kvList([
        unitType(b.type).duty ? [`Duty (${b.energy || `Q-${b.id}`})`, `${fmtShort(r.duty_kW, 5)} kW`] : null,
        r.state ? ["Temperature", fmtTemp(r.state.T_K, u, 2)] : null,
        r.state ? ["Pressure", fmtP(r.state.P_kPa, u)] : null,
        r.state ? ["Vapour fraction", fmtShort(r.state.VF, 4)] : null,
        ["Material balance", r.balance.material < 1e-9 ? "closed" : r.balance.material.toExponential(1)],
      ]), ...r.notes.map(n => h("div", { class: "fug-warn" }, n)));
    } else out.push(h("div", { class: "fa-empty" }, sol.status.blocks?.[f.sel.id]?.ok === false ? sol.status.blocks[f.sel.id].message : "Not calculated yet."));
  } else if (f.sel?.kind === "stream") {
    const s = res?.streams?.[f.sel.id];
    out.push(h("div", { class: "fug-eyebrow" }, `Stream ${f.sel.id}`));
    if (s) {
      out.push(kvList([
        ["Temperature", s.T_K == null ? "–" : fmtTemp(s.T_K, u, 2)], ["Pressure", s.P_kPa == null ? "–" : fmtP(s.P_kPa, u)],
        ["Vapour fraction", s.VF == null ? "–" : fmtShort(s.VF, 4)], ["Molar flow", `${fmtShort(s.F_kmol_h, 5)} kmol/h`],
        ["Mass flow", `${fmtShort(s.mass_kg_h, 5)} kg/h`], ["Enthalpy flow", `${fmtShort(s.H_kW, 5)} kW`],
        ...fs.components.map(c => [nameOf(c), `${fmtShort(s.flow_kmol_h[c], 5)} kmol/h`]),
      ]));
    } else out.push(h("div", { class: "fa-empty" }, "Not calculated yet."));
  } else {
    out.push(h("div", { class: "fug-eyebrow" }, "Flowsheet"),
      h("div", { class: `fa-dof ${sol.status.ready ? "is-ok" : "is-bad"}` }, sol.status.message));
    if (res) {
      const qin = Object.values(res.energy).filter(q => q.duty_kW > 0).reduce((a, q) => a + q.duty_kW, 0);
      const qout = Object.values(res.energy).filter(q => q.duty_kW < 0).reduce((a, q) => a + q.duty_kW, 0);
      out.push(kvList([
        ["Recycles", res.loops.length ? res.loops.map(l => `${l.tears.join(", ")}: ${l.iterations} iterations`).join("; ") : "none"],
        ["Heat in", `${fmtShort(qin, 5)} kW`], ["Heat out", `${fmtShort(-qout, 5)} kW`],
        ["Material balance", Object.values(res.balance.material_kmol_h).every(v => Math.abs(v) < 1e-6) ? "closed" : "check"],
        ["Energy balance", `${fmtShort(res.balance.energy_kW, 3)} kW`],
      ]), h("div", { class: "fug-foot" }, `Model: ${fs.thermo.model}${["PR", "SRK"].includes(fs.thermo.model) ? "" : `, ${fs.thermo.vapour} vapour`}. Model predictions, not measurements; the parameter sources are in Sources.`));
    }
  }
  return out;
}

function streamRows(fs, res, u, state) {
  const ids = fs.streams.map(s => s.id);
  const S = ids.map(id => res.streams[id]);
  const mass = state.basis === "mass";
  const rows = [
    ["From", "", ids.map(id => fs.streams.find(s => s.id === id).from.replace(".", " ")), "text"],
    ["To", "", ids.map(id => { const e = endOf(fs, id); return e.kind === "product" ? "product" : `${e.block} ${e.port}`; }), "text"],
    ["Temperature", u.T === "K" ? "K" : "°C", S.map(s => (s.T_K == null ? null : tToDisplay(s.T_K, u)))],
    ["Pressure", u.P, S.map(s => (s.P_kPa == null ? null : pToDisplay(s.P_kPa, u)))],
    ["Vapour fraction", "mol/mol", S.map(s => s.VF)],
    ["Molar flow", "kmol/h", S.map(s => s.F_kmol_h)],
    ["Mass flow", "kg/h", S.map(s => s.mass_kg_h)],
    ["Enthalpy flow", "kW", S.map(s => s.H_kW)],
    ...fs.components.map(c => [`Flow ${nameOf(c)}`, "kmol/h", S.map(s => s.flow_kmol_h[c])]),
    ...fs.components.map((c, i) => [mass ? `Mass fraction ${nameOf(c)}` : `Mole fraction ${nameOf(c)}`, mass ? "kg/kg" : "mol/mol",
      S.map(s => (s.F_kmol_h > 0 ? (mass ? s.flows[i] * molarMassOf(c) / s.mass_kg_h : s.z[i]) : null))]),
  ];
  return { ids, rows };
}
const molarMassOf = c => byId().get(c)?.MW ?? NaN;

function streamTable({ fs, res, u, state }) {
  const { ids, rows } = streamRows(fs, res, u, state);
  const fmt = v => (v == null || Number.isNaN(v) ? "–" : typeof v === "string" ? v : fmtShort(v, 5));
  const qs = Object.values(res.energy);
  return h("div", { class: "fs-tables" },
    h("h3", {}, "Streams"),
    h("div", { class: "fug-scroll" }, h("table", { class: "fa-table fa-stream" },
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Stream"), h("th", { scope: "col" }, "Unit"), ...ids.map(id => h("th", { scope: "col", class: "fug-num" }, id)))),
      h("tbody", {}, ...rows.map(([label, unit, vals]) => h("tr", {}, h("th", { scope: "row" }, label), h("td", {}, unit), ...vals.map(v => h("td", { class: "fug-num" }, fmt(v)))))))),
    qs.length ? h("h3", {}, "Energy streams") : null,
    qs.length ? h("table", { class: "fa-table" }, h("thead", {}, h("tr", {}, h("th", {}, "Stream"), h("th", {}, "Block"), h("th", { class: "fug-num" }, "Duty, kW"))),
      h("tbody", {}, ...qs.map(q => h("tr", {}, h("th", { scope: "row" }, q.id), h("td", {}, q.block), h("td", { class: "fug-num" }, `${q.duty_kW >= 0 ? "+" : "−"}${fmtShort(Math.abs(q.duty_kW), 5)}`))))) : null,
    h("p", { class: "fug-foot" }, "Duty: + heat in, − heat out. Enthalpy reference: each component as an ideal gas at 298.15 K."));
}

function csvTools(ctx, fs, res, u) {
  const { ids, rows } = streamRows(fs, res, u, ctx.state);
  const q = v => (v == null || Number.isNaN(v) ? "" : typeof v === "string" ? (/[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v) : String(Number(v.toPrecision(10))));
  const lines = [["Stream", "Unit", ...ids].join(","), ...rows.map(([l, unit, vals]) => [q(l), q(unit), ...vals.map(q)].join(",")), "",
    "Energy stream,Block,Duty kW", ...Object.values(res.energy).map(e => [e.id, e.block, q(e.duty_kW)].join(","))];
  const csv = lines.join("\r\n") + "\r\n";
  const status = h("div", { class: "fug-foot", "aria-live": "polite" }), box = h("div");
  const excel = () => {
    try {
      const bytes = flowsheetXlsx(fs, res, { version: pkg.version });
      const name = `${(ctx.state.title || "flowsheet").replace(/[\\/:*?"<>|]+/g, "-")}.xlsx`;
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = h("a", { href: url, download: name, style: "display:none" });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      status.textContent = `Saved ${name}: blue cells are inputs, black cells formulas, grey cells values from Fugacity (see its About sheet). If nothing was downloaded, the page does not allow downloads.`;
    } catch (e) { status.textContent = `The Excel file could not be made: ${e.message}`; }
  };
  return [h("div", { class: "fa-in-actions" },
    h("button", { type: "button", class: "fa-mini", "data-fk": "fs-xlsx", title: "An Excel workbook with the balances as formulas", on: { click: excel } }, icon("table", 15), "Download Excel"),
    h("button", { type: "button", class: "fa-mini", "data-fk": "fs-csv", on: { click: () => ctx.saveText(csv, "fugacity-flowsheet-streams.csv", "text/csv;charset=utf-8", status) } }, icon("download", 15), "Download CSV"),
    h("button", { type: "button", class: "fa-mini", "data-fk": "fs-csv-copy", on: { click: () => ctx.copyText(csv, status, box) } }, icon("copy", 15), "Copy CSV")), status, box];
}
