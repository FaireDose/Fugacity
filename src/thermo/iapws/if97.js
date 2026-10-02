/**
 * IAPWS-IF97: industrial formulation for the thermodynamic properties of water and steam.
 *
 * Source (equations, coefficients, region limits and verification values):
 *   IAPWS R7-97(2012), "Revised Release on the IAPWS Industrial Formulation 1997 for the
 *   Thermodynamic Properties of Water and Steam", International Association for the
 *   Properties of Water and Steam, August 2007, editorial revision 2012.
 *   Free from IAPWS: https://iapws.org/technical-guidance/release/IF97-Rev
 *   (PDF: https://iapws.org/technical-guidance/release/IF97-Rev.download)
 *   Equation and table numbers below refer to that release.
 *
 * The coefficient tables were compared, entry by entry, with two independent open-source
 * implementations of the same release: CoolProp's IF97.h (https://github.com/CoolProp/IF97,
 * MIT) and the `iapws` Python package 1.5.5 (https://github.com/jjgomera/iapws). They are
 * written here in the release's own format (mantissa 0.xxx and power of ten) so that a
 * reviewer can compare them line by line with the PDF. Every verification table of the
 * release is reproduced in test/steam.test.js.
 *
 * Regions (Section 4 and Figure 1 of the release):
 *   1  compressed liquid    273.15 K <= T <= 623.15 K, psat(T) <= p <= 100 MPa
 *   2  vapour               273.15 K <= T <= 623.15 K, 0 < p <= psat(T)
 *                           623.15 K <  T <= 863.15 K, 0 < p <= pB23(T)
 *                           863.15 K <  T <= 1073.15 K, 0 < p <= 100 MPa
 *   3  near-critical        623.15 K <  T <= TB23(p), pB23(T) < p <= 100 MPa
 *   4  saturation line      273.15 K <= T <= 647.096 K
 *   5  high temperature     1073.15 K < T <= 2273.15 K, 0 < p <= 50 MPa
 * Outside these limits every function throws a RangeError.
 *
 * Region 3 is defined by the Helmholtz energy f(rho, T), so a (T, p) state needs the density.
 * Here it is found by solving p(rho, T) = p on the region-3 basic equation itself (Eq. 28):
 * a scan in density from the liquid side (high density, for compressed-liquid and
 * supercritical states) or from the vapour side (low density, below psat), then Brent's
 * method, then a check that dp/drho > 0 (a mechanically stable root). Reasons for this
 * choice over the backward equations v(p,T) of IAPWS SR5-05(2016):
 *   - the result is exactly consistent with the basic equation (the backward equations
 *     deviate from it by up to their permitted tolerances), so h, s, cp, w at (T, p) agree
 *     with the verification values of Table 33 to the last digit;
 *   - SR5-05 has 26 subregions and about a thousand coefficients: a large transcription
 *     surface for no gain in a browser, where a 1-D root search costs well under a millisecond;
 *   - it fails loudly: if no stable root is bracketed the function throws.
 *
 * Units inside this file follow the release: T in K, p in MPa, specific properties in kJ/kg,
 * kJ/(kg K), density in kg/m3. The exported functions take and return pressure in kPa
 * (the engine's unit); mass-specific properties stay in steam-table units (kJ/kg).
 */
import { fail, failRange } from "../../util/errors.js";

/** Specific gas constant of IF97, kJ/(kg K) (Eq. 1). */
export const R = 0.461526;
/** Critical temperature (K), pressure (MPa) and density (kg/m3), Eqs. 2-4. */
export const TC = 647.096, PC = 22.064, RHOC = 322;
/** Triple point (Eq. 9): 273.16 K, 611.657 Pa. */
export const TT = 273.16, PT = 611.657e-6;

const T_MIN = 273.15, T_13 = 623.15, T_B23_MAX = 863.15, T_25 = 1073.15, T_MAX = 2273.15;
const P_MAX = 100, P_MAX_5 = 50;

// ---------------------------------------------------------------------------------------
// Coefficients
// ---------------------------------------------------------------------------------------

/** Table 1: B23 boundary, n1..n5. */
const N23 = [0.34805185628969e3, -0.11671859879975e1, 0.10192970039326e-2,
  0.57254459862746e3, 0.13918839778870e2];

