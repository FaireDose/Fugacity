/**
 * Workbench (Fugacity.app): the DOM-free part. Configuration, state changes, which views
 * can run for which component selection, component search, and display formatting.
 *
 * No thermodynamics here: this file only reads the component list (listComponents), the
 * list of gases with a Henry's law constant (HENRY_GASES) and the known-deviation list
 * (src/data/known-issues.json), and converts units with the exact definitions in
 * properties-logic.js (0 °C = 273.15 K, 1 bar = 100 kPa).
 */
import { listComponents, findComponent, MODELS, EOS_MODELS } from "../thermo/system.js";
import { HENRY_GASES } from "../thermo/henry.js";
import { pure } from "../thermo/pure.js";
import knownIssues from "../data/known-issues.json" with { type: "json" };
import { normalizeUnits, tToDisplay, tFromDisplay, pToDisplay, pFromDisplay, fmtShort } from "./properties-logic.js";

/** Ribbon tabs, in order. */
export const TABS = [
  { id: "components", label: "Components" },
  { id: "vle", label: "Phase equilibrium" },
  { id: "eos", label: "Gases & EOS" },
  { id: "properties", label: "Properties" },
  { id: "steam", label: "Steam" },
  { id: "view", label: "View" },
];

/** Canvas views: the tab each belongs to and its name. */
export const VIEWS = {
  txy: { tab: "vle", label: "T-x-y diagram" },
  ternary: { tab: "vle", label: "Ternary map" },
  azeotropes: { tab: "vle", label: "Azeotropes" },
  pxy: { tab: "eos", label: "P-x-y diagram" },
  envelope: { tab: "eos", label: "Phase envelope" },
  henry: { tab: "eos", label: "Gas solubility in water" },
  properties: { tab: "properties", label: "Property curves" },
  steam: { tab: "steam", label: "Steam tables" },
};

/** Ready-made component sets (Components tab). */
export const PRESETS = [
  { label: "Methanol, acetone, chloroform", components: ["methanol", "acetone", "chloroform"], view: "ternary" },
  { label: "Water, acetic acid, ethylene glycol", components: ["water", "acetic-acid", "ethylene-glycol"], view: "ternary" },
  { label: "Ethanol, water, ethyl acetate", components: ["ethanol", "water", "ethyl-acetate"], view: "ternary" },
  { label: "Ethanol, water", components: ["ethanol", "water"], view: "txy" },
  { label: "Benzene, toluene", components: ["benzene", "toluene"], view: "txy" },
  { label: "Methane, ethane", components: ["methane", "ethane"], view: "pxy" },
  { label: "Nitrogen, oxygen", components: ["nitrogen", "oxygen"], view: "envelope" },
];

export const MAX_COMPONENTS = 6;
const START_ALIASES = { eos: "eos", "pt": "envelope", "p-x-y": "pxy", "t-x-y": "txy", vle: "ternary", gases: "henry", solubility: "henry", explorer: "properties" };

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
 * Can a view run with this component selection, and on which components?
 * @returns {{enabled:boolean, use:string[], reason?:string, note?:string}}
 *   `use`: the components the view will show; `reason`: why it is disabled;
 *   `note`: what the view does with the selection (e.g. "first two of three liquids").
 */
