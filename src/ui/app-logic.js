/**
 * Workbench (Fugacity.app): the DOM-free part. Configuration, state changes (navigation
 * between workspaces, the inputs each view keeps, the supporting panels), which views can
 * run for a list of components, component search, and display formatting. The workspaces
 * and the checks of the inputs are in workspaces.js.
 *
 * No thermodynamics here: this file only reads the component list (listComponents), the
 * list of gases with a Henry's law constant (HENRY_GASES), the known-deviation list
 * (src/data/known-issues.json) and the parameter sets of the library (library.sets), and
 * converts units with the exact definitions in properties-logic.js (0 °C = 273.15 K,
 * 1 bar = 100 kPa).
 */
import { normalizeFlowsheet } from "../flowsheet/document.js";
import { listComponents, findComponent, MODELS, EOS_MODELS } from "../thermo/system.js";
import { library, selection } from "../thermo/library.js";
import { HENRY_GASES } from "../thermo/henry.js";
import { pure } from "../thermo/pure.js";
import knownIssues from "../data/known-issues.json" with { type: "json" };
import { WORKSPACES, UTILITIES, INPUTS, checkInputs, normalizeInputs, seedInputs, isEosModel } from "./workspaces.js";
import { normalizeUnits, tToDisplay, tFromDisplay, pToDisplay, pFromDisplay, fmtShort } from "./properties-logic.js";
import { normalizeFlash, FLASH_DEFAULTS } from "./flash-logic.js";

/**
 * Canvas views: the workspace each belongs to and its name. The phase-equilibrium diagrams
 * (`diagram: true`) all use the one model of the Model group: an activity-coefficient model
 * (NRTL, UNIQUAC, ideal, with a vapour model) or an equation of state (PR, SRK).
 */
export const VIEWS = {
  txy: { workspace: "equilibrium", diagram: true, label: "T-x-y diagram" },
  ternary: { workspace: "equilibrium", diagram: true, label: "Ternary map" },
  azeotropes: { workspace: "equilibrium", diagram: true, label: "Azeotropes" },
  pxy: { workspace: "equilibrium", diagram: true, label: "P-x-y diagram" },
  envelope: { workspace: "equilibrium", diagram: true, label: "Phase envelope" },
  flash: { workspace: "flash", label: "Flash" },
  henry: { workspace: "solubility", label: "Gas solubility" },
  properties: { workspace: "properties", label: "Property curves" },
  steam: { workspace: "steam", label: "Steam tables" },
};

/** Every model of the Model group: activity-coefficient models, then equations of state. */
export const ALL_MODELS = [...MODELS, ...EOS_MODELS];

/** The model as a short phrase: "NRTL with a PR vapour", "Peng–Robinson", "Ideal solution". */
export function modelLabel(state) {
  const m = state.model;
  if (isEosModel(m)) return m === "PR" ? "Peng–Robinson" : "SRK";
  const liquid = m === "ideal" ? "Ideal solution" : m;
  return state.vapour && state.vapour !== "ideal" ? `${liquid} with a ${state.vapour} vapour` : liquid;
}

/**
 * The ribbon tabs of earlier versions, still accepted by update({ tab }): "vle" and "eos"
 * open the phase-equilibrium workspace with an activity model or an equation of state,
 * "properties" and "steam" their workspaces, "library" and "view" open the Library and the
 * Settings panels, "components" shows the Inputs panel.
 */
export const LEGACY_TABS = ["components", "vle", "eos", "properties", "steam", "library", "view"];

/** Ready-made component sets (the Examples menu of the Inputs panel); `model`: the one they need, when not an activity model. */
export const PRESETS = [
  { label: "Methanol, acetone, chloroform", components: ["methanol", "acetone", "chloroform"], view: "ternary" },
  { label: "Water, acetic acid, ethylene glycol", components: ["water", "acetic-acid", "ethylene-glycol"], view: "ternary" },
  { label: "Ethanol, water, ethyl acetate", components: ["ethanol", "water", "ethyl-acetate"], view: "ternary" },
  { label: "Ethanol, water", components: ["ethanol", "water"], view: "txy" },
  { label: "Benzene, toluene", components: ["benzene", "toluene"], view: "txy" },
  { label: "Methane, ethane", components: ["methane", "ethane"], view: "pxy", model: "PR" },
  { label: "Nitrogen, oxygen", components: ["nitrogen", "oxygen"], view: "envelope", model: "PR" },
];

