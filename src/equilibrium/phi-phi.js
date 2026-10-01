/**
 * Vapour-liquid equilibrium with an equation of state for both phases (phi-phi):
 * bubble and dew points, K_i = phi_i^L / phi_i^V.
 *
 * Method: the standard successive-substitution scheme for saturation points, with a
 * Newton step on the outer variable (the VL flash of the open-source thermo library,
 * thermo.flash.FlashVL, is the independent check in validation/python/reference_eos.py):
 *   - start from Wilson's K-values, ln K_i = ln(Pc_i / P) + 5.37 (1 + w_i)(1 - Tc_i / T)
 *     (Wilson's correlation as documented in the open-source chemicals library,
 *     chemicals.flash_basic.Wilson_K_value; used only as the starting guess);
 *   - Newton step on the unknown (ln P, or T) for f = ln sum_i K_i x_i (bubble) or
 *     f = ln sum_i y_i / K_i (dew), with the derivative by finite difference at fixed
 *     compositions; the incipient-phase composition is updated by successive substitution
 *     (y_i = K_i x_i / sum, or x_i = (y_i / K_i) / sum).
 * For an ideal system df/dlnP = -1 (bubble) or +1 (dew), and the step is the classical
 * P <- P sum K_i x_i update.
 *
 * Near the mixture critical point this iteration can fall onto the trivial solution
 * (vapour = liquid). The solver then scans the unknown for a sign change of f, with the
 * incipient phase converged by successive substitution at each fixed value, and finishes
 * with Brent's method. If neither finds a non-trivial solution it throws ("no two-phase
 * solution found": the state is at or above the mixture's critical region).
 *
 * Units: T in K, P in kPa.
 */
import { brent } from "../util/solve.js";

const MAX_IT = 300;

const clean = z => {
  const v = z.map(u => +u);
  if (v.some(u => !(u >= 0))) throw new Error("Mole fractions must be non-negative numbers.");
  const s = v.reduce((a, b) => a + b, 0);
  if (!(s > 0)) throw new Error("Composition must have a positive sum.");
  return v.map(u => u / s);
};

const logSumExp = (w, lnv) => {
  let m = -Infinity;
  for (let i = 0; i < w.length; i++) if (w[i] > 0 && lnv[i] > m) m = lnv[i];
  let s = 0;
  for (let i = 0; i < w.length; i++) if (w[i] > 0) s += w[i] * Math.exp(lnv[i] - m);
  return m + Math.log(s);
};

/** ln of Wilson's K-values at T (K), P (kPa). */
export function wilsonLnK(comps, T, P) {
  return comps.map(c => Math.log(c.Pc_Pa / 1000 / P) + 5.37 * (1 + c.omega) * (1 - c.Tc_K / T));
}

function wilsonTemperature(comps, z, P, bubble) {
  const f = T => {
    const lnK = wilsonLnK(comps, T, P);
    return bubble ? logSumExp(z, lnK) : logSumExp(z, lnK.map(v => -v));
  };
  return brent(f, 5, 5000, { xtol: 1e-6 });
}

const LABEL = { bubbleP: "bubble pressure", bubbleT: "bubble temperature", dewP: "dew pressure", dewT: "dew temperature" };

