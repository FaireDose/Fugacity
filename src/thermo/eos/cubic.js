/**
 * Cubic equations of state: Peng-Robinson (1976) and Soave-Redlich-Kwong (1972).
 *
 * Equations (generic two-parameter cubic, as written in the open-source `thermo` library
 * documentation, classes thermo.eos.PR, thermo.eos.SRK and thermo.eos_mix.PRMIX / SRKMIX,
 * https://thermo.readthedocs.io/thermo.eos.html and .../thermo.eos_mix.html, MIT license):
 *
 *   P = R T / (v - b) - a(T) / ((v + d1 b)(v + d2 b))
 *   PR : d1 = 1 + sqrt(2), d2 = 1 - sqrt(2)          SRK: d1 = 1, d2 = 0
 *   a_i(T) = OmegaA R^2 Tc_i^2 / Pc_i * alpha_i(T),   b_i = OmegaB R Tc_i / Pc_i
 *   alpha_i = [1 + m_i (1 - sqrt(T / Tc_i))]^2
 *   PR : m = 0.37464 + 1.54226 w - 0.26992 w^2   (Peng & Robinson, Ind. Eng. Chem. Fundam.
 *        15 (1976) 59, doi:10.1021/i160057a011)
 *   SRK: m = 0.480 + 1.574 w - 0.176 w^2          (Soave, Chem. Eng. Sci. 27 (1972) 1197,
 *        doi:10.1016/0009-2509(72)80096-4)
 *   OmegaA, OmegaB to full precision from the criticality conditions, with the closed forms
 *   given in the thermo source (thermo/eos.py, PR.c1, PR.c2, SRK.c1, SRK.c2):
 *     PR : X = (-1 + (6 sqrt2 + 8)^(1/3) - (6 sqrt2 - 8)^(1/3)) / 3,
 *          OmegaB = X / (X + 3), OmegaA = 8 (5 X + 1) / (49 - 37 X)   (0.45724, 0.07780)
 *     SRK: OmegaA = 1 / (9 (2^(1/3) - 1)), OmegaB = (2^(1/3) - 1) / 3  (0.42748, 0.08664)
 *
 * Mixing rules (van der Waals one-fluid):
 *   a = sum_i sum_j x_i x_j (1 - k_ij) sqrt(a_i a_j),   b = sum_i x_i b_i
 *
 * With A = a P / (R T)^2 and B = b P / (R T), Z solves
 *   Z^3 + ((d1 + d2 - 1) B - 1) Z^2 + (A + d1 d2 B^2 - (d1 + d2) B (B + 1)) Z
 *       - (A B + d1 d2 B^2 (B + 1)) = 0
 * Fugacity coefficient, residual enthalpy and entropy (relative to the ideal gas at the
 * same T and P), with L = ln((Z + d1 B) / (Z + d2 B)):
 *   ln phi_i = b_i/b (Z - 1) - ln(Z - B) - A / (B (d1 - d2)) (2 sum_j x_j a_ij / a - b_i/b) L
 *   H^R = R T (Z - 1) + (T da/dT - a) / (b (d1 - d2)) L
 *   S^R = R ln(Z - B) + (da/dT) / (b (d1 - d2)) L
 *   Cv^R = T d2a/dT2 / (b (d1 - d2)) L,   Cp^R = Cv^R + T (dP/dT)_v^2 / (-(dP/dv)_T) - R
 * (generic d1/d2 form as in the thermo GCEOS and GCEOSMIX classes; checked against thermo
 * PRMIX/SRKMIX and an independent Python implementation in validation/python/reference_eos.py).
 *
 * Root selection: with three real roots above B, the smallest is the liquid and the largest
 * the vapour. With one real root, it is returned for either phase and labelled
 * "liquid-like" when v < v_c,EOS / b * b (v_c/b = Zc/OmegaB of the equation of state,
 * 3.95 for PR, 3.85 for SRK) and "vapour-like" otherwise.
 *
 * Units: T in K, P in kPa at the interface (Pa inside), v in m3/mol, energies in J/mol.
 */

