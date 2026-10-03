#!/usr/bin/env node
/**
 * Engineering report: computes a fixed set of engineering results with a built Fugacity
 * bundle and compares two versions (main and a pull request) with independent references.
 * Proposal 0002, section 8.
 *
 * Cases:      validation/report/cases.json (what is computed, at which conditions, tolerances)
 * References: validation/report/reference/*.json (made by validation/report/make_reference.py
 *             from CoolProp 8.0.0, the NIST Chemistry WebBook and the data in validation/data)
 *
 * Usage
 *   npm run build && npm run report
 *       runs this checkout (dist/fugacity.mjs) and compares it with itself; writes
 *       dist/report/{head.json, report.md, report.html}
 *   npm run report -- --base-bundle ../main/dist/fugacity.mjs
 *       same, with another build (for example main) as the base
 *
 *   node scripts/engineering-report.mjs run --bundle <dir>/dist/fugacity.mjs --out results.json
 *       computes every case with one bundle and writes the results (JSON)
 *   node scripts/engineering-report.mjs compare --base base.json --head head.json --out-dir out
 *       [--base-dir <base checkout>] [--head-dir <head checkout>]
 *       [--base-label "main"] [--head-label "this PR"]
 *       compares two result files with the references; writes out/report.md (pull request
 *       comment, under 65,000 characters) and out/report.html (self-contained, with plots).
 *       With --base-dir and --head-dir, the report warns when the pull request changes the
 *       report itself (this script, the cases, the references or the workflows).
 *
 * Feature detection: every case uses only the public interface of the bundle. A case whose
 * function does not exist in that version (Fugacity.steam, pure().props, model: "PR", ...)
 * or whose data is missing is reported as "not available in this version", not as a failure.
 * Interfaces that did not exist when this script was written (steam tables, equation of
 * state) are reached through the small ADAPTERS below; if a pull request adds such an
 * interface with other names, its cases stay "not available" until the adapter is updated.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
export const MAX_MARKDOWN = 65000;
const R = 8.314462618; // J/(mol K), CODATA 2018 (exact)

// ------------------------------------------------------------------ quantities and units

/** Display information for each quantity key (the key carries the unit). */
export const QUANTITIES = {
  T_C: { label: "T", unit: "°C", fmt: v => v.toFixed(2), devUnit: "K" },
  x1: { label: "x₁", unit: "mol/mol", fmt: v => v.toFixed(4) },
  x2: { label: "x₂", unit: "mol/mol", fmt: v => v.toFixed(4) },
  x3: { label: "x₃", unit: "mol/mol", fmt: v => v.toFixed(4) },
  y1: { label: "y₁", unit: "mol/mol", fmt: v => v.toFixed(4) },
  P_kPa: { label: "P", unit: "kPa", fmt: sig(5) },
  P_bar: { label: "P", unit: "bar", fmt: sig(6) },
  psat_kPa: { label: "Vapour pressure", unit: "kPa", fmt: sig(5) },
  rho_kg_m3: { label: "ρ", unit: "kg/m³", fmt: sig(5) },
  rhoL_kg_m3: { label: "ρ′ saturated liquid", unit: "kg/m³", fmt: sig(6) },
  rhoV_kg_m3: { label: "ρ″ saturated vapour", unit: "kg/m³", fmt: sig(6) },
  cp_kJ_kgK: { label: "cp", unit: "kJ/(kg·K)", fmt: sig(5) },
  dHvap_kJ_kg: { label: "Δh vap", unit: "kJ/kg", fmt: sig(5) },
  h_kJ_kg: { label: "h", unit: "kJ/kg", fmt: sig(6) },
  hL_kJ_kg: { label: "h′ saturated liquid", unit: "kJ/kg", fmt: sig(6) },
  hV_kJ_kg: { label: "h″ saturated vapour", unit: "kJ/kg", fmt: sig(6) },
  s_kJ_kgK: { label: "s", unit: "kJ/(kg·K)", fmt: sig(5) },
  mu_mPa_s: { label: "μ", unit: "mPa·s", fmt: sig(4) },
  k_W_mK: { label: "λ", unit: "W/(m·K)", fmt: sig(4) },
  HE_J_mol: { label: "hᴱ", unit: "J/mol", fmt: v => v.toFixed(1) },
  VF: { label: "vapour fraction", unit: "mol/mol", fmt: v => v.toFixed(5) },
};
const PROPERTY_LABELS = {
  vapourPressure: "vapour pressure", liquidDensity: "liquid density", liquidHeatCapacity: "liquid cp",
  heatOfVaporization: "heat of vaporization", liquidViscosity: "liquid viscosity",
  liquidThermalConductivity: "liquid thermal conductivity", idealGasHeatCapacity: "ideal-gas cp",
  density: "density",
};
function sig(n) {
  return v => {
    if (v === 0) return "0";
    const s = Number(v.toPrecision(n));
    return Math.abs(s) < 1e-3 || Math.abs(s) >= 1e7 ? s.toExponential(n - 1) : String(s);
  };
}
export const fmtValue = (key, v) => (v === null || v === undefined ? "" : (QUANTITIES[key]?.fmt ?? sig(5))(v));
const name = id => { const s = String(id).replace(/-/g, " "); return s[0].toUpperCase() + s.slice(1); };
const tC = T => +(T - 273.15).toFixed(2);
const bar = P => +(P / 100).toPrecision(6);

// ------------------------------------------------------------------ feature detection

/** Thrown when a function or data does not exist in the version under test. */
export class NotAvailable extends Error {}

const NA_PATTERNS = [
  /not in the databank/i, /no open data/i, /has no vapour-pressure record/i, /no vapour pressure/i,
  /unknown component/i, /unknown model/i, /unknown property/i, /not available/i, /no UNIQUAC/i,
  /no parameters for/i, /missing (binary|interaction|pair)/i,
];
const RANGE_PATTERNS = [/outside/i, /out of range/i, /range of validity/i, /beyond/i];

/** Classify an error thrown by a case: not available (feature/data missing, out of range) or a real error. */
export function classify(e) {
  const msg = String(e?.message ?? e);
  if (e instanceof NotAvailable || NA_PATTERNS.some(p => p.test(msg))) return { status: "na", reason: msg };
  if (e instanceof RangeError || RANGE_PATTERNS.some(p => p.test(msg))) return { status: "na", reason: `outside the range of this version: ${msg}` };
  return { status: "error", reason: msg };
}

function fn(obj, prop, what) {
  if (!obj || typeof obj[prop] !== "function") throw new NotAvailable(`${what} is not available in this version`);
  return obj[prop].bind(obj);
}
const num = v => typeof v === "number" && Number.isFinite(v);

/** Pick the first numeric field among [key, factor] candidates, converted by the factor. */
export function pick(obj, candidates, what) {
  if (obj && typeof obj === "object") {
    for (const [k, f] of candidates) if (num(obj[k])) return obj[k] * f;
  }
  const keys = obj && typeof obj === "object" ? Object.keys(obj).join(", ") : typeof obj;
  throw new NotAvailable(`${what}: no recognised field in the output (fields: ${keys})`);
}

