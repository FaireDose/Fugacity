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
 * Enthalpy reference: ideal gas at 298.15 K, so
 *   h_vapour(T, P) = integral of cpIG from 298.15 K to T + h_R(T, P)
 *   h_liquid(T)    = integral of cpIG from 298.15 K to T + h_R(T, psat(T)) - dHvap(T)
 * with h_R the Peng-Robinson residual enthalpy of the vapour (eos/cubic.js), so that
 * h_vapour - h_liquid = dHvap at saturation. The pressure effect on the liquid is
 * neglected (valid well below the critical point). This is the usual path construction
 * of a departure function (ideal gas -> real saturated vapour -> saturated liquid).
 * Limits: dimerizing components (acetic acid) get no enthalpy (null, with a note); the
 * residual enthalpy of polar vapours is approximate (see POLAR_NOTE).
 */
import componentData from "../data/components.json" with { type: "json" };
import { evaluate } from "./correlations.js";
import { brent } from "../util/solve.js";
import { findComponent } from "./system.js";
import { steam, steamSat, STANDARD as IF97_NAME, VISCOSITY_STANDARD, CONDUCTIVITY_STANDARD } from "./iapws/steam.js";
import { hIdealGas as hIdealGasIF97, cpIdealGas as cpIdealGasIF97, psat as psatIF97, tsat as tsatIF97,
  TC as TC_IF97 } from "./iapws/if97.js";
import { viscosity as viscosityIAPWS, thermalConductivityParts as conductivityIAPWS } from "./iapws/transport.js";
import { cubicEos, CUBICS } from "./eos/cubic.js";
import { dimerK, monomerPressure } from "./vapour.js";
import { fail, failRange } from "../util/errors.js";

