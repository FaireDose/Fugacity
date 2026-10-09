/**
 * Property explorer: the DOM-free part (unit conversions, curve sampling, tables).
 *
 * Everything here works on the object returned by `pure(id)` (layer 1, src/thermo/pure.js)
 * and only calls its public methods: record(), property(), props(), psat(). No
 * thermodynamics is done here; this file decides *where* to ask the engine for values,
 * so that no curve is ever drawn outside the validity range of the correlation behind it,
 * and converts engine units (SI: K, kPa, J/mol, kg/m3, Pa s, W/(m K), N/m) for display.
 *
 * Unit conversions are exact definitions (BIPM SI Brochure, 9th edition, 2019, tables 4
 * and 8: 0 °C = 273.15 K, 1 bar = 100 kPa); molar to mass basis divides by the molar
 * mass M (g/mol): (J/mol) / (g/mol) = J/g = kJ/kg.
 */
import { PROPERTIES, PROPERTY_NAMES } from "../thermo/pure.js";

// ---------------------------------------------------------------------------------------
// Units

/** Default display units. */
export const DEFAULT_UNITS = Object.freeze({ T: "C", P: "bar", basis: "mass", viscosity: "mPa s" });

/** The unit switches the explorer offers, with their display labels. */
export const UNIT_CHOICES = {
  T: [["C", "°C"], ["K", "K"]],
  P: [["bar", "bar"], ["kPa", "kPa"]],
  basis: [["mass", "kJ/kg"], ["molar", "J/mol"]],
  viscosity: [["mPa s", "mPa·s"], ["Pa s", "Pa·s"]],
};

const ALIASES = {
  T: { c: "C", "°c": "C", degc: "C", celsius: "C", k: "K", kelvin: "K" },
  P: { bar: "bar", kpa: "kPa" },
  basis: { mass: "mass", "kj/kg": "mass", molar: "molar", "j/mol": "molar", mol: "molar" },
  viscosity: { "mpa s": "mPa s", "mpa·s": "mPa s", "mpas": "mPa s", cp: "mPa s", "pa s": "Pa s", "pa·s": "Pa s", pas: "Pa s" },
};

/**
 * Normalize a units object from the configuration. Accepts e.g.
 * `{ T: "K", P: "kPa", energy: "J/mol", viscosity: "Pa·s" }` (`energy` is an alias of `basis`).
 * Unknown values throw, so a typo is not silently ignored.
 */
export function normalizeUnits(u = {}, base = DEFAULT_UNITS) {
  const out = { ...base };
  const src = { ...u };
  if (src.energy != null && src.basis == null) src.basis = src.energy;
  for (const key of Object.keys(ALIASES)) {
    if (src[key] == null) continue;
    const v = ALIASES[key][String(src[key]).trim().toLowerCase().replace(/\s+/g, " ")];
    if (!v) {
      throw new Error(`Unknown ${key} unit "${src[key]}". Use one of: ${UNIT_CHOICES[key].map(c => c[1]).join(", ")}.`);
    }
    out[key] = v;
  }
  return out;
}

/** Temperature K -> display unit. */
export const tToDisplay = (T_K, units) => (units.T === "K" ? T_K : T_K - 273.15);
/** Temperature display unit -> K. */
export const tFromDisplay = (v, units) => (units.T === "K" ? v : v + 273.15);
/** Pressure kPa -> display unit. */
export const pToDisplay = (P_kPa, units) => (units.P === "bar" ? P_kPa / 100 : P_kPa);
/** Pressure display unit -> kPa. */
export const pFromDisplay = (v, units) => (units.P === "bar" ? v * 100 : v);

/**
 * Quantities shown by the explorer: engine unit and conversion to the display unit.
 * `MW` is the molar mass in g/mol (needed for the mass basis).
 */