/** Table 2: region 1, [I, J, n]. */
const R1 = [
  [0, -2, 0.14632971213167], [0, -1, -0.84548187169114], [0, 0, -0.37563603672040e1],
  [0, 1, 0.33855169168385e1], [0, 2, -0.95791963387872], [0, 3, 0.15772038513228],
  [0, 4, -0.16616417199501e-1], [0, 5, 0.81214629983568e-3], [1, -9, 0.28319080123804e-3],
  [1, -7, -0.60706301565874e-3], [1, -1, -0.18990068218419e-1], [1, 0, -0.32529748770505e-1],
  [1, 1, -0.21841717175414e-1], [1, 3, -0.52838357969930e-4], [2, -3, -0.47184321073267e-3],
  [2, 0, -0.30001780793026e-3], [2, 1, 0.47661393906987e-4], [2, 3, -0.44141845330846e-5],
  [2, 17, -0.72694996297594e-15], [3, -4, -0.31679644845054e-4], [3, 0, -0.28270797985312e-5],
  [3, 6, -0.85205128120103e-9], [4, -5, -0.22425281908000e-5], [4, -2, -0.65171222895601e-6],
  [4, 10, -0.14341729937924e-12], [5, -8, -0.40516996860117e-6], [8, -11, -0.12734301741641e-8],
  [8, -6, -0.17424871230634e-9], [21, -29, -0.68762131295531e-18], [23, -31, 0.14478307828521e-19],
  [29, -38, 0.26335781662795e-22], [30, -39, -0.11947622640071e-22], [31, -40, 0.18228094581404e-23],
  [32, -41, -0.93537087292458e-25],
];

/** Table 10: region 2, ideal-gas part, [J°, n°]. */
const R2_0 = [
  [0, -0.96927686500217e1], [1, 0.10086655968018e2], [-5, -0.56087911283020e-2],
  [-4, 0.71452738081455e-1], [-3, -0.40710498223928], [-2, 0.14240819171444e1],
  [-1, -0.43839511319450e1], [2, -0.28408632460772], [3, 0.21268463753307e-1],
];

/** Table 11: region 2, residual part, [I, J, n]. */
const R2_R = [
  [1, 0, -0.17731742473213e-2], [1, 1, -0.17834862292358e-1], [1, 2, -0.45996013696365e-1],
  [1, 3, -0.57581259083432e-1], [1, 6, -0.50325278727930e-1], [2, 1, -0.33032641670203e-4],
  [2, 2, -0.18948987516315e-3], [2, 4, -0.39392777243355e-2], [2, 7, -0.43797295650573e-1],
  [2, 36, -0.26674547914087e-4], [3, 0, 0.20481737692309e-7], [3, 1, 0.43870667284435e-6],
  [3, 3, -0.32277677238570e-4], [3, 6, -0.15033924542148e-2], [3, 35, -0.40668253562649e-1],
  [4, 1, -0.78847309559367e-9], [4, 2, 0.12790717852285e-7], [4, 3, 0.48225372718507e-6],
  [5, 7, 0.22922076337661e-5], [6, 3, -0.16714766451061e-10], [6, 16, -0.21171472321355e-2],
  [6, 35, -0.23895741934104e2], [7, 0, -0.59059564324270e-17], [7, 11, -0.12621808899101e-5],
  [7, 25, -0.38946842435739e-1], [8, 8, 0.11256211360459e-10], [8, 36, -0.82311340897998e1],
  [9, 13, 0.19809712802088e-7], [10, 4, 0.10406965210174e-18], [10, 10, -0.10234747095929e-12],
  [10, 14, -0.10018179379511e-8], [16, 29, -0.80882908646985e-10], [16, 50, 0.10693031879409],
  [18, 57, -0.33662250574171], [20, 20, 0.89185845355421e-24], [20, 35, 0.30629316876232e-12],
  [20, 48, -0.42002467698208e-5], [21, 21, -0.59056029685639e-25], [22, 53, 0.37826947613457e-5],
  [23, 39, -0.12768608934681e-14], [24, 26, 0.73087610595061e-28], [24, 40, 0.55414715350778e-16],
  [24, 58, -0.94369707241210e-6],
];