export const MAX_COMPONENTS = 6;
const START_ALIASES = { drum: "flash", eos: "eos", "pt": "envelope", "p-x-y": "pxy", "t-x-y": "txy", vle: "ternary", gases: "henry", solubility: "henry", explorer: "properties", library: "sources" };

const normModel = m => (String(m ?? "NRTL").toUpperCase() === "IDEAL" ? "ideal" : String(m ?? "NRTL").toUpperCase());
const normEos = m => String(m ?? "PR").toUpperCase();

/** Component ids from names, aliases, formulas or CAS numbers; duplicates dropped; at most MAX_COMPONENTS. */
export function normalizeComponents(list) {
  const ids = [];
  for (const c of list ?? []) {
    const id = findComponent(c);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, MAX_COMPONENTS);
}

/** The component records (from listComponents) by id. */
export function componentMap() {
  return new Map(listComponents().map(c => [c.id, c]));
}

/** Components usable with activity-coefficient models (liquids with vapour pressure and UNIQUAC data). */
export function liquids(ids) {
  const m = componentMap();
  return ids.filter(id => m.get(id)?.activity);
}

/** Selected gases that have a Henry's law constant in water. */
export function henryGases(ids) {
  return ids.filter(id => HENRY_GASES.includes(id));
}

/**
 * Can a view run with this list of components, and on which ones? Used to choose the first
 * view from the configuration (and from update({ components })).
 * @returns {{enabled:boolean, use:string[], reason?:string, note?:string}}
 *   `use`: the components the view will show; `reason`: why it cannot run;
 *   `note`: what the view does with the list (e.g. "first two of three liquids").
 */
export function viewAvailability(view, ids, model = "NRTL") {
  // with an equation of state every component can be in a diagram
  const liq = isEosModel(model) ? ids.slice() : liquids(ids);
  const word = n => ["no", "one", "two", "three", "four", "five", "six"][n] ?? String(n);
  switch (view) {
    case "txy":
      if (liq.length < 2) return { enabled: false, use: [], reason: `A T-x-y diagram needs two liquids; ${word(liq.length)} selected.` };
      return { enabled: true, use: liq.slice(0, 2), note: liq.length > 2 ? `First two of ${word(liq.length)} liquids.` : undefined };
    case "ternary":
      if (liq.length < 3) return { enabled: false, use: [], reason: `A ternary map needs three liquids; ${word(liq.length)} selected.` };
      return { enabled: true, use: liq.slice(0, 3), note: liq.length > 3 ? `First three of ${word(liq.length)} liquids.` : undefined };
    case "azeotropes":
      if (liq.length < 2) return { enabled: false, use: [], reason: `An azeotrope search needs at least two liquids; ${word(liq.length)} selected.` };
      return { enabled: true, use: liq.slice(0, 4), note: liq.length > 4 ? `First four of ${word(liq.length)} liquids.` : undefined };
    case "pxy":
      if (liq.length < 2) return { enabled: false, use: [], reason: `A P-x-y diagram needs two ${isEosModel(model) ? "components" : "liquids"}; ${word(liq.length)} selected.` };
      return { enabled: true, use: liq.slice(0, 2), note: liq.length > 2 ? `First two of ${word(liq.length)}.` : undefined };
    case "envelope": {
      const min = isEosModel(model) ? 1 : 2;
      if (liq.length < min) return { enabled: false, use: [], reason: min === 1 ? "Select at least one component." : `With an activity model the phase envelope needs two liquids; ${word(liq.length)} selected.` };
      return { enabled: true, use: liq.slice(0, 6) };
    }
    case "flash": {
      const min = isEosModel(model) ? 1 : 2;
      if (liq.length < min) return { enabled: false, use: [], reason: `A flash needs ${min === 1 ? "a component" : "two liquids with an activity model"}; ${word(liq.length)} selected.` };
      return { enabled: true, use: liq.slice(0, 6) };
    }
    case "henry": {
      const g = henryGases(ids);
      return { enabled: true, use: g.length ? g : HENRY_GASES.slice(), note: g.length ? undefined : "No gas selected: all gases with a Henry's law constant are shown." };
    }
    case "properties":
      return { enabled: true, use: ids.length ? [ids[0]] : ["water"] };
    case "steam":
      return { enabled: true, use: ["water"] };
    default:
      throw new Error(`Unknown view "${view}". Known: ${Object.keys(VIEWS).join(", ")}.`);
  }
}