function solve(sys, z, given, kind) {
  const eos = sys.eos, comps = eos.comps, n = eos.n;
  if (!Array.isArray(z) || z.length !== n) throw new Error(`Give ${n} mole fractions.`);
  z = clean(z);
  const bubble = kind.startsWith("bubble"), varP = kind.endsWith("P");
  if (!(given > 0)) throw new RangeError(`${varP ? "Temperature" : "Pressure"} must be positive (got ${given}).`);
  const what = `${sys.model} ${LABEL[kind]} at ${varP ? `T = ${given} K` : `P = ${given} kPa`}`;
  // the unknown u is ln P (bubble/dew pressure) or T (bubble/dew temperature)
  const TP = u => (varP ? [given, Math.exp(u)] : [u, given]);

  function resid(u, w) {
    const [T, P] = TP(u);
    const L = eos.state(T, P, bubble ? z : w, "liquid"), V = eos.state(T, P, bubble ? w : z, "vapour");
    const lnK = L.lnPhi.map((v, i) => v - V.lnPhi[i]);
    const terms = bubble ? z.map((v, i) => v * Math.exp(lnK[i])) : z.map((v, i) => v * Math.exp(-lnK[i]));
    const S = terms.reduce((a, b) => a + b, 0);
    const trivial = lnK.reduce((a, v) => a + v * v, 0) < 1e-8;
    return { f: Math.log(S), lnK, wNew: terms.map(t => t / S), L, V, trivial };
  }
  const wilsonW = u => {
    const [T, P] = TP(u);
    const lnK = wilsonLnK(comps, T, P);
    return normalize(z.map((v, i) => v * Math.exp(bubble ? lnK[i] : -lnK[i])));
  };
  const result = (u, r, iterations, method) => {
    const [T, P] = TP(u);
    const out = { iterations, method, K: r.lnK.map(Math.exp), Z_L: r.L.Z, Z_V: r.V.Z, rootTypes: { liquid: r.L.rootType, vapour: r.V.rootType } };
    if (varP) out.P = P; else out.T = T;
    if (bubble) out.y = r.wNew; else out.x = r.wNew;
    return out;
  };

  // u0 from Wilson's K-values
  let u0;
  if (varP) {
    const lnK = wilsonLnK(comps, given, 1);
    u0 = bubble ? logSumExp(z, lnK) : -logSumExp(z, lnK.map(v => -v));
  } else {
    u0 = wilsonTemperature(comps, z, given, bubble);
  }

  // 1. Newton on u (derivative at fixed compositions), successive substitution on w.
  let note = "";
  {
    let u = u0, w = wilsonW(u0);
    for (let it = 1; it <= MAX_IT; it++) {
      const r = resid(u, w);
      if (!Number.isFinite(r.f)) { note = "non-finite residual"; break; }
      if (r.trivial) { note = "converged to the trivial solution"; break; }
      const dw = Math.max(...r.wNew.map((v, i) => Math.abs(v - w[i])));
      if (Math.abs(r.f) < 1e-11 && dw < 1e-10) return result(u, r, it, "Newton");
      const h = varP ? 1e-6 : u * 1e-6;
      const d = (resid(u + h, w).f - r.f) / h;
      // expected sign of df/du: bubble P -1, dew P +1, bubble T +, dew T -
      const sgn = varP ? (bubble ? -1 : 1) : (bubble ? 1 : -1);
      let step = -r.f / d;
      if (!Number.isFinite(step) || Math.sign(d) !== sgn) step = varP ? -sgn * r.f : -sgn * r.f * u * 0.1;
      const lim = varP ? 0.4 : 0.05 * u;
      u += Math.max(-lim, Math.min(lim, step));
      w = r.wNew;
      if (it === MAX_IT) note = "no convergence";
    }
  }

  // 2. Fallback (near the critical region): scan u for a sign change of f, where f is
  //    evaluated with the incipient phase converged by successive substitution at fixed u;
  //    then Brent's method on u.
  let warm = null, evals = 0;
  function inner(u) {
    let w = warm || wilsonW(u);
    for (let k = 0; k < 2000; k++) {
      evals++;
      let r;
      try { r = resid(u, w); } catch (e) { return null; }
      if (!Number.isFinite(r.f) || r.trivial) return null;
      const dw = Math.max(...r.wNew.map((v, i) => Math.abs(v - w[i])));
      w = r.wNew;
      if (dw < 1e-12) { warm = w; return r; }
    }
    return null;
  }
  const grid = [];
  const N = 120;
  const [lo, hi] = varP ? [u0 - Math.log(100), Math.min(u0 + Math.log(100), Math.log(20 * Math.max(...comps.map(c => c.Pc_Pa / 1000))))]
    : [Math.max(5, 0.3 * u0), 2.5 * u0];
  for (let k = 0; k <= N; k++) {
    const u = lo + (hi - lo) * k / N;
    warm = null;
    const r = inner(u);
    grid.push({ u, r, w: warm });
  }
  const solveBracket = (a, b) => {
    const f = u => { const r = inner(u); if (!r) throw new Error("trivial inside bracket"); return r.f; };
    const u = brent(f, a.u, b.u, { xtol: varP ? 1e-13 : 1e-10 });
    const r = inner(u);
    return result(u, r, evals, "scan + Brent");
  };
  for (let k = 0; k < N; k++) {
    const a = grid[k], b = grid[k + 1];
    if (a.r && b.r && Math.sign(a.r.f) !== Math.sign(b.r.f)) {
      try { warm = a.w; return solveBracket(a, b); } catch (e) { /* try the next bracket */ }
    }
  }
  // a sign change hidden next to the edge of the region with a non-trivial solution
  for (let k = 0; k < N; k++) {
    let a = grid[k], b = grid[k + 1];
    if (!a.r === !b.r) continue;
    if (!a.r) [a, b] = [b, a];
    let A = { u: a.u, r: a.r, w: a.w }, Bu = b.u;
    for (let it = 0; it < 60; it++) {
      const m = (A.u + Bu) / 2;
      warm = A.w;
      const r = inner(m);
      if (!r) { Bu = m; continue; }
      if (Math.sign(r.f) !== Math.sign(A.r.f)) {
        try { warm = A.w; return solveBracket(A, { u: m }); } catch (e) { break; }
      }
      A = { u: m, r, w: warm };
    }
  }
  throw new Error(`${what}: no two-phase solution found (${note || "no convergence"} from Wilson's K-values, and no sign change found between ` +
    `${varP ? `${Math.exp(lo).toPrecision(3)} and ${Math.exp(hi).toPrecision(3)} kPa` : `${lo.toFixed(1)} and ${hi.toFixed(1)} K`}). ` +
    "The state is probably at or above the mixture's critical region, where only the trivial solution (vapour = liquid) exists.");
}