/** Table 30: region 3, n1 (the ln(delta) term) and [I, J, n] for i = 2..40. */
const R3_N1 = 0.10658070028513e1;
const R3 = [
  [0, 0, -0.15732845290239e2], [0, 1, 0.20944396974307e2],
  [0, 2, -0.76867707878716e1], [0, 7, 0.26185947787954e1], [0, 10, -0.28080781148620e1],
  [0, 12, 0.12053369696517e1], [0, 23, -0.84566812812502e-2], [1, 2, -0.12654315477714e1],
  [1, 6, -0.11524407806681e1], [1, 15, 0.88521043984318], [1, 17, -0.64207765181607],
  [2, 0, 0.38493460186671], [2, 2, -0.85214708824206], [2, 6, 0.48972281541877e1],
  [2, 7, -0.30502617256965e1], [2, 22, 0.39420536879154e-1], [2, 26, 0.12558408424308],
  [3, 0, -0.27999329698710], [3, 2, 0.13899799569460e1], [3, 4, -0.20189915023570e1],
  [3, 16, -0.82147637173963e-2], [3, 26, -0.47596035734923], [4, 0, 0.43984074473500e-1],
  [4, 2, -0.44476435428739], [4, 4, 0.90572070719733], [4, 26, 0.70522450087967],
  [5, 1, 0.10770512626332], [5, 3, -0.32913623258954], [5, 26, -0.50871062041158],
  [6, 0, -0.22175400873096e-1], [6, 2, 0.94260751665092e-1], [6, 26, 0.16436278447961],
  [7, 2, -0.13503372241348e-1], [8, 26, -0.14834345352472e-1], [9, 2, 0.57922953628084e-3],
  [9, 26, 0.32308904703711e-2], [10, 0, 0.80964802996215e-4], [10, 1, -0.16557679795037e-3],
  [11, 26, -0.44923899061815e-4],
];

/** Table 34: region 4 (saturation line), n1..n10. */
const N4 = [0.11670521452767e4, -0.72421316703206e6, -0.17073846940092e2,
  0.12020824702470e5, -0.32325550322333e7, 0.14915108613530e2,
  -0.48232657361591e4, 0.40511340542057e6, -0.23855557567849, 0.65017534844798e3];

/** Table 37: region 5, ideal-gas part, [J°, n°]. */
const R5_0 = [
  [0, -0.13179983674201e2], [1, 0.68540841634434e1], [-3, -0.24805148933466e-1],
  [-2, 0.36901534980333], [-1, -0.31161318213925e1], [2, -0.32961626538917],
];

/** Table 38: region 5, residual part, [I, J, n]. */
const R5_R = [
  [1, 1, 0.15736404855259e-2], [1, 2, 0.90153761673944e-3], [1, 3, -0.50270077677648e-2],
  [2, 3, 0.22440037409485e-5], [2, 9, -0.41163275453471e-5], [3, 7, 0.37919454822955e-7],
];

// ---------------------------------------------------------------------------------------
// Boundaries
// ---------------------------------------------------------------------------------------

/** B23 boundary, Eq. 5: pressure (MPa) at temperature T (K). */
export function pB23(T) {
  return N23[0] + N23[1] * T + N23[2] * T * T;
}

/** B23 boundary, Eq. 6: temperature (K) at pressure p (MPa). */
export function tB23(p) {
  return N23[3] + Math.sqrt((p - N23[4]) / N23[2]);
}

/** Region 4, Eq. 30: saturation pressure (MPa) at T (K), 273.15 K <= T <= 647.096 K. */
export function psatMPa(T) {
  if (!(T >= T_MIN && T <= TC)) {
    throw failRange("OUT_OF_RANGE", `IAPWS-IF97 saturation pressure: T = ${T} K is outside 273.15-647.096 K.`);
  }
  const th = T + N4[8] / (T - N4[9]);
  const A = th * th + N4[0] * th + N4[1];
  const B = N4[2] * th * th + N4[3] * th + N4[4];
  const C = N4[5] * th * th + N4[6] * th + N4[7];
  return Math.pow(2 * C / (-B + Math.sqrt(B * B - 4 * A * C)), 4);
}

const P_SAT_MIN = psatMPa(T_MIN); // 611.213 Pa

/** Region 4, Eq. 31: saturation temperature (K) at p (MPa), psat(273.15 K) <= p <= 22.064 MPa. */
export function tsatMPa(p) {
  if (!(p >= P_SAT_MIN && p <= PC)) {
    throw failRange("OUT_OF_RANGE", `IAPWS-IF97 saturation temperature: p = ${p * 1000} kPa is outside ` +
      `${(P_SAT_MIN * 1000).toPrecision(6)}-22064 kPa.`);
  }
  const b = Math.pow(p, 0.25);
  const E = b * b + N4[2] * b + N4[5];
  const F = N4[0] * b * b + N4[3] * b + N4[6];
  const G = N4[1] * b * b + N4[4] * b + N4[7];
  const D = 2 * G / (-F - Math.sqrt(F * F - 4 * E * G));
  return (N4[9] + D - Math.sqrt((N4[9] + D) ** 2 - 4 * (N4[8] + N4[9] * D))) / 2;
}