/**
 * Adapters for interfaces added in v0.2 (steam tables, equation of state). Fields are
 * recognised by name, following the convention that field names carry units.
 */
export const ADAPTERS = {
  steamFields: {
    rho_kg_m3: [["rho_kg_m3", 1], ["density_kg_m3", 1]],
    h_kJ_kg: [["h_kJ_kg", 1], ["h_J_kg", 1e-3]],
    s_kJ_kgK: [["s_kJ_kgK", 1], ["s_J_kgK", 1e-3]],
    cp_kJ_kgK: [["cp_kJ_kgK", 1], ["cp_J_kgK", 1e-3]],
    mu_mPa_s: [["mu_Pa_s", 1e3], ["mu_mPa_s", 1], ["mu_uPa_s", 1e-3]],
    k_W_mK: [["k_W_mK", 1], ["k_mW_mK", 1e-3]],
    P_bar: [["P_bar", 1], ["psat_kPa", 1e-2], ["Psat_kPa", 1e-2], ["P_kPa", 1e-2], ["p_kPa", 1e-2], ["P_MPa", 10], ["psat_MPa", 10]],
  },
  /** Molar fields, converted with the molar mass of water from the bundle (g/mol). */
  steamMolarFields: { h_kJ_kg: "h_J_mol", s_kJ_kgK: "s_J_molK", cp_kJ_kgK: "cp_J_molK" },
  /** Where a saturation result keeps its two phases. */
  liquidKeys: ["liquid", "L", "f", "satLiquid"],
  vapourKeys: ["vapour", "vapor", "V", "g", "satVapour", "satVapor"],
  /** Saturation function at T (K), searched in this order. */
  saturation(F) {
    const s = F.steam;
    for (const f of [s?.saturation, s?.sat, s?.saturationT, s?.satT, F.steamSaturation]) {
      if (typeof f === "function") return f;
    }
    // Fugacity.steamSat({ T_K }) | ({ P_kPa }) (v0.2)
    if (typeof F.steamSat === "function") return T => F.steamSat({ T_K: T });
    return null;
  },
  /** Mixture density with an equation of state: s.density(z, T_K, P_kPa) or s.Z(z, T_K, P_kPa). */
  eosDensity(s, z, T, P, MWmix) {
    if (typeof s.density === "function") {
      const r = s.density(z, T, P);
      return { value: num(r) ? r : pick(r, [["rho_kg_m3", 1], ["density_kg_m3", 1]], "system.density"), method: "system.density(z, T, P)" };
    }
    for (const k of ["Z", "compressibility"]) {
      if (typeof s[k] === "function") {
        const r = s[k](z, T, P);
        const Z = num(r) ? r : pick(r, [["Z", 1], ["Zv", 1], ["Z_vapour", 1]], `system.${k}`);
        return { value: (P * 1000 * MWmix / 1000) / (Z * R * T), method: `system.${k}(z, T, P)` };
      }
    }
    throw new NotAvailable("no density or compressibility function on an equation-of-state system in this version");
  },
};

// ------------------------------------------------------------------ evaluating cases

function makeContext(F) {
  const pures = new Map(), systems = new Map();
  return {
    F,
    pure(c) {
      if (!pures.has(c)) pures.set(c, fn(F, "pure", "Fugacity.pure()")(c));
      return pures.get(c);
    },
    system(components, model, vapour) {
      const key = model + (vapour ? "/" + vapour : "") + ":" + components.join("+");
      if (!systems.has(key)) {
        const make = fn(F, "system", "Fugacity.system()");
        try { systems.set(key, make({ components, model, ...(vapour ? { vapour } : {}) })); } catch (e) { systems.set(key, e); }
      }
      const s = systems.get(key);
      if (s instanceof Error) throw s;
      return s;
    },
  };
}

const other = c => (c === "water" ? "acetic-acid" : "water");

function boilingPoint(ctx, c, P) {
  if (typeof ctx.F.pure === "function") {
    const p = ctx.pure(c);
    if (typeof p.tsat === "function") return { value: p.tsat(P) - 273.15, method: "pure().tsat" };
  }
  const s = ctx.system([c, other(c)], "ideal");
  return { value: fn(s, "boilingPoints", "system.boilingPoints()")(P)[0] - 273.15, method: "system().boilingPoints" };
}

function vapourPressure(ctx, c, T) {
  if (typeof ctx.F.pure === "function") {
    const p = ctx.pure(c);
    if (typeof p.psat === "function") return { value: p.psat(T), method: "pure().psat" };
  }
  const s = ctx.system([c, other(c)], "ideal");
  return { value: fn(s, "psat", "system.psat()")(T)[0], method: "system().psat" };
}

const PROPS_FIELD = {
  liquidDensity: ["rho_kg_m3", (v, M) => v], liquidHeatCapacity: ["cp_J_molK", (v, M) => v / M],
  heatOfVaporization: ["dHvap_J_mol", (v, M) => v / M], liquidViscosity: ["mu_Pa_s", v => v * 1e3],
  liquidThermalConductivity: ["k_W_mK", v => v], idealGasHeatCapacity: [null, (v, M) => v / M],
};

function missingReason(p, prop) {
  try {
    const a = p.available?.();
    if (a?.none?.includes(prop)) return `no open data for ${PROPERTY_LABELS[prop]} in this version`;
  } catch { /* ignore */ }
  return `${PROPERTY_LABELS[prop]} is not in the databank of this version`;
}

function pureProperty(ctx, cs) {
  const { component: c, property: prop, T_K: T } = cs;
  if (prop === "vapourPressure") return vapourPressure(ctx, c, T);
  const p = ctx.pure(c);
  const M = p.MW;
  if (!num(M)) throw new NotAvailable("pure().MW is not available in this version");
  if (prop === "density") {
    const st = fn(p, "props", "pure().props()")(T, cs.P_kPa);
    if (!num(st?.rho_kg_m3)) throw new NotAvailable(`density not given by pure().props() in this version${st?.notes?.length ? ": " + st.notes.join(" ") : ""}`);
    return { value: st.rho_kg_m3, method: `pure().props(), phase ${st.phase}` };
  }
  const [field, conv] = PROPS_FIELD[prop];
  let propsNote = "";
  // 1. The state function (the engineering interface; water uses the steam tables there).
  if (field && typeof p.props === "function") {
    let P = cs.P_kPa ?? 101.325;
    try { const ps = p.psat(T); if (num(ps) && P < ps * 1.001) P = ps * 1.001; } catch { /* no vapour pressure: keep P */ }
    try {
      const st = p.props(T, P);
      if (st?.phase === "liquid" && num(st[field])) return { value: conv(st[field], M), method: `pure().props() at ${+P.toPrecision(6)} kPa` };
      propsNote = st?.phase && st.phase !== "liquid" ? ` (pure().props() gives phase "${st.phase}")` : "";
    } catch (e) { propsNote = ` (pure().props(): ${e.message})`; }
  }
  // 2. The correlation record (saturated liquid).
  if (typeof p.property === "function" && typeof p.has === "function") {
    if (p.has(prop)) return { value: conv(p.property(prop, T), M), method: "pure().property()" };
    throw new NotAvailable(missingReason(p, prop) + propsNote);
  }
  throw new NotAvailable("pure().property() is not available in this version" + propsNote);
}