/** A view name of this or an earlier version ("eos", "gases", "explorer", …) as a view id; "sources" for the library names. */
function aliasOf(wanted) {
  const w = String(wanted ?? "");
  return START_ALIASES[w.toLowerCase()] ?? w;
}

/**
 * The first view that can run with a list of components and the model, preferring `wanted`
 * (resolves "eos" to P-x-y or the envelope). Without a wanted view: the ternary map for three
 * liquids, the T-x-y diagram for two, else P-x-y for two components and the phase envelope
 * for one or more than two (with an equation of state). Without components: the wanted view
 * with empty inputs, or the T-x-y diagram (the workbench opens empty and asks for them).
 */
export function resolveView(wanted, ids, model = "NRTL") {
  let v = aliasOf(wanted);
  if (v === "eos") v = ids.length === 2 ? "pxy" : "envelope";
  if (!ids.length) return VIEWS[v] ? v : "txy";
  if (VIEWS[v] && viewAvailability(v, ids, model).enabled) return v;
  const liq = liquids(ids).length;
  if ((v === "pxy" || v === "envelope") && viewAvailability("envelope", ids, model).enabled) return "envelope";
  if (liq >= 3) return "ternary";
  if (liq === 2) return "txy";
  if (ids.length === 2 && viewAvailability("pxy", ids, model).enabled) return "pxy";
  if (ids.length && viewAvailability("envelope", ids, model).enabled) return "envelope";
  return ids.length ? "envelope" : "properties";
}

const DEFAULTS = {
  components: ["methanol", "acetone", "chloroform"],
  model: "NRTL", eos: "PR", vapour: "ideal", P_kPa: 101.325, basis: "mole",
  background: true, residueCurves: true, isotherms: true, grid: 40,
  property: "density", henryP_kPa: 101.325, henryT_K: 298.15, steamP_kPa: [10, 100, 1000, 10000],
};

/**
 * Normalize the configuration of Fugacity.app into the initial state. Unknown models,
 * units and components throw (a typo is never silently ignored).
 *
 * The model: `model` is one of ALL_MODELS and is used by every phase-equilibrium diagram;
 * `eos` remembers the last equation of state (the `eos` key and `tab: "eos"` select it).
 * Without `model`, an equation of state is chosen when the configuration asks for one
 * (`eos`, or start "eos", "pxy" or "envelope") or when the components need one (gases).
 *
 * The state holds, besides the settings:
 *  - `workspace` (WORKSPACES) and `view`, the view on the canvas; `diagram`, the view the
 *    phase-equilibrium workspace remembers;
 *  - `inputs`: the inputs of every view, kept separately ({ txy: [id, id], ternary: [id, id, id],
 *    azeotropes: [...], pxy: [id, id], envelope: [...], henry: { gas, solvent }, properties: [id] });
 *  - `utility`: the open supporting panel (null, "library", "sources" or "settings");
 *  - `flash`: the settings of the Flash workspace (flash-logic.js FLASH_DEFAULTS: spec, T_K,
 *    P_kPa, VF, Q_J_mol, feedT_K, feedP_kPa, duty, z);
 *  - `components`: the components the current view uses (read-only summary), and
 *    `propComponent`, the component of the Properties workspace (read-only).
 */