export const QUANTITIES = {
  temperature: { label: u => (u.T === "K" ? "K" : "°C"), convert: (v, u) => tToDisplay(v, u) },
  pressure: { label: u => u.P, convert: (v, u) => pToDisplay(v, u) },
  density: { label: () => "kg/m³", convert: v => v },
  energy: {
    label: u => (u.basis === "mass" ? "kJ/kg" : "J/mol"),
    convert: (v, u, MW) => (u.basis === "mass" ? v / requireMW(MW) : v),
  },
  heatCapacity: {
    label: u => (u.basis === "mass" ? "kJ/(kg·K)" : "J/(mol·K)"),
    convert: (v, u, MW) => (u.basis === "mass" ? v / requireMW(MW) : v),
  },
  viscosity: { label: u => (u.viscosity === "Pa s" ? "Pa·s" : "mPa·s"), convert: (v, u) => (u.viscosity === "Pa s" ? v : v * 1000) },
  conductivity: { label: () => "W/(m·K)", convert: v => v },
  surfaceTension: { label: () => "mN/m", convert: v => v * 1000 },
};

function requireMW(MW) {
  if (!(MW > 0)) throw new Error("A molar mass is needed to show values on a mass basis.");
  return MW;
}

/** Convert an engine (SI) value of `quantity` to the display unit. null stays null. */
export function toDisplay(quantity, v, units, MW) {
  if (v == null || !Number.isFinite(v)) return null;
  const q = QUANTITIES[quantity];
  if (!q) throw new Error(`Unknown quantity "${quantity}".`);
  return q.convert(v, units, MW);
}

/** Display unit label of a quantity. */
export const unitLabel = (quantity, units) => QUANTITIES[quantity].label(units);

/**
 * Parse an editable list of pressures typed in the display unit, e.g. "1, 5, 10" (bar).
 * Returns sorted, distinct values in kPa; at most `max` values. Non-numbers and values
 * <= 0 are skipped.
 */
export function parsePressures(text, units, max = 6) {
  const vals = String(text).split(/[\s,;]+/).map(Number).filter(v => Number.isFinite(v) && v > 0);
  const kPa = [...new Set(vals.map(v => +pFromDisplay(v, units).toPrecision(12)))].sort((a, b) => a - b);
  return kPa.slice(0, max);
}

// ---------------------------------------------------------------------------------------
// What can be plotted

const RECORD_QUANTITY = {
  vapourPressure: "pressure",
  liquidDensity: "density",
  idealGasHeatCapacity: "heatCapacity",
  liquidHeatCapacity: "heatCapacity",
  heatOfVaporization: "energy",
  liquidViscosity: "viscosity",
  vapourViscosity: "viscosity",
  liquidThermalConductivity: "conductivity",
  vapourThermalConductivity: "conductivity",
  surfaceTension: "surfaceTension",
};

/**
 * State properties from `pure(id).props(T, P)`, with the records each one is computed from
 * in the liquid and in the gas branch of props() (see src/thermo/pure.js). These lists are
 * used only to keep sampled points inside the records' validity ranges.
 */
export const STATE_PROPERTIES = {
  density: { field: "rho_kg_m3", quantity: "density", label: "Density", symbol: "ρ",
    depends: { liquid: ["liquidDensity"], gas: [] } },
  enthalpy: { field: "h_J_mol", quantity: "energy", label: "Enthalpy", symbol: "h",
    depends: { liquid: ["idealGasHeatCapacity", "heatOfVaporization"], gas: ["idealGasHeatCapacity"] } },
  cp: { field: "cp_J_molK", quantity: "heatCapacity", label: "Heat capacity", symbol: "cp",
    depends: { liquid: ["liquidHeatCapacity"], gas: ["idealGasHeatCapacity"] } },
  viscosity: { field: "mu_Pa_s", quantity: "viscosity", label: "Viscosity", symbol: "μ",
    depends: { liquid: ["liquidViscosity"], gas: ["vapourViscosity"] } },
  conductivity: { field: "k_W_mK", quantity: "conductivity", label: "Thermal conductivity", symbol: "k",
    depends: { liquid: ["liquidThermalConductivity"], gas: ["vapourThermalConductivity"] } },
};

/**
 * Every property the explorer can show: temperature-only records (vapour pressure and
 * PROPERTIES) and state properties (functions of T and P).
 * @returns {{key:string, kind:"T"|"state", label:string, symbol:string, quantity:string}[]}
 */
