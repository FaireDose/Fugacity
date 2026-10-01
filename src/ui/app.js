/**
 * Workbench: Fugacity.app(target, config). A ribbon of tabs and buttons, a project panel
 * (components, pairs and their data), a canvas with the current diagram, an inspector
 * (readouts, calculators, sources) and a status bar.
 *
 * A view (layer 6): it calls only the layers below, through the same functions as the
 * public interface (system(), pure(), steam(), steamSat(), henry(), gasSolubility(),
 * listComponents(), PROPERTIES), and reuses the existing renderers (renderTxy,
 * renderTernary, the property explorer). State changes and the rules for which views can
 * run live in app-logic.js (tested without a DOM).
 */
import { injectAppStyles } from "./app-styles.js";
import { h } from "./dom.js";
import { icon } from "./icons.js";
import { listComponents } from "../thermo/system.js";
import { pure, PROPERTIES } from "../thermo/pure.js";
import { system } from "../system.js";
import {
  TABS, VIEWS, PRESETS, MAX_COMPONENTS, initialState, applyPatch, viewAvailability, toggleComponent, rotate,
  filterComponents, liquids, TIER_SHORT, fmtP, parseP, parseT, fmtTemp, pxyTemperature,
} from "./app-logic.js";
import { UNIT_CHOICES, explorerProperties, tToDisplay, pToDisplay, fmtShort } from "./properties-logic.js";
import { renderView } from "./app-views.js";
import pkg from "../../package.json" with { type: "json" };

const PROPERTY_GLYPHS = [
  ["density", () => "ρ", "Density"], ["enthalpy", () => "h", "Enthalpy"], ["cp", () => ["c", h("sub", {}, "p")], "Heat capacity"],
  ["viscosity", () => "μ", "Viscosity"], ["conductivity", () => "k", "Conductivity"], ["vapourPressure", () => ["P", h("sup", {}, "sat")], "Vapour pressure"],
];
const VIEW_ICON = { txy: "txy", ternary: "ternary", azeotropes: "azeo", pxy: "pxy", envelope: "envelope", henry: "henry", properties: "curves", steam: "dome" };

/**
 * Put the Fugacity workbench into a page element.
 *
 * @param {string|HTMLElement} target  element or CSS selector
 * @param {object} [cfg]
 * @param {"ternary"|"txy"|"azeotropes"|"eos"|"pxy"|"envelope"|"henry"|"properties"|"steam"} [cfg.start]
 *   first view (default: ternary for three liquids, T-x-y for two)
 * @param {string[]} [cfg.components]   up to six names, ids, formulas or CAS numbers
 *   (default methanol, acetone, chloroform)
 * @param {"NRTL"|"UNIQUAC"|"ideal"|"PR"|"SRK"} [cfg.model="NRTL"]  activity model; "PR" or "SRK" sets the equation of state
 * @param {"PR"|"SRK"} [cfg.eos="PR"]    equation of state for the Gases & EOS views
 * @param {number} [cfg.P_kPa=101.325]   pressure of the phase-equilibrium views
 * @param {number} [cfg.T_K=298.15]      temperature of the P-x-y diagram
 * @param {object} [cfg.units]           { T: "C"|"K", P: "bar"|"kPa", energy: "kJ/kg"|"J/mol", viscosity: "mPa s"|"Pa s" }
 * @param {"mole"|"mass"} [cfg.basis="mole"]  compositions in mole fractions or wt %
 * @param {string} [cfg.property="density"]   property of the property view
 * @param {boolean} [cfg.background=true]     show the background layers (colour map, isotherms, grid lines, two-liquid shading)
 * @param {{left?:boolean, right?:boolean}} [cfg.panels]  show the project panel and the inspector
 * @returns {{state:object, update:(patch:object)=>void}}
 *
 * @example
 * Fugacity.app("#app", { start: "ternary", components: ["methanol", "acetone", "chloroform"] });
 */