function waterMW(ctx) {
  try { const M = ctx.pure("water").MW; if (num(M)) return M; } catch { /* fall through */ }
  return null;
}

function steamField(ctx, obj, key, what) {
  try {
    return pick(obj, ADAPTERS.steamFields[key], what);
  } catch (e) {
    const mk = ADAPTERS.steamMolarFields[key];
    const M = waterMW(ctx);
    if (mk && M && obj && num(obj[mk])) return obj[mk] / M;
    throw e;
  }
}

function steamState(ctx, T, P, key) {
  const steam = fn(ctx.F, "steam", "Fugacity.steam()");
  const r = steam(T, P);
  return { value: steamField(ctx, r, key, "Fugacity.steam()"), method: "Fugacity.steam(T, P)" };
}

function steamSaturation(ctx, T, key) {
  fn(ctx.F, "steam", "Fugacity.steam()");
  const satFn = ADAPTERS.saturation(ctx.F);
  let r, liq, vap, method;
  if (satFn) {
    r = satFn(T);
    liq = ADAPTERS.liquidKeys.map(k => r?.[k]).find(o => o && typeof o === "object") ?? null;
    vap = ADAPTERS.vapourKeys.map(k => r?.[k]).find(o => o && typeof o === "object") ?? null;
    method = "steam saturation function";
  } else if (typeof ctx.F.steam.psat === "function") {
    const ps = ctx.F.steam.psat(T);
    const pk = num(ps) ? ps : steamField(ctx, ps, "P_bar", "Fugacity.steam.psat()") * 100;
    r = { psat_kPa: pk };
    liq = ctx.F.steam(T, pk * (1 + 1e-7));
    vap = ctx.F.steam(T, pk * (1 - 1e-7));
    method = "Fugacity.steam(T, psat ± 1e-7)";
  } else {
    throw new NotAvailable("no saturation function in Fugacity.steam in this version");
  }
  const flat = { rhoL_kg_m3: ["rhoL_kg_m3", "rho_liquid_kg_m3"], rhoV_kg_m3: ["rhoV_kg_m3", "rho_vapour_kg_m3"],
    hL_kJ_kg: ["hL_kJ_kg", "h_liquid_kJ_kg"], hV_kJ_kg: ["hV_kJ_kg", "h_vapour_kJ_kg"] };
  const phaseValue = k => {
    if (r && flat[k]) for (const f of flat[k]) if (num(r[f])) return r[f];
    const o = k.includes("L_") ? liq : vap;
    return steamField(ctx, o, k.startsWith("rho") ? "rho_kg_m3" : "h_kJ_kg", `saturated ${k.includes("L_") ? "liquid" : "vapour"}`);
  };
  let value;
  if (key === "P_bar") value = steamField(ctx, r, "P_bar", "steam saturation");
  else if (key === "dHvap_kJ_kg") value = num(r?.dHvap_kJ_kg) ? r.dHvap_kJ_kg : phaseValue("hV_kJ_kg") - phaseValue("hL_kJ_kg");
  else value = phaseValue(key);
  return { value, method };
}

function evaluateQuantity(ctx, cs, key) {
  const F = ctx.F;
  switch (cs.type) {
    case "normalBoilingPoint":
      return boilingPoint(ctx, cs.component, cs.P_kPa);
    case "azeotrope": {
      const s = ctx.system(cs.components, cs.model);
      const list = fn(s, "azeotropes", "system.azeotropes()")(cs.P_kPa) || [];
      if (!list.length) throw new Error("no azeotrope found");
      const x1 = z => (Array.isArray(z.x) ? z.x[0] : z.x);
      const z = [...list].sort((a, b) => Math.abs(x1(a) - cs.near_x1) - Math.abs(x1(b) - cs.near_x1))[0];
      return { value: key === "T_C" ? z.T - 273.15 : x1(z), method: `system.azeotropes(), ${z.type ?? ""}`.trim() };
    }
    case "ternaryAzeotrope": {
      const s = ctx.system(cs.components, cs.model);
      // Start at the reference composition; if that fails, try the starting points the
      // ternary view uses and take the interior azeotrope closest to the reference.
      const find = fn(s, "findAzeotrope", "system.findAzeotrope()");
      const tryFind = x0 => { try { return find(x0, cs.P_kPa); } catch { return null; } };
      let z = tryFind(cs.x0), method = "system.findAzeotrope() from the reference composition";
      if (!z) {
        const starts = [[1 / 3, 1 / 3, 1 / 3], [0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.2, 0.2, 0.6], [0.45, 0.45, 0.1], [0.45, 0.1, 0.45], [0.1, 0.45, 0.45]];
        const dist = a => Math.hypot(...a.x.map((v, k) => v - cs.x0[k]));
        z = starts.map(tryFind).filter(a => a && Math.min(...a.x) > 1e-3).sort((a, b) => dist(a) - dist(b))[0] ?? null;
        method = "system.findAzeotrope() from the view's starting points (none found from the reference composition)";
      }
      if (!z) throw new Error("no ternary azeotrope found");
      return { value: key === "T_C" ? z.T - 273.15 : z.x[Number(key.slice(1)) - 1], method };
    }
    case "bubbleT": {
      const s = ctx.system(cs.components, cs.model);
      const r = fn(s, "bubbleT", "system.bubbleT()")([cs.x1, 1 - cs.x1], cs.P_kPa);
      return { value: key === "T_C" ? r.T - 273.15 : r.y[0], method: "system.bubbleT()" };
    }
    case "flash": {
      const s = ctx.system(cs.components, cs.model, cs.vapour && cs.vapour !== "ideal" ? cs.vapour : undefined);
      const r = fn(s, "flash", "system.flash()")({ z: cs.z, ...cs.spec });
      const vap = r.phases.find(p => p.type === "vapour");
      const v = key === "VF" ? r.VF : key === "T_C" ? r.T - 273.15 : vap ? vap.composition[0] : null;
      return { value: v, method: "system.flash()" };
    }
    case "excessEnthalpy": {
      const s = ctx.system(cs.components, cs.model);
      return { value: fn(s, "excessEnthalpy", "system.excessEnthalpy()")([cs.x1, 1 - cs.x1], cs.T_K), method: "system.excessEnthalpy()" };
    }
    case "dewT": {
      const s = ctx.system(cs.components, cs.model);
      const r = fn(s, "dewT", "system.dewT()")([cs.y1, 1 - cs.y1], cs.P_kPa);
      return { value: key === "T_C" ? r.T - 273.15 : r.x[0], method: "system.dewT()" };
    }
    case "bubbleP": {
      const s = ctx.system(cs.components, cs.model);
      const r = fn(s, "bubbleP", "system.bubbleP()")([cs.x1, 1 - cs.x1], cs.T_K);
      const v = key === "P_kPa" ? r.P : key === "P_bar" ? r.P / 100 : r.y[0];
      return { value: v, method: "system.bubbleP()" };
    }
    case "pureProperty":
      return pureProperty(ctx, cs);
    case "steamState":
      return steamState(ctx, cs.T_K, cs.P_kPa, key);
    case "steamSaturation":
      return steamSaturation(ctx, cs.T_K, key);
    case "mixtureDensity": {
      const s = ctx.system(cs.components, cs.model);
      const MWmix = cs.components.reduce((a, c, i) => a + cs.z[i] * ctx.pure(c).MW, 0);
      return ADAPTERS.eosDensity(s, cs.z, cs.T_K, cs.P_kPa, MWmix);
    }
    default:
      throw new Error(`unknown case type ${cs.type}`);
  }
}