export function explorerProperties() {
  const tOnly = [{ key: "vapourPressure", kind: "T", label: "Vapour pressure", symbol: "Psat", quantity: "pressure" },
    ...PROPERTY_NAMES.map(key => ({ key, kind: "T", label: PROPERTIES[key].label, symbol: PROPERTIES[key].symbol,
      quantity: RECORD_QUANTITY[key] ?? null, rawUnits: PROPERTIES[key].units }))];
  const state = Object.entries(STATE_PROPERTIES).map(([key, d]) => ({ key, kind: "state", label: d.label, symbol: d.symbol, quantity: d.quantity }));
  return [...state, ...tOnly];
}

/** Find a property by key (case-insensitive; "psat" means vapourPressure). */
export function findExplorerProperty(key) {
  const k = String(key ?? "").trim().toLowerCase();
  const list = explorerProperties();
  const hit = list.find(p => p.key.toLowerCase() === k) || (k === "psat" ? list.find(p => p.key === "vapourPressure") : null);
  if (!hit) throw new Error(`Unknown property "${key}". Known: ${list.map(p => p.key).join(", ")}.`);
  return hit;
}

// ---------------------------------------------------------------------------------------
// Sampling

/** n evenly spaced values from lo to hi, both included. */
export function linspace(lo, hi, n) {
  if (n < 2) return [lo];
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? hi : lo + (hi - lo) * i / (n - 1)));
}

const inRange = (r, T) => r && Number.isFinite(r.Tmin_K) && Number.isFinite(r.Tmax_K) && T >= r.Tmin_K - 1e-9 && T <= r.Tmax_K + 1e-9;

/** The message the engine gives for a missing property (includes the sources searched). */
export function missingMessage(p, name) {
  try { p.property(name, p.Tb_K || 298.15); } catch (e) { return e.message.replace(/^vapourPressure\b/, "Vapour pressure"); }
  return null;
}

/**
 * Sample a temperature-only property over its record's validity range (optionally narrowed
 * to [Tmin, Tmax]). Never samples outside the record's range.
 * @returns {{available:boolean, message?:string, record?:object, range?:[number,number],
 *            points:{T:number, v:number}[]}}  T in K, v in engine units
 */
export function sampleTemperatureProperty(p, name, { n = 160, Tmin = -Infinity, Tmax = Infinity } = {}) {
  const rec = p.record(name);
  if (!rec) return { available: false, message: missingMessage(p, name), points: [] };
  if (!Number.isFinite(rec.Tmin_K) || !Number.isFinite(rec.Tmax_K)) {
    return { available: true, record: rec, points: [], message: "This record has no stated temperature range, so it is not drawn." };
  }
  const range = [rec.Tmin_K, rec.Tmax_K];
  const lo = Math.max(rec.Tmin_K, Tmin), hi = Math.min(rec.Tmax_K, Tmax);
  if (!(hi > lo)) return { available: true, record: rec, range, points: [], message: "The chosen temperature range does not overlap the range of the data." };
  const points = [];
  for (const T of linspace(lo, hi, n)) {
    try {
      const v = p.property(name, T);
      if (Number.isFinite(v)) points.push({ T, v });
    } catch { /* outside a sub-range or undefined: skip, never extrapolate */ }
  }
  return { available: true, record: rec, range, points };
}

const phaseClass = ph => (ph === "liquid" ? "liquid" : ph === "vapour" || ph === "supercritical" ? "gas" : null);

/**
 * One state point for a state property, or null when the engine has no valid value there.
 * A value is accepted only when every record it is computed from (STATE_PROPERTIES.depends)
 * covers T, unless the engine reports an official standard (tier "standard", e.g. IAPWS or
 * the ideal-gas law) as its source.
 * @returns {{T:number, P:number, phase:string, cls:"liquid"|"gas", v:number|null, state:object}|null}
 */
export function statePoint(p, key, T, P) {
  const def = STATE_PROPERTIES[key];
  if (!def) throw new Error(`Unknown state property "${key}".`);
  let s;
  try { s = p.props(T, P); } catch { return null; }
  const cls = phaseClass(s.phase);
  if (!cls) return null;
  let v = s[def.field];
  if (v == null || !Number.isFinite(v)) v = null;
  else if (s.sources?.[def.field]?.tier !== "standard") {
    for (const name of def.depends[cls]) {
      const r = p.record(name);
      if (r && !inRange(r, T)) { v = null; break; }
    }
  }
  return { T, P, phase: s.phase, cls, v, state: s };
}