function normalize(v) {
  const s = v.reduce((a, b) => a + b, 0);
  return v.map(u => u / s);
}

/**
 * Bubble pressure at T (K) for liquid x. Returns { P (kPa), y, K, Z_L, Z_V, iterations }.
 * @param {object} sys  an equation-of-state system (model "PR" or "SRK")
 */
export const eosBubbleP = (sys, x, T) => solve(sys, x, T, "bubbleP");
/** Bubble temperature at P (kPa) for liquid x. Returns { T (K), y, K, Z_L, Z_V, iterations }. */
export const eosBubbleT = (sys, x, P) => solve(sys, x, P, "bubbleT");
/** Dew pressure at T (K) for vapour y. Returns { P (kPa), x, K, Z_L, Z_V, iterations }. */
export const eosDewP = (sys, y, T) => solve(sys, y, T, "dewP");
/** Dew temperature at P (kPa) for vapour y. Returns { T (K), x, K, Z_L, Z_V, iterations }. */
export const eosDewT = (sys, y, P) => solve(sys, y, P, "dewT");

/** Methods attached by Fugacity.system() to an equation-of-state system. */
export function eosMethods(sys) {
  const no = what => () => {
    throw new Error(`${what} is not available for ${sys.model} (equation-of-state) systems yet; it needs an activity-coefficient model (NRTL, UNIQUAC, ideal). Available: bubbleT, bubbleP, dewT, dewP, Z, lnPhi, density.`);
  };
  return {
    bubbleT: (x, P) => eosBubbleT(sys, x, P),
    bubbleP: (x, T) => eosBubbleP(sys, x, T),
    dewT: (y, P) => eosDewT(sys, y, P),
    dewP: (y, T) => eosDewP(sys, y, T),
    boilingPoints: no("boilingPoints"),
    /** Saturation pressure (kPa) of each pure component at T from the equation of state (null at or above Tc). */
    psatEos: T => sys.eos.comps.map((c, i) => (T < c.Tc_K ? sys.eos.psat(i, T) : null)),
    txy: no("txy"), pxy: no("pxy"), ternaryGrid: no("ternaryGrid"), residueCurve: no("residueCurve"),
    azeotropes: no("azeotropes"), findAzeotrope: no("findAzeotrope"), isLiquidStable: no("isLiquidStable"),
  };
}