/** Throws unless (T, p MPa) is inside the range of validity of IF97. */
function checkRange(T, p) {
  if (!Number.isFinite(T) || !Number.isFinite(p)) throw failRange("BAD_INPUT", "IAPWS-IF97: T and P must be numbers.");
  if (T < T_MIN || T > T_MAX) {
    throw failRange("OUT_OF_RANGE", `IAPWS-IF97 is valid from 273.15 K to 2273.15 K; T = ${T} K.`);
  }
  if (!(p > 0)) throw failRange("BAD_INPUT", `IAPWS-IF97 needs a positive pressure; P = ${p * 1000} kPa.`);
  if (T <= T_25 && p > P_MAX) {
    throw failRange("OUT_OF_RANGE", `IAPWS-IF97 is valid up to 100 MPa below 1073.15 K; P = ${p * 1000} kPa.`);
  }
  if (T > T_25 && p > P_MAX_5) {
    throw failRange("OUT_OF_RANGE", `IAPWS-IF97 is valid up to 50 MPa above 1073.15 K (region 5); P = ${p * 1000} kPa.`);
  }
}

/**
 * Region number (1, 2, 3 or 5) of the single-phase state (T K, p MPa).
 * On the saturation line (p = psat(T), T <= 623.15 K) the liquid (region 1) is returned.
 */
export function regionTP(T, p) {
  checkRange(T, p);
  if (T > T_25) return 5;
  if (T <= T_13) return p >= psatMPa(T) ? 1 : 2;
  if (T > T_B23_MAX) return 2;
  return p > pB23(T) ? 3 : 2;
}

// ---------------------------------------------------------------------------------------
// Gibbs-energy regions 1, 2, 5 (dimensionless gamma and its derivatives)
// ---------------------------------------------------------------------------------------

function gamma1(pi, tau) {
  const a = 7.1 - pi, b = tau - 1.222;
  let g = 0, gp = 0, gpp = 0, gt = 0, gtt = 0, gpt = 0;
  for (const [I, J, n] of R1) {
    const aI = Math.pow(a, I), bJ = Math.pow(b, J);
    const aI1 = I === 0 ? 0 : I * Math.pow(a, I - 1);
    const aI2 = I < 2 ? 0 : I * (I - 1) * Math.pow(a, I - 2);
    const bJ1 = J === 0 ? 0 : J * Math.pow(b, J - 1);
    const bJ2 = J === 0 || J === 1 ? 0 : J * (J - 1) * Math.pow(b, J - 2);
    g += n * aI * bJ;
    gp -= n * aI1 * bJ;
    gpp += n * aI2 * bJ;
    gt += n * aI * bJ1;
    gtt += n * aI * bJ2;
    gpt -= n * aI1 * bJ1;
  }
  return { g, gp, gpp, gt, gtt, gpt };
}

/** Ideal-gas part gamma° = ln(pi) + sum n° tau^J° (regions 2 and 5). */
function gammaIdeal(table, pi, tau) {
  let g = Math.log(pi), gt = 0, gtt = 0;
  for (const [J, n] of table) {
    g += n * Math.pow(tau, J);
    if (J !== 0) gt += n * J * Math.pow(tau, J - 1);
    if (J !== 0 && J !== 1) gtt += n * J * (J - 1) * Math.pow(tau, J - 2);
  }
  return { g, gp: 1 / pi, gpp: -1 / (pi * pi), gt, gtt, gpt: 0 };
}