/**
 * Default temperature range for a state property: the union of the ranges of the records
 * it depends on and of the vapour pressure. When the engine gives an official standard
 * (for example IAPWS for water) at the upper end, the range is widened to 1.5 Tc so the
 * superheated region shows; samples are still accepted only where the engine gives values.
 * @returns {[number, number]|null}  K
 */
export function stateDomain(p, key, P_kPa = 101.325) {
  const def = STATE_PROPERTIES[key];
  const names = ["vapourPressure", ...def.depends.liquid, ...def.depends.gas];
  const recs = names.map(n => p.record(n)).filter(r => r && Number.isFinite(r.Tmin_K) && Number.isFinite(r.Tmax_K));
  if (!recs.length) return null;
  const lo = Math.min(...recs.map(r => r.Tmin_K));
  let hi = Math.max(...recs.map(r => r.Tmax_K));
  if (p.Tc_K > 0 && hi < 1.5 * p.Tc_K) {
    let s = null;
    try { s = p.props(1.5 * p.Tc_K, P_kPa); } catch { /* no values there */ }
    if (s && s[def.field] != null && s.sources?.[def.field]?.tier === "standard") hi = 1.5 * p.Tc_K;
  }
  return hi > lo ? [lo, hi] : null;
}

/** Bisection on the phase class between Ta (phase a) and Tb (phase b). */
function phaseBoundary(p, Ta, Tb, P, clsA) {
  let a = Ta, b = Tb;
  const cls = T => { try { return phaseClass(p.props(T, P).phase); } catch { return null; } };
  for (let i = 0; i < 60 && b - a > 1e-7 * b; i++) {
    const m = (a + b) / 2;
    if (cls(m) === clsA) a = m; else b = m;
  }
  return (a + b) / 2;
}

/**
 * Sample a state property at pressure P (kPa) between Tmin and Tmax (K).
 * Returns curve segments (a new segment starts at a phase change or where values stop),
 * the phase changes found (boiling point, or Tc where the engine switches from liquid to
 * gas correlations above the critical pressure), the gaps (temperature runs without a value:
 * reason "phase" when the engine cannot tell the phase, "data" when no record covers T),
 * the sources the engine reported, and its notes (out-of-range messages are left out: the
 * range is shown separately).
 */
export function sampleStateProperty(p, key, P, { Tmin, Tmax, n = 200 } = {}) {
  if (!(Tmax > Tmin)) throw new Error("sampleStateProperty: Tmax must be above Tmin.");
  const def = STATE_PROPERTIES[key];
  if (!def) throw new Error(`Unknown state property "${key}".`);
  let pts = linspace(Tmin, Tmax, n).map(T => statePoint(p, key, T, P) || { T, cls: null, v: null });

  // Locate phase changes precisely, and add points just either side of each one.
  const transitions = [], extra = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (a.cls && b.cls && a.cls !== b.cls) {
      const Tt = phaseBoundary(p, a.T, b.T, P, a.cls), d = Math.max(1e-6 * Tt, 1e-7);
      const before = statePoint(p, key, Tt - d, P), after = statePoint(p, key, Tt + d, P);
      const kind = p.Tc_K > 0 && Math.abs(Tt - p.Tc_K) < 1e-4 * p.Tc_K ? "critical" : "boiling";
      transitions.push({ T: Tt, from: a.cls, to: b.cls, kind,
        vFrom: before?.cls === a.cls ? before.v : null, vTo: after?.cls === b.cls ? after.v : null });
      if (before?.cls === a.cls) extra.push(before);
      if (after?.cls === b.cls) extra.push(after);
    }
  }
  pts = pts.concat(extra).sort((x, y) => x.T - y.T);

  const segments = [];
  let cur = null;
  for (const q of pts) {
    if (q.v == null) { cur = null; continue; }
    if (!cur || cur.cls !== q.cls) { cur = { cls: q.cls, points: [] }; segments.push(cur); }
    cur.points.push({ T: q.T, v: q.v, phase: q.phase });
  }

  // Runs of temperatures without a value, and why (phase unknown, or no valid data there).
  const gaps = [];
  let gap = null;
  for (const q of pts) {
    if (q.v != null) { gap = null; continue; }
    const reason = q.cls ? "data" : "phase";
    if (!gap || gap.reason !== reason || gap.cls !== q.cls) { gap = { T0: q.T, T1: q.T, reason, cls: q.cls }; gaps.push(gap); } else gap.T1 = q.T;
  }

  const sources = new Map(), psatSources = new Map(), notes = new Set();
  for (const q of pts) {
    if (!q.state) continue;
    const src = q.state.sources?.[def.field];
    if (src && q.v != null) sources.set(sourceKey(src), src);
    const ps = q.state.sources?.psat_kPa;
    if (ps) psatSources.set(sourceKey(ps), ps);
    for (const note of q.state.notes || []) if (!/outside the (vapour-pressure )?range/i.test(note)) notes.add(note);
  }
  return { key, P_kPa: P, segments, transitions, gaps, sources: [...sources.values()], psatSources: [...psatSources.values()], notes: [...notes],
    count: segments.reduce((s, g) => s + g.points.length, 0) };
}

