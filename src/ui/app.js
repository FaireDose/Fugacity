/**
 * Workbench: Fugacity.app(target, config).
 *
 * Layout, from top to bottom:
 *  - the navigation bar: one tab per calculation task (Phase equilibrium, Gas solubility,
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
import { listComponents } from "../thermo/system.js";
import { HENRY_GASES } from "../thermo/henry.js";
import { system } from "../system.js";
import {
  VIEWS, PRESETS, initialState, applyPatch, TIER_SHORT, fmtP, parseP, parseT, fmtTemp, pxyTemperature,
  RULES, ruleOf, setsFor, setChoices, pairKeyOf,
} from "./app-logic.js";
import { WORKSPACES, UTILITIES, INPUTS, checkInputs, examplesFor, rotateInputs, solventsFor } from "./workspaces.js";
import { UNIT_CHOICES, explorerProperties, tToDisplay, pToDisplay, fmtShort } from "./properties-logic.js";
import { renderView, sourcesPanel } from "./app-views.js";
import pkg from "../../package.json" with { type: "json" };

const PROPERTY_GLYPHS = [
  ["density", () => "ρ", "Density"], ["enthalpy", () => "h", "Enthalpy"], ["cp", () => ["c", h("sub", {}, "p")], "Heat capacity"],
  ["viscosity", () => "μ", "Viscosity"], ["conductivity", () => "k", "Conductivity"], ["vapourPressure", () => ["P", h("sup", {}, "sat")], "Vapour pressure"],
];
const VIEW_ICON = { txy: "txy", ternary: "ternary", azeotropes: "azeo", pxy: "pxy", envelope: "envelope", henry: "henry", properties: "curves", steam: "dome" };
/** A label inside a sentence: "Ternary map" → "ternary map", but "T-x-y diagram" stays. */
const lower = s => (/^[A-Z]-/.test(s) ? s : s[0].toLowerCase() + s.slice(1));
const NEEDS = {
  txy: "Two liquids", ternary: "Three liquids", azeotropes: "Two to four liquids", pxy: "Two components, gases too",
  envelope: "One to six components, gases too", henry: "A gas and a solvent", properties: "One component", steam: "Water",
};