export function initialState(cfg = {}) {
  const components = normalizeComponents(cfg.components ?? DEFAULTS.components);
  let start = aliasOf(cfg.start ?? "");
  const explicit = cfg.model != null;
  let model = checkModel(normModel(cfg.model ?? DEFAULTS.model));
  const eos = checkEos(normEos(isEosModel(model) ? model : cfg.eos ?? DEFAULTS.eos));
  if (!explicit) {
    const asked = cfg.eos != null || ["eos", "pxy", "envelope"].includes(start);
    const liquidView = resolveView(start === "sources" ? "" : start, components, model);
    const needsEos = components.length > 0 && VIEWS[liquidView].diagram && !viewAvailability(liquidView, components, model).enabled;
    if (asked || needsEos) model = eos;
  }
  const state = {
    workspace: null,
    view: null,
    diagram: null,
    utility: null,
    inputs: seedInputs(components, { propComponent: cfg.propComponent, gas: cfg.gas, solvent: cfg.solvent, model }),
    components: [],
    model,
    eos,
    vapour: checkVapour(cfg.vapour ?? DEFAULTS.vapour),
    P_kPa: positive(cfg.P_kPa ?? DEFAULTS.P_kPa, "P_kPa"),
    T_K: cfg.T_K == null ? null : positive(cfg.T_K, "T_K"),
    units: normalizeUnits(cfg.units ?? {}, { T: "C", P: "kPa", basis: "mass", viscosity: "mPa s" }),
    basis: cfg.basis === "mass" ? "mass" : "mole",
    background: cfg.background !== false,
    panels: { left: cfg.panels?.left !== false, right: cfg.panels?.right !== false },
    ribbon: cfg.ribbon !== false,
    residueCurves: cfg.residueCurves !== false,
    isotherms: cfg.isotherms !== false,
    grid: [24, 40, 60].includes(cfg.grid) ? cfg.grid : DEFAULTS.grid,
    property: cfg.property ?? DEFAULTS.property,
    propComponent: null,
    z: { pxy: null, envelope: null },
    henryP_kPa: positive(cfg.henryP_kPa ?? DEFAULTS.henryP_kPa, "henryP_kPa"),
    henryT_K: positive(cfg.henryT_K ?? DEFAULTS.henryT_K, "henryT_K"),
    compareGases: !!cfg.compareGases,
    steamP_kPa: cleanList(cfg.steamP_kPa ?? DEFAULTS.steamP_kPa),
    flash: normalizeFlash(cfg.flash ?? {}, FLASH_DEFAULTS),
    title: cfg.title,
    sets: normalizeSets(cfg.sets),
    flowsheet: normalizeFlowsheet(cfg.flowsheet),
    prefer: normalizePrefer(cfg.prefer),
  };
  if (start === "sources") { state.utility = "sources"; start = ""; }
  const view = resolveView(start, components, model);
  const firstDiagram = resolveView("", components, model);
  state.workspace = VIEWS[view].workspace;
  state.diagram = VIEWS[view].workspace === "equilibrium" ? view : VIEWS[firstDiagram].workspace === "equilibrium" ? firstDiagram : "ternary";
  if (cfg.z != null && view in state.z) state.z[view] = normalizeComposition(cfg.z, checkInputs(view, state.inputs[view], model).use.length);
  return derive(state, view);
}

/** Fill in the read-only summary fields: view, components (in use) and propComponent. */
function derive(state, view) {
  state.view = view ?? (state.workspace === "equilibrium" ? state.diagram : WORKSPACES.find(w => w.id === state.workspace).view);
  state.components = checkInputs(state.view, state.inputs[state.view], state.model).use;
  state.propComponent = state.inputs.properties[0] ?? null;
  return state;
}

function checkModel(m) {
  if (!ALL_MODELS.includes(m)) throw new Error(`Unknown model "${m}". Use an activity model (${MODELS.join(", ")}) or an equation of state (${EOS_MODELS.join(", ")}).`);
  return m;
}
/** Vapour model of the activity-coefficient views: "ideal", "PR" or "SRK". */
function checkVapour(v) {
  const m = String(v).toUpperCase() === "IDEAL" ? "ideal" : String(v).toUpperCase();
  if (m !== "ideal" && !EOS_MODELS.includes(m)) throw new Error(`Unknown vapour model "${v}". Use "ideal" or one of: ${EOS_MODELS.join(", ")}.`);
  return m;
}
function checkEos(m) {
  if (!EOS_MODELS.includes(m)) throw new Error(`Unknown equation of state "${m}". Use one of: ${EOS_MODELS.join(", ")}.`);
  return m;
}
function positive(v, name) {
  const x = Number(v);
  if (!(x > 0) || !Number.isFinite(x)) throw new RangeError(`${name} must be a positive number (got ${v}).`);
  return x;
}
function cleanList(list) {
  const out = [...new Set((Array.isArray(list) ? list : [list]).map(Number))].filter(v => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!out.length) throw new Error("Give at least one positive pressure in kPa.");
  return out.slice(0, 6);
}