/** Residual part gamma^r = sum n pi^I (tau - shift)^J (region 2: shift 0.5; region 5: shift 0). */
function gammaResidual(table, pi, t) {
  let g = 0, gp = 0, gpp = 0, gt = 0, gtt = 0, gpt = 0;
  for (const [I, J, n] of table) {
    const pI = Math.pow(pi, I), tJ = Math.pow(t, J);
    const pI1 = I * Math.pow(pi, I - 1), pI2 = I < 2 ? 0 : I * (I - 1) * Math.pow(pi, I - 2);
    const tJ1 = J === 0 ? 0 : J * Math.pow(t, J - 1);
    const tJ2 = J === 0 || J === 1 ? 0 : J * (J - 1) * Math.pow(t, J - 2);
    g += n * pI * tJ;
    gp += n * pI1 * tJ;
    gpp += n * pI2 * tJ;
    gt += n * pI * tJ1;
    gtt += n * pI * tJ2;
    gpt += n * pI1 * tJ1;
  }
  return { g, gp, gpp, gt, gtt, gpt };
}

const add = (a, b) => ({
  g: a.g + b.g, gp: a.gp + b.gp, gpp: a.gpp + b.gpp, gt: a.gt + b.gt, gtt: a.gtt + b.gtt, gpt: a.gpt + b.gpt,
});

/** Properties from the dimensionless Gibbs energy (Tables 3, 12, 39 of the release). */
function fromGibbs(region, T, p, pStar, tau, d) {
  const pi = p / pStar;
  const RT = R * T;
  const v = RT * pi * d.gp / p * 1e-3;                                  // m3/kg
  const cp = -R * tau * tau * d.gtt;
  const x = d.gp - tau * d.gpt;
  const cv = R * (-tau * tau * d.gtt + x * x / d.gpp);
  const w2 = 1000 * RT * d.gp * d.gp / (x * x / (tau * tau * d.gtt) - d.gpp);
  const dvdp = 1e-3 * RT * d.gpp / (pStar * pStar);                     // m3/(kg MPa)
  return {
    region, T, p, rho: 1 / v, v,
    u: RT * (tau * d.gt - pi * d.gp),
    h: RT * tau * d.gt,
    s: R * (tau * d.gt - d.g),
    cp, cv, w: Math.sqrt(w2),
    drhodp: -dvdp / (v * v),                                             // kg/(m3 MPa)
  };
}

function region1(T, p) {
  const tau = 1386 / T;
  return fromGibbs(1, T, p, 16.53, tau, gamma1(p / 16.53, tau));
}

function region2(T, p) {
  const tau = 540 / T;
  return fromGibbs(2, T, p, 1, tau, add(gammaIdeal(R2_0, p, tau), gammaResidual(R2_R, p, tau - 0.5)));
}

function region5(T, p) {
  const tau = 1000 / T;
  return fromGibbs(5, T, p, 1, tau, add(gammaIdeal(R5_0, p, tau), gammaResidual(R5_R, p, tau)));
}

/**
 * Ideal-gas specific enthalpy of IF97 (region-2 ideal-gas part, h° = R T tau dgamma°/dtau), kJ/kg.
 * Same reference state as the rest of IF97 (liquid at the triple point).
 */
export function hIdealGas(T) {
  const tau = 540 / T;
  return R * T * tau * gammaIdeal(R2_0, 1, tau).gt;
}

/** Ideal-gas isobaric heat capacity of IF97 (region-2 ideal-gas part, -R tau^2 d2gamma°/dtau2), kJ/(kg K). */
export function cpIdealGas(T) {
  const tau = 540 / T;
  return -R * tau * tau * gammaIdeal(R2_0, 1, tau).gtt;
}

// ---------------------------------------------------------------------------------------
// Region 3 (Helmholtz energy)
// ---------------------------------------------------------------------------------------

function phi3(delta, tau) {
  let f = R3_N1 * Math.log(delta), fd = R3_N1 / delta, fdd = -R3_N1 / (delta * delta);
  let ft = 0, ftt = 0, fdt = 0;
  for (const [I, J, n] of R3) {
    const dI = Math.pow(delta, I), tJ = Math.pow(tau, J);
    const dI1 = I === 0 ? 0 : I * Math.pow(delta, I - 1);
    const dI2 = I < 2 ? 0 : I * (I - 1) * Math.pow(delta, I - 2);
    const tJ1 = J === 0 ? 0 : J * Math.pow(tau, J - 1);
    const tJ2 = J === 0 || J === 1 ? 0 : J * (J - 1) * Math.pow(tau, J - 2);
    f += n * dI * tJ;
    fd += n * dI1 * tJ;
    fdd += n * dI2 * tJ;
    ft += n * dI * tJ1;
    ftt += n * dI * tJ2;
    fdt += n * dI1 * tJ1;
  }
  return { f, fd, fdd, ft, ftt, fdt };
}

