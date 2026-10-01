/**
 * Pure-component properties (proposal 0002).
 *
 * Data: each component in src/data/components.json may carry a `properties` object whose
 * entries are correlation records (see correlations.js) or "no open data" markers:
 *   "liquidViscosity": { "available": false, "searched": ["CoolProp", "NIST WebBook", ...] }
 * Vapour pressure stays in the component's top-level `vapourPressure` record (used by the
 * VLE models too).
 *
 * Engine units: K, kPa, mol, J, kg/m3, Pa s, W/(m K). Records store the units listed in
 * PROPERTIES[name].recordUnits; the loader refuses any other units.
 *
 * Enthalpy reference: ideal gas at 298.15 K and the given pressure-independent state, so
 *   h_vapour(T) = integral of cpIG from 298.15 K to T   (+ residual enthalpy, from an
 *                 equation of state when one is used)
 *   h_liquid(T) = h_vapour,ideal(T) - dHvap(T)          (pressure effect on the liquid
 *                 neglected; valid well below the critical point)
 * Smith, Van Ness & Abbott, Introduction to Chemical Engineering Thermodynamics, ch. 6
 * (the same reference-state construction; any edition).
 */
import componentData from "../data/components.json" with { type: "json" };
import { evaluate } from "./correlations.js";
import { brent } from "../util/solve.js";
import { findComponent } from "./system.js";
import { cubicEos, CUBICS } from "./eos/cubic.js";

export const R = 8.314462618; // J/(mol K), CODATA 2018 exact value

/** Properties the engine knows, with display information for views. */
export const PROPERTIES = {
  liquidDensity:              { label: "Liquid density (saturated)", symbol: "ρL", units: "kg/m3", recordUnits: "kg/m3" },
  idealGasHeatCapacity:       { label: "Ideal-gas heat capacity", symbol: "cp°", units: "J/mol/K", recordUnits: "J/mol/K" },
  liquidHeatCapacity:         { label: "Liquid heat capacity", symbol: "cpL", units: "J/mol/K", recordUnits: "J/mol/K" },
  heatOfVaporization:         { label: "Heat of vaporization", symbol: "ΔHvap", units: "J/mol", recordUnits: "J/mol" },
  liquidViscosity:            { label: "Liquid viscosity", symbol: "μL", units: "Pa s", recordUnits: "Pa s" },
  vapourViscosity:            { label: "Vapour viscosity (low pressure)", symbol: "μV", units: "Pa s", recordUnits: "Pa s" },
  liquidThermalConductivity:  { label: "Liquid thermal conductivity", symbol: "kL", units: "W/m/K", recordUnits: "W/m/K" },
  vapourThermalConductivity:  { label: "Vapour thermal conductivity (low pressure)", symbol: "kV", units: "W/m/K", recordUnits: "W/m/K" },
  surfaceTension:             { label: "Surface tension", symbol: "σ", units: "N/m", recordUnits: "N/m" },
};
export const PROPERTY_NAMES = Object.keys(PROPERTIES);

const T_REF = 298.15;

// 16-point Gauss-Legendre nodes and weights on [-1, 1] (Abramowitz & Stegun, table 25.4).
const GL_X = [0.0950125098376374, 0.2816035507792589, 0.4580167776572274, 0.6178762444026438,
  0.7554044083550030, 0.8656312023878318, 0.9445750230732326, 0.9894009349916499];
const GL_W = [0.1894506104550685, 0.1826034150449236, 0.1691565193950025, 0.1495959888165767,
  0.1246289712555339, 0.0951585116824928, 0.0622535239386479, 0.0271524594117541];
function integrate(f, a, b) {
  if (a === b) return 0;
  const m = (a + b) / 2, r = (b - a) / 2;
  let s = 0;
  for (let i = 0; i < GL_X.length; i++) s += GL_W[i] * (f(m + r * GL_X[i]) + f(m - r * GL_X[i]));
  return s * r;
}