const sourceKey = s => JSON.stringify([s.tier, s.source]);

// ---------------------------------------------------------------------------------------
// Saturation table and single state

/** Columns of the saturation table: [id, state field, quantity, phase, header]. */
export const SAT_COLUMNS = [
  ["rhoL", "rho_kg_m3", "density", "liquid", "ρ liquid"],
  ["rhoV", "rho_kg_m3", "density", "gas", "ρ vapour"],
  ["hL", "h_J_mol", "energy", "liquid", "h liquid"],
  ["hV", "h_J_mol", "energy", "gas", "h vapour"],
  ["dHvap", "dHvap_J_mol", "energy", "liquid", "ΔHvap"],
  ["cpL", "cp_J_molK", "heatCapacity", "liquid", "cp liquid"],
  ["cpV", "cp_J_molK", "heatCapacity", "gas", "cp vapour"],
  ["muL", "mu_Pa_s", "viscosity", "liquid", "μ liquid"],
  ["muV", "mu_Pa_s", "viscosity", "gas", "μ vapour"],
  ["kL", "k_W_mK", "conductivity", "liquid", "k liquid"],
  ["kV", "k_W_mK", "conductivity", "gas", "k vapour"],
];

/** Round numbers ("nice" steps of 1, 2, 2.5 or 5 x 10^k) between lo and hi. */
export function niceValues(lo, hi, target = 10) {
  if (!(hi > lo)) return [];
  const raw = (hi - lo) / target, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(st => (hi - lo) / st <= target) ?? 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9 * Math.abs(hi || 1); v += step) out.push(+v.toFixed(10));
  return out;
}

/**
 * Saturation ("steam table") rows: temperatures at round values of the display unit from
 * the start of the vapour-pressure record up to Tc (or the end of the record, if the engine
 * gives no vapour pressure beyond it), each with the engine's own Psat at that T (from
 * props(), e.g. IAPWS-IF97 for water, or the vapour-pressure record) and the saturated
 * liquid and vapour states from props() (liquid just above Psat, vapour just below it).
 * Values are in engine units; null where the engine has no valid value.
 * @returns {{rows:{T:number, psat:number, [col:string]:number|null}[], columns:string[],
 *   range:[number,number]|null, psatSource:object|null, message?:string}}
 */
export function saturationTable(p, units, { rows = 11, Tmin, Tmax } = {}) {
  const vp = p.record("vapourPressure");
  if (!vp) return { rows: [], columns: [], range: null, psatSource: null, message: missingMessage(p, "vapourPressure") };
  const engine = T => {
    const st = statePointAll(p, T, 101.325);
    if (st && Number.isFinite(st.psat_kPa)) return { ps: st.psat_kPa, src: st.sources?.psat_kPa ?? null };
    try { return { ps: p.psat(T), src: { tier: vp.tier, source: vp.source } }; } catch { return null; }
  };
  const top = p.Tc_K > 0 && engine(p.Tc_K * 0.999) ? p.Tc_K * (1 - 1e-6) : Math.min(vp.Tmax_K, p.Tc_K > 0 ? p.Tc_K * (1 - 1e-6) : Infinity);
  let lo = Math.max(vp.Tmin_K, Tmin ?? -Infinity), hi = Math.min(top, Tmax ?? Infinity);
  if (!(hi > lo)) { lo = vp.Tmin_K; hi = top; }
  const Ts = niceValues(tToDisplay(lo, units), tToDisplay(hi, units), rows - 1).map(v => tFromDisplay(v, units))
    .filter(T => T >= lo - 1e-9 && T <= hi + 1e-9);
  const out = [];
  let psatSource = null;
  for (const T of Ts) {
    const e = engine(T);
    if (!e) continue;
    const ps = e.ps;
    psatSource ??= e.src;
    const row = { T, psat: ps };
    const sides = { liquid: statePointAll(p, T, ps * (1 + 1e-9)), gas: statePointAll(p, T, ps * (1 - 1e-9)) };
    for (const [id, field, , cls] of SAT_COLUMNS) {
      const st = sides[cls];
      row[id] = st && phaseClass(st.phase) === cls && Number.isFinite(st[field]) && fieldInRange(p, field, cls, T, st) ? st[field] : null;
    }
    out.push(row);
  }
  const columns = SAT_COLUMNS.map(c => c[0]).filter(id => out.some(r => r[id] != null));
  return { rows: out, columns, range: [lo, hi], psatSource };
}

