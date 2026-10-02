/**
 * Viscosity and thermal conductivity of water and steam, IAPWS industrial forms.
 *
 * Sources (free from IAPWS):
 *   Viscosity: IAPWS R12-08, "Release on the IAPWS Formulation 2008 for the Viscosity of
 *   Ordinary Water Substance" (2008).
 *   https://iapws.org/technical-guidance/release/viscosity  (PDF: .../viscosity.download)
 *   Thermal conductivity: IAPWS R15-11, "Release on the IAPWS Formulation 2011 for the
 *   Thermal Conductivity of Ordinary Water Substance" (2011, revised 2018).
 *   https://iapws.org/technical-guidance/release/ThCond  (PDF: .../ThCond.download)
 * The equations were cross-read with two open-source implementations of the same releases:
 * CoolProp's IF97.h (https://github.com/CoolProp/IF97, MIT) and the `iapws` Python package
 * 1.5.5 (functions _Viscosity and _ThCond). The verification tables of both releases,
 * including the tables for industrial use with IAPWS-IF97, are reproduced in
 * test/steam.test.js.
 *
 * Industrial use, as each release recommends:
 *   - Viscosity (R12-08, section on industrial use): the critical enhancement is dropped
 *     (mu2 = 1) and the density comes from IAPWS-IF97. mu2 differs from 1 only in a small
 *     region around the critical point (about 645.91-650.77 K and 245.8-405.3 kg/m3 in the
 *     release), where it reaches about 9 %.
 *   - Thermal conductivity (R15-11, section 3, industrial use): cp, cp/cv and the
 *     compressibility zeta = (d rho/d p)_T come from IAPWS-IF97; zeta at the reference
 *     temperature T_R = 1.5 Tc comes from the release's Eq. 25 (coefficients A_ij, Table 6);
 *     the viscosity in the critical term is the industrial one (mu2 = 1). If IF97 gives a
 *     negative zeta or cp, or one above 1e13, it is set to 1e13 (release safeguard).
 *
 * Range: both formulations are valid from 273.16 K to 1173.15 K at the pressures of
 * IAPWS-IF97 (the releases extend to higher pressures). Outside 273.16-1173.15 K these
 * functions throw: the releases only say they extrapolate "reasonably" there. (IF97 itself
 * starts at 273.15 K; between 273.15 and 273.16 K steam() gives no transport properties.)
 *
 * Units: T in K, rho in kg/m3, (d rho/d p)_T in kg/(m3 MPa), cp and cv in kJ/(kg K);
 * viscosity returned in Pa s, thermal conductivity in W/(m K).
 */
import { failRange } from "../../util/errors.js";

const T_STAR = 647.096, RHO_STAR = 322.0, P_STAR = 22.064; // K, kg/m3, MPa
const MU_STAR = 1e-6;      // Pa s
const LAMBDA_STAR = 1e-3;  // W/(m K)
const R_TC = 0.46151805;   // kJ/(kg K): the gas constant R15-11 uses in cp-bar = cp/R
export const T_MAX_TRANSPORT = 1173.15;
export const T_MIN_TRANSPORT = 273.16; // triple point: lower limit of both releases

/** R12-08 Table 1: H_i, i = 0..3. */
const H0 = [1.67752, 2.20462, 0.6366564, -0.241605];

/** R12-08 Table 2: nonzero H_ij as [i, j, H_ij]. */
const H1 = [
  [0, 0, 5.20094e-1], [1, 0, 8.50895e-2], [2, 0, -1.08374], [3, 0, -2.89555e-1],
  [0, 1, 2.22531e-1], [1, 1, 9.99115e-1], [2, 1, 1.88797], [3, 1, 1.26613], [5, 1, 1.20573e-1],
  [0, 2, -2.81378e-1], [1, 2, -9.06851e-1], [2, 2, -7.72479e-1], [3, 2, -4.89837e-1], [4, 2, -2.57040e-1],
  [0, 3, 1.61913e-1], [1, 3, 2.57399e-1],
  [0, 4, -3.25372e-2], [3, 4, 6.98452e-2],
  [4, 5, 8.72102e-3],
  [3, 6, -4.35673e-3], [5, 6, -5.93264e-4],
];

/** R15-11 Table 1: L_k, k = 0..4. */
const L0 = [2.443221e-3, 1.323095e-2, 6.770357e-3, -3.454586e-3, 4.096266e-4];

/** R15-11 Table 2: L_ij, rows i = 0..4, columns j = 0..5. */
const L1 = [
  [1.60397357, -0.646013523, 0.111443906, 0.102997357, -0.0504123634, 0.00609859258],
  [2.33771842, -2.78843778, 1.53616167, -0.463045512, 0.0832827019, -0.00719201245],
  [2.19650529, -4.54580785, 3.55777244, -1.40944978, 0.275418278, -0.0205938816],
  [-1.21051378, 1.60812989, -0.621178141, 0.0716373224, 0, 0],
  [-2.7203370, 4.57586331, -3.18369245, 1.1168348, -0.19268305, 0.012913842],
];

/** R15-11 Table 3: critical-region constants. */
const CRIT = { Lambda: 177.8514, qD_inv_nm: 0.40, nu: 0.630, gamma: 1.239, xi0_nm: 0.13, Gamma0: 0.06, TR: 1.5 };