/**
 * Put the Fugacity workbench into a page element.
 *
 * The workbench has four workspaces, one per task: Phase equilibrium (T-x-y, ternary map,
 * azeotropes with an activity model; P-x-y and phase envelope with an equation of state),
 * Gas solubility (Henry's law, a gas in a solvent), Properties (one pure component) and
 * Steam (IAPWS-IF97). Library, Sources and Settings open as a drawer over the workspace.
 * Each workspace keeps its own inputs: `components` seeds all of them (the first two liquids
 * for T-x-y, the first three for the ternary map, the first gas for Gas solubility, the
 * first component for Properties, ...).
 *
 * @param {string|HTMLElement} target  element or CSS selector
 * @param {object} [cfg]
 * @param {"ternary"|"txy"|"azeotropes"|"eos"|"pxy"|"envelope"|"henry"|"properties"|"steam"|"sources"} [cfg.start]
 *   first view (default: ternary for three liquids, T-x-y for two); "henry" opens Gas solubility,
 *   "sources" (or "library") opens the Sources panel over the first workspace
 * @param {string[]} [cfg.components]   up to six names, ids, formulas or CAS numbers
 *   (default methanol, acetone, chloroform)
 * @param {"NRTL"|"UNIQUAC"|"ideal"|"PR"|"SRK"} [cfg.model="NRTL"]  activity model; "PR" or "SRK" sets the equation of state
 * @param {"PR"|"SRK"} [cfg.eos="PR"]    equation of state of the P-x-y and phase-envelope diagrams
 * @param {number} [cfg.P_kPa=101.325]   pressure of the activity-model diagrams
 * @param {number} [cfg.T_K]             temperature of the P-x-y diagram (default: 85 % of the lowest critical temperature)
 * @param {string} [cfg.gas]             gas of the Gas solubility workspace (default: the first gas in components, else oxygen)
 * @param {string} [cfg.solvent="water"] solvent of the Gas solubility workspace
 * @param {number} [cfg.henryT_K=298.15] temperature of the Gas solubility workspace
 * @param {number} [cfg.henryP_kPa=101.325]  gas partial pressure of the Gas solubility workspace
 * @param {boolean} [cfg.compareGases=false] also draw the other gases with a constant in the same solvent
 * @param {string} [cfg.propComponent]   component of the Properties workspace (default: the first of components)
 * @param {string} [cfg.property="density"]   property of the Properties workspace
 * @param {number[]} [cfg.steamP_kPa]   isobars of the steam chart, kPa (up to six)
 * @param {object} [cfg.units]           { T: "C"|"K", P: "bar"|"kPa", energy: "kJ/kg"|"J/mol", viscosity: "mPa s"|"Pa s" }
 * @param {"mole"|"mass"} [cfg.basis="mole"]  compositions in mole fractions or wt %
 * @param {boolean} [cfg.background=true]     show the background layers (colour map, isotherms, grid lines, two-liquid shading)
 * @param {{left?:boolean, right?:boolean}} [cfg.panels]  show the Inputs panel (left) and the Results panel (right)
 * @param {boolean} [cfg.ribbon=true]    show the toolbar of the workspace
 * @param {Object<string,string>} [cfg.sets]  parameter set per pair, e.g. { "acetone+chloroform": "chemsep" }
 *   (update({ sets }) merges; a null set name, or sets: null, goes back to the default)
 * @param {"best"|"fitted"|"databank"|string[]} [cfg.prefer]  global rule (Library panel) or a list of tiers
 * @returns {{state:object, update:(patch:object)=>void}}  `update` takes any configuration key and
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

  let state = initialState(cfg);
  const uid = Math.random().toString(36).slice(2, 7);
  const all = listComponents();
  const byId = new Map(all.map(c => [c.id, c]));
  const nameOf = id => byId.get(id)?.name ?? id;
  const sizeOf = w => (w < 720 ? "narrow" : w < 1080 ? "mid" : "wide");
  const ui = {
    size: sizeOf(root.clientWidth || 1200), status: { busy: false, ms: null, error: null, info: null },
    sources: { query: "", kind: "all", mine: false }, opener: null, drawnUtility: null,
  };

  // ---- skeleton
  const box = h("div", { class: "fug fug-app" });
  const titleBar = h("header", { class: "fa-titlebar" });
  const ribbon = h("div", { class: "fa-ribbon", role: "toolbar", id: `fa-rib-${uid}` });
  const left = h("aside", { class: "fa-left", "aria-label": "Inputs", id: `fa-in-${uid}` });
  const canvasBar = h("div", { class: "fa-canvas-bar" });
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
  const stage = h("div", { class: "fa-stage" }, ribbon, body, statusBar, layer);
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
    const fk = focusKey();
    const before = canvasKey();
    const util0 = state.utility;
    state = applyPatch(state, patch);
    api.state = state;
    renderChrome();
    if (redraw && canvasKey() !== before) renderCanvas();
    if (state.utility !== util0) {
      if (state.utility) {
        if (!util0) ui.opener = fk;
        drawer.focus({ preventScroll: true }); // the navigation bar stays in view
      } else if (!restoreFocus(fk) && !restoreFocus(ui.opener)) restoreFocus(`util-${util0}`);
    } else restoreFocus(fk);
  }

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
  function seg(label, choices, current, onPick) {
    return h("div", { class: "fug-seg fa-seg", role: "group", "aria-label": label },
      ...choices.map(([v, text]) => h("button", { type: "button", "aria-pressed": String(current === v), "data-fk": `seg-${label}-${v}`, on: { click: () => onPick(v) } }, text)));
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
    const nav = h("nav", { class: "fa-nav", "aria-label": "Workspaces" }, ...WORKSPACES.map(w => h("button", {
      type: "button", class: "fa-nav-btn", "aria-current": state.workspace === w.id ? "page" : undefined, "data-fk": `ws-${w.id}`,
      "aria-label": w.label, on: { click: () => set({ workspace: w.id, utility: null }) } },
      icon(w.icon, 18), h("span", { class: "fa-nav-long" }, w.label), h("span", { class: "fa-nav-short", "aria-hidden": "true" }, w.short))));
    const utils = h("div", { class: "fa-utils", role: "group", "aria-label": "Supporting tools" }, ...UTILITIES.map(u => h("button", {
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
  }

  // ---- toolbar of the workspace: diagrams, model and display options
  function diagramButton(view, label) {
    return bigButton({ ico: VIEW_ICON[view], label, pressed: state.view === view, title: `${VIEWS[view].label}: ${NEEDS[view].toLowerCase()}`,
      fk: `diagram-${view}`, onClick: () => set({ view }) });
  }
  function ribbonGroups() {
    const u = state.units, v = state.view, fam = VIEWS[v].family;
    const bg = smallButton({ ico: "layers", label: "Background", pressed: state.background, fk: "bg",
      title: "Show or hide the colour map, isotherms, grid lines and two-liquid shading", onClick: () => set({ background: !state.background }, { canvas: false }) });
    switch (state.workspace) {
      case "equilibrium": return [
        group("Liquid mixtures, activity model", diagramButton("txy", "T-x-y"), diagramButton("ternary", "Ternary map"), diagramButton("azeotropes", "Azeotropes")),
        group("Equation of state", diagramButton("pxy", "P-x-y"), diagramButton("envelope", "Phase envelope")),
        fam === "activity"
          ? group("Activity model", stack(seg("Activity model", [["NRTL", "NRTL"], ["UNIQUAC", "UNIQUAC"], ["ideal", "Ideal"]], state.model, m => set({ model: m })),
            seg("Vapour model", [["ideal", "Ideal gas"], ["PR", "PR"], ["SRK", "SRK"]], state.vapour, m => set({ vapour: m })),
            h("div", { class: "fa-hint" }, `${state.model === "ideal" ? "Liquid γ = 1" : "Liquid γ"}; ${state.vapour === "ideal" ? "vapour ideal gas" : `${state.vapour} vapour with φsat and Poynting`}`)))
          : group("Equation of state", stack(seg("Equation of state", [["PR", "Peng–Robinson"], ["SRK", "SRK"]], state.eos, m => set({ eos: m })),
            h("div", { class: "fa-hint" }, "Both phases; k_ij from the databank"))),
        group("Display", stack(
          ...(v === "ternary" ? [
            smallButton({ ico: "residue", label: "Residue curves", pressed: state.residueCurves, onClick: () => set({ residueCurves: !state.residueCurves }) }),
            smallButton({ ico: "isotherm", label: "Isotherms", pressed: state.isotherms, onClick: () => set({ isotherms: !state.isotherms }) }),
            h("label", { class: "fa-field", for: `fa-grid-${uid}` }, h("span", {}, "Map resolution"),
              h("select", { id: `fa-grid-${uid}`, "data-fk": "grid", on: { change: ev => set({ grid: +ev.target.value }) } },
                ...[[24, "Coarse"], [40, "Normal"], [60, "Fine"]].map(([g, t]) => h("option", { value: g, selected: state.grid === g }, t)))),
          ] : []), bg)),
        ...(fam === "activity" ? [group("Composition", seg("Composition basis", [["mole", "mol frac"], ["mass", "wt %"]], state.basis, b => set({ basis: b })))] : []),
      ];
      case "solubility": return [
        group("Model", h("div", { class: "fa-stack fa-about" },
          h("div", { class: "fa-theme" }, icon("henry", 18), "Henry's law, x = p / H"),
          h("div", { class: "fa-hint" }, "Dilute solutions at low to moderate pressure"))),
        group("Display", stack(
          smallButton({ ico: "curves", label: "Compare with the other gases", pressed: state.compareGases, fk: "compare",
            title: "Also draw the other gases with a Henry's law constant in the same solvent", onClick: () => set({ compareGases: !state.compareGases }) }), bg)),
      ];
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
  function optionsFor(view, current, slot) {
    const spec = INPUTS[view], value = state.inputs[view];
    const usedElsewhere = new Map((Array.isArray(value) ? value : []).map((id, i) => [id, i]).filter(([id, i]) => id && i !== slot));
    const opt = c => {
      const bad = spec.liquid && !c.activity;
      const other = usedElsewhere.get(c.id);
      return h("option", { value: c.id, selected: c.id === current, disabled: bad && c.id !== current },
        other != null ? `${c.name}, also component ${other + 1}` : `${c.name} (${c.formula})${bad ? ", gas: equation of state only" : ""}`);
    };
    return [
      h("optgroup", { label: "Liquids" }, ...all.filter(c => c.activity).map(opt)),
      h("optgroup", { label: spec.liquid ? "Gases (not for activity models)" : "Gases" }, ...all.filter(c => !c.activity).map(opt)),
    ];
  }

  function slotsInput(view, check) {
    const spec = INPUTS[view], value = state.inputs[view];
    const bad = new Map(check.problems.filter(p => p.slot != null).map(p => [p.slot, p.message]));
    return h("div", { class: "fa-slots" }, ...value.map((id, i) => {
      const sid = `fa-slot-${view}-${i}-${uid}`;
      const sel = h("select", { id: sid, "data-fk": `slot-${view}-${i}`, "aria-invalid": bad.has(i) ? "true" : undefined,
        "aria-describedby": bad.has(i) ? `fa-problems-${uid}` : undefined,
        on: { change: ev => { const next = value.slice(); next[i] = ev.target.value || null; set({ inputs: { [view]: next } }); } } },
        h("option", { value: "", selected: !id }, spec.liquid ? "Choose a liquid…" : "Choose a component…"), ...optionsFor(view, id, i));
      return h("div", { class: "fa-slot" + (bad.has(i) ? " is-bad" : "") + (spec.n === 1 ? " is-single" : "") },
        h("label", { for: sid },
          spec.n > 1 ? h("span", { class: "fa-chip-n", "aria-hidden": "true" }, String(i + 1)) : null,
          h("span", { class: "fa-slot-name" }, spec.n > 1 ? `Component ${i + 1}` : "Component"),
          spec.n > 1 ? h("span", { class: "fa-slot-role" }, spec.roles[i]) : null),
        sel);
    }));
  }

  function listInput(view) {
    const spec = INPUTS[view], value = state.inputs[view];
    const chips = value.map((id, i) => h("li", { class: "fa-chip" },
      h("span", { class: "fa-chip-n", "aria-hidden": "true" }, String(i + 1)),
      h("span", { class: "fa-chip-name" }, nameOf(id)),
      h("span", { class: "fa-chip-f" }, byId.get(id)?.formula ?? ""),
      h("button", { type: "button", class: "fa-x", "aria-label": `Remove ${nameOf(id)}`, title: "Remove", "data-fk": `rm-${view}-${i}`,
        on: { click: () => set({ inputs: { [view]: value.filter((_, k) => k !== i) } }) } }, icon("close", 14))));
    const full = value.length >= spec.max;
    const addId = `fa-add-${view}-${uid}`;
    const add = h("select", { id: addId, "data-fk": `add-${view}`, disabled: full,
      on: { change: ev => { if (ev.target.value) set({ inputs: { [view]: [...value, ev.target.value] } }); } } },
      h("option", { value: "" }, full ? `Full: at most ${spec.max}` : spec.liquid ? "Add a liquid…" : "Add a component…"),
      ...optionsFor(view, null, -1).map(g => { for (const o of [...g.children]) if (value.includes(o.value)) o.remove(); return g; }));
    return h("div", { class: "fa-list" },
      value.length ? h("ol", { class: "fa-chips", "aria-label": "Chosen components" }, ...chips) : h("div", { class: "fa-empty" }, "None chosen yet."),
      h("label", { class: "fa-add", for: addId }, h("span", { class: "fa-visually-hidden" }, "Add a component"), add));
  }

  function problemsBox(check) {
    return h("div", { class: "fa-problems", id: `fa-problems-${uid}`, "aria-live": "polite" },
      ...(check.ok ? [] : [h("ul", {}, ...check.problems.map(p => h("li", {}, p.message)))]));
  }

  function inputsSection(title, ...children) {
    return h("section", { class: "fa-in-sec" }, h("h3", {}, title), ...children);
  }

  function renderLeft() {
    const v = state.view, spec = INPUTS[v], check = checkInputs(v, state.inputs[v]);
    const u = state.units;
    const secs = [];
    if (state.workspace === "equilibrium") {
      const value = state.inputs[v];
      const examples = examplesFor(v, PRESETS);
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
        h("p", { class: "fa-in-hint" }, `${NEEDS[v]} for the ${lower(VIEWS[v].label)}${spec.kind === "slots" && spec.n === 3 ? ", in corner order" : ""}.`),
        spec.kind === "slots" ? slotsInput(v, check) : listInput(v),
        problemsBox(check),
        actions.length ? h("div", { class: "fa-in-actions" }, ...actions) : null));
      if (VIEWS[v].family === "activity") secs.push(inputsSection("Conditions", pressureField()));
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
    } else if (state.workspace === "solubility") {
      const { gas, solvent } = state.inputs.henry;
      const bad = new Map(check.problems.map(p => [p.slot, p.message]));
      const gasSel = h("select", { id: `fa-gas-${uid}`, "data-fk": "gas", "aria-invalid": bad.has(0) ? "true" : undefined,
        on: { change: ev => set({ gas: ev.target.value }) } },
        ...(gas && !HENRY_GASES.includes(gas) ? [h("option", { value: gas, selected: true, disabled: true }, `${nameOf(gas)} (no Henry's law constant)`)] : []),
        ...HENRY_GASES.map(g => h("option", { value: g, selected: g === gas }, `${nameOf(g)} (${byId.get(g)?.formula ?? ""})`)));
      const solvents = solventsFor(HENRY_GASES.includes(gas) ? gas : null);
      const solvSel = h("select", { id: `fa-solv-${uid}`, "data-fk": "solvent", "aria-invalid": bad.has(1) ? "true" : undefined,
        on: { change: ev => set({ solvent: ev.target.value }) } },
        ...(solvent && !solvents.includes(solvent) ? [h("option", { value: solvent, selected: true, disabled: true }, `${nameOf(solvent)} (no constant for this gas)`)] : []),
        ...solvents.map(s => h("option", { value: s, selected: s === solvent }, nameOf(s))));
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

  // binary pairs of the inputs with the tier of their parameters, for the model in use
  function pairRows(ids) {
    const eosView = VIEWS[state.view].family === "eos";
    if (ids.length < 2) return null;
    const model = eosView ? state.eos : state.model;
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
      : VIEWS[v].family === "eos" ? (state.eos === "PR" ? "Peng–Robinson" : "SRK") : state.model === "ideal" ? "Ideal" : state.model;
    const cond = v === "pxy" ? `T ${fmtTemp(pxyTemperature(state), u)}` : v === "henry" ? `${fmtTemp(state.henryT_K, u)}, p gas ${fmtP(state.henryP_kPa, u)}`
      : VIEWS[v].family === "activity" ? `P ${fmtP(state.P_kPa, u)}` : v === "envelope" ? "Feed under Results" : null;
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
    const names = state.components.map(nameOf);
    return names.length ? names.map((n, i) => (i ? n.toLowerCase() : n)).join(", ").replace(/, ([^,]*)$/, " and $1") : VIEWS[v].label;
  }

  function renderCanvasBar() {
    const v = state.view, u = state.units, check = checkInputs(v, state.inputs[v]);
    const title = check.ok ? state.title || calculationName() : VIEWS[v].label;
    const prop = v === "properties" ? explorerProperties().find(p => p.key === state.property) : null;
    const vap = state.vapour && state.vapour !== "ideal" ? ` with a ${state.vapour} vapour` : "";
    const sub = !check.ok ? `${NEEDS[v]} needed: choose them in Inputs` : {
      txy: `T-x-y diagram at ${fmtP(state.P_kPa, u)}, ${state.model}${vap}`,
      ternary: `Bubble-temperature map and residue curves at ${fmtP(state.P_kPa, u)}, ${state.model}${vap}`,
      azeotropes: `Binary and ternary azeotropes at ${fmtP(state.P_kPa, u)}, ${state.model}${vap}`,
      pxy: `P-x-y diagram at ${fmtTemp(pxyTemperature(state), u)}, ${state.eos === "PR" ? "Peng–Robinson" : "SRK"}`,
      envelope: `Bubble and dew points of the feed, ${state.eos === "PR" ? "Peng–Robinson" : "SRK"}`,
      henry: `Solubility at ${fmtTemp(state.henryT_K, u)} and a gas partial pressure of ${fmtP(state.henryP_kPa, u)}, Henry's law`,
      properties: `${prop?.label ?? "Property"} against temperature, pure component`,
      steam: "Temperature–entropy chart with isobars, IAPWS-IF97",
    }[v];
    const tog = (ico, label, pressed, onClick, fk) => h("button", { type: "button", class: "fa-icon-btn", "aria-pressed": String(pressed), title: label, "aria-label": label, "data-fk": fk, on: { click: onClick } }, icon(ico, 18));
    const ws = WORKSPACES.find(w => w.id === state.workspace);
    canvasBar.replaceChildren(
      h("div", { class: "fa-canvas-title" },
        h("div", { class: "fa-crumb" }, ws.label, state.workspace === "equilibrium" ? ` / ${VIEWS[v].label}` : ""),
        h("h2", {}, v === "properties" && check.ok ? [h("span", { class: "fa-role-tag" }, "Component"), title] : title),
        h("div", { class: "fa-sub" }, sub)),
      h("div", { class: "fa-canvas-tools", role: "toolbar", "aria-label": "Panels" },
        tog("panelL", "Inputs panel", state.panels.left, () => set({ panels: { left: !state.panels.left } }, { canvas: false }), "tog-left"),
        tog("layers", state.background ? "Hide background layers" : "Show background layers", state.background, () => set({ background: !state.background }, { canvas: false }), "tog-bg"),
        tog("panelR", "Results panel", state.panels.right, () => set({ panels: { right: !state.panels.right } }, { canvas: false }), "tog-right")));
  }

  // ---- drawer: Library, Sources, Settings
  function drawerSection(title, ...children) {
    return h("section", { class: "fa-dsec" }, h("h3", {}, title), ...children);
  }
  function drawerBody(id) {
    const u = state.units;
    if (id === "sources") {
      const check = checkInputs(state.view, state.inputs[state.view]);
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
    for (const el of [ribbon, body, statusBar]) el.inert = !!id;
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

  // ---- canvas
  const canvasKey = () => {
    const v = state.view, check = checkInputs(v, state.inputs[v]);
    return JSON.stringify([v, check.ok ? check.use : ["invalid", state.inputs[v]], state.model, state.eos, state.P_kPa, state.T_K,
      state.units, state.basis, state.residueCurves, state.isotherms, state.grid, state.property, state.z[v] ?? null,
      v === "henry" ? [state.inputs.henry, state.henryT_K, state.henryP_kPa, state.compareGases] : null, state.steamP_kPa, state.sets, state.prefer]);
  };
  let canvasRendered = false, token = 0;
  function renderCanvas(now = false) {
    const my = ++token;
    ui.status = { busy: true, ms: null, error: null, info: null };
    renderStatus();
    box.classList.add("fa-busy");
    const run = () => {
      if (my !== token) return;
      const t0 = performance.now();
      const v = state.view, check = checkInputs(v, state.inputs[v]);
      let info = null, error = null;
      notes.replaceChildren(); below.replaceChildren(); inspectorExtra.replaceChildren(); provenance.replaceChildren(); side.hidden = false;
      delete plot.dataset.view;
      if (!check.ok) {
        plot.replaceChildren(needInputs(v, check));
        side.replaceChildren(h("div", { class: "fa-empty" }, "No results yet: the inputs are incomplete."));
      } else {
        try {
          const viewState = { ...state, components: check.use, z: state.z[v] ?? null };
          info = renderView(v, { state: viewState, set, plot, side, notes, below, extra: inspectorExtra, compact: ui.size === "narrow", uid, badge, ui });
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
      renderStatus();
    };
    if (now) run(); else setTimeout(run, 16);
  }

  function needInputs(v, check) {
    return h("div", { class: "fa-need", role: "status" },
      h("h3", {}, `The ${lower(VIEWS[v].label)} needs: ${NEEDS[v].toLowerCase()}`),
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
  };
  renderChrome();
  renderCanvas(true);
  measure();
  return api;
}