/** Grid spec {from, to, n} or a list (same arithmetic as make_reference.py). */
export function expand(v) {
  if (Array.isArray(v)) return v;
  return Array.from({ length: v.n }, (_, i) => v.from + (v.to - v.from) * i / (v.n - 1));
}

/**
 * Run every case and curve with one bundle.
 * @param {object} F      the Fugacity module (namespace)
 * @param {object} cases  validation/report/cases.json
 */
export function runCases(F, cases, { curves = true } = {}) {
  const ctx = makeContext(F);
  const results = {};
  for (const g of cases.groups) {
    for (const cs of g.cases) {
      results[cs.id] = {};
      for (const q of cs.quantities) {
        let r;
        try {
          const { value, method } = evaluateQuantity(ctx, cs, q.key);
          r = num(value) ? { status: "ok", value, method } : { status: "error", reason: `non-numeric result (${value})`, method };
        } catch (e) {
          r = classify(e);
        }
        results[cs.id][q.key] = r;
      }
    }
  }
  const curveResults = {};
  if (curves) {
    for (const cv of cases.curves || []) {
      const xs = expand(cv[cv.x]);
      const ys = xs.map(x => {
        try {
          const { value } = evaluateQuantity(ctx, { ...cv, [cv.x]: x }, cv.key);
          return num(value) ? value : null;
        } catch { return null; }
      });
      if (ys.some(y => y !== null)) curveResults[cv.id] = { y: ys };
    }
  }
  const features = {
    pure: typeof F.pure === "function",
    props: (() => { try { return typeof F.pure("water").props === "function"; } catch { return false; } })(),
    steam: typeof F.steam === "function",
    PR: (() => { try { F.system({ components: ["methane", "ethane"], model: "PR" }); return true; } catch { return false; } })(),
  };
  return { fugacity_report_results: 1, fugacity_version: F.version ?? null, features, results, curves: curveResults };
}

// ------------------------------------------------------------------ comparison

/** Deviation of value from reference: relative (fraction) or absolute, per the tolerance. */
export function deviation(value, ref, tol) {
  if (!num(value) || !num(ref)) return null;
  if (tol?.rel !== undefined) return ref === 0 ? null : (value - ref) / Math.abs(ref);
  return value - ref;
}

/** True when |deviation| is within the tolerance (rel fraction or abs). */
export function withinTolerance(dev, tol) {
  if (dev === null || !tol) return null;
  const limit = tol.rel !== undefined ? tol.rel : tol.abs;
  return Math.abs(dev) <= limit * (1 + 1e-12);
}

export function formatDeviation(dev, tol, key) {
  if (dev === null) return "";
  const sgn = dev >= 0 ? "+" : "−";
  if (tol?.rel !== undefined) {
    const p = Math.abs(dev) * 100;
    return `${sgn}${p < 0.01 ? p.toExponential(1) : p < 10 ? p.toFixed(2) : p.toFixed(1)} %`;
  }
  const unit = QUANTITIES[key]?.devUnit ?? (QUANTITIES[key]?.unit === "mol/mol" ? "" : QUANTITIES[key]?.unit ?? "");
  const a = Math.abs(dev);
  return `${sgn}${unit === "K" ? a.toFixed(2) : unit === "J/mol" ? a.toFixed(1) : a < 1e-3 ? a.toExponential(1) : a.toFixed(4)}${unit ? " " + unit : ""}`;
}

function tolText(tol) {
  if (!tol) return "";
  const t = tol.rel !== undefined ? `±${+(tol.rel * 100).toPrecision(3)} %` : `±${tol.abs}${tol.unit && tol.unit !== "mole fraction" ? " " + tol.unit : ""}`;
  return tol.informational ? `${t} (report only)` : t;
}

/** Load validation/report/reference/*.json into { caseId: { key: ref } } and a source table. */
export function loadReferences(dir) {
  const values = {}, sources = {};
  let curves = {};
  if (!existsSync(dir)) return { values, sources, curves };
  for (const f of readdirSync(dir).filter(f => f.endsWith(".json")).sort()) {
    const d = JSON.parse(readFileSync(join(dir, f), "utf8"));
    Object.assign(sources, d.sources || {});
    if (f === "curves.json") curves = d.curves || {};
    else Object.assign(values, d.values || {});
  }
  return { values, sources, curves };
}