/**
 * Apply a change to the state and return the new state (the input is not modified).
 *
 * Accepts the configuration keys of Fugacity.app and:
 *  - navigation: `workspace` (a WORKSPACES id: opens it on the view it remembers), `view`
 *    (a view id, which also selects its workspace; `start` is the same), `tab` (the ribbon
 *    tabs of earlier versions, LEGACY_TABS);
 *  - `utility`: open ("library", "sources", "settings") or close (null) a supporting panel.
 *    Any change of workspace or view closes it, unless the same patch opens one;
 *  - `inputs`: inputs of one or more views, e.g. { ternary: ["water", "ethanol", "methanol"] },
 *    { properties: ["ethanol"] }, { henry: { gas: "oxygen", solvent: "water" } }; kept as
 *    given (checkInputs explains a duplicate or an unusable component);
 *  - `gas`, `solvent` (Gas solubility), `propComponent` (Properties): shortcuts for `inputs`;
 *  - `components`: one list for every view, as in the configuration (seeds the inputs of all
 *    views, and moves the phase-equilibrium workspace to a diagram that can run with them);
 *  - `model`: the model of every diagram (ALL_MODELS); `eos`: selects that equation of state
 *    as the model (the key of earlier versions, when the equation of state had its own diagrams);
 *  - `z`: feed composition of the P-x-y or phase-envelope view on the canvas;
 *  - `flash`: settings of the Flash workspace, merged ({ spec: "TP", T_K: 350 }); a new list
 *    of flash components resets its feed composition to equimolar.
 */