function statePointAll(p, T, P) { try { return p.props(T, P); } catch { return null; } }

const FIELD_KEY = Object.fromEntries(Object.entries(STATE_PROPERTIES).map(([k, d]) => [d.field, k]));

/** Is a props() field at T backed by records whose ranges cover T (or by a standard)? */
function fieldInRange(p, field, cls, T, st) {
  if (st.sources?.[field]?.tier === "standard") return true;
  const deps = field === "dHvap_J_mol" ? ["heatOfVaporization"] : STATE_PROPERTIES[FIELD_KEY[field]]?.depends[cls] ?? [];
  return deps.every(n => { const r = p.record(n); return !r || inRange(r, T); });
}

/**
 * All props() fields at one state, with the same range rule as the curves.
 * @returns {object} props() output where fields outside a record's range are set to null
 *   and listed in `outOfRange`
 */
export function singleState(p, T, P) {
  const s = p.props(T, P);
  const cls = phaseClass(s.phase);
  const out = { ...s, outOfRange: [] };
  if (!cls) return out;
  for (const field of ["rho_kg_m3", "cp_J_molK", "h_J_mol", "dHvap_J_mol", "mu_Pa_s", "k_W_mK"]) {
    if (out[field] != null && !fieldInRange(p, field, cls, T, s)) { out[field] = null; out.outOfRange.push(field); }
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Axis helpers and formatting

/** Logarithmic axis ticks between lo > 0 and hi. */
export function logTicks(lo, hi) {
  const a = Math.floor(Math.log10(lo)), b = Math.ceil(Math.log10(hi));
  const mult = b - a <= 2 ? [1, 2, 5] : b - a <= 4 ? [1, 3] : [1];
  const out = [];
  for (let e = a; e <= b; e++) for (const m of mult) { const v = m * 10 ** e; if (v >= lo * (1 - 1e-12) && v <= hi * (1 + 1e-12)) out.push(+v.toPrecision(12)); }
  return out;
}

/** Format a number with `sig` significant figures; exponent form for very large/small values. */
export function fmtNum(v, sig = 4) {
  if (v == null || !Number.isFinite(v)) return "–";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-3) return v.toExponential(sig - 1).replace("e+", "e");
  const s = v.toPrecision(sig);
  return s.includes("e") ? String(Number(s)) : s;
}

/** Short form without trailing zeros (for labels and inputs): 1 bar, 99.61 °C, 2.5e-5. */
export function fmtShort(v, sig = 5) {
  if (v == null || !Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) return String(Number(v.toPrecision(sig - 2))).replace("e+", "e");
  return String(Number(v.toPrecision(sig)));
}

/** Temperature label in the display unit, at most two decimals. */
export const fmtT = (T_K, units) => String(+tToDisplay(T_K, units).toFixed(2));

/** Readable tier label. */
export const TIER_LABEL = {
  standard: "official standard",
  fitted: "fitted by CHEPTA to an open source",
  databank: "open databank",
  predicted: "predicted (estimation method)",
};

/** One-line text for a record's or props() `source` (a string or an object). */
export function formatSource(src) {
  if (src == null) return "source not stated";
  if (typeof src === "string") return src;
  return [src.name, src.reference, src.access, src.fit].filter(Boolean).join("; ");
}