function describe(cs, key) {
  const [c1, c2] = (cs.components || []).map(name);
  const q = QUANTITIES[key] || { label: key, unit: "" };
  switch (cs.type) {
    case "normalBoilingPoint":
      return { property: `${name(cs.component)}: normal boiling point`, conditions: `${bar(cs.P_kPa)} bar` };
    case "azeotrope":
      return { property: `${c1} + ${c2}: azeotrope ${key === "T_C" ? "T" : `x(${c1.toLowerCase()})`}`, conditions: `${bar(cs.P_kPa)} bar, ${cs.model}` };
    case "ternaryAzeotrope": {
      const comps = cs.components.map(name);
      const what = key === "T_C" ? "T" : `x(${comps[Number(key.slice(1)) - 1].toLowerCase()})`;
      return { property: `${comps.join(" + ")}: azeotrope ${what}`, conditions: `${bar(cs.P_kPa)} bar, ${cs.model}` };
    }
    case "bubbleT":
      return { property: `${c1} + ${c2}: bubble ${key === "T_C" ? "T" : `y(${c1.toLowerCase()})`}`, conditions: `x(${c1.toLowerCase()}) = ${cs.x1}, ${bar(cs.P_kPa)} bar, ${cs.model}` };
    case "flash": {
      const comps = cs.components.map(name);
      const sp = Object.entries(cs.spec).map(([k, v]) => (k === "T" ? `${tC(v)} °C` : k === "P" ? `${bar(v)} bar` : k === "H" ? `H = ${v} J/mol` : `VF = ${v}`)).join(", ");
      const q = { VF: "vapour fraction", T_C: "T", y1: `y(${comps[0].toLowerCase()})` }[key];
      return { property: `${comps.join(" + ")}: flash, ${q}`, conditions: `z = [${cs.z.join(", ")}], ${sp}, ${cs.model}${cs.vapour && cs.vapour !== "ideal" ? ` with ${cs.vapour} vapour` : ""}` };
    }
    case "excessEnthalpy":
      return { property: `${c1} + ${c2}: excess enthalpy`, conditions: `x(${c1.toLowerCase()}) = ${cs.x1}, ${tC(cs.T_K)} °C, ${cs.model}` };
    case "dewT":
      return { property: `${c1} + ${c2}: dew ${key === "T_C" ? "T" : `x(${c1.toLowerCase()})`}`, conditions: `y(${c1.toLowerCase()}) = ${cs.y1}, ${bar(cs.P_kPa)} bar, ${cs.model}` };
    case "bubbleP":
      return { property: `${c1} + ${c2}: bubble ${key.startsWith("P") ? "P" : `y(${c1.toLowerCase()})`}`, conditions: `x(${c1.toLowerCase()}) = ${cs.x1}, ${tC(cs.T_K)} °C, ${cs.model}` };
    case "pureProperty": {
      let cond = `${tC(cs.T_K)} °C`;
      if (cs.state === "saturated liquid") cond += ", saturated liquid (normal boiling point)";
      else if (cs.P_kPa !== undefined) cond += `, ${bar(cs.P_kPa)} bar`;
      return { property: `${name(cs.component)}: ${PROPERTY_LABELS[cs.property] ?? cs.property}`, conditions: cond };
    }
    case "steamSaturation":
      return { property: `Water: ${key === "P_bar" ? "saturation pressure" : q.label}`, conditions: `${tC(cs.T_K)} °C, saturation` };
    case "steamState":
      return { property: `Water: ${q.label}`, conditions: `${bar(cs.P_kPa)} bar, ${tC(cs.T_K)} °C (${cs.label})` };
    case "mixtureDensity":
      return { property: `${name(cs.label)}: density`, conditions: `${cs.components.map((c, i) => `${cs.z[i]} ${c}`).join(" + ")}, ${tC(cs.T_K)} °C, ${bar(cs.P_kPa)} bar, ${cs.model}` };
    default:
      return { property: `${cs.id} ${key}`, conditions: "" };
  }
}

/**
 * Compare base (main) and head (pull request) results with the references.
 * @returns {{ groups: Array, summary: object }}
 */
export function compare(cases, refs, base, head) {
  const summary = { total: 0, ok: 0, out: 0, outInfo: 0, noRef: 0, na: 0, error: 0, newer: 0, changed: 0, lost: 0 };
  const groups = [];
  for (const g of cases.groups) {
    const rows = [];
    for (const cs of g.cases) {
      for (const q of cs.quantities) {
        const tol = q.tolerance ?? cs.tolerance ?? cases.tolerances[q.tol];
        const ref = refs.values?.[cs.id]?.[q.key] ?? null;
        const b = base?.results?.[cs.id]?.[q.key] ?? { status: "na", reason: "not computed by the base version" };
        const h = head?.results?.[cs.id]?.[q.key] ?? { status: "na", reason: "not computed by this version" };
        const refValue = num(ref?.value) ? ref.value : null;
        const dev = h.status === "ok" ? deviation(h.value, refValue, tol) : null;
        const baseDev = b.status === "ok" ? deviation(b.value, refValue, tol) : null;
        const inTol = withinTolerance(dev, tol);
        const scale = tol?.rel !== undefined ? tol.rel * Math.abs(refValue ?? b.value ?? h.value ?? 0) : tol?.abs ?? 0;
        const changed = b.status === "ok" && h.status === "ok" &&
          Math.abs(h.value - b.value) > Math.max(1e-9 * Math.abs(b.value), 0.01 * scale);
        const newer = b.status !== "ok" && h.status === "ok";
        const lost = b.status === "ok" && h.status !== "ok";
        let status;
        if (h.status === "error") status = "error";
        else if (lost) status = "lost";
        else if (h.status === "na") status = "na";
        else if (inTol === true) status = "ok";
        else if (inTol === false) status = tol?.informational ? "outInfo" : "out";
        else status = "noRef";
        summary.total++;
        if (status !== "lost") summary[status]++;
        if (lost) summary.lost++;
        if (newer) summary.newer++;
        if (changed) summary.changed++;
        const show = changed || newer || lost || status === "error" || status === "out" || status === "outInfo";
        const asOnMain = !changed && b.status === "ok" && withinTolerance(baseDev, tol) === false;
        rows.push({ id: cs.id, key: q.key, ...describe(cs, q.key), unit: QUANTITIES[q.key]?.unit ?? "",
          base: b, head: h, ref, dev, baseDev, tol, inTol, status, changed, newer, lost, asOnMain, show });
      }
    }
    groups.push({ id: g.id, title: g.title, rows });
  }
  return { groups, summary };
}

// ------------------------------------------------------------------ report-machinery changes

const MACHINERY = ["scripts/engineering-report.mjs", "validation/report", ".github/workflows/engineering-report.yml",
  ".github/workflows/engineering-report-comment.yml"];

function listFiles(root, rel) {
  const p = join(root, rel);
  if (!existsSync(p)) return [];
  if (statSync(p).isFile()) return [rel];
  return readdirSync(p).flatMap(f => listFiles(root, join(rel, f)));
}

/** Files of the report itself that differ between two checkouts. */
export function machineryChanges(baseDir, headDir) {
  if (!baseDir || !headDir) return null;
  const hash = (root, f) => existsSync(join(root, f)) ? createHash("sha256").update(readFileSync(join(root, f))).digest("hex") : null;
  const files = new Set(MACHINERY.flatMap(m => [...listFiles(baseDir, m), ...listFiles(headDir, m)]));
  const changed = [...files].filter(f => hash(baseDir, f) !== hash(headDir, f)).sort();
  return { changed, newReport: !existsSync(join(baseDir, "scripts/engineering-report.mjs")) };
}

// ------------------------------------------------------------------ Markdown

const ICON = { ok: "✅", out: "⚠️", outInfo: "⚠️ (report only)", noRef: "no reference", na: "not available", error: "❌ error", lost: "⚠️ lost" };
const esc = s => String(s ?? "").replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
const cell = r => r.status === "ok" ? fmtValue(r.key, r.value) : r.status === "na" ? "n/a" : "error";

function statusText(row) {
  let t = ICON[row.status];
  if (row.newer && row.status !== "na") t = `🆕 ${t}`;
  else if (row.changed) t = `✏️ ${t}`;
  else if (row.asOnMain && (row.status === "out" || row.status === "outInfo")) t += " as on main";
  return t;
}

function mdRow(r) {
  const ref = num(r.ref?.value) ? fmtValue(r.key, r.ref.value) : "–";
  const b = r.base.status === "ok" ? fmtValue(r.key, r.base.value) : r.base.status === "na" ? "n/a" : "error";
  const h = r.head.status === "ok" ? fmtValue(r.key, r.head.value) : r.head.status === "na" ? "n/a" : "error";
  return `| ${esc(r.property)} | ${esc(r.conditions)} | ${esc(r.unit)} | ${b} | ${h} | ${ref} | ${formatDeviation(r.dev, r.tol, r.key)} | ${statusText(r)} |`;
}
const MD_HEAD = "| Property | Conditions | Unit | main | this PR | Reference | Deviation | |\n|---|---|---|--:|--:|--:|--:|---|";

