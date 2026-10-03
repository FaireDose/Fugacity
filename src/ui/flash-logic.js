/**
 * Flash workspace of the workbench (proposal 0001, step 6): the DOM-free part. The flash
 * settings kept in the state, the request sent to the engine, the stream table of the result
 * (the feed and each phase), and its CSV export (roadmap B1).
 *
 * No thermodynamics here: runFlash only calls sys.flash (src/equilibrium/flash.js) and
 * sys.flash again for the feed enthalpy; the table converts units with the exact definitions
 * in properties-logic.js and mole to mass fractions with the molar masses of the components.
 *
 * Units inside: T in K, P in kPa, enthalpy and duty in J per mol of feed, mole fractions.
 */
import { tToDisplay, pToDisplay } from "./properties-logic.js";

/** The specifications of the flash, as in sys.flash. */
export const FLASH_SPECS = [
  { id: "TP", label: "T, P", title: "Temperature and pressure", hint: "Isothermal flash: the feed brought to T and P." },
  { id: "PH", label: "P, Q", title: "Pressure and heat duty", hint: "Feed at its own T and P, heated by Q and flashed to P. Q = 0: adiabatic flash (a valve)." },
  { id: "PVF", label: "P, VF", title: "Pressure and vapour fraction", hint: "Temperature at which the feed is that fraction vapour: VF = 0 is the bubble point, VF = 1 the dew point." },
  { id: "TVF", label: "T, VF", title: "Temperature and vapour fraction", hint: "Pressure at which the feed is that fraction vapour: VF = 0 is the bubble point, VF = 1 the dew point." },
];

/**
 * The flash settings of a new workbench.
 *  - spec: one of FLASH_SPECS; T_K, P_kPa, VF: the conditions it uses;
 *  - Q_J_mol: heat duty of the P-H flash (J per mol of feed; 0 = adiabatic);
 *  - feedT_K, feedP_kPa: the state of the feed: used by the P-H flash, and by the others
 *    when `duty` is on (the heat duty Q = H_out - H_feed is then reported);
 *  - z: feed mole fractions, one per component of the flash inputs (null: equimolar);
 *  - flow_kmol_h: feed flow, for the phase flows and the heat duty in kW (a multiplication:
 *    the flash itself is per mole of feed).
 */
export const FLASH_DEFAULTS = Object.freeze({
  spec: "PVF", T_K: 350, P_kPa: 101.325, VF: 0.5, Q_J_mol: 0, feedT_K: 298.15, feedP_kPa: 101.325, duty: false, z: null, flow_kmol_h: 100,
});

/** Heat duty in kW for a duty in J per mol of feed and a feed flow in kmol/h. */
export const dutyKW = (Q_J_mol, flow_kmol_h) => Q_J_mol * flow_kmol_h / 3600;

const positive = (v, name) => {
  const x = Number(v);
  if (!(x > 0) || !Number.isFinite(x)) throw new RangeError(`flash.${name} must be a positive number (got ${v}).`);
  return x;
};

/** Merge a change into the flash settings, with checks (a typo is never silently ignored). */
export function normalizeFlash(patch = {}, prev = FLASH_DEFAULTS) {
  if (patch == null || typeof patch !== "object" || Array.isArray(patch)) throw new Error("flash must be an object such as { spec: \"TP\", T_K: 350, P_kPa: 101.325 }.");
  const known = Object.keys(FLASH_DEFAULTS);
  for (const k of Object.keys(patch)) if (!known.includes(k)) throw new Error(`flash: unknown key "${k}". Known: ${known.join(", ")}.`);
  const f = { ...prev };
  if (patch.spec != null) {
    const id = String(patch.spec).toUpperCase().replace(/[^A-Z]/g, "");
    if (!FLASH_SPECS.some(s => s.id === id)) throw new Error(`flash.spec "${patch.spec}" is not one of: ${FLASH_SPECS.map(s => s.id).join(", ")}.`);
    f.spec = id;
  }
  for (const k of ["T_K", "P_kPa", "feedT_K", "feedP_kPa", "flow_kmol_h"]) if (patch[k] != null) f[k] = positive(patch[k], k);
  if (patch.VF != null) {
    const v = Number(patch.VF);
    if (!(v >= 0 && v <= 1)) throw new RangeError(`flash.VF must be between 0 and 1 (got ${patch.VF}).`);
    f.VF = v;
  }
  if (patch.Q_J_mol != null) {
    const q = Number(patch.Q_J_mol);
    if (!Number.isFinite(q)) throw new RangeError(`flash.Q_J_mol must be a number (got ${patch.Q_J_mol}).`);
    f.Q_J_mol = q;
  }
  if ("duty" in patch) f.duty = !!patch.duty;
  if ("z" in patch) {
    if (patch.z == null) f.z = null;
    else {
      const z = (Array.isArray(patch.z) ? patch.z : [patch.z]).map(Number);
      if (z.some(v => !(v >= 0))) throw new RangeError("flash.z: mole fractions must be non-negative numbers.");
      if (!(z.reduce((a, b) => a + b, 0) > 0)) throw new RangeError("flash.z: the feed composition must have a positive sum.");
      f.z = z;
    }
  }
  return f;
}

/** The feed mole fractions for n components: f.z normalized when it has n values, else equimolar. */
export function feedComposition(f, n) {
  if (!Array.isArray(f.z) || f.z.length !== n) return Array.from({ length: n }, () => 1 / n);
  const s = f.z.reduce((a, b) => a + b, 0);
  return f.z.map(v => v / s);
}