/** Pressure (MPa) from the region-3 equation at density rho (kg/m3) and T (K). */
function p3(rho, T) {
  const delta = rho / RHOC;
  return rho * R * T * delta * phi3(delta, TC / T).fd * 1e-3;
}

/**
 * Region-3 properties at density rho (kg/m3) and temperature T (K), Table 31 of the release.
 * Returns p in MPa and the other properties in kJ/kg, kJ/(kg K), m/s, kg/(m3 MPa).
 */
export function region3(rho, T) {
  const delta = rho / RHOC, tau = TC / T;
  const d = phi3(delta, tau);
  const RT = R * T;
  const x = delta * d.fd - delta * tau * d.fdt;
  const y = 2 * delta * d.fd + delta * delta * d.fdd;
  return {
    region: 3, T, p: rho * RT * delta * d.fd * 1e-3, rho, v: 1 / rho,
    u: RT * tau * d.ft,
    h: RT * (tau * d.ft + delta * d.fd),
    s: R * (tau * d.ft - d.f),
    cv: -R * tau * tau * d.ftt,
    cp: R * (-tau * tau * d.ftt + x * x / y),
    w: Math.sqrt(1000 * RT * (y - x * x / (tau * tau * d.ftt))),
    drhodp: 1 / (1e-3 * RT * y),
  };
}

/**
 * Density (kg/m3) on the region-3 equation at (T K, p MPa).
 * side "liquid": the root of highest density (compressed liquid and supercritical states);
 * side "vapour": the root of lowest density (vapour below psat).
 */
function rho3(T, p, side) {
  const f = rho => p3(rho, T) - p;
  // Start points: every region-3 state lies between 20 and 800 kg/m3 (the densest is about
  // 760 kg/m3 at 623.15 K and 100 MPa). Above about 820 kg/m3 the region-3 polynomial has a
  // spurious pressure maximum, so the liquid-side scan must not start higher than 800 kg/m3.
  const STEP = 1.02, RHO_HI = 800, RHO_LO = 20;
  let a, b, fa, fb;
  if (side === "liquid") {
    a = RHO_HI; fa = f(a);
    if (!(fa > 0)) throw fail("NO_CONVERGENCE", `IAPWS-IF97 region 3: no liquid-side density found at ${T} K, ${p * 1000} kPa.`);
    for (;;) {
      b = a / STEP; fb = f(b);
      if (fb <= 0) break;
      a = b; fa = fb;
      if (b < RHO_LO) throw fail("NO_CONVERGENCE", `IAPWS-IF97 region 3: density search failed at ${T} K, ${p * 1000} kPa.`);
    }
  } else {
    a = RHO_LO; fa = f(a);
    if (!(fa < 0)) throw fail("NO_CONVERGENCE", `IAPWS-IF97 region 3: no vapour-side density found at ${T} K, ${p * 1000} kPa.`);
    for (;;) {
      b = a * STEP; fb = f(b);
      if (fb >= 0) break;
      a = b; fa = fb;
      if (b > RHO_HI) throw fail("NO_CONVERGENCE", `IAPWS-IF97 region 3: density search failed at ${T} K, ${p * 1000} kPa.`);
    }
  }
  // Near the critical point the bracket may hold more than one root: refine it from the
  // same side with 50 sub-steps, so that the first sign change is the wanted root.
  // (f(a) is never zero here: the scan only moves past points where f has the start sign.)
  const n = 50, h = (b - a) / n;
  let x0 = a, f0 = fa, lo = a, hi = b;
  for (let k = 1; k <= n; k++) {
    const x1 = k === n ? b : a + k * h, f1 = k === n ? fb : f(x1);
    if ((f0 > 0) !== (f1 > 0) || f1 === 0) { lo = x0; hi = x1; break; }
    x0 = x1; f0 = f1;
  }
  const rho = brentRoot(f, Math.min(lo, hi), Math.max(lo, hi));
  // Mechanical stability: dp/drho > 0. At the critical point itself dp/drho = 0, so allow
  // a round-off-sized negative value there.
  const delta = rho / RHOC, d = phi3(delta, TC / T);
  const dpdrho = 1e-3 * R * T * (2 * delta * d.fd + delta * delta * d.fdd);  // MPa/(kg/m3)
  if (dpdrho < -1e-9) {
    throw fail("NO_CONVERGENCE", `IAPWS-IF97 region 3: unstable density root (dp/drho < 0) at ${T} K, ${p * 1000} kPa.`);
  }
  return rho;
}