export function summaryLines(s) {
  return [
    `| ✅ within tolerance | ⚠️ out of tolerance | 🆕 new | ✏️ changed | ⚠️ lost | ❌ errors | no reference | not available |`,
    `|--:|--:|--:|--:|--:|--:|--:|--:|`,
    `| ${s.ok} | ${s.out + s.outInfo}${s.outInfo ? ` (${s.outInfo} report only)` : ""} | ${s.newer} | ${s.changed} | ${s.lost} | ${s.error} | ${s.noRef} | ${s.na} |`,
  ];
}

/**
 * Pull request comment. Short summary, then per group only the rows that changed or are out
 * of tolerance, then everything in a collapsed block. Kept under MAX_MARKDOWN characters.
 */
export function renderMarkdown(cmp, meta = {}) {
  const s = cmp.summary;
  const head = [
    `## Engineering report`,
    ``,
    `**${esc(meta.headLabel ?? "this PR")}** compared with **${esc(meta.baseLabel ?? "main")}** and with independent references, ${s.total} results.`,
    ``,
    ...summaryLines(s),
    ``,
  ];
  const m = meta.machinery;
  if (m?.changed?.length) {
    head.push(m.newReport
      ? `> ℹ️ This pull request adds the engineering report itself; there is no earlier report to compare with.`
      : `> ⚠️ **This pull request changes the report itself** (${m.changed.map(f => "`" + esc(f) + "`").join(", ")}). Check those changes (cases, references, tolerances, script) before relying on the ✅ marks.`, ``);
  }
  const changes = [];
  for (const g of cmp.groups) {
    const rows = g.rows.filter(r => r.show);
    if (!rows.length) continue;
    changes.push(`### ${g.title}`, ``, MD_HEAD, ...rows.map(mdRow), ``);
  }
  if (!changes.length) changes.push(`No result changed and every result with a reference is within tolerance.`, ``);
  const legend = [
    `<sub>Deviation = this PR minus reference (relative for properties, absolute for temperatures and compositions). ` +
    `🆕 = not available on main; ✏️ = changed from main; ⚠️ lost = computed on main but not in this PR; "report only" = informational, does not block (an equation of state against a reference equation of state, or an excess enthalpy compared with data the fit used or predicted outside the fitted range). ` +
    `Tolerances and sources: \`validation/report/README.md\`.${meta.htmlNote ? " " + meta.htmlNote : ""}</sub>`, ``,
  ];
  const detailsOpen = [`<details><summary>All ${s.total} results</summary>`, ``];
  const detailsClose = [`</details>`, ``];
  let all = [];
  for (const g of cmp.groups) {
    // Results available in neither version are only counted here (they are listed in the HTML report).
    const rows = g.rows.filter(r => !(r.base.status === "na" && r.head.status === "na"));
    const none = g.rows.length - rows.length;
    all.push(`#### ${g.title}`, ``);
    if (rows.length) all.push(MD_HEAD, ...rows.map(mdRow), ``);
    if (none) all.push(`*${none} result${none > 1 ? "s" : ""} not available in either version (see the HTML report for the reasons).*`, ``);
  }
  const build = a => [...head, ...changes, ...detailsOpen, ...a, ...detailsClose, ...legend].join("\n");
  let md = build(all);
  if (md.length > MAX_MARKDOWN) {
    // Drop rows from the full list (keep the changes) until the comment fits.
    const note = `*The full list is too long for a comment: see the HTML report.*`;
    let keep = all.length;
    while (keep > 0 && build([...all.slice(0, keep), "", note]).length > MAX_MARKDOWN) keep = Math.floor(keep * 0.9);
    md = build([...all.slice(0, keep), "", note]);
    if (md.length > MAX_MARKDOWN) md = md.slice(0, MAX_MARKDOWN - 200) + "\n\n*(truncated: see the HTML report)*\n";
  }
  return md;
}

// ------------------------------------------------------------------ HTML

const h = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function niceTicks(lo, hi, n = 5) {
  if (!(hi > lo)) { hi = lo + 1; }
  const span = hi - lo, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => span / s <= n) ?? 10 * mag;
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) ticks.push(+v.toPrecision(12));
  return ticks;
}

/** A small line plot as inline SVG: series = [{ name, cls, xs, ys, kind: "line"|"dots"|"dashed" }]. */
export function svgPlot({ title, xLabel, yLabel, series }) {
  const W = 360, H = 230, L = 58, Rr = 10, T = 12, B = 40;
  const pts = series.flatMap(s => s.xs.map((x, i) => [x, s.ys[i]]).filter(([x, y]) => num(x) && num(y)));
  if (!pts.length) return "";
  let [x0, x1] = [Math.min(...pts.map(p => p[0])), Math.max(...pts.map(p => p[0]))];
  let [y0, y1] = [Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[1]))];
  if (x1 === x0) x1 = x0 + 1;
  if (y1 === y0) { y0 -= Math.abs(y0) * 0.05 || 1; y1 += Math.abs(y1) * 0.05 || 1; }
  const pad = (y1 - y0) * 0.06; y0 -= pad; y1 += pad;
  const X = x => L + (x - x0) / (x1 - x0) * (W - L - Rr), Y = y => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const xt = niceTicks(x0, x1), yt = niceTicks(y0, y1);
  const f = v => String(+v.toPrecision(4));
  let out = `<svg class="plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="${h(title)}">`;
  out += yt.map(v => `<line class="grid" x1="${L}" x2="${W - Rr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="tick" x="${L - 6}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end">${f(v)}</text>`).join("");
  out += xt.map(v => `<text class="tick" x="${X(v).toFixed(1)}" y="${H - B + 15}" text-anchor="middle">${f(v)}</text>`).join("");
  out += `<line class="axis" x1="${L}" x2="${W - Rr}" y1="${H - B}" y2="${H - B}"/>`;
  out += `<text class="lab" x="${(L + W - Rr) / 2}" y="${H - 6}" text-anchor="middle">${h(xLabel)}</text>`;
  out += `<text class="lab" transform="translate(13 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">${h(yLabel)}</text>`;
  for (const s of series) {
    const p = s.xs.map((x, i) => [x, s.ys[i]]);
    if (s.kind === "dots") {
      out += p.filter(([x, y]) => num(x) && num(y)).map(([x, y]) =>
        `<circle class="${s.cls}" cx="${X(x).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="4"><title>${h(s.name)}: ${f(x)}, ${f(y)}</title></circle>`).join("");
    } else {
      // Break the line where values are missing.
      let d = "", pen = false;
      for (const [x, y] of p) {
        if (num(x) && num(y)) { d += `${pen ? "L" : "M"}${X(x).toFixed(1)} ${Y(y).toFixed(1)} `; pen = true; } else pen = false;
      }
      if (d) out += `<path class="${s.cls}" d="${d.trim()}"><title>${h(s.name)}</title></path>`;
    }
  }
  return out + `</svg>`;
}

