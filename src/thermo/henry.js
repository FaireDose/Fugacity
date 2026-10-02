/**
 * Henry's law for gases dissolved in water (infinite dilution), mole-fraction based:
 *   p_i = H_i x_i   (strictly f_i = H_i x_i; at low pressure the fugacity of the gas equals
 *                    its partial pressure), H in kPa.
 *
 * Equations:
 *  - IAPWS G7-04 (2004), "Guideline on the Henry's constant and vapor-liquid distribution
 *    constant for gases in H2O and D2O at high temperatures", http://www.iapws.org
 *    (free to download; IAPWS allows publication with attribution), eq. 3 and 4;
 *    Fernandez-Prini, Alvarez and Harvey, J. Phys. Chem. Ref. Data 32 (2003) 903:
 *      ln(H / p1*) = A / Tr + B tau^0.355 / Tr + C Tr^-0.41 exp(tau),
 *      Tr = T / Tc1, tau = 1 - Tr, Tc1 = 647.096 K,
 *      ln(p1* / pc1) = (Tc1 / T) sum_i a_i tau^b_i, pc1 = 22.064 MPa  (water vapour pressure)
 *    used for hydrogen, nitrogen, oxygen, methane and ethane (form checked against the
 *    guideline's table 6 check values in test/henry.test.js).
 *  - Ethylene (not in IAPWS G7-04): R. Sander, Compilation of Henry's law constants
 *    (version 5.0.0), Atmos. Chem. Phys. 23 (2023) 10901, CC BY 4.0, three-parameter fit
 *      Hcp = exp(A + B / T + C ln T)   [mol/(m3 Pa)]
 *    converted with the compilation's own relation Hxp = Hcp M_w / rho_w (rho_w = 997 kg/m3),
 *    so H = 1 / Hxp = rho_w / (M_w Hcp)   [Pa].
 *
 * Outside an entry's temperature range the functions throw.
 */
import henryData from "../data/henry.json" with { type: "json" };
import componentData from "../data/components.json" with { type: "json" };
import { findComponent } from "./system.js";

const W = henryData.solvents.water.vapourPressure;
const RHO_W = 997;                                          // kg/m3, as in Sander (2023)
const M_W = componentData.components.water.MW / 1000;       // kg/mol

/** Gases with a Henry's law constant in water (component ids). */
export const HENRY_GASES = henryData.pairs.map(p => p.gas);

/** Vapour pressure of water from IAPWS G7-04 eq. 4, kPa. */
export function waterPsatG704(T) {
  const tau = 1 - T / W.Tc_K;
  let s = 0;
  for (let i = 0; i < W.a.length; i++) s += W.a[i] * Math.pow(tau, W.b[i]);
  return W.pc_MPa * 1000 * Math.exp(W.Tc_K / T * s);
}

function entry(gas, solvent) {
  const g = findComponent(gas), s = findComponent(solvent);
  const p = henryData.pairs.find(e => e.gas === g && e.solvent === s);
  if (!p) {
    throw new Error(`No Henry's law constant for ${gas} in ${solvent}. Available in water: ${HENRY_GASES.join(", ")}.`);
  }
  return p;
}

/**
 * Henry's law constant H (kPa), mole-fraction based (p_i = H x_i), of a gas in a solvent.
 * @param {string} gas      e.g. "oxygen", "N2", "methane"
 * @param {string} solvent  "water"
 * @param {number} T_K
 */
export function henry(gas, solvent, T_K) {
  const p = entry(gas, solvent);
  if (!(T_K >= p.Tmin_K && T_K <= p.Tmax_K)) {
    throw new RangeError(`Henry's law constant of ${p.gas} in ${p.solvent}: ${T_K} K is outside the range of its equation (${p.Tmin_K}-${p.Tmax_K} K).`);
  }
  if (p.equation === "IAPWS-G7-04") {
    const Tr = T_K / W.Tc_K, tau = 1 - Tr;
    return waterPsatG704(T_K) * Math.exp(p.A / Tr + p.B * Math.pow(tau, 0.355) / Tr + p.C * Math.pow(Tr, -0.41) * Math.exp(tau));
  }
  if (p.equation === "Sander-3") {
    const Hcp = Math.exp(p.A + p.B / T_K + p.C * Math.log(T_K)); // mol/(m3 Pa)
    return RHO_W / (M_W * Hcp) / 1000;
  }
  throw new Error(`Unknown Henry's law equation "${p.equation}".`);
}

/** Source, tier and validity range of a Henry's law constant. */
export function henryInfo(gas, solvent = "water") {
  const p = entry(gas, solvent);
  return { gas: p.gas, solvent: p.solvent, Tmin_K: p.Tmin_K, Tmax_K: p.Tmax_K, tier: p.tier, source: p.source, validity: p.validity,
    source_ids: (p.source_ids ?? []).slice() };
}

/**
 * Mole fraction of a dissolved gas in water at T (K) under its partial pressure (kPa):
 * x = p / H. Valid for dilute solutions (x << 1) at low to moderate pressure, where the
 * gas fugacity equals its partial pressure and the pressure effect on H is negligible.
 */
export function gasSolubility(gas, T_K, p_gas_kPa, solvent = "water") {
  if (!(p_gas_kPa >= 0)) throw new RangeError(`Partial pressure must be non-negative (got ${p_gas_kPa} kPa).`);
  return p_gas_kPa / henry(gas, solvent, T_K);
}
