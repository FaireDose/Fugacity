/**
 * Workbench: Fugacity.app(target, config).
 *
 * Layout, from top to bottom:
 *  - the navigation bar: one tab per calculation task (Phase equilibrium, Flash, Gas solubility,
 *    Properties, Steam) and, on the right, the supporting utilities (Library, Sources,
 *    Settings), which open as a drawer over the workspace and never change it;
 *  - the toolbar of the active workspace: its diagrams, model and display options only;
 *  - the workspace: Inputs (the components the current diagram needs, each with its role,
 *    and the conditions), the canvas, and Results (readouts, calculators, sources);
 *  - the status bar.
 * Each workspace remembers its own inputs and settings (state.inputs, app-logic.js), and a
 * selection that does not fit is explained on the canvas instead of being changed.
 *
 * A view (layer 6): it calls only the layers below, through the same functions as the
 * public interface (system(), pure(), steam(), steamSat(), henry(), gasSolubility(),
 * listComponents(), PROPERTIES, library), and reuses the existing renderers (renderTxy,
 * renderTernary, the property explorer). State changes, the workspaces and the checks of
 * the inputs live in app-logic.js and workspaces.js (tested without a DOM).
 */
import { injectAppStyles } from "./app-styles.js";
import { h } from "./dom.js";
import { icon } from "./icons.js";
import { componentPicker } from "./component-picker.js";
import { listComponents } from "../thermo/system.js";
import { HENRY_GASES } from "../thermo/henry.js";
import { system } from "../system.js";
import {
  VIEWS, PRESETS, initialState, applyPatch, TIER_SHORT, fmtP, parseP, parseT, fmtTemp, pxyTemperature,
  RULES, ruleOf, setsFor, setChoices, pairKeyOf, modelLabel, feedbackLinks,
} from "./app-logic.js";
import { diagramXlsx, exportFileName } from "./diagram-export.js";
import { FUTURE_MODELS } from "./future-models.js";
import { WORKSPACES, SECTIONS, sectionOf, UTILITIES, INPUTS, checkInputs, examplesFor, rotateInputs, solventsFor, needsFor, isEosModel } from "./workspaces.js";
import { UNIT_CHOICES, explorerProperties, tToDisplay, pToDisplay, fmtShort } from "./properties-logic.js";
import { renderView, sourcesPanel, saveText, copyText } from "./app-views.js";
import { flowsheetRibbon, flowsheetInputs, ensureUi } from "./flowsheet-view.js";
import { projectOf, projectText, projectFileName, stateFromProject } from "./project.js";
import { browserStore, hostStore, autosave, lastAutosave, clearAutosave } from "./project-store.js";
import { FLASH_SPECS, FLOW_UNITS, feedComposition, convertBasis, flowIn } from "./flash-logic.js";
import { pure } from "../thermo/pure.js";
import { SOLID_UNITS } from "./solubility-units.js";
import pkg from "../../package.json" with { type: "json" };

const PROPERTY_GLYPHS = [
  ["density", () => "ρ", "Density"], ["enthalpy", () => "h", "Enthalpy"], ["cp", () => ["c", h("sub", {}, "p")], "Heat capacity"],
  ["viscosity", () => "μ", "Viscosity"], ["conductivity", () => "k", "Conductivity"], ["vapourPressure", () => ["P", h("sup", {}, "sat")], "Vapour pressure"],
];
const VIEW_ICON = { flash: "drum", txy: "txy", ternary: "ternary", azeotropes: "azeo", pxy: "pxy", envelope: "envelope", henry: "henry", solid: "flask", sle: "azeo", properties: "curves", steam: "dome" };
/** A label inside a sentence: "Ternary map" → "ternary map", but "T-x-y diagram" stays. */
const lower = s => (/^[A-Z]-/.test(s) ? s : s[0].toLowerCase() + s.slice(1));
const NEEDS_ACTIVITY = {
  txy: "Two liquids", ternary: "Three liquids", azeotropes: "Two to four liquids", pxy: "Two liquids",
  envelope: "Two to six liquids", flash: "Two to six liquids", henry: "A gas and a solvent", properties: "One component", steam: "Water",
  solid: "A solid and a solvent", sle: "Two components with melting data",
};
const NEEDS_EOS = {
  ...NEEDS_ACTIVITY, txy: "Two components", ternary: "Three components", azeotropes: "Two to four components", pxy: "Two components",
  envelope: "One to six components", flash: "One to six components",
};
/** What a view needs with the model in use (an equation of state takes gases too). */
const needsOf = (view, model) => (isEosModel(model) ? NEEDS_EOS : NEEDS_ACTIVITY)[view];

/**
 * Put the Fugacity workbench into a page element.
 *
 * The workbench has five workspaces, one per task: Phase equilibrium (T-x-y, ternary map,
 * azeotropes, P-x-y and phase envelope, each with the model chosen in the toolbar: an
 * activity model with a vapour model, or an equation of state), Flash (a feed flashed at
 * T and P, P and heat duty, or a vapour fraction, with the same model; stream table and CSV),
 * Gas solubility (Henry's law, a gas in a solvent), Properties (one pure component) and
 * Steam (IAPWS-IF97). Library, Sources and Settings open as a drawer over the workspace.
 * Each workspace keeps its own inputs: `components` seeds all of them (the first two liquids
 * for T-x-y, the first three for the ternary map, the first gas for Gas solubility, the
 * first component for Properties, ...).
 *
 * @param {string|HTMLElement} target  element or CSS selector
 * @param {object} [cfg]
 * @param {"ternary"|"txy"|"azeotropes"|"eos"|"pxy"|"envelope"|"henry"|"solid"|"sle"|"properties"|"steam"|"sources"} [cfg.start]
 *   first view (default: ternary for three liquids, T-x-y for two); "henry" opens the gas
 *   solubility, "solid" a solid in a solvent and "sle" the solid-liquid diagram (Solubility
 *   workspace; their components are set with update({ inputs: { solid: [solid, solvent], sle: [a, b] } }),
 *   the readout temperature with `sleT_K`), "sources" (or "library") opens the Sources panel over the
 *   first workspace
 * @param {string[]} [cfg.components]   up to six names, ids, formulas or CAS numbers
 *   (default methanol, acetone, chloroform)
 * @param {"NRTL"|"UNIQUAC"|"ideal"|"PR"|"SRK"} [cfg.model="NRTL"]  model of every phase-equilibrium diagram
 *   (default NRTL; an equation of state when `eos` or start "eos", "pxy" or "envelope" is given, or when gases need one)
 * @param {"PR"|"SRK"} [cfg.eos="PR"]    equation of state to use when one is chosen (as `model` when no `model` is given)
 * @param {"ideal"|"PR"|"SRK"} [cfg.vapour="ideal"]  vapour model with an activity model
 * @param {number} [cfg.P_kPa=101.325]   pressure of the activity-model diagrams
 * @param {number} [cfg.T_K]             temperature of the P-x-y diagram (default: 85 % of the lowest critical temperature)
 * @param {string} [cfg.gas]             gas of the Gas solubility workspace (default: the first gas in components, else oxygen)
 * @param {string} [cfg.solvent="water"] solvent of the Gas solubility workspace
 * @param {number} [cfg.henryT_K=298.15] temperature of the Gas solubility workspace
 * @param {number} [cfg.henryP_kPa=101.325]  gas partial pressure of the Gas solubility workspace
 * @param {boolean} [cfg.compareGases=false] also draw the other gases with a constant in the same solvent
 * @param {"mole"|"mass"|"g100g"|"gL"} [cfg.solidUnit="mole"] how the Solid view states the solubility: mole fraction,
 *   wt %, g per 100 g of solvent, or g per litre of solvent
 * @param {string} [cfg.propComponent]   component of the Properties workspace (default: the first of components)
 * @param {string} [cfg.property="density"]   property of the Properties workspace
 * @param {number[]} [cfg.steamP_kPa]   isobars of the steam chart, kPa (up to six)
 * @param {object} [cfg.units]           { T: "C"|"K", P: "bar"|"kPa", energy: "kJ/kg"|"J/mol", viscosity: "mPa s"|"Pa s" }
 * @param {"mole"|"mass"} [cfg.basis="mole"]  compositions in mole fractions or wt %
 * @param {boolean} [cfg.background=true]     show the background layers (colour map, isotherms, grid lines, two-liquid shading)
 * @param {{left?:boolean, right?:boolean}} [cfg.panels]  show the Inputs panel (left) and the Results panel (right)
 * @param {boolean} [cfg.ribbon=true]    show the toolbar of the workspace
 * @param {object} [cfg.flash]          Flash workspace: { spec: "TP"|"PH"|"PVF"|"TVF", T_K, P_kPa, VF, Q_J_mol,
 *   feedT_K, feedP_kPa, duty, z } (flash-logic.js); its components come from `components`
 * @param {Object<string,string>} [cfg.sets]  parameter set per pair, e.g. { "acetone+chloroform": "chemsep" }
 *   (update({ sets }) merges; a null set name, or sets: null, goes back to the default)
 * @param {"best"|"fitted"|"databank"|string[]} [cfg.prefer]  global rule (Library panel) or a list of tiers
 * @param {object|string} [cfg.project]  start from a project file (src/ui/project.js) instead of the keys above
 * @param {(project:object)=>void} [cfg.onSave]  also called with the project when the person saves it in the
 *   Project panel, so the page can keep it (browser or chat storage)
 * @returns {{state:object, update:(patch:object)=>void, save:()=>object, load:(project:object|string)=>void}}  `update` takes any configuration key and
 *   `workspace`, `view`, `inputs` (e.g. { ternary: ["water", "ethanol", "methanol"] }), `utility`
 *   ("library", "sources", "settings" or null), `z`, and the `tab` names of earlier versions;
 *   see applyPatch in app-logic.js
 *
 * @example
 * Fugacity.app("#app", { start: "ternary", components: ["methanol", "acetone", "chloroform"] });
 */