const CURVE_AXES = {
  T_K: ["T (°C)", v => v - 273.15], P_kPa: ["P (bar)", v => v / 100], x1: ["x₁ (mol/mol)", v => v],
};

function curveTitle(cv) {
  const q = QUANTITIES[cv.key];
  const yl = `${cv.type === "pureProperty" ? PROPERTY_LABELS[cv.property] : q.label} (${q.unit})`;
  switch (cv.type) {
    case "pureProperty": return [`${name(cv.component)}: ${PROPERTY_LABELS[cv.property]}${cv.state === "fluid" ? ` at ${tC(cv.T_K)} °C` : ""}`, yl, `${name(cv.component)}`];
    case "steamState": return [`Water (steam tables): ${q.label} at ${bar(cv.P_kPa)} bar`, `${q.label} (${q.unit})`, "Steam tables"];
    case "steamSaturation": return [`Water: saturation pressure`, `P (bar)`, "Steam tables"];
    case "bubbleT": return [`${cv.components.map(name).join(" + ")}: bubble T at ${bar(cv.P_kPa)} bar, ${cv.model}`, `T (°C)`, "Mixtures"];
    case "bubbleP": return [`${cv.components.map(name).join(" + ")}: bubble P at ${tC(cv.T_K)} °C, ${cv.model}`, `P (${q.unit})`, "Mixtures"];
    default: return [cv.id, yl, "Other"];
  }
}

function renderPlots(cases, refs, base, head) {
  const sections = new Map();
  for (const cv of cases.curves || []) {
    const [ax, conv] = CURVE_AXES[cv.x];
    const xs = expand(cv[cv.x]).map(conv);
    const series = [];
    const bc = base?.curves?.[cv.id], hc = head?.curves?.[cv.id], rc = refs.curves?.[cv.id];
    // This PR first, main dashed on top, so both stay visible where they coincide.
    if (hc) series.push({ name: "this PR", cls: "s-head", xs, ys: hc.y, kind: "line" });
    if (bc) series.push({ name: "main", cls: "s-base", xs, ys: bc.y, kind: "line" });
    if (rc?.y) series.push({ name: "reference", cls: "s-ref", xs, ys: rc.y, kind: "dots" });
    if (rc?.points) series.push({ name: "reference data", cls: "s-ref", xs: rc.points.map(p => p[0]), ys: rc.points.map(p => p[1]), kind: "dots" });
    if (!bc && !hc) continue;
    const [title, yl, section] = curveTitle(cv);
    const svg = svgPlot({ title, xLabel: ax, yLabel: yl, series });
    if (!svg) continue;
    const src = rc ? (refs.sources?.[rc.source]?.citation ?? rc.source) : "no reference";
    if (!sections.has(section)) sections.set(section, []);
    sections.get(section).push(`<figure><figcaption>${h(title)}</figcaption>${svg}<p class="src">Reference: ${h(src)}</p></figure>`);
  }
  let out = "";
  for (const [sec, figs] of sections) {
    out += `<details${sec === "Steam tables" || sec === "Mixtures" ? " open" : ""}><summary>${h(sec)} (${figs.length} plot${figs.length > 1 ? "s" : ""})</summary><div class="plots">${figs.join("")}</div></details>`;
  }
  return out;
}

function htmlTable(rows, refs) {
  const tr = r => {
    const ref = num(r.ref?.value) ? fmtValue(r.key, r.ref.value) : "–";
    const refTitle = r.ref ? (r.ref.value === null ? r.ref.why : `${refs.sources?.[r.ref.source]?.citation ?? r.ref.source}; ${r.ref.detail ?? ""}`) : "no reference";
    const tdv = x => x.status === "ok"
      ? `<td class="n" title="${h(x.method ?? "")}">${fmtValue(r.key, x.value)}</td>`
      : `<td class="n na" title="${h(x.reason ?? "")}">${x.status === "na" ? "n/a" : "error"}</td>`;
    return `<tr class="st-${r.status}"><td>${h(r.property)}</td><td>${h(r.conditions)}</td><td>${h(r.unit)}</td>${tdv(r.base)}${tdv(r.head)}` +
      `<td class="n" title="${h(refTitle)}">${ref}</td><td class="n">${formatDeviation(r.dev, r.tol, r.key)}</td><td class="n tol">${h(tolText(r.tol))}</td><td>${statusText(r)}</td></tr>`;
  };
  return `<div class="tw"><table><thead><tr><th>Property</th><th>Conditions</th><th>Unit</th><th>main</th><th>this PR</th><th>Reference</th><th>Deviation</th><th>Tolerance</th><th></th></tr></thead><tbody>${rows.map(tr).join("")}</tbody></table></div>`;
}