/** Brent's method to full double precision on a bracketed root (local copy: no layer import). */
function brentRoot(f, lo, hi) {
  let a = lo, b = hi, fa = f(a), fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  if ((fa > 0) === (fb > 0)) throw fail("NO_CONVERGENCE", "IAPWS-IF97: root not bracketed.");
  let c = a, fc = fa, d = b - a, e = d;
  for (let i = 0; i < 200; i++) {
    if ((fb > 0) === (fc > 0)) { c = a; fc = fa; d = b - a; e = d; }
    if (Math.abs(fc) < Math.abs(fb)) { a = b; b = c; c = a; fa = fb; fb = fc; fc = fa; }
    const tol = 4 * Number.EPSILON * Math.abs(b);
    const m = 0.5 * (c - b);
    if (Math.abs(m) <= tol || fb === 0) return b;
    if (Math.abs(e) >= tol && Math.abs(fa) > Math.abs(fb)) {
      let p, q, r;
      const s = fb / fa;
      if (a === c) { p = 2 * m * s; q = 1 - s; }
      else { q = fa / fc; r = fb / fc; p = s * (2 * m * q * (q - r) - (b - a) * (r - 1)); q = (q - 1) * (r - 1) * (s - 1); }
      if (p > 0) q = -q; else p = -p;
      if (2 * p < Math.min(3 * m * q - Math.abs(tol * q), Math.abs(e * q))) { e = d; d = p / q; } else { d = m; e = m; }
    } else { d = m; e = m; }
    a = b; fa = fb;
    b += Math.abs(d) > tol ? d : (m > 0 ? tol : -tol);
    fb = f(b);
  }
  throw fail("NO_CONVERGENCE", "IAPWS-IF97 region 3: density iteration did not converge.");
}

// ---------------------------------------------------------------------------------------
// Public functions (pressure in kPa)
// ---------------------------------------------------------------------------------------

/**
 * Phase label of a single-phase state: "supercritical" when T >= Tc and p >= pc,
 * "liquid" when T < Tc and p >= psat(T), otherwise "vapour".
 */
function phaseLabel(T, p) {
  if (T >= TC) return p >= PC ? "supercritical" : "vapour";
  return p >= psatMPa(T) ? "liquid" : "vapour";
}

/**
 * IF97 properties at T (K) and P (kPa), in IF97 units (kJ/kg ...), plus region and phase.
 * @returns {{region:number, phase:string, T:number, p:number, rho:number, v:number, u:number,
 *   h:number, s:number, cp:number, cv:number, w:number, drhodp:number}}
 *   p in MPa, drhodp = (d rho / d p)_T in kg/(m3 MPa).
 */
export function stateTP(T, P_kPa) {
  const p = P_kPa / 1000;
  const region = regionTP(T, p);
  const phase = phaseLabel(T, p);
  let st;
  if (region === 1) st = region1(T, p);
  else if (region === 2) st = region2(T, p);
  else if (region === 5) st = region5(T, p);
  else st = { ...region3(rho3(T, p, phase === "vapour" ? "vapour" : "liquid"), T), p };
  return { ...st, phase };
}

/**
 * Saturated liquid and vapour at T (K) from region 4 (psat) and the single-phase regions
 * (1 and 2 up to 623.15 K, region 3 above). p (MPa) may be given when T came from tsatMPa(p),
 * so that the states are evaluated at exactly that pressure.
 */
export function saturationT(T, p = psatMPa(T)) {
  let liquid, vapour;
  if (T <= T_13) {
    liquid = region1(T, p);
    vapour = region2(T, p);
  } else {
    liquid = { ...region3(rho3(T, p, "liquid"), T), p };
    vapour = { ...region3(rho3(T, p, "vapour"), T), p };
  }
  return { T, p, liquid: { ...liquid, phase: "liquid" }, vapour: { ...vapour, phase: "vapour" } };
}

/** Saturation pressure, kPa (Eq. 30). */
export const psat = T => psatMPa(T) * 1000;
/** Saturation temperature, K (Eq. 31). */
export const tsat = P_kPa => tsatMPa(P_kPa / 1000);

export const LIMITS = { T_MIN, T_13, T_B23_MAX, T_25, T_MAX, P_MAX_MPa: P_MAX, P_MAX_5_MPa: P_MAX_5 };