// Accuracy of the Peng-Robinson residual enthalpy and cp of vapours, against CoolProp's
// reference equations of state (test/eos-reference.test.js, 12 states): light gases and
// hydrocarbons within 7-20 % in h_R (at most 270 J/mol), polar vapours 27-45 % too small
// in magnitude (methanol at 450 K, 1 MPa: -959 J/mol against -1450 J/mol; acetone at
// 400 K, 0.5 MPa: -861 against -1548), and their residual cp 3-4 times too small
// (classical alpha function, no association term).
const POLAR_RESIDUAL_NOTE = new Set(["water", "methanol", "ethanol", "acetone", "ethylene-glycol", "ethyl-acetate", "chloroform"]);
const POLAR_NOTE = "Polar vapour: the Peng-Robinson residual enthalpy is 27-45 % too small in magnitude and the residual cp 3-4 times too small (for example methanol at 450 K and 1 MPa: h_R = -959 J/mol against -1450 J/mol from CoolProp). The ideal-gas part dominates at low pressure.";

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
 * @param {object} [opts]
 * @param {object} [opts.properties]  property records that replace or add to the databank's
 *        (same format as components.json; e.g. the user's own data, or test records)
 */
export function pure(key, opts = {}) {
  const id = findComponent(key);
  const c = componentData.components[id];
  const data = { ...(c.properties || {}), ...(opts.properties || {}) };
  for (const [name, rec] of Object.entries(data)) {
    if (!PROPERTIES[name]) throw fail("BAD_INPUT", `${c.name}: unknown property "${name}"${opts.properties?.[name] ? "" : " in components.json"}.`);
    if (rec.available === false) continue;
    if (rec.units !== PROPERTIES[name].recordUnits) {
      throw fail("MISSING_DATA", `${c.name}: ${name} must be stored in ${PROPERTIES[name].recordUnits}, found "${rec.units}".`);
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
      throw fail("BAD_INPUT", `Unknown property "${name}". Known: vapourPressure, ${PROPERTY_NAMES.join(", ")}.`);
    }
    const r = record(name);
    if (!r) throw fail("MISSING_DATA", missingMessage(name));
    const v = evaluate(r, T, opts);
    return name === "vapourPressure" ? v / 1000 : v;
  }

  /** Vapour pressure, kPa. */
  const psat = (T, opts) => property("vapourPressure", T, opts);

  /** Saturation (boiling) temperature at P (kPa), K. */
  function tsat(P) {
    if (!vpRec) throw fail("MISSING_DATA", missingMessage("vapourPressure"));
    const lo = vpRec.Tmin_K, hi = vpRec.Tmax_K;
    const flo = psat(lo) - P, fhi = psat(hi) - P;
    if (flo > 0 || fhi < 0) {
      throw failRange("OUT_OF_RANGE", `${c.name}: ${P} kPa is outside the vapour-pressure range ` +
        `(${psat(lo).toPrecision(4)}-${psat(hi).toPrecision(4)} kPa, ${lo}-${hi} K).`);
    }
    return brent(T => psat(T) - P, lo, hi, { xtol: 1e-9 });
  }

  /** Ideal-gas enthalpy relative to the ideal gas at 298.15 K, J/mol. */
  function hIdealGas(T) {
    const r = record("idealGasHeatCapacity");
    if (!r) throw fail("MISSING_DATA", missingMessage("idealGasHeatCapacity"));
    return integrate(t => evaluate(r, t, { extrapolate: true }), T_REF, T);
  }

  /**
   * State properties at T (K) and P (kPa). Missing properties are null, with a note.
   * Liquid properties are at saturation (pressure effect neglected). Vapour and
   * supercritical states use Peng-Robinson (eos/cubic.js) for Z, density, residual
   * enthalpy and residual cp, added to the ideal-gas correlations.
   */
  function props(T, P) {
    if (id === "water") return waterProps(c, T, P);
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
    const assocNote = `${c.name} dimerizes in the vapour; enthalpy is not given (null) until the association model is used for enthalpy: the ideal-gas (monomer) cp and the heat of vaporization to the dimerized vapour do not share a reference (about 28 kJ/mol apart for acetic acid).`;
    if (out.phase === "liquid") {
      tryGet("rho_kg_m3", () => property("liquidDensity", T), "liquidDensity");
      tryGet("cp_J_molK", () => property("liquidHeatCapacity", T), "liquidHeatCapacity");
      tryGet("dHvap_J_mol", () => property("heatOfVaporization", T), "heatOfVaporization");
      if (c.association) {
        out.h_J_mol = null;
        out.notes.push(assocNote);
      } else {
        tryGet("h_J_mol", () => liquidEnthalpy(T, ps));
        out.notes.push("Liquid enthalpy h = h_ideal-gas + h_residual(saturated vapour, Peng-Robinson) - dHvap, so that h_vapour - h_liquid = dHvap at saturation.");
      }
      tryGet("mu_Pa_s", () => property("liquidViscosity", T), "liquidViscosity");
      tryGet("k_W_mK", () => property("liquidThermalConductivity", T), "liquidThermalConductivity");
      out.notes.push("Liquid properties at saturation; the effect of pressure is neglected.");
    } else if (c.association && c.association.type === "dimer") {
      // Dimerizing vapour (chemical theory, as in the VLE models): ideal gas of monomers
      // and dimers, p_dimer = K p_monomer^2 (vapour.js). Peng-Robinson is not used.
      const K = dimerK(c.association, T), pm = monomerPressure(P, K), pd = K * pm * pm;
      out.rho_kg_m3 = MWkg * (pm + 2 * pd) * 1000 / (R * T);
      out.sources.rho_kg_m3 = { tier: "databank", source: `Chemical theory (ideal monomer + dimer gas): ${c.association.source}` };
      out.dimerFraction = pd / P;
      out.h_J_mol = null;
      tryGet("cp_J_molK", () => property("idealGasHeatCapacity", T), "idealGasHeatCapacity");
      out.notes.push(assocNote);
      if (out.cp_J_molK !== null) out.notes.push(`cp_J_molK is the ideal-gas heat capacity of the ${c.name} monomer; it excludes the heat of dissociating the dimers (${(100 * 2 * pd / (pm + 2 * pd)).toFixed(0)} % of the molecules are dimerized here), so the real vapour's cp is higher.`);
      tryGet("mu_Pa_s", () => property("vapourViscosity", T), "vapourViscosity");
      tryGet("k_W_mK", () => property("vapourThermalConductivity", T), "vapourThermalConductivity");
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
      if (POLAR_RESIDUAL_NOTE.has(id)) out.notes.push(POLAR_NOTE);
    }
    out.notes = [...new Set(out.notes)];
    return out;
  }

  /**
   * Liquid enthalpy at saturation, J/mol (reference: ideal gas at 298.15 K):
   *   h_L(T) = h_IG(T) + h_R,V(T, psat) - dHvap(T)
   * with h_R,V the Peng-Robinson residual enthalpy of the saturated vapour, so that the
   * vapour (h_IG + h_R from Peng-Robinson) and the liquid join at saturation:
   * h_V - h_L = dHvap. psat from the vapour-pressure correlation, or from Peng-Robinson
   * when there is none. Not available for dimerizing components (see props()).
   */
  function liquidEnthalpy(T, ps = null) {
    if (c.association) throw fail("NOT_AVAILABLE", `${c.name} dimerizes in the vapour: liquid enthalpy is not available yet.`);
    const pS = ps ?? (vpRec ? psat(T) : eosPR().psat(0, T));
    return hIdealGas(T) + eosPR().state(T, pS, [1], "vapour").hR_J_mol - property("heatOfVaporization", T);
  }

  /** Enthalpies of the saturated vapour and liquid at T (J/mol) and the pressure (kPa). */
  function saturation(T) {
    if (!(T < c.Tc_K)) throw failRange("OUT_OF_RANGE", `${c.name}: no saturation state at ${T} K (critical temperature ${c.Tc_K} K).`);
    const pS = vpRec ? psat(T) : eosPR().psat(0, T);
    const hV = c.association ? null : hIdealGas(T) + eosPR().state(T, pS, [1], "vapour").hR_J_mol;
    const hL = c.association ? null : liquidEnthalpy(T, pS);
    return { T_K: T, P_kPa: pS, hV_J_mol: hV, hL_J_mol: hL, dHvap_J_mol: property("heatOfVaporization", T) };
  }

  const base = {
    id, name: c.name, formula: c.formula, cas: c.cas,
    MW: c.MW, Tc_K: c.Tc_K, Pc_kPa: c.Pc_Pa / 1000, omega: c.omega, Tb_K: c.Tb_K,
    // melting (triple-point) temperature and enthalpy of fusion with their source, or null (no open data)
    fusion: c.fusion && c.fusion.available !== false
      ? { Tm_K: c.fusion.Tm_K, Hfus_J_mol: c.fusion.Hfus_J_mol, tier: c.fusion.tier, source: c.fusion.source } : null,
    has, record, property, psat, tsat, hIdealGas, props, liquidEnthalpy, saturation,
    /** Names of the properties with data, and those marked "no open data". */
    available() {
      const have = PROPERTY_NAMES.filter(has);
      if (vpRec) have.unshift("vapourPressure");
      const none = PROPERTY_NAMES.filter(n => data[n]?.available === false);
      return { have, none };
    },
  };
  if (id !== "water") return base;
  // Water: IAPWS for everything, including the saturation enthalpies (consistent with props()).
  const M = c.MW, h0 = hIdealGasIF97(T_REF);
  const waterSaturation = T => {
    const s = steamSat({ T_K: T });
    const hL = M * (s.liquid.h_kJ_kg - h0), hV = M * (s.vapour.h_kJ_kg - h0);
    return { T_K: s.T_K, P_kPa: s.P_kPa, hV_J_mol: hV, hL_J_mol: hL, dHvap_J_mol: hV - hL };
  };
  return { ...base, ...waterMethods(c, base), saturation: waterSaturation, liquidEnthalpy: T => waterSaturation(T).hL_J_mol };
}

// ---------------------------------------------------------------------------------------
// Water: IAPWS standards instead of correlations (proposal 0002, section 2).
// ---------------------------------------------------------------------------------------

const IF97_SOURCE = {
  name: "IAPWS-IF97",
  reference: "IAPWS R7-97(2012), Revised Release on the IAPWS Industrial Formulation 1997 for the " +
    "Thermodynamic Properties of Water and Steam",
  access: "free from IAPWS: https://iapws.org/technical-guidance/release/IF97-Rev",
};
const MU_SOURCE = {
  name: "IAPWS R12-08 (industrial form: mu2 = 1, density from IAPWS-IF97)",
  reference: "IAPWS R12-08, Release on the IAPWS Formulation 2008 for the Viscosity of Ordinary Water Substance",
  access: "free from IAPWS: https://iapws.org/technical-guidance/release/viscosity",
};
const K_SOURCE = {
  name: "IAPWS R15-11 (industrial form, with IAPWS-IF97)",
  reference: "IAPWS R15-11, Release on the IAPWS Formulation 2011 for the Thermal Conductivity of Ordinary Water Substance",
  access: "free from IAPWS: https://iapws.org/technical-guidance/release/ThCond",
};

/**
 * Water's property methods from the IAPWS standards, replacing the correlation-based ones of
 * pure(): psat and tsat from IF97 region 4, hIdealGas from the IF97 ideal-gas part, and every
 * property in PROPERTIES that IAPWS covers (saturated-liquid values for the liquid
 * properties; the dilute-gas limit, rho -> 0, for the "low pressure" vapour viscosity and
 * conductivity). Properties IAPWS does not cover here (surface tension) fall back to the
 * records in components.json. The top-level `vapourPressure` record of water in
 * components.json, used by the VLE models, is not changed or used by these methods.
 */
function waterMethods(c, base) {
  const M = c.MW; // g/mol
  const TT = 273.16, TMIN = 273.15;
  // name: [Tmin, Tmax, source, function of T in engine units]
  const sat = T => steamSat({ T_K: T });
  const IF97_PROPS = {
    vapourPressure: [TMIN, TC_IF97, IF97_SOURCE, T => psatIF97(T)],
    liquidDensity: [TMIN, TC_IF97, IF97_SOURCE, T => sat(T).liquid.rho_kg_m3],
    idealGasHeatCapacity: [TMIN, 1073.15, IF97_SOURCE, T => M * cpIdealGasIF97(T)],
    liquidHeatCapacity: [TMIN, 647.0, IF97_SOURCE, T => M * sat(T).liquid.cp_kJ_kgK],
    heatOfVaporization: [TMIN, TC_IF97, IF97_SOURCE, T => M * sat(T).hfg_kJ_kg],
    liquidViscosity: [TT, TC_IF97, MU_SOURCE, T => sat(T).liquid.mu_Pa_s],
    vapourViscosity: [TT, 1173.15, MU_SOURCE, T => viscosityIAPWS(T, 0)],
    liquidThermalConductivity: [TT, 647.0, K_SOURCE, T => sat(T).liquid.k_W_mK],
    vapourThermalConductivity: [TT, 1173.15, K_SOURCE, T => conductivityIAPWS(T, 0, null).k_W_mK],
  };
  const units = name => name === "vapourPressure" ? "kPa" : PROPERTIES[name].units;
  const record = name => {
    const e = IF97_PROPS[name];
    if (!e) return base.record(name);
    return { equation: "IAPWS", units: units(name), Tmin_K: e[0], Tmax_K: e[1], tier: "standard", source: e[2] };
  };
  const has = name => record(name) !== null;
  function property(name, T, opts) {
    const e = IF97_PROPS[name];
    if (!e) return base.property(name, T, opts);
    if (!(T >= e[0] && T <= e[1])) {
      throw failRange("OUT_OF_RANGE", `Water: ${PROPERTIES[name]?.label ?? "vapour pressure"} from IAPWS is ` +
        `available from ${e[0]} K to ${e[1]} K; T = ${T} K.`);
    }
    return e[3](T);
  }
  return {
    has, record, property,
    /** Vapour pressure, kPa (IAPWS-IF97 region 4, Eq. 30), 273.15-647.096 K. */
    psat: T => property("vapourPressure", T),
    /** Saturation temperature at P (kPa), K (IAPWS-IF97 region 4, Eq. 31), 0.611213-22064 kPa. */
    tsat: P => tsatIF97(P),
    /** Ideal-gas enthalpy relative to the ideal gas at 298.15 K, J/mol (IF97 ideal-gas part), 273.15-1073.15 K. */
    hIdealGas(T) {
      if (!(T >= TMIN && T <= 1073.15)) {
        throw failRange("OUT_OF_RANGE", `Water: IF97 ideal-gas enthalpy is available from 273.15 K to 1073.15 K; T = ${T} K.`);
      }
      return M * (hIdealGasIF97(T) - hIdealGasIF97(T_REF));
    },
    available() {
      const have = ["vapourPressure", ...PROPERTY_NAMES.filter(has)];
      const none = PROPERTY_NAMES.filter(n => !IF97_PROPS[n] && componentData.components.water.properties?.[n]?.available === false);
      return { have, none };
    },
  };
}

/**
 * Water at T (K) and P (kPa) from IAPWS-IF97 (all phases) with the IAPWS viscosity
 * (R12-08) and thermal conductivity (R15-11) in their industrial forms; see src/thermo/iapws/.
 * Converted to the engine's molar units with the component's molar mass M (g/mol, so
 * kJ/kg x g/mol = J/mol), and to the engine's enthalpy reference (ideal gas at 298.15 K):
 *   h_J_mol = M * (h_IF97(T, P) - h°_IF97(298.15 K)),
 * where h° is the ideal-gas part of IF97 region 2 (R T tau dgamma°/dtau). Throws outside the
 * range of IF97 (273.15-1073.15 K up to 100 MPa; to 2273.15 K up to 50 MPa).
 */
function waterProps(c, T, P) {
  const M = c.MW;
  const st = steam(T, P);
  const src = { tier: "standard", source: IF97_NAME + " (IAPWS R7-97(2012))" };
  const msrc = { tier: "standard", source: VISCOSITY_STANDARD };
  const ksrc = { tier: "standard", source: CONDUCTIVITY_STANDARD };
  const below = T <= TC_IF97;
  const out = {
    component: c.name, T_K: T, P_kPa: P, phase: st.phase, region: st.region,
    psat_kPa: below ? psatIF97(T) : null,
    rho_kg_m3: st.rho_kg_m3,
    cp_J_molK: st.cp_kJ_kgK * M,
    cv_J_molK: st.cv_kJ_kgK * M,
    h_J_mol: M * (st.h_kJ_kg - hIdealGasIF97(T_REF)),
    s_J_molK: st.s_kJ_kgK * M,
    dHvap_J_mol: below ? steamSat({ T_K: T }).hfg_kJ_kg * M : null,
    mu_Pa_s: st.mu_Pa_s,
    k_W_mK: st.k_W_mK,
    sources: {
      psat_kPa: src, rho_kg_m3: src, cp_J_molK: src, cv_J_molK: src, h_J_mol: src, s_J_molK: src,
      dHvap_J_mol: src, mu_Pa_s: msrc, k_W_mK: ksrc,
    },
    notes: [
      "Water: IAPWS-IF97 at the given T and P (all phases); viscosity and thermal conductivity " +
      "from the IAPWS releases (industrial forms).",
      "h_J_mol is relative to the ideal gas at 298.15 K; s_J_molK keeps the IF97 reference " +
      "(saturated liquid at the triple point).",
      ...st.notes,
    ],
  };
  if (!below) out.notes.push("Above the critical temperature: no vapour pressure or heat of vaporization.");
  return out;
}
