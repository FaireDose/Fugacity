/**
 * Mixture enthalpy and the state of one phase (proposal 0001, step 3): system.phase(),
 * system.enthalpy() and, for activity models, system.excessEnthalpy().
 *
 * Reference state for every component: the ideal gas at 298.15 K, h = 0 (as pure() uses).
 *
 * Activity-coefficient systems (NRTL, UNIQUAC, ideal liquid):
 *   vapour  h_V = sum y_i h_IG,i(T) + h_R(T, P, y)
 *           with h_R = 0 for the ideal-gas vapour, or the residual enthalpy of the PR / SRK
 *           vapour (eos/cubic.js) when the system has vapour "PR" or "SRK";
 *   liquid  h_L = sum x_i [h_IG,i(T) + h_R,i^sat(T) - dHvap_i(T)] + h^E(T, x)
 *           with h_R,i^sat the residual enthalpy of saturated pure vapour i at P_i^sat from the
 *           same vapour model (0 for the ideal gas), dHvap_i from pure(), and the excess
 *           enthalpy from the activity model (Gibbs-Helmholtz)
 *               h^E = -R T^2 sum_i x_i (d ln gamma_i / dT)_x,
 *           the derivative by central differences (+- 0.01 K). A pure component then boils
 *           with exactly its heat of vaporization, whichever vapour model is chosen. The
 *           pressure effect on the liquid is neglected: about v_L (P - P_sat), 18 J/mol for
 *           water 10 bar above its vapour pressure (test/enthalpy.test.js).
 * Equation-of-state systems (PR, SRK): h = sum z_i h_IG,i(T) + h_R(T, P, z) for either phase.
 *
 * Fugacities (kPa), for the flash: liquid f_i = x_i gamma_i P_i^sat phi_i^sat exp[v_i^L (P - P_i^sat)/RT]
 * (gamma-phi-vapour.js; phi^sat = 1 and no Poynting term for the ideal gas), vapour
 * f_i = y_i phi_i P; equations of state f_i = z_i phi_i P.
 *
 * Not available: systems with a dimerizing acid (acetic acid), whose vapour enthalpy needs the
 * association enthalpy (as pure() says). excessEnthalpy() works for them: it is a liquid
 * property.
 *
 * Open references: the Gibbs-Helmholtz relation for the excess enthalpy and the gamma-phi
 * liquid enthalpy as documented for the `thermo` library (MIT): thermo.activity.GibbsExcess.HE
 * and thermo.phases.GibbsExcessLiquid (https://thermo.readthedocs.io); residual enthalpies of
 * the cubic equations as cited in eos/cubic.js.
 */
import { pure } from "./pure.js";
import { fail, failRange } from "../util/errors.js";
import { checkComposition, checkPressure, checkTemperature } from "../util/inputs.js";

const R = 8.314462618;      // J/(mol K)
const DT = 0.01;            // K, step of the temperature derivative of ln gamma

function checkPhase(phase) {
  const p = String(phase).toLowerCase();
  if (p === "liquid" || p === "vapour" || p === "vapor") return p === "vapor" ? "vapour" : p;
  throw fail("BAD_INPUT", `Phase must be "liquid" or "vapour" (got ${JSON.stringify(phase)}).`);
}

/** Call fn(); if it throws a Fugacity error, add the component and the quantity to the message. */
function named(name, what, fn) {
  try { return fn(); } catch (e) {
    if (!e || !e.code) throw e;
    const make = e instanceof RangeError ? failRange : fail;
    throw make(e.code, `${name}, ${what}: ${e.message}`, e.details);
  }
}

/**
 * Methods for an activity-coefficient system.
 * @param {object} ctx  { ids, comps, n, model, gammas, psat, cubicVapour, assoc, warnings }
 */