export const R = 8.314462618; // J/(mol K), CODATA 2018

const SQRT2 = Math.SQRT2;

function prOmegas() {
  const X = (-1 + Math.cbrt(6 * SQRT2 + 8) - Math.cbrt(6 * SQRT2 - 8)) / 3;
  return { OmegaA: 8 * (5 * X + 1) / (49 - 37 * X), OmegaB: X / (X + 3) };
}
function srkOmegas() {
  const c = Math.cbrt(2) - 1;
  return { OmegaA: 1 / (9 * c), OmegaB: c / 3 };
}

/** The two equations of state, with their constants. */
export const CUBICS = {
  PR: {
    name: "Peng-Robinson (1976)",
    d1: 1 + SQRT2, d2: 1 - SQRT2, ...prOmegas(),
    m: w => 0.37464 + 1.54226 * w - 0.26992 * w * w,
    reference: "Peng & Robinson, Ind. Eng. Chem. Fundam. 15 (1976) 59, doi:10.1021/i160057a011",
  },
  SRK: {
    name: "Soave-Redlich-Kwong (1972)",
    d1: 1, d2: 0, ...srkOmegas(),
    m: w => 0.480 + 1.574 * w - 0.176 * w * w,
    reference: "Soave, Chem. Eng. Sci. 27 (1972) 1197, doi:10.1016/0009-2509(72)80096-4",
  },
};
// Critical compressibility of each equation: at Tc, Pc the cubic has a triple root, so
// 3 Zc = -(coefficient of Z^2) = 1 - (d1 + d2 - 1) OmegaB  (PR 0.3074, SRK 1/3).
for (const c of Object.values(CUBICS)) {
  c.Zc = (1 - (c.d1 + c.d2 - 1) * c.OmegaB) / 3;
  c.vcOverB = c.Zc / c.OmegaB;
}

/**
 * Real roots of z^3 + c2 z^2 + c1 z + c0 = 0, ascending, each polished by Newton steps.
 * Trigonometric solution for three real roots, Cardano otherwise.
 */
export function cubicRoots(c2, c1, c0) {
  const q = (3 * c1 - c2 * c2) / 9;
  const r = (9 * c2 * c1 - 27 * c0 - 2 * c2 * c2 * c2) / 54;
  const disc = q * q * q + r * r;
  let roots;
  if (disc < 0) {
    const th = Math.acos(Math.max(-1, Math.min(1, r / Math.sqrt(-q * q * q))));
    const k = 2 * Math.sqrt(-q);
    roots = [0, 1, 2].map(j => k * Math.cos((th + 2 * Math.PI * j) / 3) - c2 / 3);
  } else {
    const s = Math.cbrt(r + Math.sqrt(disc)), t = Math.cbrt(r - Math.sqrt(disc));
    roots = [s + t - c2 / 3];
  }
  const f = z => ((z + c2) * z + c1) * z + c0;
  const df = z => (3 * z + 2 * c2) * z + c1;
  roots = roots.map(z => {
    for (let i = 0; i < 4; i++) {
      const d = df(z);
      if (d === 0) break;
      const dz = f(z) / d;
      z -= dz;
      if (Math.abs(dz) <= 1e-16 * Math.abs(z)) break;
    }
    return z;
  });
  return roots.sort((a, b) => a - b);
}

const normPhase = phase => {
  const p = String(phase || "").toLowerCase();
  if (["liquid", "l", "liq"].includes(p)) return "liquid";
  if (["vapour", "vapor", "v", "gas", "g"].includes(p)) return "vapour";
  throw new Error(`Unknown phase "${phase}": use "liquid" or "vapour".`);
};

/**
 * A cubic equation of state for a set of components.
 *
 * @param {"PR"|"SRK"} model
 * @param {{name:string, Tc_K:number, Pc_Pa:number, omega:number}[]} comps
 * @param {number[][]} [kij]  symmetric binary parameters (default 0)
 */