export function app(target, cfg = {}) {
  const root = typeof target === "string" ? document.querySelector(target) : target;
  if (!root) throw new Error(`Fugacity.app: no element matches "${target}".`);
  const doc = root.ownerDocument;
  injectAppStyles(doc);

  let state = cfg.project != null ? stateFromProject(cfg.project) : initialState(cfg);
  // where projects are kept besides files: this browser, and the host page's storage (project-store.js)
  const stores = [hostStore(cfg.storage), browserStore()].filter(st => st && st.available);
  // the automatic copy of the last session, offered back (never opened by itself)
  const useAutosave = cfg.autosave !== false;
  let previous = useAutosave && cfg.project == null ? lastAutosave() : null;
  let autosaveTimer = null;
  const uid = Math.random().toString(36).slice(2, 7);
  const all = listComponents();
  const byId = new Map(all.map(c => [c.id, c]));
  const nameOf = id => byId.get(id)?.name ?? id;
  const sizeOf = w => (w < 720 ? "narrow" : w < 1080 ? "mid" : "wide");
  const ui = {
    size: sizeOf(root.clientWidth || 1200), status: { busy: false, ms: null, error: null, info: null },
    sources: { query: "", kind: "all", mine: false }, opener: null, drawnUtility: null,
    lastWs: {},   // the workspace each section had open last
    records: {},   // the last result of a view that a project file keeps (the flash stream table), by view
    projectNote: "",
  };

  // ---- skeleton
  const box = h("div", { class: "fug fug-app" });
  const titleBar = h("header", { class: "fa-titlebar" });
  const ribbon = h("div", { class: "fa-ribbon", role: "toolbar", id: `fa-rib-${uid}` });
  const left = h("aside", { class: "fa-left", "aria-label": "Inputs", id: `fa-in-${uid}` });
  const canvasBar = h("div", { class: "fa-canvas-bar" });
  // Excel download of the diagram on the canvas: shown when the view has a data table (info.export)
  const excelBtn = h("button", { type: "button", class: "fa-mini fa-excel", "data-fk": "diagram-xlsx", hidden: true,
    title: "Download the numbers of this diagram as an Excel workbook: every point drawn, in the units shown",
    on: { click: () => exportDiagram() } }, icon("table", 15), "Excel");
  const notes = h("div", { class: "fa-notes" });
  const plot = h("div", { class: "fug-plot fa-plot" });
  const below = h("div", { class: "fa-below" });
  const canvas = h("main", { class: "fa-canvas" }, canvasBar, notes, plot, below);
  const side = h("div", { class: "fug-side fa-readout", "aria-live": "polite" });
  const inspectorExtra = h("div", { class: "fa-inspector-extra" });
  const provenance = h("div", { class: "fa-provenance" });
  const right = h("aside", { class: "fa-right", "aria-label": "Results" },
    h("div", { class: "fa-panel-head" }, h("h2", {}, "Results"), provenance), side, inspectorExtra);
  const statusBar = h("div", { class: "fa-status", role: "status" });
  const body = h("div", { class: "fa-body" }, left, canvas, right);
  const drawer = h("section", { class: "fa-drawer", role: "dialog", id: `fa-drawer-${uid}`, tabindex: "-1",
    "aria-labelledby": `fa-dt-${uid}`, "aria-describedby": `fa-dd-${uid}` });
  const layer = h("div", { class: "fa-layer", hidden: true },
    h("div", { class: "fa-scrim", "aria-hidden": "true", on: { click: () => set({ utility: null }, { canvas: false }) } }), drawer);
  const subnav = h("nav", { class: "fa-subnav", "aria-label": "Workspaces of the section" });
  const stage = h("div", { class: "fa-stage" }, subnav, ribbon, body, statusBar, layer);
  box.append(titleBar, stage);
  root.replaceChildren(box);

  // Escape closes the open panel (from anywhere in the workbench)
  box.addEventListener("keydown", ev => {
    if (ev.key === "Escape" && state.utility && !ev.defaultPrevented) { ev.preventDefault(); set({ utility: null }, { canvas: false }); }
  });

  // ---- size classes (the container, not the window: artifacts can be narrow on a wide screen)
  const measure = () => {
    const size = sizeOf(root.clientWidth || 1200);
    if (size !== ui.size) {
      ui.size = size;
      box.dataset.size = size;
      const fk = focusKey();
      renderChrome(true);
      restoreFocus(fk);
      if (canvasRendered) renderCanvas(true);
    }
  };
  box.dataset.size = ui.size;
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(measure).observe(root);

  // ---- focus: controls carry data-fk, so focus survives a redraw of the chrome
  function focusKey() {
    const a = doc.activeElement;
    return a && box.contains(a) ? a.closest("[data-fk]")?.dataset.fk ?? null : null;
  }
  function restoreFocus(fk) {
    if (!fk) return false;
    const el = box.querySelector(`[data-fk="${fk.replace(/["\\]/g, "\\$&")}"]`);
    if (!el || el.closest("[inert]") || el.closest("[hidden]")) return false;
    if (doc.activeElement !== el) el.focus();
    return true;
  }

  // ---- state changes
  function set(patch, { canvas: redraw = true } = {}) {
    if (useAutosave && Object.keys(patch).some(k => k !== "utility" && k !== "panels" && k !== "ribbon")) scheduleAutosave();
    const fk = focusKey();
    const util0 = state.utility;
    state = applyPatch(state, patch);
    api.state = state;
    renderChrome();
    // redraw when what the canvas shows differs from what it last drew (also for changes made
    // to `ui` just before this call, such as the flowsheet's selection or zoom)
    if (redraw && canvasKey() !== ui.drawnKey) renderCanvas();
    if (state.utility !== util0) {
      if (state.utility) {
        if (!util0) ui.opener = fk;
        drawer.focus({ preventScroll: true }); // the navigation bar stays in view
      } else if (!restoreFocus(fk) && !restoreFocus(ui.opener)) restoreFocus(`util-${util0}`);
    } else restoreFocus(fk);
  }

  /** Keep a copy of the open work in this browser a moment after it changes (and when the page is left). */
  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(flushAutosave, 800);
  }
  function flushAutosave() {
    if (autosaveTimer == null) return;
    clearTimeout(autosaveTimer); autosaveTimer = null;
    previous = null;
    autosave(projectText(currentProject()));
  }
  if (useAutosave && typeof window !== "undefined") window.addEventListener("pagehide", flushAutosave);

  // ---- controls
  function bigButton({ ico, label, pressed, title, onClick, fk, note }) {
    return h("button", { type: "button", class: "fa-btn fa-big", "aria-pressed": pressed == null ? undefined : String(!!pressed),
      title, "data-fk": fk ?? `big-${label}`, on: { click: onClick } }, icon(ico, 26), h("span", {}, label), note ? h("small", {}, note) : null);
  }
  function smallButton({ ico, label, pressed, disabled, title, onClick, glyph, fk }) {
    return h("button", { type: "button", class: "fa-btn fa-small", "aria-pressed": pressed == null ? undefined : String(!!pressed),
      disabled: !!disabled, title, "data-fk": fk ?? `small-${label}`, on: { click: onClick } },
      glyph ? h("span", { class: "fa-glyph", "aria-hidden": "true" }, glyph()) : icon(ico, 18), h("span", {}, label));
  }
  function seg(label, choices, current, onPick, { disabled = false, title } = {}) {
    return h("div", { class: "fug-seg fa-seg", role: "group", "aria-label": label, title },
      ...choices.map(([v, text]) => h("button", { type: "button", "aria-pressed": String(current === v), disabled, "data-fk": `seg-${label}-${v}`, on: { click: () => onPick(v) } }, text)));
  }
  function group(label, ...children) {
    return h("div", { class: "fa-group", role: "group", "aria-label": label },
      h("div", { class: "fa-group-body" }, ...children), h("div", { class: "fa-group-label" }, label));
  }
  const stack = (...children) => h("div", { class: "fa-stack" }, ...children);
  function field(label, value, onCommit, { id, width = "7em", title, hint } = {}) {
    const inp = h("input", { type: "text", inputmode: "decimal", id: `fa-${id}-${uid}`, value, style: `width:${width}`, title, "data-fk": `field-${id}`,
      on: { change: ev => { if (onCommit(ev.target.value) === false) ev.target.value = value; } } });
    return h("label", { class: "fa-field", for: inp.id }, h("span", {}, label, hint ? h("small", {}, hint) : null), inp);
  }
  const pressureField = () => field(`Pressure, ${state.units.P}`, fmtShort(pToDisplay(state.P_kPa, state.units), 6),
    t => { const v = parseP(t, state.units); if (v == null) return false; set({ P_kPa: v }); }, { id: "p" });

  // ---- navigation bar: workspaces, then the supporting utilities
  function renderTitleBar() {
    // File (save and open: the Project panel) first, then the sections; the supporting panels on the right
    const proj = UTILITIES.find(u => u.id === "project");
    const file = h("button", { type: "button", class: "fa-nav-btn fa-file-btn", "aria-expanded": String(state.utility === "project"), "aria-controls": drawer.id,
      "aria-haspopup": "dialog", "data-fk": "util-project", title: proj.intro, "aria-label": "File: save and open projects",
      on: { click: () => set({ utility: state.utility === "project" ? null : "project" }, { canvas: false }) } },
      icon("file", 18), h("span", { class: "fa-nav-long" }, "File"), h("span", { class: "fa-nav-short", "aria-hidden": "true" }, "File"));
    const current = sectionOf(state.workspace);
    const nav = h("nav", { class: "fa-nav", "aria-label": "Sections" }, file, ...SECTIONS.map(sec => h("button", {
      type: "button", class: "fa-nav-btn", "aria-current": current === sec.id ? "page" : undefined, "data-fk": `sec-${sec.id}`,
      "aria-label": sec.label, on: { click: () => {
        const ws = ui.lastWs[sec.id] && sec.workspaces.includes(ui.lastWs[sec.id]) ? ui.lastWs[sec.id] : sec.workspaces[0];
        set({ workspace: ws, utility: null });
      } } },
      icon(sec.icon, 18), h("span", { class: "fa-nav-long" }, sec.label), h("span", { class: "fa-nav-short", "aria-hidden": "true" }, sec.short ?? sec.label))));
    const utils = h("div", { class: "fa-utils", role: "group", "aria-label": "Supporting tools" }, ...UTILITIES.filter(u => u.id !== "project").map(u => h("button", {
      type: "button", class: "fa-util-btn", "aria-expanded": String(state.utility === u.id), "aria-controls": drawer.id, "aria-haspopup": "dialog",
      "data-fk": `util-${u.id}`, title: u.intro, "aria-label": u.label,
      on: { click: () => {
        if (u.id === "sources") ui.sources.mine = false; // the general browser starts with every source
        set({ utility: state.utility === u.id ? null : u.id }, { canvas: false });
      } } },
      icon(u.icon, 17), h("span", { class: "fa-util-label" }, u.label))));
    titleBar.replaceChildren(
      h("div", { class: "fa-brand" }, icon("logo", 22), h("span", { class: "fa-name" }, "Fugacity")),
      nav, utils,
      h("button", { type: "button", class: "fa-icon-btn fa-collapse", title: state.ribbon ? "Hide the toolbar" : "Show the toolbar",
        "aria-label": state.ribbon ? "Hide the toolbar" : "Show the toolbar", "aria-expanded": String(state.ribbon), "aria-controls": ribbon.id, "data-fk": "collapse",
        on: { click: () => set({ ribbon: !state.ribbon }, { canvas: false }) } }, icon(state.ribbon ? "chevronUp" : "chevronDown", 16)));
    // the second row: the workspaces of the section, and the models not available yet
    const sec = SECTIONS.find(x => x.id === current);
    ui.lastWs[current] = state.workspace;
    const tabs = sec ? [...sec.workspaces.map(id => WORKSPACES.find(w => w.id === id)), ...(sec.locked ?? []).map(l => ({ ...l, isLocked: true }))] : [];
    subnav.hidden = tabs.length < 2;
    subnav.replaceChildren(...tabs.map(w => w.isLocked
      ? h("span", { class: "fa-sub-btn is-locked", title: w.note, "aria-disabled": "true", role: "link" }, icon("lock", 15), h("span", {}, w.label), h("small", {}, "not available yet"))
      : h("button", { type: "button", class: "fa-sub-btn", "aria-current": state.workspace === w.id ? "page" : undefined, "data-fk": `ws-${w.id}`,
        on: { click: () => set({ workspace: w.id, utility: null }) } }, icon(w.icon, 16), h("span", {}, w.label))));
  }

  // ---- toolbar of the workspace: diagrams, model and display options
  function diagramButton(view, label) {
    return bigButton({ ico: VIEW_ICON[view], label, pressed: state.view === view, title: `${VIEWS[view].label}: ${needsOf(view, state.model).toLowerCase()}`,
      fk: `diagram-${view}`, onClick: () => set({ view }) });
  }
  /** Models on the roadmap: locked chips with what each is for (FUTURE_MODELS). */
  const lockedChips = list => list.map(m => h("span", { class: "fa-locked-chip", title: m.note, "aria-disabled": "true", "data-fk": `later-${m.id}` },
    icon("lock", 11), m.label));
  /** One labelled row of the Model group: a caption and its choices. */
  const modelRow = (caption, label, choices, current, onPick) =>
    h("div", { class: "fa-model-row" }, h("span", { class: "fa-model-cap", "aria-hidden": "true" }, caption), seg(label, choices, current, onPick));
  /**
   * The Model group: the activity models, with their vapour model as a smaller sub-row (it
   * belongs to them: the liquid from γ, the vapour from an ideal gas or a cubic equation),
   * then the equations of state, which describe both phases. The vapour row stays in place,
   * dimmed and disabled, while an equation of state is chosen.
   */
  function modelGroup() {
    const eos = isEosModel(state.model);
    const hint = eos
      ? `${state.model === "PR" ? "Peng–Robinson" : "SRK"} for liquid and vapour; k_ij from the databank`
      : `${state.model === "ideal" ? "Liquid γ = 1" : `Liquid γ from ${state.model}`}; ${state.vapour === "ideal" ? "ideal-gas vapour" : `${state.vapour} vapour with φsat and Poynting`}`;
    return group("Model", h("div", { class: "fa-stack fa-models" },
      h("div", { class: "fa-model-family" + (eos ? "" : " is-on") },
        modelRow("Activity", "Activity model (liquid)", [["NRTL", "NRTL"], ["UNIQUAC", "UNIQUAC"], ["ideal", "Ideal"]], eos ? null : state.model, m => set({ model: m })),
        h("div", { class: "fa-model-row fa-model-sub" + (eos ? " is-off" : "") },
          h("span", { class: "fa-model-cap", "aria-hidden": "true" }, "vapour"),
          seg("Vapour model of the activity model", [["ideal", "Ideal gas"], ["PR", "PR"], ["SRK", "SRK"]], state.vapour, m => set({ vapour: m }),
            { disabled: eos, title: eos ? "The vapour model belongs to the activity models; an equation of state describes the vapour itself" : undefined }))),
      h("div", { class: "fa-model-family" + (eos ? " is-on" : "") },
        modelRow("EOS", "Equation of state (both phases)", [["PR", "Peng–Robinson"], ["SRK", "SRK"]], eos ? state.model : null, m => set({ model: m }))),
      h("div", { class: "fa-model-row fa-model-later", role: "note", "aria-label": "Models not available yet" },
        h("span", { class: "fa-model-cap", "aria-hidden": "true" }, "later"), ...lockedChips([...FUTURE_MODELS.activity, ...FUTURE_MODELS.eos])),
      h("div", { class: "fa-hint" }, hint)));
  }
  function ribbonGroups() {
    const u = state.units, v = state.view;
    const bg = smallButton({ ico: "layers", label: "Background", pressed: state.background, fk: "bg",
      title: "Show or hide the colour map, isotherms, grid lines and two-liquid shading", onClick: () => set({ background: !state.background }, { canvas: false }) });
    switch (state.workspace) {
      case "equilibrium": return [
        group("Diagrams", diagramButton("txy", "T-x-y"), diagramButton("pxy", "P-x-y"), diagramButton("ternary", "Ternary map"),
          diagramButton("azeotropes", "Azeotropes"), diagramButton("envelope", "Phase envelope")),
        modelGroup(),
        group("Display", stack(
          ...(v === "ternary" ? [
            smallButton({ ico: "residue", label: "Residue curves", pressed: state.residueCurves, onClick: () => set({ residueCurves: !state.residueCurves }) }),
            smallButton({ ico: "isotherm", label: "Isotherms", pressed: state.isotherms, onClick: () => set({ isotherms: !state.isotherms }) }),
            h("label", { class: "fa-field", for: `fa-grid-${uid}` }, h("span", {}, "Map resolution"),
              h("select", { id: `fa-grid-${uid}`, "data-fk": "grid", on: { change: ev => set({ grid: +ev.target.value }) } },
                ...[[24, "Coarse"], [40, "Normal"], [60, "Fine"]].map(([g, t]) => h("option", { value: g, selected: state.grid === g }, t)))),
          ] : []), bg)),
        group("Composition", seg("Composition basis", [["mole", "mol frac"], ["mass", "wt %"]], state.basis, b => set({ basis: b }))),
      ];
      case "flash": return [
        group("Specification", h("div", { class: "fa-stack" },
          seg("Flash specification", FLASH_SPECS.map(f => [f.id, f.label]), state.flash.spec, sp => set({ flash: { spec: sp } })),
          h("div", { class: "fa-hint" }, FLASH_SPECS.find(f => f.id === state.flash.spec).title))),
        modelGroup(),
        group("Composition", seg("Composition basis", [["mole", "mol frac"], ["mass", "wt %"]], state.basis, b => set({ basis: b }))),
      ];
      case "solubility": {
        const views = group("Views", diagramButton("henry", "Gas"), diagramButton("solid", "Solid"), diagramButton("sle", "Solid-liquid"));
        if (v === "henry") return [views,
          group("Model", h("div", { class: "fa-stack fa-about" },
            h("div", { class: "fa-theme" }, icon("henry", 18), "Henry's law, x = p / H"),
            h("div", { class: "fa-hint" }, "Dilute solutions at low to moderate pressure"))),
          group("Display", stack(
            smallButton({ ico: "curves", label: "Compare with the other gases", pressed: state.compareGases, fk: "compare",
              title: "Also draw the other gases with a Henry's law constant in the same solvent", onClick: () => set({ compareGases: !state.compareGases }) }), bg)),
        ];
        // solids: a pure solid in equilibrium with the liquid; γ from an activity model (or 1: the ideal solubility)
        return [views,
          group("Liquid model", h("div", { class: "fa-stack" },
            seg("Liquid model", [["NRTL", "NRTL"], ["UNIQUAC", "UNIQUAC"], ["ideal", "Ideal"]], isEosModel(state.model) ? null : state.model, m => set({ model: m })),
            h("div", { class: "fa-hint" }, "ln(x γ) = −(ΔH_fus / R T)(1 − T / T_m); pure solid, ΔCp = 0"))),
          v === "solid"
            ? group("Solubility as", seg("Solubility unit", SOLID_UNITS.map(su => [su.id, su.label]), state.solidUnit, su => set({ solidUnit: su })))
            : group("Composition", seg("Composition basis", [["mole", "mol frac"], ["mass", "wt %"]], state.basis, b => set({ basis: b }))),
        ];
      }
      case "properties": {
        const more = explorerProperties().filter(p => !PROPERTY_GLYPHS.some(g => g[0] === p.key));
        return [
          group("Property", h("div", { class: "fa-cols fa-cols-3" }, ...PROPERTY_GLYPHS.map(([key, glyph, label]) => smallButton({
            glyph, label, pressed: state.property === key, onClick: () => set({ property: key }),
          })))),
          group("More correlations", h("div", { class: "fa-stack" },
            h("label", { class: "fa-field", for: `fa-pm-${uid}` }, h("span", {}, "Function of T only"),
              h("select", { id: `fa-pm-${uid}`, "data-fk": "more", on: { change: ev => { if (ev.target.value) set({ property: ev.target.value }); } } },
                h("option", { value: "" }, "Choose…"),
                ...more.map(p => h("option", { value: p.key, selected: state.property === p.key }, p.label)))))),
          group("Energy basis", seg("Energy basis", UNIT_CHOICES.basis, u.basis, b => set({ units: { basis: b } }))),
        ];
      }
      case "flowsheet": return flowsheetRibbon({ state, set, ui, group, bigButton, smallButton });
      case "steam": return [
        group("Standard", h("div", { class: "fa-stack fa-about" },
          h("div", { class: "fa-theme" }, icon("dome", 18), "IAPWS-IF97 water and steam"),
          h("div", { class: "fa-hint" }, "Viscosity IAPWS R12-08, conductivity R15-11"))),
        group("Display", stack(bg)),
      ];
      default: return [];
    }
  }

  // ---- Inputs panel: what the current view needs, each with its role
  /** True while no component is chosen for a view that takes them (the workbench opened empty):
   *  the inputs then show a neutral start hint instead of problems. */
  function blank(view) {
    const value = state.inputs[view];
    return Array.isArray(value) && view !== "steam" && !value.some(Boolean);
  }

  /** How a component appears in the pickers of a view: a note, and whether it can be chosen (liquids only). */
  function pickStatus(view, slot) {
    const spec = needsFor(view, state.model), value = state.inputs[view];
    const usedElsewhere = new Map((Array.isArray(value) ? value : []).map((id, i) => [id, i]).filter(([id, i]) => id && i !== slot));
    return c => {
      const bad = spec.liquid && !c.activity;
      const noMelt = !bad && spec.solid?.includes(slot) && !c.fusion;
      const other = usedElsewhere.get(c.id);
      return { disabled: bad || noMelt, note: bad ? "gas: equation of state only" : noMelt ? "no melting data" : other != null ? `also component ${other + 1}` : null };
    };
  }

  function slotsInput(view, check) {
    const spec = needsFor(view, state.model), value = state.inputs[view];
    const bad = new Map(blank(view) ? [] : check.problems.filter(p => p.slot != null).map(p => [p.slot, p.message]));
    return h("div", { class: "fa-slots" }, ...value.map((id, i) => {
      const sid = `fa-slot-${view}-${i}-${uid}`;
      const picker = componentPicker({
        id: sid, fk: `slot-${view}-${i}`, label: spec.n > 1 ? `Component ${i + 1}` : "Component", components: all, value: id,
        placeholder: spec.liquid ? "Liquid: name, formula, CAS…" : "Name, formula, CAS…",
        status: pickStatus(view, i), invalid: bad.has(i), describedBy: bad.has(i) ? `fa-problems-${uid}` : undefined,
        onPick: pid => { if (!pid) return; const next = value.slice(); next[i] = pid; set({ inputs: { [view]: next } }); },
      });
      return h("div", { class: "fa-slot" + (bad.has(i) ? " is-bad" : "") + (spec.n === 1 ? " is-single" : "") },
        h("label", { for: sid },
          spec.n > 1 ? h("span", { class: "fa-chip-n", "aria-hidden": "true" }, String(i + 1)) : null,
          h("span", { class: "fa-slot-name" }, spec.n > 1 ? `Component ${i + 1}` : "Component"),
          spec.n > 1 ? h("span", { class: "fa-slot-role" }, spec.roles[i]) : null),
        picker);
    }));
  }

  function listInput(view) {
    const spec = needsFor(view, state.model), value = state.inputs[view];
    const chips = value.map((id, i) => h("li", { class: "fa-chip" },
      h("span", { class: "fa-chip-n", "aria-hidden": "true" }, String(i + 1)),
      h("span", { class: "fa-chip-name" }, nameOf(id)),
      h("span", { class: "fa-chip-f" }, byId.get(id)?.formula ?? ""),
      h("button", { type: "button", class: "fa-x", "aria-label": `Remove ${nameOf(id)}`, title: "Remove", "data-fk": `rm-${view}-${i}`,
        on: { click: () => set({ inputs: { [view]: value.filter((_, k) => k !== i) } }) } }, icon("close", 14))));
    const full = value.length >= spec.max;
    const addId = `fa-add-${view}-${uid}`;
    const add = componentPicker({
      id: addId, fk: `add-${view}`, label: "Add a component", disabled: full, clearOnPick: true,
      components: all.filter(c => !value.includes(c.id)), status: pickStatus(view, -1),
      placeholder: full ? `Full: at most ${spec.max}` : spec.liquid ? "Add a liquid: name, formula, CAS…" : "Add: name, formula, CAS…",
      onPick: pid => { if (pid) set({ inputs: { [view]: [...value, pid] } }); },
    });
    return h("div", { class: "fa-list" },
      value.length ? h("ol", { class: "fa-chips", "aria-label": "Chosen components" }, ...chips) : h("div", { class: "fa-empty" }, "None chosen yet."),
      h("div", { class: "fa-add" }, h("label", { class: "fa-visually-hidden", for: addId }, "Add a component"), add));
  }

  function problemsBox(check) {
    return h("div", { class: "fa-problems", id: `fa-problems-${uid}`, "aria-live": "polite" },
      ...(check.ok || blank(state.view) ? [] : [h("ul", {}, ...check.problems.map(p => h("li", {}, p.message)))]));
  }

  function inputsSection(title, ...children) {
    return h("section", { class: "fa-in-sec" }, h("h3", {}, title), ...children);
  }

  function renderLeft() {
    const v = state.view, spec = needsFor(v, state.model), check = checkInputs(v, state.inputs[v], state.model);
    const u = state.units;
    const secs = [];
    if (state.workspace === "equilibrium") {
      const value = state.inputs[v];
      const examples = examplesFor(v, PRESETS, state.model);
      const actions = [];
      if (spec.kind === "slots") {
        actions.push(h("button", { type: "button", class: "fa-mini", "data-fk": "act-order",
          title: spec.n === 3 ? "Move the first component to the end (turns the ternary diagram)" : "Swap the two components",
          on: { click: () => set({ inputs: { [v]: rotateInputs(value) } }) } }, icon(spec.n === 3 ? "rotate" : "swap", 15), spec.n === 3 ? "Rotate" : "Swap"));
      }
      if (examples.length) {
        actions.push(h("select", { class: "fa-examples", "aria-label": "Load an example", "data-fk": "examples",
          on: { change: ev => { const p = examples[+ev.target.value]; if (p) set({ inputs: { [v]: p.components } }); } } },
          h("option", { value: "" }, "Examples…"), ...examples.map((p, i) => h("option", { value: i }, p.label))));
      }
      secs.push(inputsSection(`Components`,
        h("p", { class: "fa-in-hint" }, `${needsOf(v, state.model)} for the ${lower(VIEWS[v].label)}${spec.kind === "slots" && spec.n === 3 ? ", in corner order" : ""}.`),
        spec.kind === "slots" ? slotsInput(v, check) : listInput(v),
        problemsBox(check),
        actions.length ? h("div", { class: "fa-in-actions" }, ...actions) : null));
      if (v === "txy" || v === "ternary" || v === "azeotropes") secs.push(inputsSection("Conditions", pressureField()));
      else if (v === "pxy") {
        secs.push(inputsSection("Conditions",
          field(`Temperature, ${u.T === "K" ? "K" : "°C"}`, check.ok ? String(+tToDisplay(pxyTemperature(state), u).toFixed(3)) : "",
            t => { if (String(t).trim() === "") { set({ T_K: null }); return; } const val = parseT(t, u); if (val == null) return false; set({ T_K: val }); },
            { id: "t", title: "Temperature of the P-x-y diagram. Leave empty for 85 % of the lowest critical temperature." }),
          h("p", { class: "fa-in-hint" }, state.T_K == null ? "Automatic: 85 % of the lowest critical temperature. Type a value to set it." : "Clear the field for the automatic temperature.")));
      } else {
        secs.push(inputsSection("Conditions", h("p", { class: "fa-in-hint" }, "The feed composition, and the temperature and pressure of the bubble and dew points, are set in the calculator under Results.")));
      }
      if (check.ok) { const pairs = pairRows(check.use); if (pairs) secs.push(pairs); }
    } else if (state.workspace === "flash") {
      secs.push(inputsSection("Components",
        h("p", { class: "fa-in-hint" }, `${needsOf("flash", state.model)} in the feed.`),
        listInput("flash"), problemsBox(check),
        examplesFor("flash", PRESETS, state.model).length ? h("div", { class: "fa-in-actions" }, h("select", { class: "fa-examples", "aria-label": "Load an example", "data-fk": "examples",
          on: { change: ev => { const p = examplesFor("flash", PRESETS, state.model)[+ev.target.value]; if (p) set({ inputs: { flash: p.components } }); } } },
          h("option", { value: "" }, "Examples…"), ...examplesFor("flash", PRESETS, state.model).map((p, i) => h("option", { value: i }, p.label)))) : null));
      if (check.ok) secs.push(feedSection(check.use), specSection());
      if (check.ok) { const pairs = pairRows(check.use); if (pairs) secs.push(pairs); }
    } else if (state.workspace === "solubility" && (v === "solid" || v === "sle")) {
      secs.push(inputsSection(v === "solid" ? "Solid and solvent" : "Components",
        h("p", { class: "fa-in-hint" }, v === "solid"
          ? "The solid that dissolves (it needs a melting temperature and enthalpy of fusion) and the liquid solvent."
          : "Two components that crystallize as pure solids (both need melting data); x is the mole fraction of the first."),
        slotsInput(v, check), problemsBox(check),
        h("div", { class: "fa-in-actions" }, h("button", { type: "button", class: "fa-mini", "data-fk": "act-order", title: "Swap the two components",
          on: { click: () => set({ inputs: { [v]: rotateInputs(state.inputs[v]) } }) } }, icon("swap", 15), "Swap"))));
      secs.push(inputsSection("Conditions",
        field(`Temperature, ${u.T === "K" ? "K" : "°C"}`, String(+tToDisplay(state.sleT_K, u).toFixed(2)),
          t => { const val = parseT(t, u); if (val == null) return false; set({ sleT_K: val }); },
          { id: "slet", title: v === "solid" ? "Temperature of the readout: the solubility there" : "Temperature of the readout: the liquid compositions where each solid starts to crystallize" })));
      if (check.ok) { const pairs = pairRows(check.use); if (pairs) secs.push(pairs); }
    } else if (state.workspace === "solubility") {
      const { gas, solvent } = state.inputs.henry;
      const bad = new Map(check.problems.map(p => [p.slot, p.message]));
      // every component is listed; those without a Henry's law constant (for this gas) say so and cannot be picked
      const gasSel = componentPicker({
        id: `fa-gas-${uid}`, fk: "gas", label: "Gas", components: all, value: gas, invalid: bad.has(0),
        status: c => (HENRY_GASES.includes(c.id) ? {} : { disabled: true, note: "no Henry's law constant" }),
        group: c => (HENRY_GASES.includes(c.id) ? "With Henry's law constants" : "Others"),
        onPick: g => { if (g) set({ gas: g }); },
      });
      const solvents = solventsFor(HENRY_GASES.includes(gas) ? gas : null);
      const solvSel = componentPicker({
        id: `fa-solv-${uid}`, fk: "solvent", label: "Solvent", components: all.filter(c => c.activity || solvents.includes(c.id)), value: solvent,
        invalid: bad.has(1),
        status: c => (solvents.includes(c.id) ? {} : { disabled: true, note: "no constant for this gas" }),
        group: c => (solvents.includes(c.id) ? "With a constant for this gas" : "Others"),
        onPick: v => { if (v) set({ solvent: v }); },
      });
      secs.push(inputsSection("Gas and solvent",
        h("div", { class: "fa-slots" },
          h("div", { class: "fa-slot is-single" + (bad.has(0) ? " is-bad" : "") }, h("label", { for: gasSel.id }, h("span", { class: "fa-slot-name" }, "Gas"), h("span", { class: "fa-slot-role" }, "dissolved")), gasSel),
          h("div", { class: "fa-slot is-single" + (bad.has(1) ? " is-bad" : "") }, h("label", { for: solvSel.id }, h("span", { class: "fa-slot-name" }, "Solvent"), h("span", { class: "fa-slot-role" }, "liquid")), solvSel)),
        problemsBox(check),
        h("p", { class: "fa-in-hint" }, `The databank has Henry's law constants for ${HENRY_GASES.length} gases in ${solventsFor(null).map(s => nameOf(s).toLowerCase()).join(", ")}.`)));
      secs.push(inputsSection("Conditions",
        field(`Temperature, ${u.T === "K" ? "K" : "°C"}`, String(+tToDisplay(state.henryT_K, u).toFixed(2)),
          t => { const val = parseT(t, u); if (val == null) return false; set({ henryT_K: val }); }, { id: "ht" }),
        field(`Gas partial pressure, ${u.P}`, fmtShort(pToDisplay(state.henryP_kPa, u), 6),
          t => { const val = parseP(t, u); if (val == null) return false; set({ henryP_kPa: val }); }, { id: "hp", title: "Partial pressure of the gas over the solution" })));
    } else if (state.workspace === "properties") {
      const id = state.inputs.properties[0];
      secs.push(inputsSection("Component",
        h("p", { class: "fa-in-hint" }, "One pure component. Its constants and sources are listed under Results."),
        slotsInput("properties", check), problemsBox(check)));
    } else if (state.workspace === "flowsheet") {
      secs.push(...flowsheetInputs({ state, set, ui, uid, inputsSection }));
    } else if (state.workspace === "steam") {
      secs.push(inputsSection("Substance", h("div", { class: "fa-fixed" }, h("b", {}, "Water"), h("span", { class: "fa-chip-f" }, "H2O")),
        h("p", { class: "fa-in-hint" }, "IAPWS-IF97 covers water and steam only.")));
      secs.push(inputsSection("Isobars",
        field(`Pressures, ${u.P}`, state.steamP_kPa.map(P => fmtShort(pToDisplay(P, u), 6)).join(", "),
          t => { const list = String(t).split(/[\s,;]+/).map(x => parseP(x, u)).filter(x => x != null); if (!list.length) return false; set({ steamP_kPa: list }); },
          { id: "sp", width: "100%", title: "Up to six pressures, separated by commas" }),
        h("p", { class: "fa-in-hint" }, "Up to six, separated by commas.")));
    }
    left.replaceChildren(h("div", { class: "fa-panel-head" }, h("h2", {}, "Inputs"), h("span", { class: "fa-count" }, VIEWS[v].label)), ...secs);
  }

  // ---- Flash workspace: the feed composition (in the display basis) and the specification
  function feedSection(ids) {
    const f = state.flash, mass = state.basis === "mass";
    const MW = ids.map(id => pure(id).MW);
    const z = feedComposition(f, ids.length);
    const shown = mass ? convertBasis(z, MW, true).map(v => 100 * v) : z;
    const commit = (k, text) => {
      const v = Number(String(text).trim().replace(",", "."));
      if (!(v >= 0) || !Number.isFinite(v)) return false;
      const next = shown.slice(); next[k] = v;
      if (!(next.reduce((a, b) => a + b, 0) > 0)) return false;
      set({ flash: { z: mass ? convertBasis(next, MW) : next } });
    };
    const total = shown.reduce((a, b) => a + b, 0);
    return inputsSection(`Feed, ${mass ? "wt %" : "mole fractions"}`,
      h("div", { class: "fa-flow" },
        field("Feed flow", fmtShort(f.flow, 6), x => { const v = Number(String(x).trim().replace(",", ".")); if (!(v > 0) || !Number.isFinite(v)) return false; set({ flash: { flow: v } }); },
          { id: "fflow", title: "For the stream and component flows and the heat duty in kW; the flash itself is per mole of feed" }),
        // a new unit keeps the same flow (6 significant digits), it does not relabel the number
        seg("Feed flow unit", FLOW_UNITS.map(x => [x, x]), f.flowUnit, x => {
          if (x === f.flowUnit) return;
          const MWmix = z.reduce((a, v, i) => a + v * MW[i], 0);
          set({ flash: { flowUnit: x, flow: +flowIn(f, x, MWmix).toPrecision(6) } });
        })),
      h("div", { class: "fa-feed" }, ...ids.map((id, k) => field(nameOf(id), fmtShort(+shown[k].toPrecision(6), 6), t => commit(k, t), { id: `fz${k}`, width: "6em" }))),
      h("p", { class: "fa-in-hint" }, `Normalized to ${mass ? "100 wt %" : "1"} (now ${fmtShort(+total.toPrecision(6), 6)}).`,
        " ", h("button", { type: "button", class: "fa-link-btn", "data-fk": "feed-eq", on: { click: () => set({ flash: { z: null } }) } }, "Equimolar")));
  }
  function specSection() {
    const f = state.flash, u = state.units, sp = FLASH_SPECS.find(x => x.id === f.spec);
    const tLab = `Temperature, ${u.T === "K" ? "K" : "°C"}`;
    const tField = (label, key, id) => field(label, String(+tToDisplay(f[key], u).toFixed(3)),
      x => { const v = parseT(x, u); if (v == null) return false; set({ flash: { [key]: v } }); }, { id });
    const pField = (label, key, id) => field(label, fmtShort(pToDisplay(f[key], u), 6),
      x => { const v = parseP(x, u); if (v == null) return false; set({ flash: { [key]: v } }); }, { id });
    const vfField = () => field("Vapour fraction", String(f.VF), x => { const v = Number(String(x).replace(",", ".")); if (!(v >= 0 && v <= 1)) return false; set({ flash: { VF: v } }); },
      { id: "fvf", title: "Moles of vapour per mole of feed: 0 bubble point, 1 dew point" });
    const conds = [];
    if (f.spec === "TP") conds.push(tField(tLab, "T_K", "ft"), pField(`Pressure, ${u.P}`, "P_kPa", "fp"));
    if (f.spec === "PVF") conds.push(pField(`Pressure, ${u.P}`, "P_kPa", "fp"), vfField());
    if (f.spec === "TVF") conds.push(tField(tLab, "T_K", "ft"), vfField());
    if (f.spec === "PH") {
      conds.push(pField(`Flash pressure, ${u.P}`, "P_kPa", "fp"),
        field("Heat duty Q, J/mol", String(f.Q_J_mol), x => { const v = Number(String(x).trim().replace(",", ".")); if (!Number.isFinite(v)) return false; set({ flash: { Q_J_mol: v } }); },
          { id: "fq", title: "Heat added per mole of feed; 0 for an adiabatic flash (valve), negative for cooling" }));
    }
    const feedState = [tField(`Feed temperature, ${u.T === "K" ? "K" : "°C"}`, "feedT_K", "fft"), pField(`Feed pressure, ${u.P}`, "feedP_kPa", "ffp")];
    return h("div", {},
      inputsSection(`Specification: ${sp.title.toLowerCase()}`, h("p", { class: "fa-in-hint" }, sp.hint), ...conds),
      inputsSection("Feed state",
        f.spec === "PH"
          ? h("p", { class: "fa-in-hint" }, "The feed enthalpy is taken at this temperature and pressure; the flash outlet has H = H_feed + Q.")
          : h("label", { class: "fa-check-label" }, h("input", { type: "checkbox", checked: f.duty, "data-fk": "fduty", on: { change: ev => set({ flash: { duty: ev.target.checked } }) } }),
            h("span", {}, "Heat duty from a feed at")),
        ...(f.spec === "PH" || f.duty ? feedState : [])));
  }

  // binary pairs of the inputs with the tier of their parameters, for the model in use
  function pairRows(ids) {
    const model = state.model, eosView = isEosModel(model);
    if (ids.length < 2) return null;
    const head = h("h3", {}, eosView ? `Pairs, ${model} k_ij` : `Parameter sets, ${model}`);
    if (model === "ideal") return h("section", { class: "fa-in-sec fa-pairs" }, head, h("p", { class: "fa-in-hint" }, "Ideal solution: no pair parameters."));
    let info;
    try { info = system({ components: ids, model, allowMissingPairs: true, ...setsFor(state, model) }).info; } catch (e) {
      return h("section", { class: "fa-in-sec fa-pairs" }, head, h("div", { class: "fa-empty" }, e.message));
    }
    const nameToId = new Map(all.map(c => [c.name, c.id]));
    const rows = info.pairs.filter(p => p.tier !== "none").map(p => {
      const choices = setChoices(p);
      const key = pairKeyOf(nameToId.get(p.pair[0]) ?? p.pair[0], nameToId.get(p.pair[1]) ?? p.pair[1]);
      const sel = choices.length ? h("select", { class: "fa-set-sel", id: `fa-set-${key.replace(/[^a-z0-9]+/g, "-")}-${uid}`, "data-fk": `set-${key}`,
        "aria-label": `Parameter set for ${p.pair.join(" + ")}`, title: "Parameter set: switching recalculates the diagram",
        on: { change: ev => {
          const val = ev.target.value, pick = choices.find(c => c.set === val);
          set({ sets: { [key]: pick?.default && !state.prefer ? null : val } });
        } } },
      ...choices.map(c => h("option", { value: c.set, selected: c.current }, `${c.label} · ${TIER_SHORT[c.tier] ?? c.tier}`))) : null;
      return h("li", { title: p.source, class: sel ? "has-sets" : undefined },
        h("span", { class: "fa-pair-name" }, p.pair.join(" + ")), badge(p.tier),
        sel, p.note ? h("div", { class: "fa-pair-note" }, p.note) : null);
    });
    for (const mp of info.missingPairs) rows.push(h("li", { title: eosView ? "No k_ij in the databank: k_ij = 0 is used" : "No parameters: these pairs cannot be calculated" }, h("span", {}, mp.join(" + ")), badge("none")));
    // progressive disclosure: open on wide screens, folded on phones; the reader's choice is kept
    const open = ui.pairsOpen ?? ui.size !== "narrow";
    const missing = info.missingPairs.length;
    return h("section", { class: "fa-in-sec fa-pairs" },
      h("details", { open, on: { toggle: ev => { ui.pairsOpen = ev.target.open; } } },
        h("summary", { "data-fk": "pairs-summary" }, head.textContent, h("span", { class: "fa-count" }, missing ? ` ${missing} without data` : ` ${rows.length}`)),
        h("ul", {}, ...rows),
        h("p", { class: "fa-in-hint" }, "The rule for all pairs is in the Library.")));
  }

  function renderStatus() {
    const st = ui.status, u = state.units, v = state.view;
    const model = v === "steam" ? "IAPWS-IF97" : v === "henry" ? "Henry's law" : v === "properties" ? "Pure-component data"
      : v === "flowsheet" ? `Flowsheet: ${state.flowsheet.thermo.model}`
      : modelLabel(state);
    const fs = state.flash;
    const cond = v === "flash" ? { TP: `T ${fmtTemp(fs.T_K, u)}, P ${fmtP(fs.P_kPa, u)}`, PH: `P ${fmtP(fs.P_kPa, u)}, Q ${fs.Q_J_mol} J/mol`,
      PVF: `P ${fmtP(fs.P_kPa, u)}, VF ${fs.VF}`, TVF: `T ${fmtTemp(fs.T_K, u)}, VF ${fs.VF}` }[fs.spec]
      : v === "pxy" ? `T ${fmtTemp(pxyTemperature(state), u)}` : v === "henry" ? `${fmtTemp(state.henryT_K, u)}, p gas ${fmtP(state.henryP_kPa, u)}`
      : v === "solid" || v === "sle" ? `T ${fmtTemp(state.sleT_K, u)}`
      : VIEWS[v].diagram && v !== "envelope" ? `P ${fmtP(state.P_kPa, u)}` : v === "envelope" ? "Feed under Results" : null;
    const cell = (cls, ...c) => h("span", { class: `fa-cell ${cls}` }, ...c);
    const rule = ruleOf(state.prefer), hand = Object.keys(state.sets).length;
    const setsCell = rule !== "best" || hand
      ? [cell("fa-sets-cell", `Sets: ${rule === "best" ? "defaults" : RULES.find(r => r.id === rule)?.label ?? state.prefer.join(", ")}${hand ? `, ${hand} by hand` : ""}`)] : [];
    statusBar.replaceChildren(
      cell("fa-state" + (st.waiting ? " is-wait" : st.error ? " is-err" : st.busy ? " is-busy" : ""), h("i", { "aria-hidden": "true" }),
        st.waiting ? "Inputs needed" : st.busy ? "Calculating" : st.error ? "Error" : st.ms != null ? `Ready, ${st.ms < 1000 ? `${Math.max(1, Math.round(st.ms))} ms` : `${(st.ms / 1000).toFixed(1)} s`}` : "Ready"),
      cell("", model), ...setsCell,
      ...(cond ? [cell("", cond)] : []),
      st.info?.data ? cell("fa-grow", st.info.data) : h("span", { class: "fa-grow" }),
      cell("fa-hide-narrow", `${u.T === "K" ? "K" : "°C"}, ${u.P}, ${state.basis === "mass" ? "wt %" : "mol frac"}`),
      cell("", `Fugacity ${pkg.version}`));
  }

  /** The name of the calculation on the canvas, e.g. "Methanol, acetone and chloroform". */
  function calculationName() {
    const v = state.view;
    if (v === "steam") return "Water and steam";
    if (v === "henry") {
      const { gas, solvent } = state.inputs.henry;
      return gas && solvent ? `${nameOf(gas)} in ${nameOf(solvent).toLowerCase()}` : VIEWS[v].label;
    }
    if (v === "solid" && state.components.length === 2) return `${nameOf(state.components[0])} in ${nameOf(state.components[1]).toLowerCase()}`;
    const names = state.components.map(nameOf);
    return names.length ? names.map((n, i) => (i ? n.toLowerCase() : n)).join(", ").replace(/, ([^,]*)$/, " and $1") : VIEWS[v].label;
  }

  function renderCanvasBar() {
    const v = state.view, u = state.units, check = checkInputs(v, state.inputs[v], state.model);
    const title = v === "flowsheet" ? state.title || "Flowsheet" : check.ok ? state.title || calculationName() : VIEWS[v].label;
    const prop = v === "properties" ? explorerProperties().find(p => p.key === state.property) : null;
    const ml = modelLabel(state);
    const sub = !check.ok ? `${needsOf(v, state.model)} needed: choose them in Inputs` : {
      txy: `T-x-y diagram at ${fmtP(state.P_kPa, u)}, ${ml}`,
      ternary: `Bubble-temperature map and residue curves at ${fmtP(state.P_kPa, u)}, ${ml}`,
      azeotropes: `Binary and ternary azeotropes at ${fmtP(state.P_kPa, u)}, ${ml}`,
      pxy: `P-x-y diagram at ${fmtTemp(pxyTemperature(state), u)}, ${ml}`,
      envelope: `Bubble and dew points of the feed, ${ml}`,
      flash: `${FLASH_SPECS.find(f => f.id === state.flash.spec).title} flash, ${ml}`,
      henry: `Solubility at ${fmtTemp(state.henryT_K, u)} and a gas partial pressure of ${fmtP(state.henryP_kPa, u)}, Henry's law`,
      solid: `Solubility of the solid against temperature, ${ml}`,
      sle: `Solid-liquid diagram with the eutectic, ${ml}`,
      properties: `${prop?.label ?? "Property"} against temperature, pure component`,
      steam: "Temperature–entropy chart with isobars, IAPWS-IF97",
      flowsheet: state.flowsheet.components.length
        ? `${state.flowsheet.components.map(nameOf).join(", ")}; ${state.flowsheet.thermo.model}${["PR", "SRK"].includes(state.flowsheet.thermo.model) ? "" : `, ${state.flowsheet.thermo.vapour} vapour`}`
        : "Setup: components, then method, then blocks",
    }[v];
    const tog = (ico, label, pressed, onClick, fk) => h("button", { type: "button", class: "fa-icon-btn", "aria-pressed": String(pressed), title: label, "aria-label": label, "data-fk": fk, on: { click: onClick } }, icon(ico, 18));
    const ws = WORKSPACES.find(w => w.id === state.workspace);
    canvasBar.replaceChildren(
      h("div", { class: "fa-canvas-title" },
        h("div", { class: "fa-crumb" }, ws.label, state.workspace === "equilibrium" ? ` / ${VIEWS[v].label}` : ""),
        h("h2", {}, v === "properties" && check.ok ? [h("span", { class: "fa-role-tag" }, "Component"), title] : title),
        h("div", { class: "fa-sub" }, sub)),
      h("div", { class: "fa-canvas-tools", role: "toolbar", "aria-label": "Panels" },
        excelBtn,
        tog("panelL", "Inputs panel", state.panels.left, () => set({ panels: { left: !state.panels.left } }, { canvas: false }), "tog-left"),
        tog("layers", state.background ? "Hide background layers" : "Show background layers", state.background, () => set({ background: !state.background }, { canvas: false }), "tog-bg"),
        tog("panelR", "Results panel", state.panels.right, () => set({ panels: { right: !state.panels.right } }, { canvas: false }), "tog-right")));
  }

  // ---- drawer: Library, Sources, Settings
  function drawerSection(title, ...children) {
    return h("section", { class: "fa-dsec" }, h("h3", {}, title), ...children);
  }
  /** The project document of the workbench as it is now (the flash stream table when it is current). */
  function currentProject() {
    const results = {};
    const rec = ui.records.flash;
    if (rec && rec.key === flashKey()) results.flash = rec.record;
    // the solved flowsheet: its streams and energy streams as a record (never read back)
    const fsc = ui.fs?.cache;
    if (fsc?.result && fsc.key === JSON.stringify(state.flowsheet)) {
      const r = fsc.result;
      results.flowsheet = {
        streams: Object.fromEntries(Object.entries(r.streams).map(([id, s]) => [id, { T_K: s.T_K, P_kPa: s.P_kPa, VF: s.VF, F_kmol_h: s.F_kmol_h, mass_kg_h: s.mass_kg_h, H_kW: s.H_kW, flow_kmol_h: s.flow_kmol_h }])),
        energy: Object.fromEntries(Object.entries(r.energy).map(([id, q]) => [id, { block: q.block, duty_kW: q.duty_kW }])),
        loops: r.loops,
      };
    }
    return projectOf(state, { version: pkg.version, results });
  }
  const flashKey = () => JSON.stringify([state.inputs.flash, state.flash, state.model, state.eos, state.vapour, state.units, state.sets, state.prefer]);
  /** Replace the workbench with a project (throws with the reason when it cannot be read). */
  function loadProject(input) {
    const next = stateFromProject(input);
    state = next; api.state = state; ui.records = {};
    renderChrome(true);
    renderCanvas(true);
  }

  function projectPanel() {
    const status = h("div", { class: "fug-foot", "aria-live": "polite" }), box = h("div");
    const openStatus = h("div", { class: "fug-foot", "aria-live": "polite" }, ui.projectNote);
    ui.projectNote = "";
    const fail = e => { openStatus.textContent = ""; openStatus.append(h("div", { class: "fug-err", role: "alert" }, `Not opened: ${e.message}`)); };
    const open = (text, name) => {
      try { loadProject(text); } catch (e) { fail(e); return; }
      ui.projectNote = `Opened ${name}. Everything was calculated again with Fugacity ${pkg.version}.`;
      set({ utility: "project" }, { canvas: false });
    };
    const fileId = `fa-pfile-${uid}`;
    const file = h("input", { type: "file", id: fileId, accept: ".json,application/json", class: "fa-visually-hidden", "data-fk": "proj-file",
      on: { change: ev => {
        const f = ev.target.files?.[0];
        if (!f) return;
        f.text().then(t => open(t, f.name), fail);
      } } });
    const paste = h("textarea", { class: "fa-csv-text", rows: 5, "aria-label": "The text of a saved project",
      placeholder: '{ "fugacity_project": 2, "workbench": { … } }', "data-fk": "proj-paste" });
    const doc = () => currentProject();
    const hasFlash = !!doc().results?.flash;
    const nameHint = h("p", { class: "fa-in-hint" }, `File name: ${projectFileName(state)}`);
    // the name is the project's title (also shown on the canvas); typing updates it without
    // redrawing the panel, so a click on Save right after typing is not lost
    const nameInput = h("input", { type: "text", id: `fa-pname-${uid}`, value: state.title ?? "", placeholder: calculationName(), maxlength: 80,
      style: "width:100%", "data-fk": "proj-name", "aria-describedby": `fa-pname-hint-${uid}`,
      on: { input: ev => {
        state = applyPatch(state, { title: ev.target.value.trim() || null }); api.state = state;
        if (useAutosave) scheduleAutosave();
        nameHint.textContent = `File name: ${projectFileName(state)}`;
        renderCanvasBar();
      } } });
    nameHint.id = `fa-pname-hint-${uid}`;
    const keep = d => {
      if (typeof cfg.onSave !== "function") return;
      try { cfg.onSave(d); status.textContent += " Also passed to this page."; } catch (e) { status.textContent += ` This page could not keep it: ${e.message}`; }
    };
    /** Save with the browser's Save dialog (choose the folder and the name) where the page may
     *  use it, else as a download. */
    async function saveProject() {
      const d = doc(), text = projectText(d), name = projectFileName(state);
      const picker = typeof window !== "undefined" ? window.showSaveFilePicker : null;
      if (picker) {
        try {
          const handle = await picker.call(window, { suggestedName: name, types: [{ description: "Fugacity project", accept: { "application/json": [".json"] } }] });
          const w = await handle.createWritable();
          await w.write(text); await w.close();
          status.textContent = `Saved ${handle.name}.`;
          keep(d);
          return;
        } catch (e) {
          if (e?.name === "AbortError") { status.textContent = "Not saved."; return; }
          // a sandboxed page may not open the dialog: download instead
        }
      }
      saveText(text, name, "application/json", status, { copyLabel: "Copy", bom: false });
      keep(d);
    }
    return h("div", { class: "fa-dgrid" },
      previous ? drawerSection("Continue where you left off", restoreBox()) : null,
      drawerSection("Save",
        h("label", { class: "fa-field fa-field-wide", for: nameInput.id }, h("span", {}, "Name"), nameInput),
        nameHint,
        h("p", {}, "A small JSON file with the components, model and conditions of every workspace, the flash specification and feed, the flowsheet (setup, blocks, streams), the parameter sets and the open view."
          + (hasFlash ? " It also keeps the flash stream table (the mass balance) as calculated now." : " Open the Flash workspace before saving to keep its stream table (the mass balance) in the file too.")
          + (doc().results?.flowsheet ? " The solved flowsheet's streams and duties are kept as well." : "")),
        h("div", { class: "fa-in-actions" },
          h("button", { type: "button", class: "fa-mini", "data-fk": "proj-save", on: { click: () => { saveProject(); } } }, icon("download", 15), "Save…"),
          h("button", { type: "button", class: "fa-mini", "data-fk": "proj-copy",
            on: { click: () => copyText(projectText(doc()), status, box, { what: "project", done: "Project copied: paste it into a file or a chat to keep it." }) } }, icon("copy", 15), "Copy")),
        status, box,
        h("p", { class: "fa-in-hint" }, "Save opens your browser's Save dialog where it can (choose the folder and the name); otherwise the file goes to your Downloads folder."),
        h("p", { class: "fa-in-hint" }, "Your projects and exports are yours: Fugacity claims no rights in what you create with it.")),
      drawerSection("Open",
        h("p", {}, "A project file (.fugacity.json) saved with Save. It replaces what is open now; the results are calculated again."),
        h("div", { class: "fa-in-actions" },
          h("label", { class: "fa-mini", for: fileId, role: "button", tabindex: "0", "data-fk": "proj-open",
            on: { keydown: ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); file.click(); } } } }, icon("file", 15), "Open a file…"), file),
        h("details", { class: "fa-paste" },
          h("summary", { "data-fk": "proj-paste-toggle" }, "Paste a project's text instead (from Copy)"),
          h("p", { class: "fa-in-hint" }, "Where a page cannot download files (some AI chats), Copy puts the project's text on the clipboard; it starts with { \"fugacity_project\": … }. Paste that text here to open the project again. This box is not for instructions or questions: to have a flowsheet built from a description, ask your AI assistant."),
          paste,
          h("div", { class: "fa-in-actions" },
            h("button", { type: "button", class: "fa-mini", "data-fk": "proj-load", on: { click: () => {
              const t = paste.value.trim();
              if (!t) return;
              if (!t.startsWith("{")) {
                openStatus.replaceChildren(h("div", { class: "fug-err", role: "alert" }, "This is not a project's text. Paste the text that Copy gave you (it starts with { \"fugacity_project\": … }). To describe what you want in words, ask your AI assistant instead."));
                return;
              }
              open(t, "the pasted project");
            } } }, icon("check", 15), "Open the pasted text"))),
        openStatus),
      ...stores.map(storeSection),
      drawerSection("From code",
        h("p", { class: "fa-in-hint" }, "const w = Fugacity.app(\"#app\"); w.save() returns the project; w.load(project) opens one; Fugacity.app(\"#app\", { project }) starts from one; { storage: { list(), get(name), put(name, project), remove(name) } } keeps projects in the page's own storage (for example an AI chat's); { autosave: false } turns off the copy in this browser.")));
  }

  /** A store (this browser, or the host page's storage): save under the project's name, and the list. */
  function storeSection(store) {
    const status = h("div", { class: "fug-foot", "aria-live": "polite" });
    const list = h("ul", { class: "fa-store-list" }, h("li", { class: "fa-empty" }, "Loading…"));
    const name = () => (state.title || (state.components.length ? calculationName() : "") || "Untitled").trim();
    const refresh = () => store.list().then(items => {
      list.replaceChildren(...(items.length ? items.map(it => h("li", {},
        h("span", { class: "fa-store-name" }, it.name), it.saved_at ? h("small", {}, new Date(it.saved_at).toLocaleString()) : null,
        h("button", { type: "button", class: "fa-mini", "data-fk": `store-open-${store.id}-${it.name}`, on: { click: () => {
          store.get(it.name).then(p => { loadProject(p); ui.projectNote = `Opened "${it.name}" from ${store.label.toLowerCase()}. Everything was calculated again.`; set({ utility: "project" }, { canvas: false }); },
            e => { status.textContent = `Not opened: ${e.message}`; });
        } } }, "Open"),
        h("button", { type: "button", class: "fa-mini", "aria-label": `Delete ${it.name}`, "data-fk": `store-del-${store.id}-${it.name}`, on: { click: () => {
          store.remove(it.name).then(refresh, e => { status.textContent = e.message; });
        } } }, icon("trash", 14)))) : [h("li", { class: "fa-empty" }, "Nothing kept here yet.")]));
    }, e => { list.replaceChildren(h("li", { class: "fug-err" }, `This storage did not answer: ${e.message}`)); });
    refresh();
    return drawerSection(store.label,
      h("p", { class: "fa-in-hint" }, store.id === "browser"
        ? "Kept in this browser until you clear its site data; not on other computers. For safe keeping, also save a file."
        : "Kept by the page that shows the workbench (for example the AI chat's storage)."),
      h("div", { class: "fa-in-actions" }, h("button", { type: "button", class: "fa-mini", "data-fk": `store-save-${store.id}`, on: { click: () => {
        const n = name();
        store.put(n, currentProject()).then(() => { status.textContent = `Kept as "${n}".`; refresh(); }, e => { status.textContent = `Not kept: ${e.message}`; });
      } } }, icon("download", 15), `Keep here as "${name()}"`)),
      status, list);
  }

  /** "Continue where you left off": the automatic copy of the last session in this browser. */
  function restoreBox() {
    if (!previous) return null;
    const when = new Date(previous.saved_at).toLocaleString();
    return h("div", { class: "fa-restore", role: "note" },
      h("span", {}, `Your last work in this browser (${when}) can be opened again.`),
      h("button", { type: "button", class: "fa-mini", "data-fk": "restore", on: { click: () => {
        const p = previous; previous = null;
        try { loadProject(p.text); ui.projectNote = "Your last work was opened again."; } catch (e) { ui.projectNote = `It could not be opened: ${e.message}`; clearAutosave(); }
        set({ utility: state.utility }, { canvas: false });
      } } }, "Continue"),
      h("button", { type: "button", class: "fa-mini", "data-fk": "restore-no", on: { click: () => { previous = null; clearAutosave(); set({}, { canvas: false }); renderCanvas(true); } } }, "Start new"));
  }

  /** The Feedback panel: GitHub issue forms and the Discussions forum, the bug form filled with the setup. */
  function feedbackPanel() {
    const v = state.view, check = checkInputs(v, state.inputs[v], state.model);
    const setup = v === "flowsheet" ? `Flowsheet "${state.title || "untitled"}", ${state.flowsheet.thermo.model}`
      : `${WORKSPACES.find(w => w.id === state.workspace).label}${state.workspace === "equilibrium" ? `, ${VIEWS[v].label}` : ""}${check.ok ? `: ${calculationName()}` : ""}; ${modelLabel(state)}`;
    const links = feedbackLinks({ version: pkg.version, setup });
    return h("div", { class: "fa-dgrid" },
      drawerSection("On GitHub", h("ul", { class: "fa-feedback" }, ...links.map(l => h("li", {},
        h("a", { href: l.url, target: "_blank", rel: "noopener", "data-fk": `feedback-${l.id}` }, l.label),
        h("p", { class: "fa-in-hint" }, l.hint))))),
      drawerSection("Before you send",
        h("p", { class: "fa-in-hint" }, "The pages are public and need a free GitHub account. For a wrong result, say what you expected and where that number comes from; a saved project file (File, Save) lets others open exactly your setup."),
        h("p", { class: "fa-in-hint" }, "A security problem: report it privately, as SECURITY.md says, not in a public issue.")));
  }

  function drawerBody(id) {
    const u = state.units;
    if (id === "project") return projectPanel();
    if (id === "feedback") return feedbackPanel();
    if (id === "sources") {
      const check = checkInputs(state.view, state.inputs[state.view], state.model);
      return sourcesPanel({ ids: check.ok ? check.use : [], what: check.ok ? calculationName() : VIEWS[state.view].label, uid, look: ui.sources });
    }
    if (id === "library") {
      const rule = ruleOf(state.prefer), chosen = Object.keys(state.sets).length;
      return h("div", { class: "fa-dgrid" },
        drawerSection("Parameter sets for every pair",
          h("div", { class: "fa-rules", role: "group", "aria-label": "Rule for every pair" }, ...RULES.map(r => h("button", {
            type: "button", class: "fa-rule", "aria-pressed": String(rule === r.id), "data-fk": `rule-${r.id}`, on: { click: () => set({ prefer: r.id }) } },
          h("b", {}, r.label), h("span", {}, r.hint))))),
        drawerSection("Per pair",
          h("p", {}, chosen ? `${chosen} pair${chosen === 1 ? "" : "s"} set by hand.` : "Each pair can use another set: its menu is in the Inputs panel of the phase-equilibrium diagrams."),
          h("button", { type: "button", class: "fa-mini", disabled: !chosen && rule === "best", "data-fk": "lib-reset",
            on: { click: () => set({ sets: null, prefer: null }) } }, icon("clear", 15), "Back to the defaults"),
          h("p", { class: "fa-in-hint" }, "Sets from a paper: Fugacity.library.add() (this page only).")),
        drawerSection("Sources",
          h("p", {}, "Every source once: what it is, why it is open, what uses it."),
          h("button", { type: "button", class: "fa-mini", "data-fk": "lib-browse", on: { click: () => { ui.sources.mine = false; set({ utility: "sources" }, { canvas: false }); } } }, icon("book", 15), "Browse sources")));
    }
    return h("div", { class: "fa-dgrid" },
      drawerSection("Units", h("div", { class: "fa-units" },
        h("span", {}, "Temperature"), seg("Temperature unit", UNIT_CHOICES.T, u.T, x => set({ units: { T: x } })),
        h("span", {}, "Pressure"), seg("Pressure unit", UNIT_CHOICES.P, u.P, x => set({ units: { P: x } })),
        h("span", {}, "Composition"), seg("Composition basis", [["mole", "mol frac"], ["mass", "wt %"]], state.basis, b => set({ basis: b })),
        h("span", {}, "Energy"), seg("Energy basis", UNIT_CHOICES.basis, u.basis, x => set({ units: { basis: x } })))),
      drawerSection("Show", h("div", { class: "fa-stack" },
        smallButton({ ico: "panelL", label: "Inputs panel", pressed: state.panels.left, onClick: () => set({ panels: { left: !state.panels.left } }, { canvas: false }) }),
        smallButton({ ico: "panelR", label: "Results panel", pressed: state.panels.right, onClick: () => set({ panels: { right: !state.panels.right } }, { canvas: false }) }),
        smallButton({ ico: "status", label: "Toolbar", pressed: state.ribbon, onClick: () => set({ ribbon: !state.ribbon }, { canvas: false }) }),
        smallButton({ ico: "layers", label: "Background layers", pressed: state.background, onClick: () => set({ background: !state.background }, { canvas: false }) }))),
      drawerSection("Theme", h("div", { class: "fa-theme" }, icon("theme", 18), "Follows the page"),
        h("p", { class: "fa-in-hint" }, "Light or dark, as the host page or system is set.")));
  }

  function renderDrawer() {
    const id = state.utility;
    layer.hidden = !id;
    for (const el of [subnav, ribbon, body, statusBar]) el.inert = !!id;
    if (!id) { drawer.replaceChildren(); ui.drawnUtility = null; return; }
    // the source browser keeps its scroll and search while it is open; the others follow the state
    if (id === "sources" && ui.drawnUtility === "sources") return;
    const u = UTILITIES.find(x => x.id === id);
    const ws = WORKSPACES.find(w => w.id === state.workspace);
    drawer.dataset.utility = id;
    drawer.replaceChildren(
      h("div", { class: "fa-drawer-head" },
        h("div", {},
          h("h2", { id: `fa-dt-${uid}` }, icon(u.icon, 18), u.title),
          h("p", { id: `fa-dd-${uid}` }, u.intro),
          h("p", { class: "fa-back-note" }, `Close, or press Esc, to go back to ${ws.label}${state.workspace === "equilibrium" ? `, ${VIEWS[state.view].label}` : ""}: your inputs and results stay as they are.`)),
        h("button", { type: "button", class: "fa-close", "data-fk": "drawer-close", on: { click: () => set({ utility: null }, { canvas: false }) } },
          icon("close", 16), h("span", {}, "Close"))),
      h("div", { class: "fa-drawer-body" }, drawerBody(id)));
    ui.drawnUtility = id;
  }

  function renderChrome(force = false) {
    box.classList.toggle("fa-no-left", !state.panels.left);
    box.classList.toggle("fa-no-right", !state.panels.right);
    box.classList.toggle("fa-nobg", !state.background);
    box.classList.toggle("fa-ribbon-closed", !state.ribbon);
    box.dataset.workspace = state.workspace;
    renderTitleBar();
    const ws = WORKSPACES.find(w => w.id === state.workspace);
    ribbon.setAttribute("aria-label", `${ws.label}: diagrams and options`);
    ribbon.hidden = !state.ribbon;
    ribbon.replaceChildren(...ribbonGroups());
    left.hidden = !state.panels.left;
    right.hidden = !state.panels.right;
    renderLeft();
    renderCanvasBar();
    renderStatus();
    if (force) ui.drawnUtility = null;
    renderDrawer();
  }

  /** Download the numbers behind the diagram on the canvas (the view's export()) as .xlsx. */
  function exportDiagram() {
    const exp = ui.status.info?.export;
    if (!exp) return;
    const note = h("div", { class: "fug-foot fa-export-note", role: "status" });
    try {
      const desc = exp();
      const name = exportFileName(desc);
      const url = URL.createObjectURL(new Blob([diagramXlsx(desc, { version: pkg.version })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = h("a", { href: url, download: name, style: "display:none" });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      note.textContent = `Saved ${name}: an About sheet with the settings and sources, then ${desc.tables.map(t => `"${t.name}"`).join(", ")}, with every point the view calculated, in the units shown. If nothing was downloaded, the page does not allow downloads.`;
    } catch (e) { note.textContent = `The Excel file could not be made: ${e.message}`; }
    notes.querySelector(".fa-export-note")?.remove();
    notes.prepend(note);
  }

  // ---- canvas
  const canvasKey = () => {
    const v = state.view, check = checkInputs(v, state.inputs[v], state.model);
    return JSON.stringify([v, check.ok ? check.use : ["invalid", state.inputs[v]], state.model, state.eos, state.vapour, state.P_kPa, state.T_K,
      state.units, state.basis, state.residueCurves, state.isotherms, state.grid, state.property, state.z[v] ?? null,
      v === "henry" ? [state.inputs.henry, state.henryT_K, state.henryP_kPa, state.compareGases] : null,
      v === "solid" || v === "sle" ? [state.sleT_K, state.solidUnit] : null, state.steamP_kPa, state.sets, state.prefer,
      v === "flash" ? state.flash : null,
      v === "flowsheet" ? [state.flowsheet, ensureUi(ui).sel, ui.fs.auto, ui.fs.solveKey, ui.fs.zoom] : null]);
  };
  let canvasRendered = false, token = 0;
  function renderCanvas(now = false) {
    ui.drawnKey = canvasKey();
    const my = ++token;
    ui.status = { busy: true, ms: null, error: null, info: null };
    renderStatus();
    box.classList.add("fa-busy");
    const run = () => {
      if (my !== token) return;
      const t0 = performance.now();
      const v = state.view, check = checkInputs(v, state.inputs[v], state.model);
      let info = null, error = null;
      notes.replaceChildren(); below.replaceChildren(); inspectorExtra.replaceChildren(); provenance.replaceChildren(); side.hidden = false;
      excelBtn.hidden = true;
      delete plot.dataset.view;
      if (!check.ok) {
        plot.replaceChildren(needInputs(v, check));
        side.replaceChildren(h("div", { class: "fa-empty" }, blank(v) ? "No results yet: choose the components." : "No results yet: the inputs are incomplete."));
      } else {
        try {
          const viewState = { ...state, components: check.use, z: state.z[v] ?? null };
          info = renderView(v, { state: viewState, set, plot, side, notes, below, extra: inspectorExtra, compact: ui.size === "narrow", uid, badge, ui });
          if (info?.record?.flash) ui.records.flash = { key: flashKey(), record: info.record.flash };
          provenance.append(h("button", { type: "button", class: "fa-mini", "data-fk": "src-here",
            on: { click: () => { ui.sources.mine = true; ui.sources.query = ""; ui.sources.kind = "all"; set({ utility: "sources" }, { canvas: false }); } } },
          icon("book", 15), "Sources used here"));
        } catch (e) {
          error = e.message;
          plot.replaceChildren(h("div", { class: "fug-err", role: "alert" }, e.message));
          side.replaceChildren(h("div", { class: "fa-empty" }, "No readout: the calculation stopped with the error shown on the canvas."));
        }
      }
      canvasRendered = true;
      box.classList.remove("fa-busy");
      ui.status = { busy: false, ms: check.ok ? performance.now() - t0 : null, error: error ?? info?.error ?? null, info, waiting: !check.ok };
      excelBtn.hidden = !(check.ok && !error && typeof info?.export === "function");
      renderStatus();
    };
    if (now) run(); else setTimeout(run, 16);
  }

  function needInputs(v, check) {
    if (blank(v)) {
      const examples = examplesFor(v, PRESETS, state.model).length;
      return h("div", { class: "fa-need is-start", role: "status" },
        restoreBox(),
        h("h3", {}, `Start by choosing ${needsOf(v, state.model).toLowerCase()}`),
        h("p", {}, `Choose them in the Inputs panel${ui.size === "narrow" ? " above" : ""}${examples ? ", or load one of the Examples there" : ""}. The ${lower(VIEWS[v].label)} is calculated as soon as the inputs fit; the ribbon switches between diagrams, models and the other workspaces.`),
        state.panels.left ? null : h("button", { type: "button", class: "fa-mini", "data-fk": "show-inputs", on: { click: () => set({ panels: { left: true } }, { canvas: false }) } }, icon("panelL", 15), "Show the Inputs panel"));
    }
    return h("div", { class: "fa-need", role: "status" },
      h("h3", {}, `The ${lower(VIEWS[v].label)} needs: ${needsOf(v, state.model).toLowerCase()}${isEosModel(state.model) || !VIEWS[v].diagram ? "" : ` with ${state.model === "ideal" ? "an ideal solution" : state.model}`}`),
      h("ul", {}, ...check.problems.map(p => h("li", {}, p.message))),
      h("p", {}, `Choose them in the Inputs panel${ui.size === "narrow" ? " above" : ""}. Nothing is calculated until the inputs fit; your choices are kept as they are.`),
      state.panels.left ? null : h("button", { type: "button", class: "fa-mini", "data-fk": "show-inputs", on: { click: () => set({ panels: { left: true } }, { canvas: false }) } }, icon("panelL", 15), "Show the Inputs panel"));
  }

  function badge(tier) {
    return h("span", { class: `fa-tier fa-tier-${tier}`, title: tier === "none" ? "No parameters in the databank" : `Tier: ${tier}` }, TIER_SHORT[tier] ?? tier);
  }

  const api = {
    state,
    /** Change the workbench: any configuration key, plus workspace, view, inputs, utility, panels, ribbon, z (see applyPatch). */
    update(patch = {}) { set(patch); },
    /** The project document of the workbench as it is now (src/ui/project.js); JSON.stringify it to keep it. */
    save() { return currentProject(); },
    /** Open a project (a document or its JSON text); throws, naming the problem, when it cannot be read. */
    load(project) { loadProject(project); },
  };
  renderChrome();
  renderCanvas(true);
  measure();
  return api;
}