export function activityPhaseMethods(ctx) {
  const { ids, comps, n, gammas, psat, cubicVapour, assoc, warnings } = ctx;
  const pures = ids.map(id => pure(id));
  const hIG = (i, T) => named(comps[i].name, "ideal-gas enthalpy", () => pures[i].hIdealGas(T));
  const dHvap = (i, T) => named(comps[i].name, "heat of vaporization", () => pures[i].property("heatOfVaporization", T));

  /** h^E (J/mol) of liquid x at T, without input checks. */
  function hE(x, T) {
    const a = gammas(x, T + DT), b = gammas(x, T - DT);
    let s = 0;
    for (let i = 0; i < n; i++) if (x[i] > 0) s += x[i] * (Math.log(a[i]) - Math.log(b[i])) / (2 * DT);
    return -R * T * T * s;
  }

  function noAssociation(z) {
    const k = assoc.findIndex((a, i) => a && z[i] > 0);
    if (k >= 0) {
      throw fail("NOT_AVAILABLE", `${comps[k].name} dimerizes in the vapour: enthalpies of systems with it are not available yet (the association enthalpy is not modelled). Its excess enthalpy is: use excessEnthalpy().`);
    }
  }

  /**
   * One phase at T (K), P (kPa) and composition z.
   * @returns {{phase:string, T:number, P:number, composition:number[], h_J_mol:number,
   *   lnFugacity:number[], gamma?:number[], hE_J_mol?:number, phi?:number[], Z?:number, warnings:string[]}}
   */
  function phase(ph, T, P, z) {
    ph = checkPhase(ph);
    T = checkTemperature(T); P = checkPressure(P);
    z = checkComposition(z, n, ph === "liquid" ? "Liquid composition" : "Vapour composition");
    noAssociation(z);
    const out = { phase: ph, T, P, composition: z };
    if (ph === "vapour") {
      let h = 0;
      for (let i = 0; i < n; i++) if (z[i] > 0) h += z[i] * hIG(i, T);
      let lnPhi = new Array(n).fill(0), Z = 1;
      if (cubicVapour) {
        const st = cubicVapour.vapourState(T, P, z);
        h += st.hR_J_mol; lnPhi = st.lnPhi; Z = st.Z;
      }
      Object.assign(out, { h_J_mol: h, phi: lnPhi.map(Math.exp), Z, lnFugacity: z.map((y, i) => Math.log(y * P) + lnPhi[i]) });
    } else {
      const ps = psat(T), g = gammas(z, T);
      const t = cubicVapour ? cubicVapour.pureTerms(T, ps) : null;
      let h = 0;
      const lnf = new Array(n);
      for (let i = 0; i < n; i++) {
        let lnPhiSat = 0, poy = 0, hRs = 0;
        if (t) {
          if (Number.isNaN(t.lnPhiSat[i]) && z[i] > 0) {
            throw failRange("OUT_OF_RANGE", `${comps[i].name} is above its critical temperature (${comps[i].Tc_K} K) at ${T.toFixed(2)} K: it has no saturated vapour, so its liquid enthalpy and fugacity cannot be calculated with an activity model.`);
          }
          if (z[i] > 0) { lnPhiSat = t.lnPhiSat[i]; hRs = t.hRsat[i]; poy = t.vL[i] * (P - ps[i]) * 1000 / (R * T); }
        }
        if (z[i] > 0) h += z[i] * (hIG(i, T) + hRs - dHvap(i, T));
        lnf[i] = Math.log(z[i] * g[i] * ps[i]) + lnPhiSat + poy;
      }
      const e = hE(z, T);
      Object.assign(out, { h_J_mol: h + e, hE_J_mol: e, gamma: g, lnFugacity: lnf });
    }
    out.warnings = warnings ? warnings(T, P) : [];
    return out;
  }

  return {
    phase,
    /** Molar enthalpy (J/mol) of one phase; reference: ideal gas at 298.15 K. */
    enthalpy: (ph, T, P, z) => phase(ph, T, P, z).h_J_mol,
    /** Excess enthalpy h^E (J/mol) of liquid x at T, from the activity model. */
    excessEnthalpy(x, T) {
      return hE(checkComposition(x, n, "Liquid composition"), checkTemperature(T));
    },
  };
}

/**
 * Methods for an equation-of-state system.
 * @param {object} ctx  { ids, comps, n, model, eos, warnings }
 */
export function eosPhaseMethods(ctx) {
  const { ids, comps, n, eos, warnings } = ctx;
  const pures = ids.map(id => pure(id));
  function phase(ph, T, P, z) {
    ph = checkPhase(ph);
    T = checkTemperature(T); P = checkPressure(P);
    z = checkComposition(z, n, ph === "liquid" ? "Liquid composition" : "Vapour composition");
    const st = eos.state(T, P, z, ph);
    let h = st.hR_J_mol;
    for (let i = 0; i < n; i++) if (z[i] > 0) h += z[i] * named(comps[i].name, "ideal-gas enthalpy", () => pures[i].hIdealGas(T));
    return {
      phase: ph, T, P, composition: z, h_J_mol: h, Z: st.Z, rootType: st.rootType,
      phi: st.lnPhi.map(Math.exp), lnFugacity: z.map((v, i) => Math.log(v * P) + st.lnPhi[i]),
      warnings: warnings ? warnings(T, P) : [],
    };
  }
  return { phase, enthalpy: (ph, T, P, z) => phase(ph, T, P, z).h_J_mol };
}