export function applyPatch(state, patch = {}) {
  const next = {
    ...state, panels: { ...state.panels }, units: { ...state.units }, sets: { ...state.sets }, z: { ...state.z },
    inputs: { ...state.inputs },
  };
  let view = state.view;
  let navigated = false;

  // the model first: the inputs are seeded and checked for it
  if (patch.model != null) {
    next.model = checkModel(normModel(patch.model));
    if (isEosModel(next.model)) next.eos = next.model;
  }
  if (patch.eos != null) { next.eos = checkEos(normEos(patch.eos)); next.model = next.eos; }

  // inputs
  if (patch.components != null) {
    const comps = normalizeComponents(patch.components);
    const keepProp = comps.includes(state.inputs.properties[0]) ? state.inputs.properties[0] : null;
    next.inputs = seedInputs(comps, { propComponent: keepProp, gas: henryGases(comps)[0] ?? state.inputs.henry.gas, solvent: state.inputs.henry.solvent, model: next.model });
    next.z = { pxy: null, envelope: null };
    next.flash = { ...next.flash, z: null };
    if (patch.view == null && patch.start == null) {
      const d = resolveView(state.diagram, comps, next.model);
      if (VIEWS[d].workspace === "equilibrium") next.diagram = d;
      if (state.workspace === "equilibrium") {
        if (VIEWS[d].workspace !== "equilibrium") next.workspace = VIEWS[d].workspace;
        view = d;
      }
    }
  }
  const ins = { ...(patch.inputs ?? {}) };
  if ("gas" in patch || "solvent" in patch) {
    ins.henry = { ...(ins.henry ?? {}), ...("gas" in patch ? { gas: patch.gas } : {}), ...("solvent" in patch ? { solvent: patch.solvent } : {}) };
  }
  if ("propComponent" in patch) ins.properties = [patch.propComponent ?? next.inputs.properties[0]];
  for (const [v, value] of Object.entries(ins)) {
    if (!(v in INPUTS) || v === "steam") throw new Error(`inputs: unknown view "${v}". Views with inputs: ${Object.keys(INPUTS).filter(k => k !== "steam").join(", ")}.`);
    next.inputs[v] = normalizeInputs(v, v === "henry" ? { ...next.inputs.henry, ...value } : value);
    if (v in next.z) next.z[v] = null;
    if (v === "flash") next.flash = { ...next.flash, z: null };
  }

  // settings
  if (patch.vapour != null) next.vapour = checkVapour(patch.vapour);
  if (patch.P_kPa != null) next.P_kPa = positive(patch.P_kPa, "P_kPa");
  if ("T_K" in patch) next.T_K = patch.T_K == null ? null : positive(patch.T_K, "T_K");
  if (patch.units != null) next.units = normalizeUnits(patch.units, state.units);
  if (patch.basis != null) next.basis = patch.basis === "mass" ? "mass" : "mole";
  for (const k of ["background", "residueCurves", "isotherms", "ribbon", "compareGases"]) if (k in patch) next[k] = !!patch[k];
  if (patch.panels) Object.assign(next.panels, Object.fromEntries(Object.entries(patch.panels).map(([k, v]) => [k, !!v])));
  if (patch.grid != null && [24, 40, 60].includes(+patch.grid)) next.grid = +patch.grid;
  if (patch.property != null) next.property = String(patch.property);
  if (patch.henryP_kPa != null) next.henryP_kPa = positive(patch.henryP_kPa, "henryP_kPa");
  if (patch.henryT_K != null) next.henryT_K = positive(patch.henryT_K, "henryT_K");
  if (patch.steamP_kPa != null) next.steamP_kPa = cleanList(patch.steamP_kPa);
  if ("title" in patch) next.title = patch.title;
  if ("sets" in patch) next.sets = patch.sets === null ? {} : normalizeSets(patch.sets, state.sets);
  if ("prefer" in patch) next.prefer = normalizePrefer(patch.prefer);
  if ("flowsheet" in patch) next.flowsheet = normalizeFlowsheet(patch.flowsheet);
  if (patch.flash != null) next.flash = normalizeFlash(patch.flash, next.flash);

  // navigation
  let utility = "utility" in patch ? patch.utility : undefined;
  const wanted = patch.view ?? patch.start;
  if (wanted != null) {
    let v = aliasOf(wanted);
    if (v === "sources") { if (utility === undefined) utility = "sources"; v = null; }
    if (v === "eos") {
      if (!isEosModel(next.model)) next.model = next.eos;
      v = checkInputs("pxy", next.inputs.pxy, next.model).ok || !checkInputs("envelope", next.inputs.envelope, next.model).ok ? "pxy" : "envelope";
    }
    if (v != null) {
      if (!VIEWS[v]) throw new Error(`Unknown view "${wanted}". Known: ${Object.keys(VIEWS).join(", ")}.`);
      view = v; navigated = true;
      next.workspace = VIEWS[v].workspace;
      if (next.workspace === "equilibrium") next.diagram = v;
    }
  }
  if (patch.workspace != null) {
    const ws = WORKSPACES.find(w => w.id === patch.workspace);
    if (!ws) throw new Error(`Unknown workspace "${patch.workspace}". Known: ${WORKSPACES.map(w => w.id).join(", ")}.`);
    next.workspace = ws.id; navigated = true;
    view = ws.id === "equilibrium" ? next.diagram : ws.view;
  }
  if (patch.tab != null) {
    if (!LEGACY_TABS.includes(patch.tab)) throw new Error(`Unknown tab "${patch.tab}". Known: ${LEGACY_TABS.join(", ")}.`);
    const t = patch.tab;
    if (t === "vle" || t === "eos") {
      // earlier versions: "vle" opened the activity-model diagrams, "eos" the equation-of-state ones
      if (t === "eos" && !isEosModel(next.model)) next.model = next.eos;
      if (t === "vle" && isEosModel(next.model)) next.model = DEFAULTS.model;
      next.workspace = "equilibrium"; view = next.diagram; navigated = true;
    } else if (t === "properties" || t === "steam") { next.workspace = t; view = t; navigated = true; }
    else if (t === "library") { if (utility === undefined) utility = "library"; }
    else if (t === "view") { if (utility === undefined) utility = "settings"; }
    else if (t === "components") next.panels.left = true;
  }
  if (utility !== undefined) {
    if (utility != null && !UTILITIES.some(u => u.id === utility)) throw new Error(`Unknown panel "${utility}". Known: ${UTILITIES.map(u => u.id).join(", ")}.`);
    next.utility = utility ?? null;
  } else if (navigated && (next.workspace !== state.workspace || view !== state.view)) {
    next.utility = null; // navigating dismisses temporary panels
  }
  if ("z" in patch) {
    if (view in next.z) next.z[view] = patch.z ? normalizeComposition(patch.z, checkInputs(view, next.inputs[view], next.model).use.length || next.inputs[view].length) : null;
    else if (patch.z != null) throw new Error(`z is the feed of the P-x-y and phase-envelope views; the view is "${view}".`);
  }
  return derive(next, view);
}

/**
 * Temperature of the P-x-y diagram when none is set: 85 % of the lowest critical temperature
 * of the components, rounded to 5 °C, so that both components are below their critical point
 * and the diagram shows a full two-phase region. 298.15 K without components.
 */
export function autoTemperature(ids) {
  if (!ids.length) return 298.15;
  const T = 0.85 * Math.min(...ids.map(id => pure(id).Tc_K));
  return Math.round((T - 273.15) / 5) * 5 + 273.15;
}

/** The P-x-y temperature in use: the one set, or autoTemperature of the selection. */
export const pxyTemperature = state => state.T_K ?? autoTemperature(state.components.slice(0, 2));

/** Add or remove a component from the selection (at most MAX_COMPONENTS; the oldest stays first). */
export function toggleComponent(ids, id) {
  if (ids.includes(id)) return ids.filter(x => x !== id);
  if (ids.length >= MAX_COMPONENTS) return ids.slice();
  return [...ids, id];
}