/** R15-11 Table 6: A_ij for zeta(T_R, rho) (Eq. 25); A[i][j], i = 0..5, j = 0..4. */
const A = [
  [6.53786807199516, 6.52717759281799, 5.35500529896124, 1.55225959906681, 1.11999926419994],
  [-5.61149954923348, -6.30816983387575, -3.96415689925446, 0.464621290821181, 0.595748562571649],
  [3.39624167361325, 8.08379285492595, 8.91990208918795, 8.93237374861479, 9.88952565078920],
  [-2.27492629730878, -9.82240510197603, -12.0338729505790, -11.0321960061126, -10.3255051147040],
  [10.2631854662709, 12.1358413791395, 9.19494865194302, 6.16780999933360, 4.66861294457414],
  [1.97815050331519, -5.54349664571295, -2.16866274479712, -0.965458722086812, -0.503243546373828],
];
/** R15-11 Eq. 26: upper reduced-density limits of the columns j = 0..3 of Table 6. */
const A_LIMITS = [0.310559006, 0.776397516, 1.242236025, 1.863354037];

function checkT(T, what) {
  if (!(T >= T_MIN_TRANSPORT && T <= T_MAX_TRANSPORT)) {
    throw failRange("OUT_OF_RANGE", `${what} (IAPWS) is valid from 273.16 K to 1173.15 K; T = ${T} K.`);
  }
}

/**
 * Viscosity, Pa s: IAPWS R12-08 without the critical enhancement (mu2 = 1), the form the
 * release recommends for industrial use.
 * @param {number} T  K
 * @param {number} rho  kg/m3 (from IAPWS-IF97 for industrial use)
 */
export function viscosity(T, rho) {
  checkT(T, "Viscosity");
  const t = T / T_STAR, d = rho / RHO_STAR;
  let s0 = 0;
  for (let i = 0; i < 4; i++) s0 += H0[i] / Math.pow(t, i);
  const mu0 = 100 * Math.sqrt(t) / s0;                                   // Eq. 11
  let s1 = 0;
  for (const [i, j, h] of H1) s1 += h * Math.pow(1 / t - 1, i) * Math.pow(d - 1, j);
  const mu1 = Math.exp(d * s1);                                          // Eq. 12
  return MU_STAR * mu0 * mu1;
}

/**
 * Thermal conductivity in the industrial form of IAPWS R15-11 (section 3), with all parts.
 * @param {number} T  K
 * @param {number} rho  kg/m3
 * @param {{cp:number, cv:number, drhodp:number}} th  IF97 values at (T, rho):
 *   cp, cv in kJ/(kg K), drhodp = (d rho/d p)_T in kg/(m3 MPa). Pass null to leave out the
 *   critical enhancement (lambda2 = 0), as in Table 4 of the release.
 * @returns {{k_W_mK:number, lambda0:number, lambda1:number, lambda2_mW_mK:number,
 *   zeta:number, zetaR:number, xi_nm:number, Z:number, mu_Pa_s:number}}
 */
export function thermalConductivityParts(T, rho, th) {
  checkT(T, "Thermal conductivity");
  const t = T / T_STAR, d = rho / RHO_STAR;
  let s0 = 0;
  for (let k = 0; k < 5; k++) s0 += L0[k] / Math.pow(t, k);
  const lambda0 = Math.sqrt(t) / s0;                                     // Eq. 16
  let s1 = 0;
  for (let i = 0; i < 5; i++) {
    const ti = Math.pow(1 / t - 1, i);
    for (let j = 0; j < 6; j++) s1 += L1[i][j] * ti * Math.pow(d - 1, j);
  }
  const lambda1 = Math.exp(d * s1);                                      // Eq. 17

  if (th === null) {
    return { k_W_mK: LAMBDA_STAR * lambda0 * lambda1, lambda0, lambda1, lambda2_mW_mK: 0 };
  }
  // Critical enhancement (Eqs. 18-25), industrial form.
  const mu = viscosity(T, rho);
  let cp = th.cp;
  if (!(cp >= 0) || cp > 1e13) cp = 1e13;
  const kappa = cp / th.cv;
  let zeta = P_STAR / RHO_STAR * th.drhodp;                              // Eq. 24, IF97
  if (!(zeta >= 0) || zeta > 1e13) zeta = 1e13;
  let col = A_LIMITS.findIndex(lim => d <= lim);
  if (col < 0) col = 4;
  let sA = 0;
  for (let i = 0; i < 6; i++) sA += A[i][col] * Math.pow(d, i);
  const zetaR = 1 / sA;                                                  // Eq. 25
  let dchi = d * (zeta - zetaR * CRIT.TR / t);                           // Eq. 23
  if (dchi < 0) dchi = 0;
  const xi = CRIT.xi0_nm * Math.pow(dchi / CRIT.Gamma0, CRIT.nu / CRIT.gamma); // Eq. 22, nm
  const y = xi / CRIT.qD_inv_nm;                                         // Eq. 20
  let Z = 0;
  if (y >= 1.2e-7) {                                                     // Eq. 19 / 21
    Z = 2 / (Math.PI * y) * (((1 - 1 / kappa) * Math.atan(y) + y / kappa) -
      (1 - Math.exp(-1 / (1 / y + y * y / (3 * d * d)))));
  }
  const lambda2 = CRIT.Lambda * d * (cp / R_TC) * t / (mu / MU_STAR) * Z;   // Eq. 18
  return {
    k_W_mK: LAMBDA_STAR * (lambda0 * lambda1 + lambda2),                 // Eq. 15
    lambda0, lambda1, lambda2_mW_mK: lambda2,
    zeta, zetaR, xi_nm: xi, Z, mu_Pa_s: mu,
    drhodp_TR: zetaR * RHO_STAR / P_STAR,
  };
}

/** Thermal conductivity, W/(m K); see thermalConductivityParts. */
export const thermalConductivity = (T, rho, th) => thermalConductivityParts(T, rho, th).k_W_mK;