export function app(target, cfg = {}) {
  const root = typeof target === "string" ? document.querySelector(target) : target;
  if (!root) throw new Error(`Fugacity.app: no element matches "${target}".`);
  injectAppStyles(root.ownerDocument);

  let state = initialState(cfg);
  const uid = Math.random().toString(36).slice(2, 7);
  const all = listComponents();
  const sizeOf = w => (w < 720 ? "narrow" : w < 1080 ? "mid" : "wide");
  const ui = { query: "", menuOpen: false, size: sizeOf(root.clientWidth || 1200), libOpen: true, status: { busy: false, ms: null, error: null, info: null } };
  // on a phone the ribbon starts folded (the menu opens it) and so does the component library
  if (ui.size === "narrow") { ui.libOpen = false; if (cfg.ribbon == null) state = applyPatch(state, { ribbon: false }); }

  // ---- skeleton
  const box = h("div", { class: "fug fug-app" });
  const titleBar = h("div", { class: "fa-titlebar" });
  const ribbon = h("div", { class: "fa-ribbon", role: "tabpanel", id: `fa-rib-${uid}` });
  const left = h("aside", { class: "fa-left", "aria-label": "Project" });
  const canvasBar = h("div", { class: "fa-canvas-bar" });
  const notes = h("div", { class: "fa-notes" });
  const plot = h("div", { class: "fug-plot fa-plot" });
  const below = h("div", { class: "fa-below" });
  const canvas = h("main", { class: "fa-canvas" }, canvasBar, notes, plot, below);
  const side = h("div", { class: "fug-side fa-readout", "aria-live": "polite" });
  const inspectorExtra = h("div", { class: "fa-inspector-extra" });
  const right = h("aside", { class: "fa-right", "aria-label": "Inspector" },
    h("div", { class: "fa-panel-head" }, h("span", {}, "Inspector")), side, inspectorExtra);
  const statusBar = h("div", { class: "fa-status", role: "status" });
  const body = h("div", { class: "fa-body" }, left, canvas, right);
  box.append(titleBar, ribbon, body, statusBar);
  root.replaceChildren(box);

  // ---- size classes (the container, not the window: artifacts can be narrow on a wide screen)
  const measure = () => {
    const size = sizeOf(root.clientWidth || 1200);
    if (size !== ui.size) {
      ui.size = size;
      box.dataset.size = size;
      renderChrome();
      if (canvasRendered) renderCanvas(true);
    }
  };
  box.dataset.size = ui.size;
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(measure).observe(root);

  // ---- state changes
  function set(patch, { canvas: redraw = true } = {}) {
    const before = canvasKey();
    state = applyPatch(state, patch);
    api.state = state;
    renderChrome();
    if (redraw && canvasKey() !== before) renderCanvas();
  }

  // ---- buttons
  function bigButton({ ico, label, pressed, disabled, title, onClick }) {
    return h("button", { type: "button", class: "fa-btn fa-big", "aria-pressed": pressed == null ? undefined : String(!!pressed),
      disabled: !!disabled, title, on: { click: onClick } }, icon(ico, 26), h("span", {}, label));
  }
  function smallButton({ ico, label, pressed, disabled, title, onClick, glyph }) {
    return h("button", { type: "button", class: "fa-btn fa-small", "aria-pressed": pressed == null ? undefined : String(!!pressed),
      disabled: !!disabled, title, on: { click: onClick } },
      glyph ? h("span", { class: "fa-glyph", "aria-hidden": "true" }, glyph()) : icon(ico, 18), h("span", {}, label));
  }
  function seg(label, choices, current, onPick) {
    return h("div", { class: "fug-seg fa-seg", role: "group", "aria-label": label },
      ...choices.map(([v, text]) => h("button", { type: "button", "aria-pressed": String(current === v), on: { click: () => onPick(v) } }, text)));
  }
  function group(label, ...children) {
    return h("div", { class: "fa-group", role: "group", "aria-label": label },
      h("div", { class: "fa-group-body" }, ...children), h("div", { class: "fa-group-label" }, label));
  }
  const stack = (...children) => h("div", { class: "fa-stack" }, ...children);
  function viewButton(view, label) {
    const av = viewAvailability(view, state.components);
    return bigButton({ ico: VIEW_ICON[view], label, pressed: state.view === view, disabled: !av.enabled,
      title: av.enabled ? (av.note ?? VIEWS[view].label) : av.reason, onClick: () => set({ view }) });
  }
  function field(label, value, onCommit, { id, width = "6.5em", title } = {}) {
    const inp = h("input", { type: "text", inputmode: "decimal", id: `${id}-${uid}`, value, style: `width:${width}`, title,
      on: { change: ev => { if (onCommit(ev.target.value) === false) ev.target.value = value; } } });
    return h("label", { class: "fa-field", for: inp.id }, h("span", {}, label), inp);
  }

  // ---- ribbon tabs
  function ribbonGroups(tab) {
    const u = state.units;
    const pField = () => field(`Pressure, ${u.P}`, fmtShort(pToDisplay(state.P_kPa, u), 6),
      t => { const v = parseP(t, u); if (v == null) return false; set({ P_kPa: v }); }, { id: "p" });
    switch (tab) {
      case "components": return [
        group("Example systems", h("div", { class: "fa-cols" }, ...PRESETS.map(p => smallButton({
          ico: VIEW_ICON[p.view], label: p.label, pressed: p.components.join() === state.components.join(),
          onClick: () => set({ components: p.components, view: p.view }),
        })))),
        group("Arrange", stack(
          smallButton({ ico: "rotate", label: "Rotate order", disabled: state.components.length < 2, title: "Move the first component to the end (turns the ternary diagram)", onClick: () => set({ components: rotate(state.components) }) }),
          smallButton({ ico: "swap", label: "Reverse order", disabled: state.components.length < 2, onClick: () => set({ components: state.components.slice().reverse() }) }),
          smallButton({ ico: "clear", label: "Clear selection", disabled: !state.components.length, onClick: () => set({ components: [] }) }))),
        group("Find", stack(
          smallButton({ ico: "search", label: "Search components", onClick: () => { ui.libOpen = true; if (!state.panels.left) set({ panels: { left: true } }, { canvas: false }); else renderLeft(); setTimeout(() => left.querySelector("input[type=search]")?.focus(), 0); } }),
          h("div", { class: "fa-hint" }, `${state.components.length} of ${MAX_COMPONENTS} selected`))),
      ];
      case "vle": {
        const tern = state.view === "ternary";
        return [
          group("Diagram", viewButton("txy", "T-x-y"), viewButton("ternary", "Ternary map"), viewButton("azeotropes", "Azeotropes")),
          group("Overlays", stack(
            smallButton({ ico: "residue", label: "Residue curves", pressed: state.residueCurves, disabled: !tern, title: tern ? undefined : "Ternary map only", onClick: () => set({ residueCurves: !state.residueCurves }) }),
            smallButton({ ico: "isotherm", label: "Isotherms", pressed: state.isotherms, disabled: !tern, title: tern ? undefined : "Ternary map only", onClick: () => set({ isotherms: !state.isotherms }) }),
            smallButton({ ico: "layers", label: "Background", pressed: state.background, title: "Show or hide the colour map, isotherms, grid lines and two-liquid shading", onClick: () => set({ background: !state.background }, { canvas: false }) }))),
          group("Activity model", h("div", { class: "fa-stack" },
            seg("Activity model", [["NRTL", "NRTL"], ["UNIQUAC", "UNIQUAC"], ["ideal", "Ideal"]], state.model, m => set({ model: m })),
            h("div", { class: "fa-hint" }, state.model === "ideal" ? "Raoult's law, γ = 1" : "Liquid γ; vapour ideal gas"))),
          group("Conditions", h("div", { class: "fa-stack" }, pField(),
            h("label", { class: "fa-field", for: `fa-grid-${uid}` }, h("span", {}, "Map resolution"),
              h("select", { id: `fa-grid-${uid}`, disabled: !tern, on: { change: ev => set({ grid: +ev.target.value }) } },
                ...[[24, "Coarse"], [40, "Normal"], [60, "Fine"]].map(([v, t]) => h("option", { value: v, selected: state.grid === v }, t)))))),
          group("Composition", seg("Composition basis", [["mole", "mol frac"], ["mass", "wt %"]], state.basis, b => set({ basis: b }))),
        ];
      }
      case "eos": return [
        group("Equation of state", h("div", { class: "fa-stack" },
          seg("Equation of state", [["PR", "Peng–Robinson"], ["SRK", "SRK"]], state.eos, m => set({ eos: m })),
          h("div", { class: "fa-hint" }, "Both phases; k_ij from the databank"))),
        group("Diagram", viewButton("pxy", "P-x-y"), viewButton("envelope", "Phase envelope")),
        group("Henry's law", viewButton("henry", "Gas in water")),
        group("Conditions", h("div", { class: "fa-stack" },
          field(`Temperature, ${u.T === "K" ? "K" : "°C"}`, String(+tToDisplay(pxyTemperature(state), u).toFixed(3)),
            t => { if (String(t).trim() === "") { set({ T_K: null }); return; } const v = parseT(t, u); if (v == null) return false; set({ T_K: v }); },
            { id: "t", title: "Temperature of the P-x-y diagram. Leave empty for 85 % of the lowest critical temperature." }),
          field(`Gas pressure, ${u.P}`, fmtShort(pToDisplay(state.henryP_kPa, u), 6),
            t => { const v = parseP(t, u); if (v == null) return false; set({ henryP_kPa: v }); }, { id: "hp", title: "Partial pressure of the gas over the water (Henry's law view)" }))),
      ];
      case "properties": {
        const propComp = state.propComponent ?? state.components[0] ?? "water";
        const more = explorerProperties().filter(p => !PROPERTY_GLYPHS.some(g => g[0] === p.key));
        return [
          group("Component", h("div", { class: "fa-stack" },
            h("label", { class: "fa-field", for: `fa-pc-${uid}` }, h("span", {}, "Pure component"),
              h("select", { id: `fa-pc-${uid}`, on: { change: ev => set({ propComponent: ev.target.value, view: "properties" }) } },
                ...all.map(c => h("option", { value: c.id, selected: c.id === propComp }, c.name)))),
            h("div", { class: "fa-hint" }, "Constants and sources in the inspector"))),
          group("Property", h("div", { class: "fa-cols fa-cols-3" }, ...PROPERTY_GLYPHS.map(([key, glyph, label]) => smallButton({
            glyph, label, pressed: state.view === "properties" && state.property === key, onClick: () => set({ property: key, view: "properties" }),
          })))),
          group("More correlations", h("div", { class: "fa-stack" },
            h("label", { class: "fa-field", for: `fa-pm-${uid}` }, h("span", {}, "Function of T only"),
              h("select", { id: `fa-pm-${uid}`, on: { change: ev => { if (ev.target.value) set({ property: ev.target.value, view: "properties" }); } } },
                h("option", { value: "" }, "Choose…"),
                ...more.map(p => h("option", { value: p.key, selected: state.property === p.key }, p.label)))))),
          group("Energy basis", seg("Energy basis", UNIT_CHOICES.basis, u.basis, b => set({ units: { basis: b } }))),
        ];
      }
      case "steam": return [
        group("Diagram", viewButton("steam", "T-s chart")),
        group("Isobars", h("div", { class: "fa-stack" },
          field(`Pressures, ${u.P}`, state.steamP_kPa.map(P => fmtShort(pToDisplay(P, u), 6)).join(", "),
            t => { const list = String(t).split(/[\s,;]+/).map(v => parseP(v, u)).filter(v => v != null); if (!list.length) return false; set({ steamP_kPa: list }); },
            { id: "sp", width: "14em", title: "Up to six pressures, separated by commas" }),
          h("div", { class: "fa-hint" }, "Up to six, separated by commas"))),
        group("Standard", h("div", { class: "fa-stack fa-about" },
          h("div", {}, "IAPWS-IF97 water and steam"),
          h("div", { class: "fa-hint" }, "Viscosity IAPWS R12-08, conductivity R15-11"))),
      ];
      case "view": return [
        group("Units", h("div", { class: "fa-units" },
          h("span", {}, "Temperature"), seg("Temperature unit", UNIT_CHOICES.T, u.T, v => set({ units: { T: v } })),
          h("span", {}, "Pressure"), seg("Pressure unit", UNIT_CHOICES.P, u.P, v => set({ units: { P: v } })),
          h("span", {}, "Composition"), seg("Composition basis", [["mole", "mol frac"], ["mass", "wt %"]], state.basis, b => set({ basis: b })),
          h("span", {}, "Energy"), seg("Energy basis", UNIT_CHOICES.basis, u.basis, v => set({ units: { basis: v } })))),
        group("Show", stack(
          smallButton({ ico: "panelL", label: "Project panel", pressed: state.panels.left, onClick: () => set({ panels: { left: !state.panels.left } }, { canvas: false }) }),
          smallButton({ ico: "panelR", label: "Inspector", pressed: state.panels.right, onClick: () => set({ panels: { right: !state.panels.right } }, { canvas: false }) }),
          smallButton({ ico: "layers", label: "Background layers", pressed: state.background, onClick: () => set({ background: !state.background }, { canvas: false }) }))),
        group("Theme", h("div", { class: "fa-stack fa-about" },
          h("div", { class: "fa-theme" }, icon("theme", 18), "Follows the page"),
          h("div", { class: "fa-hint" }, "Light or dark, as the host page or system is set"))),
      ];
      default: return [];
    }
  }

  function renderTitleBar() {
    const tabs = TABS.map(t => h("button", { type: "button", role: "tab", class: "fa-tab", id: `fa-tab-${t.id}-${uid}`,
      "aria-selected": String(state.tab === t.id), "aria-controls": ribbon.id, tabindex: state.tab === t.id ? "0" : "-1",
      on: {
        click: () => { ui.menuOpen = false; if (state.tab === t.id && !state.ribbon) set({ ribbon: true }, { canvas: false }); else set({ tab: t.id }, { canvas: false }); },
        dblclick: () => set({ ribbon: !state.ribbon }, { canvas: false }),
        keydown: ev => {
          const i = TABS.findIndex(x => x.id === state.tab);
          const j = ev.key === "ArrowRight" ? (i + 1) % TABS.length : ev.key === "ArrowLeft" ? (i + TABS.length - 1) % TABS.length : -1;
          if (j >= 0) { ev.preventDefault(); set({ tab: TABS[j].id }, { canvas: false }); titleBar.querySelector(`#fa-tab-${TABS[j].id}-${uid}`)?.focus(); }
        },
      } }, t.label));
    const current = TABS.find(t => t.id === state.tab);
    const menuBtn = h("button", { type: "button", class: "fa-menu-btn", "aria-expanded": String(ui.menuOpen), "aria-haspopup": "true",
      on: { click: () => { ui.menuOpen = !ui.menuOpen; renderTitleBar(); } } }, icon("menu", 18), h("span", {}, current.label), icon(ui.menuOpen ? "chevronUp" : "chevronDown", 16));
    const menu = ui.menuOpen ? h("div", { class: "fa-menu", role: "menu" }, ...TABS.map(t => h("button", { type: "button", role: "menuitemradio",
      "aria-checked": String(state.tab === t.id), on: { click: () => { ui.menuOpen = false; set({ tab: t.id, ribbon: true }, { canvas: false }); } } }, t.label))) : null;
    titleBar.replaceChildren(
      h("div", { class: "fa-brand" }, icon("logo", 22), h("span", { class: "fa-name" }, "Fugacity")),
      ui.size === "narrow" ? h("div", { class: "fa-menu-wrap" }, menuBtn, menu) : h("div", { class: "fa-tabs", role: "tablist", "aria-label": "Ribbon" }, ...tabs),
      h("button", { type: "button", class: "fa-icon-btn fa-collapse", title: state.ribbon ? "Collapse the ribbon" : "Expand the ribbon",
        "aria-label": state.ribbon ? "Collapse the ribbon" : "Expand the ribbon", "aria-expanded": String(state.ribbon),
        on: { click: () => set({ ribbon: !state.ribbon }, { canvas: false }) } }, icon(state.ribbon ? "chevronUp" : "chevronDown", 16)));
  }

  // ---- project panel
  function renderLeft() {
    const m = new Map(all.map(c => [c.id, c]));
    const chips = state.components.map((id, i) => h("li", { class: "fa-chip" },
      h("span", { class: "fa-chip-n", "aria-hidden": "true" }, String(i + 1)),
      h("span", { class: "fa-chip-name" }, m.get(id)?.name ?? id),
      h("span", { class: "fa-chip-f" }, m.get(id)?.formula ?? ""),
      h("button", { type: "button", class: "fa-x", "aria-label": `Remove ${m.get(id)?.name ?? id}`, title: "Remove",
        on: { click: () => set({ components: state.components.filter(x => x !== id) }) } }, icon("close", 14))));
    const search = h("input", { type: "search", placeholder: "Name, formula or CAS", value: ui.query, "aria-label": "Search components", id: `fa-q-${uid}`,
      on: { input: ev => { ui.query = ev.target.value; list.replaceChildren(...libraryRows()); } } });
    const list = h("div", { class: "fa-lib" }, ...libraryRows());
    const pairs = pairRows();
    left.replaceChildren(
      h("div", { class: "fa-panel-head" }, h("span", {}, "System"), h("span", { class: "fa-count" }, `${state.components.length}/${MAX_COMPONENTS}`)),
      state.components.length ? h("ol", { class: "fa-chips" }, ...chips) : h("div", { class: "fa-empty" }, "No components yet. Pick some below or start from an example system on the Components tab."),
      pairs ?? "",
      h("button", { type: "button", class: "fa-panel-head fa-panel-toggle", "aria-expanded": String(ui.libOpen),
        on: { click: () => { ui.libOpen = !ui.libOpen; renderLeft(); } } },
        h("span", {}, "Component library"), h("span", { class: "fa-count" }, String(all.length), icon(ui.libOpen ? "chevronUp" : "chevronDown", 14))),
      ...(ui.libOpen ? [h("div", { class: "fa-search" }, icon("search", 16), search), list] : []));
  }

  function libraryRows() {
    const found = filterComponents(all, ui.query);
    const groups = [["Liquids", "Activity models and equations of state", found.filter(c => c.activity)],
      ["Gases", "Equations of state and Henry's law", found.filter(c => !c.activity)]];
    const rows = [];
    for (const [title, sub, items] of groups) {
      if (!items.length) continue;
      rows.push(h("div", { class: "fa-lib-head", title: sub }, title));
      for (const c of items) {
        const on = state.components.includes(c.id);
        const full = !on && state.components.length >= MAX_COMPONENTS;
        rows.push(h("button", { type: "button", class: "fa-lib-row", "aria-pressed": String(on), disabled: full, title: full ? `At most ${MAX_COMPONENTS} components` : c.cas,
          on: { click: () => set({ components: toggleComponent(state.components, c.id) }) } },
          h("span", { class: "fa-check", "aria-hidden": "true" }, on ? icon("check", 14) : null),
          h("span", { class: "fa-lib-name" }, c.name), h("span", { class: "fa-lib-f" }, c.formula)));
      }
    }
    if (!rows.length) rows.push(h("div", { class: "fa-empty" }, `Nothing matches “${ui.query}”. The library has ${all.length} components; more come as open data is added.`));
    return rows;
  }

  // binary pairs of the selection with the tier of their parameters, for the model in use
  function pairRows() {
    const eosView = VIEWS[state.view].tab === "eos" && state.view !== "henry";
    const ids = eosView ? state.components : liquids(state.components);
    if (ids.length < 2 || state.view === "properties" || state.view === "steam" || state.view === "henry") return null;
    const model = eosView ? state.eos : state.model;
    if (model === "ideal") return h("div", { class: "fa-pairs" }, h("div", { class: "fa-panel-sub" }, "Pairs: ideal solution, no parameters"));
    let info;
    try { info = system({ components: ids, model, allowMissingPairs: true }).info; } catch (e) {
      return h("div", { class: "fa-pairs" }, h("div", { class: "fa-panel-sub" }, `Pairs (${model})`), h("div", { class: "fa-empty" }, e.message));
    }
    const rows = info.pairs.filter(p => p.tier !== "none").map(p => h("li", { title: p.source }, h("span", {}, p.pair.join(" + ")), badge(p.tier)));
    for (const mp of info.missingPairs) rows.push(h("li", { title: eosView ? "No k_ij in the databank: k_ij = 0 is used" : "No parameters: these pairs cannot be calculated" }, h("span", {}, mp.join(" + ")), badge("none")));
    return h("div", { class: "fa-pairs" }, h("div", { class: "fa-panel-sub" }, `Pairs, ${eosView ? `${model} k_ij` : model}`), h("ul", {}, ...rows));
  }

  function renderStatus() {
    const st = ui.status, u = state.units;
    const tab = VIEWS[state.view].tab;
    const model = state.view === "steam" ? "IAPWS-IF97" : state.view === "henry" ? "Henry's law" : state.view === "properties" ? "Pure-component data"
      : tab === "eos" ? (state.eos === "PR" ? "Peng–Robinson" : "SRK") : state.model === "ideal" ? "Ideal" : state.model;
    const cond = state.view === "pxy" ? `T ${fmtTemp(pxyTemperature(state), u)}` : state.view === "henry" ? `p gas ${fmtP(state.henryP_kPa, u)}`
      : ["txy", "ternary", "azeotropes"].includes(state.view) ? `P ${fmtP(state.P_kPa, u)}` : state.view === "envelope" ? "Feed in the inspector" : null;
    const cell = (cls, ...c) => h("span", { class: `fa-cell ${cls}` }, ...c);
    statusBar.replaceChildren(
      cell("fa-state" + (st.error ? " is-err" : st.busy ? " is-busy" : ""), h("i", { "aria-hidden": "true" }),
        st.busy ? "Calculating" : st.error ? "Error" : st.ms != null ? `Ready, ${st.ms < 1000 ? `${Math.max(1, Math.round(st.ms))} ms` : `${(st.ms / 1000).toFixed(1)} s`}` : "Ready"),
      cell("", model),
      ...(cond ? [cell("", cond)] : []),
      st.info?.data ? cell("fa-grow", st.info.data) : h("span", { class: "fa-grow" }),
      cell("fa-hide-narrow", `${u.T === "K" ? "K" : "°C"}, ${u.P}, ${state.basis === "mass" ? "wt %" : "mol frac"}`),
      cell("", `Fugacity ${pkg.version}`));
    statusBar.hidden = false;
  }

  function renderCanvasBar() {
    const av = viewAvailability(state.view, state.components);
    const names = av.use.map(id => all.find(c => c.id === id)?.name ?? id);
    const title = state.title || (state.view === "steam" ? "Water and steam" : state.view === "henry" ? "Gases in water"
      : names.length ? names.map((n, i) => (i ? n.toLowerCase() : n)).join(", ").replace(/, ([^,]*)$/, " and $1") : VIEWS[state.view].label);
    const u = state.units;
    const sub = {
      txy: `T-x-y diagram at ${fmtP(state.P_kPa, u)}, ${state.model}`,
      ternary: `Bubble-temperature map and residue curves at ${fmtP(state.P_kPa, u)}, ${state.model}`,
      azeotropes: `Binary and ternary azeotropes at ${fmtP(state.P_kPa, u)}, ${state.model}`,
      pxy: `P-x-y diagram at ${fmtTemp(pxyTemperature(state), u)}, ${state.eos === "PR" ? "Peng–Robinson" : "SRK"}`,
      envelope: `Bubble and dew points of the feed, ${state.eos === "PR" ? "Peng–Robinson" : "SRK"}`,
      henry: `Solubility at a gas partial pressure of ${fmtP(state.henryP_kPa, u)}, Henry's law`,
      properties: "Pure-component properties against temperature",
      steam: "Temperature–entropy chart with isobars, IAPWS-IF97",
    }[state.view];
    const tog = (ico, label, pressed, onClick) => h("button", { type: "button", class: "fa-icon-btn", "aria-pressed": String(pressed), title: label, "aria-label": label, on: { click: onClick } }, icon(ico, 18));
    canvasBar.replaceChildren(
      h("div", { class: "fa-canvas-title" }, h("h2", {}, title), h("div", { class: "fa-sub" }, sub, av.note ? ` (${av.note.replace(/\.$/, "").toLowerCase()})` : "")),
      h("div", { class: "fa-canvas-tools", role: "toolbar", "aria-label": "Canvas" },
        tog("panelL", "Project panel", state.panels.left, () => set({ panels: { left: !state.panels.left } }, { canvas: false })),
        tog("layers", state.background ? "Hide background layers" : "Show background layers", state.background, () => set({ background: !state.background }, { canvas: false })),
        tog("panelR", "Inspector", state.panels.right, () => set({ panels: { right: !state.panels.right } }, { canvas: false }))));
  }

  function renderChrome() {
    box.classList.toggle("fa-no-left", !state.panels.left);
    box.classList.toggle("fa-no-right", !state.panels.right);
    box.classList.toggle("fa-nobg", !state.background);
    box.classList.toggle("fa-ribbon-closed", !state.ribbon);
    renderTitleBar();
    ribbon.setAttribute("aria-labelledby", `fa-tab-${state.tab}-${uid}`);
    ribbon.hidden = !state.ribbon;
    ribbon.replaceChildren(...ribbonGroups(state.tab));
    left.hidden = !state.panels.left;
    right.hidden = !state.panels.right;
    renderLeft();
    renderCanvasBar();
    renderStatus();
  }

  // ---- canvas
  const canvasKey = () => JSON.stringify([state.view, viewAvailability(state.view, state.components).use, state.model, state.eos, state.P_kPa, state.T_K,
    state.units, state.basis, state.residueCurves, state.isotherms, state.grid, state.property, state.propComponent, state.z, state.henryP_kPa, state.steamP_kPa]);
  let canvasRendered = false, token = 0;
  function renderCanvas(now = false) {
    const my = ++token;
    ui.status = { busy: true, ms: null, error: null, info: null };
    renderStatus();
    box.classList.add("fa-busy");
    const run = () => {
      if (my !== token) return;
      const t0 = performance.now();
      let info = null, error = null;
      notes.replaceChildren(); below.replaceChildren(); inspectorExtra.replaceChildren(); side.hidden = false;
      try {
        info = renderView(state.view, { state, set, plot, side, notes, below, extra: inspectorExtra, compact: ui.size === "narrow", uid, badge });
      } catch (e) {
        error = e.message;
        plot.replaceChildren(h("div", { class: "fug-err", role: "alert" }, e.message));
        side.replaceChildren(h("div", { class: "fa-empty" }, "No readout: the calculation stopped with the error shown on the canvas."));
      }
      canvasRendered = true;
      box.classList.remove("fa-busy");
      ui.status = { busy: false, ms: performance.now() - t0, error: error ?? info?.error ?? null, info };
      renderStatus();
    };
    if (now) run(); else setTimeout(run, 16);
  }

  function badge(tier) {
    return h("span", { class: `fa-tier fa-tier-${tier}`, title: tier === "none" ? "No parameters in the databank" : `Tier: ${tier}` }, TIER_SHORT[tier] ?? tier);
  }

  const api = {
    state,
    /** Change the workbench: any configuration key, plus view, tab, panels, ribbon, z. */
    update(patch = {}) { set(patch); },
  };
  renderChrome();
  renderCanvas(true);
  measure();
  return api;
}