/** Move the first component to the end (turns the ternary diagram). */
export const rotate = ids => (ids.length > 1 ? [...ids.slice(1), ids[0]] : ids.slice());

/** Search the component list by name, id, formula, CAS number (case-insensitive substring). */
export function filterComponents(list, query) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return list.slice();
  return list.filter(c => [c.name, c.id, c.formula, c.cas].some(v => String(v ?? "").toLowerCase().includes(q)));
}

/** Mole fractions for n components, normalized; null or a wrong length gives an equimolar mixture. */
export function normalizeComposition(z, n) {
  if (!Array.isArray(z) || z.length !== n) return Array.from({ length: n }, () => 1 / n);
  const v = z.map(Number);
  if (v.some(u => !(u >= 0))) throw new RangeError("Mole fractions must be non-negative numbers.");
  const s = v.reduce((a, b) => a + b, 0);
  if (!(s > 0)) throw new RangeError("Composition must have a positive sum.");
  return v.map(u => u / s);
}

/** Known deviations of the model for exactly these components (src/data/known-issues.json). */
export function knownIssuesFor(ids, model) {
  return knownIssues.issues.filter(k => k.model === model && k.components.length === ids.length && k.components.every(c => ids.includes(c)));
}

/**
 * Count parameter sources by tier, from a system's info.pairs (and missing pairs).
 * @returns {{tier:string, count:number}[]}  in the order fitted, standard, databank, predicted, user, none
 */
export function tierCounts(pairs = [], missing = []) {
  const order = ["fitted", "standard", "databank", "predicted", "user", "none"];
  const counts = new Map();
  for (const p of pairs) counts.set(p.tier || "databank", (counts.get(p.tier || "databank") || 0) + 1);
  if (missing.length) counts.set("none", (counts.get("none") || 0) + missing.length - (pairs.some(p => p.tier === "none") ? pairs.filter(p => p.tier === "none").length : 0));
  return [...counts].filter(([, c]) => c > 0).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([tier, count]) => ({ tier, count }));
}

/** Short tier names for badges. */
export const TIER_SHORT = { fitted: "fitted", standard: "standard", databank: "databank", predicted: "predicted", user: "user", none: "no data" };

/** One-line summary of tier counts, e.g. "2 fitted, 1 databank". */
export function tierSummary(counts, noun = "pair", plural = noun + "s") {
  if (!counts.length) return "";
  const total = counts.reduce((a, c) => a + c.count, 0);
  return `${total} ${total === 1 ? noun : plural}: ` + counts.map(c => `${c.count} ${TIER_SHORT[c.tier] ?? c.tier}`).join(", ");
}

/** Pressure (kPa) as text in the display unit, e.g. "1.01325 bar". */
export const fmtP = (P_kPa, units) => `${fmtShort(pToDisplay(P_kPa, units), 6)} ${units.P}`;
/** Temperature (K) as text in the display unit, e.g. "25 °C". */
export const fmtTemp = (T_K, units, digits = 2) => `${+tToDisplay(T_K, units).toFixed(digits)} ${units.T === "K" ? "K" : "°C"}`;
/** Parse a pressure typed in the display unit; returns kPa or null. */
export function parseP(text, units) {
  const v = Number(String(text).trim().replace(",", "."));
  return Number.isFinite(v) && v > 0 ? pFromDisplay(v, units) : null;
}
/** Parse a temperature typed in the display unit; returns K or null (must be above 0 K). */
export function parseT(text, units) {
  const raw = String(text).trim().replace(",", ".");
  if (raw === "") return null;
  const v = Number(raw);
  if (!Number.isFinite(v)) return null;
  const T = tFromDisplay(v, units);
  return T > 0 ? T : null;
}

/**
 * Linear interpolation of y at x on a polyline (points in drawing order). Returns the y of the
 * first segment that spans x, or null when x is outside every segment.
 */