export function viewAvailability(view, ids) {
  const liq = liquids(ids);
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
      if (ids.length !== 2) return { enabled: false, use: [], reason: `A P-x-y diagram needs exactly two components; ${word(ids.length)} selected.` };
      return { enabled: true, use: ids.slice() };
    case "envelope":
      if (ids.length < 1) return { enabled: false, use: [], reason: "Select at least one component." };
      return { enabled: true, use: ids.slice() };
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

/** The first view that can run, preferring `wanted` (resolves "eos" to P-x-y or the envelope). */
export function resolveView(wanted, ids) {
  let v = START_ALIASES[String(wanted ?? "").toLowerCase()] ?? String(wanted ?? "");
  if (v === "eos") v = ids.length === 2 ? "pxy" : "envelope";
  if (VIEWS[v] && viewAvailability(v, ids).enabled) return v;
  const liq = liquids(ids).length;
  if (VIEWS[v]?.tab === "eos" && ids.length) return "envelope";
  if (liq >= 3) return "ternary";
  if (liq === 2) return "txy";
  if (ids.length) return "envelope";
  return "properties";
}

const DEFAULTS = {
  components: ["methanol", "acetone", "chloroform"],
  model: "NRTL", eos: "PR", P_kPa: 101.325, basis: "mole",
  background: true, residueCurves: true, isotherms: true, grid: 40,
  property: "density", henryP_kPa: 101.325, steamP_kPa: [10, 100, 1000, 10000],
};

/**
 * Normalize the configuration of Fugacity.app into the initial state. Unknown models,
 * units and components throw (a typo is never silently ignored).
 */
export function initialState(cfg = {}) {
  const components = normalizeComponents(cfg.components ?? DEFAULTS.components);
  const state = {
    components,
    view: null,
    tab: null,
    model: EOS_MODELS.includes(normModel(cfg.model)) ? DEFAULTS.model : checkModel(normModel(cfg.model ?? DEFAULTS.model)),
    eos: checkEos(normEos(cfg.eos ?? (EOS_MODELS.includes(normEos(cfg.model)) ? cfg.model : DEFAULTS.eos))),
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
    propComponent: cfg.propComponent ? findComponent(cfg.propComponent) : null,
    z: null,
    henryP_kPa: positive(cfg.henryP_kPa ?? DEFAULTS.henryP_kPa, "henryP_kPa"),
    steamP_kPa: cleanList(cfg.steamP_kPa ?? DEFAULTS.steamP_kPa),
    title: cfg.title,
  };
  state.view = resolveView(cfg.start ?? (EOS_MODELS.includes(normModel(cfg.model)) ? "eos" : null), components);
  state.tab = VIEWS[state.view].tab;
  return state;
}

function checkModel(m) {
  if (!MODELS.includes(m)) throw new Error(`Unknown activity model "${m}". Use one of: ${MODELS.join(", ")} (or eos: ${EOS_MODELS.join(", ")}).`);
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
 * Accepts the configuration keys of Fugacity.app plus `view`, `tab`, `panels`, `ribbon`,
 * `z` (EOS feed composition) and `start` (same as `view`).
 */
export function applyPatch(state, patch = {}) {
  const next = { ...state, panels: { ...state.panels }, units: { ...state.units } };
  if (patch.components != null) {
    next.components = normalizeComponents(patch.components);
    next.z = null;
    if (next.propComponent && !next.components.includes(next.propComponent)) next.propComponent = null;
  }
  if (patch.model != null) {
    const m = normModel(patch.model);
    if (EOS_MODELS.includes(m)) next.eos = m; else next.model = checkModel(m);
  }
  if (patch.eos != null) next.eos = checkEos(normEos(patch.eos));
  if (patch.P_kPa != null) next.P_kPa = positive(patch.P_kPa, "P_kPa");
  if ("T_K" in patch) next.T_K = patch.T_K == null ? null : positive(patch.T_K, "T_K");
  if (patch.units != null) next.units = normalizeUnits(patch.units, state.units);
  if (patch.basis != null) next.basis = patch.basis === "mass" ? "mass" : "mole";
  for (const k of ["background", "residueCurves", "isotherms", "ribbon"]) if (k in patch) next[k] = !!patch[k];
  if (patch.panels) Object.assign(next.panels, Object.fromEntries(Object.entries(patch.panels).map(([k, v]) => [k, !!v])));
  if (patch.grid != null && [24, 40, 60].includes(+patch.grid)) next.grid = +patch.grid;
  if (patch.property != null) next.property = String(patch.property);
  if ("propComponent" in patch) next.propComponent = patch.propComponent ? findComponent(patch.propComponent) : null;
  if ("z" in patch) next.z = patch.z ? normalizeComposition(patch.z, next.components.length) : null;
  if (patch.henryP_kPa != null) next.henryP_kPa = positive(patch.henryP_kPa, "henryP_kPa");
  if (patch.steamP_kPa != null) next.steamP_kPa = cleanList(patch.steamP_kPa);
  if ("title" in patch) next.title = patch.title;
  const wanted = patch.view ?? patch.start;
  if (wanted != null || patch.components != null) {
    next.view = resolveView(wanted ?? state.view, next.components);
    next.tab = VIEWS[next.view].tab;
  }
  if (patch.tab != null) {
    if (!TABS.some(t => t.id === patch.tab)) throw new Error(`Unknown tab "${patch.tab}".`);
    next.tab = patch.tab;
  }
  return next;
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