export function renderHtml(cmp, refs, cases, base, head, meta = {}) {
  const s = cmp.summary;
  const tiles = [["✅ within tolerance", s.ok], ["⚠️ out of tolerance", s.out + s.outInfo], ["🆕 new", s.newer], ["✏️ changed", s.changed],
    ["⚠️ lost", s.lost], ["❌ errors", s.error], ["no reference", s.noRef], ["not available", s.na]]
    .map(([l, v]) => `<div class="tile"><div class="v">${v}</div><div class="l">${l}</div></div>`).join("");
  const m = meta.machinery;
  const banner = m?.changed?.length
    ? `<p class="banner">${m.newReport ? "This pull request adds the engineering report itself." : "This pull request changes the report itself: " + m.changed.map(h).join(", ") + ". Check those changes before relying on the ✅ marks."}</p>` : "";
  const changed = cmp.groups.map(g => {
    const rows = g.rows.filter(r => r.show);
    return rows.length ? `<h3>${h(g.title)}</h3>${htmlTable(rows, refs)}` : "";
  }).join("") || "<p>No result changed and every result with a reference is within tolerance.</p>";
  const all = cmp.groups.map(g => `<details><summary>${h(g.title)} (${g.rows.length})</summary>${htmlTable(g.rows, refs)}</details>`).join("");
  const srcs = Object.entries(refs.sources || {}).map(([k, v]) =>
    `<li><b>${h(k)}</b>: ${h(v.citation)}${v.doi ? `, doi:${h(v.doi)}` : ""}${v.url ? `, <a href="${h(v.url)}">${h(v.url)}</a>` : ""}${v.access ? ` (${h(v.access)})` : ""}</li>`).join("");
  const tols = Object.entries(cases.tolerances).map(([k, t]) => `<li><b>${h(k)}</b>: ${h(tolText(t))}; ${h(t.basis ?? "")}</li>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Engineering report</title>
<style>
:root{--bg:#fcfcfb;--fg:#0b0b0b;--muted:#52514e;--line:#e4e3df;--grid:#ecebe7;--card:#f4f3f0;--head:#2a78d6;--ref:#eb6834;--base:#8a8984;--warn:#fff3d6;--err:#fde3e3}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#1a1a19;--fg:#fff;--muted:#c3c2b7;--line:#3a3a37;--grid:#2c2c2a;--card:#242422;--head:#3987e5;--ref:#d95926;--base:#8f8e88;--warn:#3a3220;--err:#3d2424}}
:root[data-theme="dark"]{--bg:#1a1a19;--fg:#fff;--muted:#c3c2b7;--line:#3a3a37;--grid:#2c2c2a;--card:#242422;--head:#3987e5;--ref:#d95926;--base:#8f8e88;--warn:#3a3220;--err:#3d2424}
body{background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:16px}
main{max-width:1200px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}h2{font-size:18px;margin:28px 0 8px}h3{font-size:15px;margin:18px 0 6px}
.meta{color:var(--muted);margin:0 0 14px}.tiles{display:flex;flex-wrap:wrap;gap:8px}.tile{background:var(--card);border-radius:8px;padding:8px 12px;min-width:110px}
.tile .v{font-size:22px;font-weight:600}.tile .l{color:var(--muted);font-size:12px}.banner{background:var(--warn);padding:8px 12px;border-radius:6px}
.tw{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border-bottom:1px solid var(--line);padding:4px 6px;text-align:left;vertical-align:top}
th{color:var(--muted);font-weight:600}td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}td.na{color:var(--muted)}td.tol{color:var(--muted)}
tr.st-out,tr.st-lost,tr.st-outInfo{background:var(--warn)}tr.st-error{background:var(--err)}
details{margin:8px 0}summary{cursor:pointer;font-weight:600}.plots{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;margin-top:8px}
figure{margin:0;background:var(--card);border-radius:8px;padding:8px}figcaption{font-size:13px;font-weight:600;margin-bottom:4px}.src{color:var(--muted);font-size:11px;margin:4px 0 0}
svg.plot{width:100%;height:auto;display:block}.grid{stroke:var(--grid);stroke-width:1}.axis{stroke:var(--muted);stroke-width:1}
.tick{fill:var(--muted);font-size:10px}.lab{fill:var(--muted);font-size:11px}
.s-head{fill:none;stroke:var(--head);stroke-width:2}.s-base{fill:none;stroke:var(--base);stroke-width:2;stroke-dasharray:5 4}
circle.s-ref{fill:var(--ref);stroke:var(--card);stroke-width:2}.legend{display:flex;gap:16px;color:var(--muted);font-size:12px;margin:6px 0}
.key{display:inline-block;width:18px;height:0;border-top:2px solid;vertical-align:middle;margin-right:4px}ul{padding-left:20px}
@media (max-width:600px){body{padding:16px 12px}}
</style></head><body><main>
<h1>Engineering report</h1>
<p class="meta">${h(meta.headLabel ?? "this PR")} compared with ${h(meta.baseLabel ?? "main")} and with independent references; ${s.total} results. Generated ${h(meta.date ?? "")}.</p>
<div class="tiles">${tiles}</div>${banner}
<h2>What changed or is out of tolerance</h2>${changed}
<h2>Plots</h2>
<div class="legend"><span><span class="key" style="border-color:var(--base);border-top-style:dashed"></span>main</span><span><span class="key" style="border-color:var(--head)"></span>this PR</span><span><svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="var(--ref)"/></svg> reference</span></div>
${renderPlots(cases, refs, base, head)}
<h2>All results</h2>${all}
<h2>Tolerances</h2><ul>${tols}</ul>
<h2>References</h2><ul>${srcs}</ul>
<p class="meta">Hover a value to see how it was computed, a reference to see its source, and "n/a" to see why a result is not available.</p>
</main></body></html>
`;
}

// ------------------------------------------------------------------ command line

export async function loadBundle(path) {
  const F = await import(pathToFileURL(resolve(path)).href);
  return F.default && typeof F.default === "object" && !F.system ? F.default : F;
}

export function loadCases(path = join(REPO, "validation/report/cases.json")) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { o[a.slice(2)] = argv[i + 1]; i++; } else o._.push(a);
  }
  return o;
}

async function cmdRun(o) {
  if (!o.bundle || !o.out) throw new Error("usage: run --bundle <dist/fugacity.mjs> --out <results.json>");
  const cases = loadCases(o.cases);
  let F;
  try {
    F = await loadBundle(o.bundle);
  } catch (e) {
    // A version that does not build: every case is reported as not available.
    console.error(`Could not load ${o.bundle}: ${e.message}`);
    F = {};
  }
  const res = runCases(F, cases);
  res.bundle = o.bundle;
  mkdirSync(dirname(resolve(o.out)), { recursive: true });
  writeFileSync(o.out, JSON.stringify(res) + "\n");
  const n = Object.values(res.results).flatMap(Object.values);
  console.log(`Fugacity ${res.fugacity_version}: ${n.filter(r => r.status === "ok").length} computed, ` +
    `${n.filter(r => r.status === "na").length} not available, ${n.filter(r => r.status === "error").length} errors -> ${o.out}`);
  return res;
}

function cmdCompare(o, baseRes, headRes) {
  const cases = loadCases(o.cases);
  const refs = loadReferences(o.references ?? join(REPO, "validation/report/reference"));
  const base = baseRes ?? JSON.parse(readFileSync(o.base, "utf8"));
  const head = headRes ?? JSON.parse(readFileSync(o.head, "utf8"));
  const cmp = compare(cases, refs, base, head);
  const label = (l, r) => `${l}${r?.fugacity_version ? ` (Fugacity ${r.fugacity_version})` : ""}`;
  const meta = {
    baseLabel: label(o["base-label"] ?? "main", base), headLabel: label(o["head-label"] ?? "this PR", head),
    machinery: machineryChanges(o["base-dir"], o["head-dir"]), date: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
    htmlNote: o["html-note"],
  };
  const outDir = o["out-dir"] ?? "dist/report";
  mkdirSync(outDir, { recursive: true });
  const md = renderMarkdown(cmp, meta);
  writeFileSync(join(outDir, "report.md"), md);
  writeFileSync(join(outDir, "report.html"), renderHtml(cmp, refs, cases, base, head, meta));
  console.log(summaryLines(cmp.summary).join("\n"));
  console.log(`report.md: ${md.length} characters -> ${relative(process.cwd(), join(outDir, "report.md"))}, report.html`);
  return cmp;
}

async function main(argv) {
  const o = args(argv);
  const cmd = o._[0];
  if (cmd === "run") return cmdRun(o);
  if (cmd === "compare") return cmdCompare(o);
  if (cmd && cmd !== "local") throw new Error(`unknown command "${cmd}" (run, compare)`);
  // Default (npm run report): this checkout against itself, or against --base-bundle.
  const outDir = o["out-dir"] ?? join(REPO, "dist/report");
  const head = await cmdRun({ ...o, bundle: o.bundle ?? join(REPO, "dist/fugacity.mjs"), out: join(outDir, "head.json") });
  const base = o["base-bundle"] ? await cmdRun({ ...o, bundle: o["base-bundle"], out: join(outDir, "base.json") }) : head;
  return cmdCompare({ ...o, "out-dir": outDir, "base-label": o["base-label"] ?? (o["base-bundle"] ? "base" : "this checkout") }, base, head);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exit(1); });
}
