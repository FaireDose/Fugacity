/**
 * Steam tables: water and steam properties from the IAPWS standards, in steam-table units.
 *
 *   Thermodynamic properties: IAPWS-IF97 (IAPWS R7-97(2012)), see if97.js.
 *   Viscosity: IAPWS R12-08, industrial form (mu2 = 1, IF97 density), see transport.js.
 *   Thermal conductivity: IAPWS R15-11, industrial form (IF97 properties), see transport.js.
 *
 * Reference state (IF97): internal energy and entropy of the saturated liquid at the triple
 * point (273.16 K) are zero, as in every printed steam table.
 *
 * Units: T in K, P in kPa; density kg/m3; specific volume m3/kg; h and u kJ/kg; s, cp, cv
 * kJ/(kg K); speed of sound m/s; viscosity Pa s; thermal conductivity W/(m K).
 */
import { stateTP, saturationT, psatMPa, tsatMPa, TC } from "./if97.js";
import { viscosity, thermalConductivity, T_MIN_TRANSPORT, T_MAX_TRANSPORT } from "./transport.js";
import { fail } from "../../util/errors.js";

export const STANDARD = "IAPWS-IF97";
export const VISCOSITY_STANDARD = "IAPWS R12-08 (industrial form: mu2 = 1, density from IAPWS-IF97)";
export const CONDUCTIVITY_STANDARD = "IAPWS R15-11 (industrial form, with IAPWS-IF97)";
export const TRANSPORT_STANDARD = "IAPWS R12-08 (viscosity, industrial form mu2 = 1) and " +
  "IAPWS R15-11 (thermal conductivity, industrial form with IAPWS-IF97)";

function present(st) {
  const out = {
    region: st.region,
    phase: st.phase,
    T_K: st.T,
    P_kPa: st.p * 1000,
    rho_kg_m3: st.rho,
    v_m3_kg: st.v,
    h_kJ_kg: st.h,
    s_kJ_kgK: st.s,
    u_kJ_kg: st.u,
    cp_kJ_kgK: st.cp,
    cv_kJ_kgK: st.cv,
    w_m_s: st.w,
    mu_Pa_s: null,
    k_W_mK: null,
    standard: STANDARD,
    transport: TRANSPORT_STANDARD,
    notes: [],
  };
  if (st.T >= T_MIN_TRANSPORT && st.T <= T_MAX_TRANSPORT) {
    out.mu_Pa_s = viscosity(st.T, st.rho);
    out.k_W_mK = thermalConductivity(st.T, st.rho, st);
  } else {
    out.notes.push(`Viscosity and thermal conductivity: the IAPWS releases are valid from ${T_MIN_TRANSPORT} K to ` +
      `${T_MAX_TRANSPORT} K; not computed at ${st.T} K.`);
  }
  return out;
}

/**
 * Water or steam at T (K) and P (kPa), IAPWS-IF97 with IAPWS transport properties.
 * Valid 273.15-1073.15 K up to 100 MPa and 1073.15-2273.15 K up to 50 MPa; throws outside.
 * On the saturation line itself the liquid is returned; use steamSat for both phases.
 *
 * @example
 * Fugacity.steam(573.15, 1000)   // superheated steam at 300 °C, 10 bar: h_kJ_kg ≈ 3051
 * @returns {{region:number, phase:"liquid"|"vapour"|"supercritical", T_K:number, P_kPa:number,
 *   rho_kg_m3:number, v_m3_kg:number, h_kJ_kg:number, s_kJ_kgK:number, u_kJ_kg:number,
 *   cp_kJ_kgK:number, cv_kJ_kgK:number, w_m_s:number, mu_Pa_s:number|null, k_W_mK:number|null,
 *   standard:string, transport:string, notes:string[]}}
 *   phase: "supercritical" when T >= 647.096 K and P >= 22064 kPa; "liquid" when T < Tc and
 *   P >= psat(T); otherwise "vapour".
 */
export function steam(T_K, P_kPa) {
  return present(stateTP(T_K, P_kPa));
}

/**
 * Saturated water and steam, given either the temperature or the pressure.
 * @param {{T_K?:number, P_kPa?:number}} spec  exactly one of T_K (273.15-647.096 K) or
 *   P_kPa (0.611213-22064 kPa)
 * @returns {{T_K:number, P_kPa:number, liquid:object, vapour:object, hfg_kJ_kg:number,
 *   sfg_kJ_kgK:number, standard:string}}  liquid and vapour have the fields of steam().
 */
export function steamSat(spec = {}) {
  const hasT = spec.T_K !== undefined, hasP = spec.P_kPa !== undefined;
  if (hasT === hasP) throw fail("BAD_INPUT", "steamSat: give exactly one of { T_K } or { P_kPa }.");
  const T = hasT ? spec.T_K : tsatMPa(spec.P_kPa / 1000);
  if (hasT) psatMPa(T); // range check with a clear message
  const sat = hasT ? saturationT(T) : saturationT(T, spec.P_kPa / 1000);
  const liquid = present(sat.liquid), vapour = present(sat.vapour);
  return {
    T_K: T, P_kPa: sat.p * 1000, liquid, vapour,
    hfg_kJ_kg: T >= TC ? 0 : vapour.h_kJ_kg - liquid.h_kJ_kg,
    sfg_kJ_kgK: T >= TC ? 0 : vapour.s_kJ_kgK - liquid.s_kJ_kgK,
    standard: STANDARD,
  };
}