function vapourPressureRecord(c) {
  const vp = c.vapourPressure;
  if (!vp) return null;
  return {
    equation: vp.equation, units: "Pa",
    coefficients: { A: vp.A, B: vp.B, C: vp.C, D: vp.D, E: vp.E },
    Tmin_K: vp.Tmin_K, Tmax_K: vp.Tmax_K, tier: vp.tier ?? "fitted",
    source: vp.source,
  };
}

/**
 * A pure component with its properties.
 * @param {string} key  name, id, alias, formula or CAS number
 */
export function pure(key) {
  const id = findComponent(key);
  const c = componentData.components[id];
  const data = c.properties || {};
  for (const [name, rec] of Object.entries(data)) {
    if (!PROPERTIES[name]) throw new Error(`${c.name}: unknown property "${name}" in components.json.`);
    if (rec.available === false) continue;
    if (rec.units !== PROPERTIES[name].recordUnits) {
      throw new Error(`${c.name}: ${name} must be stored in ${PROPERTIES[name].recordUnits}, found "${rec.units}".`);
    }
  }
  const vpRec = vapourPressureRecord(c);
  let prCache = null;
  /** Peng-Robinson for this component alone (vapour and supercritical states). */
  const eosPR = () => prCache || (prCache = cubicEos("PR", [{ name: c.name, Tc_K: c.Tc_K, Pc_Pa: c.Pc_Pa, omega: c.omega }]));

  const record = name => {
    if (name === "vapourPressure") return vpRec;
    const r = data[name];
    return r && r.available !== false ? r : null;
  };
  const has = name => record(name) !== null;
  const missingMessage = name => {
    const r = data[name];
    const what = PROPERTIES[name]?.label ?? name;
    return r && r.available === false
      ? `No open data for ${what.toLowerCase()} of ${c.name} (searched: ${(r.searched || []).join(", ")}).`
      : `${what} of ${c.name} is not in the databank yet.`;
  };

  /** Property value at T (K), in engine units (see PROPERTIES). Throws if missing or out of range. */
  function property(name, T, opts) {
    if (name !== "vapourPressure" && !PROPERTIES[name]) {
      throw new Error(`Unknown property "${name}". Known: vapourPressure, ${PROPERTY_NAMES.join(", ")}.`);
    }
    const r = record(name);
    if (!r) throw new Error(missingMessage(name));
    const v = evaluate(r, T, opts);
    return name === "vapourPressure" ? v / 1000 : v;
  }

  /** Vapour pressure, kPa. */
  const psat = (T, opts) => property("vapourPressure", T, opts);

  /** Saturation (boiling) temperature at P (kPa), K. */
  function tsat(P) {
    if (!vpRec) throw new Error(missingMessage("vapourPressure"));
    const lo = vpRec.Tmin_K, hi = vpRec.Tmax_K;
    const flo = psat(lo) - P, fhi = psat(hi) - P;
    if (flo > 0 || fhi < 0) {
      throw new RangeError(`${c.name}: ${P} kPa is outside the vapour-pressure range ` +
        `(${psat(lo).toPrecision(4)}-${psat(hi).toPrecision(4)} kPa, ${lo}-${hi} K).`);
    }
    return brent(T => psat(T) - P, lo, hi, { xtol: 1e-9 });
  }

  /** Ideal-gas enthalpy relative to the ideal gas at 298.15 K, J/mol. */
  function hIdealGas(T) {
    const r = record("idealGasHeatCapacity");
    if (!r) throw new Error(missingMessage("idealGasHeatCapacity"));
    return integrate(t => evaluate(r, t, { extrapolate: true }), T_REF, T);
  }

  /**
   * State properties at T (K) and P (kPa). Missing properties are null, with a note.
   * Liquid properties are at saturation (pressure effect neglected). Vapour and
   * supercritical states use Peng-Robinson (eos/cubic.js) for Z, density, residual
   * enthalpy and residual cp, added to the ideal-gas correlations.
   */
  function props(T, P) {
    const out = { component: c.name, T_K: T, P_kPa: P, phase: null, notes: [], sources: {} };
    const tryGet = (key, fn, srcName) => {
      try {
        out[key] = fn();
        if (srcName) { const r = record(srcName); out.sources[key] = { tier: r?.tier, source: r?.source }; }
      } catch (e) { out[key] = null; out.notes.push(e.message); }
    };
    let ps = null;
    if (T < c.Tc_K) { try { ps = psat(T); } catch (e) { out.notes.push(e.message); } }
    out.psat_kPa = ps;
    if (ps !== null) out.sources.psat_kPa = { tier: vpRec.tier, source: vpRec.source };
    out.phase = T >= c.Tc_K ? "supercritical" : ps === null ? null : P >= ps ? "liquid" : "vapour";
    if (out.phase === null && T < c.Tc_K) {
      // No vapour-pressure record (or out of its range): decide the phase with Peng-Robinson.
      try {
        const pPR = eosPR().psat(0, T);
        out.phase = P >= pPR ? "liquid" : "vapour";
        out.notes.push(`Phase decided with the Peng-Robinson saturation pressure (${pPR.toPrecision(5)} kPa); no vapour-pressure correlation available at ${T} K.`);
      } catch (e) { out.notes.push(e.message); }
    }
    if (out.phase === null) {
      out.notes.push(`Phase unknown at ${T} K: no vapour pressure available.`);
      return out;
    }
    const MWkg = c.MW / 1000;
    if (out.phase === "liquid") {
      tryGet("rho_kg_m3", () => property("liquidDensity", T), "liquidDensity");
      tryGet("cp_J_molK", () => property("liquidHeatCapacity", T), "liquidHeatCapacity");
      tryGet("dHvap_J_mol", () => property("heatOfVaporization", T), "heatOfVaporization");
      tryGet("h_J_mol", () => hIdealGas(T) - property("heatOfVaporization", T));
      tryGet("mu_Pa_s", () => property("liquidViscosity", T), "liquidViscosity");
      tryGet("k_W_mK", () => property("liquidThermalConductivity", T), "liquidThermalConductivity");
      out.notes.push("Liquid properties at saturation; the effect of pressure is neglected.");
    } else {
      // Vapour or supercritical fluid: Peng-Robinson for density, residual enthalpy and
      // residual heat capacity; ideal-gas parts from the cpIG correlation.
      const st = eosPR().state(T, P, [1], "vapour");
      const prSrc = { tier: "standard", source: `Peng-Robinson equation of state (${CUBICS.PR.reference}) with Tc, Pc and omega of ${c.name}` };
      out.Z = st.Z;
      out.rho_kg_m3 = MWkg / st.v_m3_mol;
      out.sources.rho_kg_m3 = prSrc;
      out.hResidual_J_mol = st.hR_J_mol;
      out.sources.hResidual_J_mol = prSrc;
      tryGet("cp_J_molK", () => property("idealGasHeatCapacity", T) + st.cpR_J_molK, "idealGasHeatCapacity");
      tryGet("h_J_mol", () => hIdealGas(T) + st.hR_J_mol);
      tryGet("mu_Pa_s", () => property("vapourViscosity", T), "vapourViscosity");
      tryGet("k_W_mK", () => property("vapourThermalConductivity", T), "vapourThermalConductivity");
      if (st.rootType === "liquid-like") out.notes.push("Dense (liquid-like) fluid: Peng-Robinson densities of dense fluids are typically 5-20 % off (no volume translation).");
      out.notes.push("Density, enthalpy and cp from Peng-Robinson: h = h_ideal-gas + h_residual, cp = cp_ideal-gas + cp_residual. Viscosity and thermal conductivity at low pressure.");
    }
    return out;
  }

  return {
    id, name: c.name, formula: c.formula, cas: c.cas,
    MW: c.MW, Tc_K: c.Tc_K, Pc_kPa: c.Pc_Pa / 1000, omega: c.omega, Tb_K: c.Tb_K,
    has, record, property, psat, tsat, hIdealGas, props,
    /** Names of the properties with data, and those marked "no open data". */
    available() {
      const have = PROPERTY_NAMES.filter(has);
      if (vpRec) have.unshift("vapourPressure");
      const none = PROPERTY_NAMES.filter(n => data[n]?.available === false);
      return { have, none };
    },
  };
}