export function cubicEos(model, comps, kij) {
  const eq = CUBICS[String(model).toUpperCase()];
  if (!eq) throw new Error(`Unknown equation of state "${model}". Use PR or SRK.`);
  const n = comps.length;
  for (const c of comps) {
    for (const k of ["Tc_K", "Pc_Pa", "omega"]) {
      if (!Number.isFinite(c[k])) throw new Error(`${c.name}: ${k} is missing; it is needed by the ${model} equation of state.`);
    }
  }
  const K = kij || Array.from({ length: n }, () => new Array(n).fill(0));
  const { d1, d2, OmegaA, OmegaB } = eq;
  const ac = comps.map(c => OmegaA * R * R * c.Tc_K * c.Tc_K / c.Pc_Pa);
  const bi = comps.map(c => OmegaB * R * c.Tc_K / c.Pc_Pa);
  const mi = comps.map(c => eq.m(c.omega));

  /** sqrt(a_i) and its first and second temperature derivatives. */
  function sqrtA(T) {
    const s = new Array(n), s1 = new Array(n), s2 = new Array(n);
    for (let i = 0; i < n; i++) {
      const Tc = comps[i].Tc_K, r = Math.sqrt(ac[i]), m = mi[i];
      s[i] = r * (1 + m * (1 - Math.sqrt(T / Tc)));
      s1[i] = -r * m / (2 * Math.sqrt(T * Tc));
      s2[i] = r * m / (4 * T * Math.sqrt(T * Tc));
    }
    return { s, s1, s2 };
  }

  /** Mixture parameters at T for composition x: a, da/dT, d2a/dT2, b, and sum_j x_j a_ij. */
  function mix(T, x) {
    const { s, s1, s2 } = sqrtA(T);
    let a = 0, da = 0, d2a = 0, b = 0;
    const sumA = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      b += x[i] * bi[i];
      for (let j = 0; j < n; j++) {
        const f = 1 - K[i][j];
        const aij = f * s[i] * s[j];
        sumA[i] += x[j] * aij;
        a += x[i] * x[j] * aij;
        da += x[i] * x[j] * f * (s1[i] * s[j] + s[i] * s1[j]);
        d2a += x[i] * x[j] * f * (s2[i] * s[j] + 2 * s1[i] * s1[j] + s[i] * s2[j]);
      }
    }
    return { a, da, d2a, b, sumA };
  }

  const check = (T, P, x) => {
    if (!(T > 0)) throw new RangeError(`Temperature must be positive (got ${T} K).`);
    if (!(P > 0)) throw new RangeError(`Pressure must be positive (got ${P} kPa).`);
    if (!Array.isArray(x) || x.length !== n) throw new Error(`Give ${n} mole fractions.`);
    const sum = x.reduce((u, v) => u + v, 0);
    if (!(sum > 0) || x.some(v => !(v >= 0))) throw new Error("Mole fractions must be non-negative with a positive sum.");
    return x.map(v => v / sum);
  };

  /**
   * Full state of one phase at T (K), P (kPa), composition x.
   * @returns {{Z:number, v_m3_mol:number, phase:string, rootType:string, roots:number,
   *   lnPhi:number[], hR_J_mol:number, sR_J_molK:number, cpR_J_molK:number, A:number, B:number}}
   */
  function state(T, P_kPa, x, phase) {
    x = check(T, P_kPa, x);
    const ph = normPhase(phase);
    const P = P_kPa * 1000, RT = R * T;
    const m = mix(T, x);
    const A = m.a * P / (RT * RT), B = m.b * P / RT;
    const s = d1 + d2, p = d1 * d2;
    const all = cubicRoots((s - 1) * B - 1, A + p * B * B - s * B * (B + 1), -(A * B + p * B * B * (B + 1)));
    const roots = all.filter(z => z > B);
    if (!roots.length) throw new Error(`${model}: no physical root at ${T} K, ${P_kPa} kPa.`);
    const Z = ph === "liquid" ? roots[0] : roots[roots.length - 1];
    const v = Z * RT / P;
    const rootType = roots.length > 1 ? (ph === "liquid" ? "liquid" : "vapour")
      : (v < eq.vcOverB * m.b ? "liquid-like" : "vapour-like");
    const L = Math.log((Z + d1 * B) / (Z + d2 * B));
    const dd = d1 - d2;
    const lnPhi = new Array(n);
    for (let i = 0; i < n; i++) {
      const br = bi[i] / m.b;
      lnPhi[i] = br * (Z - 1) - Math.log(Z - B) - A / (B * dd) * (2 * m.sumA[i] / m.a - br) * L;
    }
    const hR = RT * (Z - 1) + (T * m.da - m.a) / (m.b * dd) * L;
    const sR = R * Math.log(Z - B) + m.da / (m.b * dd) * L;
    const cvR = T * m.d2a / (m.b * dd) * L;
    const q1 = (v + d1 * m.b), q2 = (v + d2 * m.b);
    const dPdT = R / (v - m.b) - m.da / (q1 * q2);
    const dPdv = -RT / ((v - m.b) * (v - m.b)) + m.a * (2 * v + s * m.b) / (q1 * q1 * q2 * q2);
    const cpR = cvR + T * dPdT * dPdT / (-dPdv) - R;
    return { Z, v_m3_mol: v, phase: ph, rootType, roots: roots.length, lnPhi, hR_J_mol: hR, sR_J_molK: sR, cpR_J_molK: cpR, A, B };
  }

  /**
   * Saturation pressure (kPa) of component i alone at T (K), from the equation of state
   * (equal fugacities of liquid and vapour, Newton on ln P with d(ln phiL - ln phiV)/d ln P
   * = ZL - ZV). Throws at or above the critical temperature.
   */
  function psat(i, T) {
    const c = comps[i];
    if (!(T < c.Tc_K)) throw new RangeError(`${c.name}: no saturation pressure at ${T} K (critical temperature ${c.Tc_K} K).`);
    const x = new Array(n).fill(0); x[i] = 1;
    const both = P => {
      const L = state(T, P, x, "liquid"), V = state(T, P, x, "vapour");
      return { L, V, two: L.roots > 1 };
    };
    let P = c.Pc_Pa / 1000 * Math.exp(5.37 * (1 + c.omega) * (1 - c.Tc_K / T)); // Wilson
    let st = both(P);
    for (let k = 0; !st.two && k < 200; k++) {
      // one root: liquid-like means P is too high, vapour-like means too low
      P = st.L.rootType === "liquid-like" ? P / 1.3 : P * 1.3;
      st = both(P);
    }
    if (!st.two) throw new Error(`${c.name}: could not find a pressure with liquid and vapour roots at ${T} K.`);
    for (let it = 0; it < 100; it++) {
      const g = st.L.lnPhi[i] - st.V.lnPhi[i];
      const dg = st.L.Z - st.V.Z;
      let step = -g / dg;
      if (Math.abs(step) > 0.5) step = Math.sign(step) * 0.5;
      let Pn = P * Math.exp(step), sn = both(Pn);
      for (let h = 0; !sn.two && h < 40; h++) { step /= 2; Pn = P * Math.exp(step); sn = both(Pn); }
      P = Pn; st = sn;
      if (Math.abs(step) < 1e-13) return P;
    }
    throw new Error(`${c.name}: saturation pressure from ${model} did not converge at ${T} K.`);
  }

  return {
    model: String(model).toUpperCase(), name: eq.name, n, comps, kij: K,
    a_c: ac, b: bi, m: mi,
    state, psat, mix,
    /** Compressibility factor. */
    Z: (T, P, x, phase) => state(T, P, x, phase).Z,
    /** ln of the fugacity coefficients. */
    lnPhi: (T, P, x, phase) => state(T, P, x, phase).lnPhi,
  };
}
