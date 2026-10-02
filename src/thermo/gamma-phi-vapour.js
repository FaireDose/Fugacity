/**
 * A non-ideal vapour for activity-coefficient (gamma-phi) systems: NRTL, UNIQUAC or ideal
 * liquid with a Peng-Robinson or SRK vapour (proposal 0001, step 2).
 *
 * Phase equilibrium, for every component i:
 *
 *   y_i phi_i^V(T, P, y) P = x_i gamma_i(T, x) P_i^sat(T) phi_i^sat(T) exp[v_i^L (P - P_i^sat) / (R T)]
 *
 * with
 *   phi_i^V    the fugacity coefficient of i in the vapour mixture, from the cubic equation
 *              of state with its k_ij (src/thermo/eos/cubic.js);
 *   phi_i^sat  the fugacity coefficient of pure i as saturated vapour at T and P_i^sat (the
 *              vapour pressure of the databank), from the same equation of state;
 *   v_i^L      the molar volume of pure liquid i at T (liquid-density record of pure(); the
 *              Poynting factor). Outside the record's temperature range the nearest end of
 *              the range is used: the Poynting factor is a small correction and the liquid
 *              volume changes slowly.
 * With an ideal-gas vapour all three corrections are 1 and the equation is the modified
 * Raoult's law of src/thermo/system.js.
 *
 * Open references: the gamma-phi formulation with the Poynting and saturation fugacity
 * corrections as documented for the `thermo` library (MIT), thermo.phases.GibbsExcessLiquid,
 * equilibrium_basis "Poynting&PhiSat" (https://thermo.readthedocs.io/thermo.phases.html);
 * the cubic equations as cited in eos/cubic.js. Note: thermo evaluates phi_i^sat at the
 * equation of state's own saturation pressure; here it is evaluated at the databank vapour
 * pressure P_i^sat, the pressure that appears in the same term. The two differ slightly;
 * validation/python/reference_gamma_phi.py reports by how much.
 *
 * Units: T in K, P in kPa, molar volume in m3/mol.
 */
import { cubicEos } from "./eos/cubic.js";
import { kijMatrix } from "./eos/system.js";
import { pure } from "./pure.js";
import { selection } from "./library.js";
import { fail, failRange } from "../util/errors.js";

const R = 8.314462618; // J/(mol K)

/**
 * @param {string[]} ids    component ids
 * @param {object[]} comps  their components.json records
 * @param {"PR"|"SRK"} model
 * @param {object} cfg      the system's setup: cfg.kij (optional matrix) and cfg.prefer apply
 *                          to the vapour's k_ij; cfg.sets names the activity-model sets only
 */
export function createCubicVapour(ids, comps, model, cfg) {
  const { K, pairs, missing } = kijMatrix(ids, model, cfg.kij, selection({ prefer: cfg.prefer }));
  const eos = cubicEos(model, comps.map(c => ({ name: c.name, Tc_K: c.Tc_K, Pc_Pa: c.Pc_Pa, omega: c.omega })), K);
  const n = ids.length;
  const pures = ids.map(id => pure(id));
  const unit = i => { const e = new Array(n).fill(0); e[i] = 1; return e; };

  /** Molar volume of pure liquid i at T, m3/mol (clamped to the record's range). */
  function vLiquid(i, T) {
    const p = pures[i], rec = p.record("liquidDensity");
    if (!rec) throw fail("MISSING_DATA", `${comps[i].name}: no liquid density in the databank, so the Poynting correction of a ${model} vapour cannot be calculated.`);
    const Tc = Math.min(Math.max(T, rec.Tmin_K), rec.Tmax_K);
    return comps[i].MW / 1000 / p.property("liquidDensity", Tc);
  }

  let cacheT = NaN, cache = null;
  /** ln phi_i^sat at T for the given vapour pressures (kPa), and v_i^L; cached for the last T. */
  function pureTerms(T, psat) {
    if (T === cacheT && cache.psat.every((p, i) => p === psat[i])) return cache;
    const lnPhiSat = psat.map((ps, i) => {
      const st = eos.state(T, ps, unit(i), "vapour");
      if (st.rootType === "liquid-like") {
        throw failRange("OUT_OF_RANGE", `${comps[i].name}: the ${model} equation has no vapour root at ${T.toFixed(2)} K and the vapour pressure ${ps.toPrecision(5)} kPa, so phi_sat cannot be calculated (too close to the critical point).`);
      }
      return st.lnPhi[i];
    });
    cacheT = T;
    cache = { psat: psat.slice(), lnPhiSat, vL: ids.map((_, i) => vLiquid(i, T)) };
    return cache;
  }

  /** ln phi_i of the vapour mixture y at T, P. */
  function lnPhiVapour(T, P, y) {
    const st = eos.state(T, P, y, "vapour");
    if (st.rootType === "liquid-like") {
      throw failRange("OUT_OF_RANGE", `The ${model} vapour has no vapour root at ${T.toFixed(2)} K and ${P.toPrecision(5)} kPa (near or above the critical region of the mixture). Use model "${model}" for both phases there.`);
    }
    return st.lnPhi;
  }

  /**
   * Bubble pressure and vapour of liquid x at T, given gamma and the vapour pressures.
   * Successive substitution on P and y, starting from the modified Raoult's law.
   * @returns {{P:number, y:number[], phi:number[], phiSat:number[], poynting:number[]}}
   */
  function equilibrium(x, T, gamma, psat) {
    const { lnPhiSat, vL } = pureTerms(T, psat);
    const base = x.map((xi, i) => xi * gamma[i] * psat[i] * Math.exp(lnPhiSat[i]));
    let P = base.reduce((a, b) => a + b, 0);
    let y = base.map(v => v / P);
    for (let it = 0; it < 200; it++) {
      const lnPhi = lnPhiVapour(T, P, y);
      const part = base.map((b, i) => b * Math.exp(vL[i] * (P - psat[i]) * 1000 / (R * T) - lnPhi[i]));
      const Pn = part.reduce((a, b) => a + b, 0);
      const yn = part.map(v => v / Pn);
      const dy = yn.reduce((m, v, i) => Math.max(m, Math.abs(v - y[i])), 0);
      const dP = Math.abs(Pn / P - 1);
      P = Pn; y = yn;
      if (dP < 1e-13 && dy < 1e-13) {
        return {
          P, y, phi: lnPhiVapour(T, P, y).map(Math.exp), phiSat: lnPhiSat.map(Math.exp),
          poynting: vL.map((v, i) => Math.exp(v * (P - psat[i]) * 1000 / (R * T))),
        };
      }
    }
    throw fail("NO_CONVERGENCE", `Bubble pressure with a ${model} vapour at ${T.toFixed(2)} K did not converge in 200 steps (last ${P.toPrecision(6)} kPa).`, { x, T, P, y });
  }

  const describe = `${eos.name} vapour (fugacity coefficients with k_ij${missing.length ? `; k_ij = 0 for ${missing.map(m => m.join(" + ")).join(", ")}` : ""}), with phi_sat and the Poynting correction in the liquid`;
  return { model, eos, kij: K, pairs, missing, equilibrium, describe };
}