/** Mole fractions from mass fractions (or the other way, with `toMass`), for molar masses MW. */
export function convertBasis(v, MW, toMass = false) {
  const m = v.map((u, i) => (toMass ? u * MW[i] : u / MW[i]));
  const s = m.reduce((a, b) => a + b, 0);
  return m.map(u => u / s);
}

/**
 * Run the flash of the settings `f` on the system `sys` (the engine's sys.flash).
 *  - TP, PVF, TVF: sys.flash({ z, T, P } | { z, P, VF } | { z, T, VF }), with { feed } when
 *    f.duty is on;
 *  - PH: the feed enthalpy H_feed from a T-P flash of the feed at feedT_K, feedP_kPa, then
 *    sys.flash({ z, P, H: H_feed + Q }, { feed }).
 * @returns {{result:object, request:object, z:number[]}}  `request`: what was sent, for the record
 */
export function runFlash(sys, f) {
  const z = feedComposition(f, sys.n);
  const feed = { T: f.feedT_K, P: f.feedP_kPa };
  let spec, opts = {};
  if (f.spec === "PH") {
    const Hf = sys.flash({ z, T: feed.T, P: feed.P }).H_J_mol;
    if (Hf == null) throw new Error("The P-H flash needs enthalpies, which are not available for this system.");
    spec = { z, P: f.P_kPa, H: Hf + f.Q_J_mol };
    opts = { feed };
  } else {
    spec = f.spec === "TP" ? { z, T: f.T_K, P: f.P_kPa } : f.spec === "PVF" ? { z, P: f.P_kPa, VF: f.VF } : { z, T: f.T_K, VF: f.VF };
    if (f.duty) opts = { feed };
  }
  return { result: sys.flash(spec, opts), request: { spec, opts }, z };
}

/** The name of a phase column: "Vapour", "Liquid", or "Liquid (water-rich)" with two liquids. */
export function phaseName(p) {
  const base = p.type === "vapour" ? "Vapour" : "Liquid";
  return p.label ? `${base} (${p.label[0].toLowerCase()}${p.label.slice(1)})` : base;
}

/**
 * The stream table of a flash result: one column for the feed and one per phase.
 * @param {object} r      the flash result (sys.flash)
 * @param {object} ctx    { names: string[], MW: number[] (g/mol), z: number[] (feed), units: { T, P },
 *   flow: feed flow in kmol/h (optional: adds the molar and mass flow of each stream) }
 * @returns {{columns:string[], rows:{key:string, label:string, unit:string, values:(number|string|null)[]}[]}}
 *   values in display units (T and P as `units` say); null where a value does not apply
 *   (the feed temperature when no feed state was given, an enthalpy the model cannot give)
 */
export function flashTable(r, { names, MW, z, units, flow }) {
  const tU = units.T === "K" ? "K" : "°C";
  const phases = r.phases;
  const feedState = r.feed ?? null;
  const molarMass = x => x.reduce((a, v, i) => a + v * MW[i], 0);
  const row = (key, label, unit, feedValue, f) => ({ key, label, unit, values: [feedValue, ...phases.map(f)] });
  const rows = [
    row("fraction", "Fraction of the feed", "mol/mol", 1, p => p.fraction),
    ...(flow > 0 ? [
      row("flow", "Molar flow", "kmol/h", flow, p => flow * p.fraction),
      row("mflow", "Mass flow", "kg/h", flow * molarMass(z), p => flow * p.fraction * molarMass(p.composition)),
    ] : []),
    row("T", "Temperature", tU, feedState ? tToDisplay(feedState.T, units) : null, () => tToDisplay(r.T, units)),
    row("P", "Pressure", units.P, feedState ? pToDisplay(feedState.P, units) : null, () => pToDisplay(r.P, units)),
    row("h", "Molar enthalpy", "J/mol", feedState ? feedState.H_J_mol : null, p => p.h_J_mol),
    row("MW", "Molar mass", "g/mol", molarMass(z), p => molarMass(p.composition)),
    ...names.map((n, i) => row(`x${i}`, `Mole fraction ${n}`, "mol/mol", z[i], p => p.composition[i])),
    ...names.map((n, i) => row(`w${i}`, `Mass fraction ${n}`, "kg/kg", convertBasis(z, MW, true)[i], p => convertBasis(p.composition, MW, true)[i])),
  ];
  return { columns: ["Feed", ...phases.map(phaseName)], rows };
}

/** One CSV field: numbers with up to 10 significant digits and a decimal point; text quoted when needed. */
export function csvField(v) {
  if (v == null || (typeof v === "number" && !Number.isFinite(v))) return "";
  if (typeof v === "number") return String(Number(v.toPrecision(10)));
  const t = String(v);
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/**
 * The flash result as CSV (comma-separated, decimal point, one line per quantity), ready for a
 * spreadsheet: a heading block (what was calculated, with which model, and the summary), then
 * the stream table. Lines end with CRLF (RFC 4180).
 * @param {object} table   from flashTable
 * @param {object} meta    { title, model, spec, summary: [label, value, unit][], sources: string[], version }
 */
export function flashCsv(table, meta = {}) {
  const lines = [];
  const line = cells => lines.push(cells.map(csvField).join(","));
  line(["Fugacity flash", meta.title ?? ""]);
  if (meta.model) line(["Model", meta.model]);
  if (meta.spec) line(["Specification", meta.spec]);
  for (const [label, value, unit] of meta.summary ?? []) line([label, value, unit ?? ""]);
  for (const s of meta.sources ?? []) line(["Source", s]);
  if (meta.version) line(["Calculated with", `Fugacity ${meta.version}`]);
  line([]);
  line(["Quantity", "Unit", ...table.columns]);
  for (const r of table.rows) line([r.label, r.unit, ...r.values]);
  return lines.join("\r\n") + "\r\n";
}