export function interpolate(points, x) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const lo = Math.min(a.x, b.x), hi = Math.max(a.x, b.x);
    if (x >= lo && x <= hi) {
      if (hi === lo) return Math.max(a.y, b.y);
      return a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------
// Parameter sets (the Library panel and the pair selectors): proposal 0003

/** The global rules of the Library panel: `prefer` as the engine takes it (null: default sets). */
export const RULES = [
  { id: "best", label: "Best available", prefer: null,
    hint: "Each pair's default set: fitted to open data where there is some, otherwise the databank." },
  { id: "fitted", label: "Fitted to data first", prefer: ["fitted", "databank"],
    hint: "Sets fitted to open experimental data first, then databank sets." },
  { id: "databank", label: "Databank only (ChemSep)", prefer: ["databank"],
    hint: "Databank sets where a pair has one; a pair without one keeps its default, with a note." },
];

/** The rule id of a `prefer` setting ("custom" when it is none of RULES). */
export function ruleOf(prefer) {
  const key = JSON.stringify(prefer ?? null);
  return RULES.find(r => JSON.stringify(r.prefer) === key)?.id ?? "custom";
}

/** Canonical key of a pair in `sets`: the two component ids, sorted, joined by "+". */
export const pairKeyOf = (a, b) => [findComponent(a), findComponent(b)].sort().join("+");

/**
 * Normalize a `sets` setting ({ "pair": "set name" }, pair in any order and any component
 * name) and merge it into `prev`; an empty or null set name removes the choice for that pair.
 */
export function normalizeSets(sets, prev = {}) {
  const out = { ...prev };
  if (sets == null) return out;
  if (typeof sets !== "object" || Array.isArray(sets)) throw new Error('sets must be an object such as { "acetone+chloroform": "chemsep" }.');
  for (const [key, name] of Object.entries(sets)) {
    const parts = String(key).split("+").map(s => s.trim()).filter(Boolean);
    if (parts.length !== 2) throw new Error(`sets: "${key}" is not a pair; write it as "component+component".`);
    const k = pairKeyOf(parts[0], parts[1]);
    if (name == null || name === "") delete out[k];
    else if (typeof name !== "string") throw new Error(`sets: the set for "${key}" must be a set name (a string).`);
    else out[k] = name;
  }
  return out;
}

/** Normalize a `prefer` setting: null (default sets), a rule id of RULES, or a list of tiers. */
export function normalizePrefer(prefer) {
  if (prefer == null || prefer === "best") return null;
  const rule = typeof prefer === "string" ? RULES.find(r => r.id === prefer) : null;
  if (rule) return rule.prefer ? rule.prefer.slice() : null;
  return selection({ prefer }).prefer;
}

/**
 * Settings for system() with `model`: the global rule, and the per-pair choices that exist
 * for this model (a choice made for NRTL is kept in the state but not passed to UNIQUAC
 * when that pair has no set of that name there).
 */
export function setsFor(state, model) {
  const sets = {};
  if (model !== "ideal") {
    for (const [key, name] of Object.entries(state.sets ?? {})) {
      const [a, b] = key.split("+");
      if (library.sets(a, b, model).some(s => s.set === name)) sets[key] = name;
    }
  }
  // activity-coefficient models also take the vapour model; equations of state describe both phases
  return MODELS.includes(model) ? { sets, prefer: state.prefer ?? null, vapour: state.vapour ?? "ideal" } : { sets, prefer: state.prefer ?? null };
}

/**
 * The sets offered for a pair in the Inputs panel: the default first, then the others,
 * each with a short label and `current` for the one in use. Empty when the pair has only one set.
 * @param {object} info  an info.pairs entry of a system
 */
export function setChoices(info) {
  if (!info?.alternatives?.length) return [];
  const all = [{ set: info.set, tier: info.tier, default: info.default, current: true }, ...info.alternatives.map(a => ({ ...a, current: false }))];
  all.sort((a, b) => b.default - a.default); // default first, then the others in the library's order
  return all.map(s => ({ ...s, label: `${s.set}${s.default ? " (default)" : ""}` }));
}

/** Search the sources (from library.sources()) by any text field and by kind. */
export function filterSources(list, query, kind = "all") {
  const q = String(query ?? "").trim().toLowerCase();
  return list.filter(s => (kind === "all" || s.kind === kind) && (!q ||
    [s.id, s.title, s.authors, s.year, s.published, s.kind, s.doi, s.access, s.via, s.note, ...(s.usedBy ?? []).map(u => u.label)]
      .some(v => v != null && String(v).toLowerCase().includes(q))));
}

/** Do the sources' users involve any of these components (ids)? */
export function sourceUsedFor(source, ids, names) {
  return (source.usedBy ?? []).some(u => (u.component && ids.includes(u.component)) || (u.gas && ids.includes(u.gas))
    || (u.pair && u.pair.every(n => names.includes(n))));
}
