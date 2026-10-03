/**
 * Dew points for activity-coefficient (gamma-phi) systems: NRTL, UNIQUAC and ideal, with
 * an ideal-gas vapour and the chemical theory for dimerizing acids (as in bubble.js).
 * Proposal 0001, step 1.
 *
 * At a dew point the vapour y is given and the first drop of liquid x is found:
 *     y_i P = x_i gamma_i(T, x) P_i^sat(T)          (non-associating components)
 * and, for a dimerizing acid, the apparent vapour fraction y_i = (p_m + 2 p_d) / sum, with the
 * monomer and dimer pressures from sys.equilibrium (src/thermo/vapour.js).
 *
 * Method (the classical dew-point iteration, written for any vapour model that
 * sys.equilibrium describes):
 *   - dew pressure at fixed T: successive substitution on the liquid,
 *       x_i <- x_i * y_i / y_i(x, T),   then normalize,
 *     where y(x, T) is the vapour in equilibrium with x (sys.equilibrium). For a
 *     non-associating system this is exactly x_i = y_i P / (gamma_i P_i^sat) with gamma
 *     at the previous x. At convergence y(x, T) = y and the dew pressure is the bubble
 *     pressure of x. The step is halved (in ln x) when the error grows.
 *     Start: the ideal-solution liquid x_i ~ y_i / P_i^sat.
 *   - dew temperature at fixed P: Brent's method on f(T) = ln(P_dew(T) / P), which rises with
 *     T. The bracket is found by stepping out from the Raoult's-law dew temperature (2 K,
 *     doubling), or else by scanning between the pure boiling points (minus 80 K, plus 20 K,
 *     as for bubbleT).
 * Open descriptions of the method: the dew-point procedures of the `thermo` library
 * (thermo.flash, FlashVL dew_T and dew_P with a Gibbs-excess liquid, MIT licence), which is
 * also the independent check in validation/python/reference_dew.py.
 *
 * Several solutions: in a partly miscible system the dew-point equations can have more than
 * one solution (a first drop rich in one liquid or the other). The iteration is started from
 * the ideal-solution liquid and from a liquid rich in each component; solutions whose liquid
 * is not stable (isLiquidStable, stability.js: inside the spinodal) are discarded, and of the
 * rest the one with the lowest pressure is the dew point (compressing the vapour, the first
 * liquid appears there; at fixed P this is the highest dew temperature). If only unstable
 * liquids are found, the solver throws a PHASE_SPLIT error, as the equation-of-state solvers
 * do. The lowest-pressure rule also excludes a metastable first drop (between spinodal and
 * binodal): if the drop were metastable, a liquid below the vapour's tangent plane would
 * exist and give a dew point at a lower pressure, which the other starting liquids find.
 *
 * Units: T in K, P in kPa, mole fractions.
 */
import { brent } from "../util/solve.js";
import { fail } from "../util/errors.js";
import { checkComposition, checkPressure, checkTemperature } from "../util/inputs.js";
import { pureBoilingPoints } from "./bubble.js";
import { isLiquidStable } from "./stability.js";

const TOL = 1e-12;      // max |y(x, T) - y| at convergence
const MAX_IT = 1000;
// Floor for liquid mole fractions. It must stay far below TOL, so that a component absent
// from the vapour (y_i = 0) can satisfy the convergence test.
const X_MIN = 1e-20;

const normalize = v => {
  const s = v.reduce((a, b) => a + b, 0);
  return v.map(u => Math.max(u / s, X_MIN));
};
const maxDiff = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);

/**
 * Dew pressure without input checks. Returns { converged: false, x } (the last iterate) when
 * the iteration does not converge; the caller decides what to report.
 */
function dewPInner(sys, y, T, x0) {
  try {
    return dewPIter(sys, y, T, x0);
  } catch (e) {
    // a temperature outside the data (e.g. above a critical temperature, with a cubic vapour)
    if (e && e.code === "OUT_OF_RANGE") return { converged: false, x: x0 ?? null, rangeError: e };
    throw e;
  }
}

function dewPIter(sys, y, T, x0) {
  let x = x0 ? normalize(x0) : normalize(sys.psat(T).map((p, i) => y[i] / p));
  let e = sys.equilibrium(x, T);
  let err = maxDiff(e.y, y), step = 1;
  for (let it = 1; it <= MAX_IT; it++) {
    if (err < TOL) return { converged: true, P: e.P, x, gamma: e.gamma, iterations: it - 1 };
    const target = x.map((v, i) => v * y[i] / Math.max(e.y[i], 1e-300));
    let xn, en, errn;
    for (;;) {
      // step in ln x: step = 1 is the full substitution, smaller values damp it
      xn = normalize(x.map((v, i) => Math.exp((1 - step) * Math.log(v) + step * Math.log(Math.max(target[i], 1e-300)))));
      en = sys.equilibrium(xn, T);
      errn = maxDiff(en.y, y);
      if (Number.isFinite(errn) && (errn < err || step < 1 / 64)) break;
      step /= 2;
    }
    if (!Number.isFinite(errn)) return { converged: false, x };
    if (errn < err) step = Math.min(1, step * 2);
    x = xn; e = en; err = errn;
  }
  return { converged: false, x };
}

/**
 * All dew pressures at T found from several starting liquids, keeping the physical one.
 * In a partly miscible system the dew-point equations have more than one solution (a drop
 * rich in one or the other liquid). Compressing the vapour at fixed T, the first liquid
 * appears at the lowest of those pressures, so the solution with the lowest P is the dew
 * point; solutions whose liquid is not stable (inside the spinodal) are discarded.
 * Starts: the ideal-solution liquid, the previous solution (warm), and, for each
 * component, a liquid rich in that component.
 * @returns {{best:object|null, unstable:object|null, lastX:number[]|null, rangeError:Error|null}}
 */
function dewPSolutions(sys, y, T, warm) {
  const n = sys.n;
  const starts = [null];
  if (warm) starts.push(warm);
  if (n > 1) for (let k = 0; k < n; k++) starts.push(y.map((v, i) => (i === k ? 0.98 : 0.02 * Math.max(v, 1e-6))));
  const found = [];
  let unstable = null, lastX = null, rangeError = null;
  for (const x0 of starts) {
    const r = dewPInner(sys, y, T, x0);
    if (!r.converged) { lastX = r.x; rangeError = r.rangeError ?? rangeError; continue; }
    const { converged, ...sol } = r;
    if (found.some(f => maxDiff(f.x, sol.x) < 1e-7)) continue;
    if (n > 1 && !isLiquidStable(sys, sol.x, T)) { if (!unstable || sol.P < unstable.P) unstable = sol; continue; }
    found.push(sol);
  }
  const best = found.reduce((m, r) => (!m || r.P < m.P ? r : m), null);
  return { best, unstable, lastX, rangeError };
}

function splitError(what, r, where) {
  const xs = r.x.map(v => v.toPrecision(3)).join(", ");
  return fail("PHASE_SPLIT", `${what}: the only liquid found, [${xs}] at ${where}, lies inside the two-liquid region (it is not stable as one liquid); three-phase equilibrium is not supported yet.`, { x: r.x });
}

/**
 * Dew-point pressure at fixed temperature.
 * @param {object} sys  from createSystem (NRTL, UNIQUAC or ideal)
 * @param {number[]} y  vapour mole fractions (normalized automatically; for an acid, apparent fractions)
 * @param {number} T    K
 * @returns {{P:number, x:number[], gamma:number[], iterations:number, warnings:string[]}}  P in kPa
 */
export function dewP(sys, y, T) {
  y = checkComposition(y, sys.n, "Vapour composition");
  T = checkTemperature(T);
  const what = `${sys.model} dew pressure at T = ${T} K`;
  const { best, unstable, lastX, rangeError } = dewPSolutions(sys, y, T);
  if (!best && unstable) throw splitError(what, unstable, `${unstable.P.toFixed(2)} kPa`);
  if (!best && rangeError) throw rangeError;
  if (!best) throw fail("NO_CONVERGENCE", `${what}: the liquid composition did not converge in ${MAX_IT} substitution steps from any starting liquid.`, { y, T, lastX });
  return { ...best, warnings: sys.warnings ? sys.warnings(T, best.P) : [] };
}

/**
 * Dew-point temperature at fixed pressure.
 * @param {object} sys  from createSystem (NRTL, UNIQUAC or ideal)
 * @param {number[]} y  vapour mole fractions (normalized automatically)
 * @param {number} P    kPa
 * @returns {{T:number, x:number[], gamma:number[], iterations:number, warnings:string[]}}  T in K
 */
export function dewT(sys, y, P) {
  y = checkComposition(y, sys.n, "Vapour composition");
  P = checkPressure(P);
  const what = `${sys.model} dew temperature at P = ${P} kPa`;
  const tb = pureBoilingPoints(sys, P);
  const lo = Math.min(...tb) - 80, hi = Math.max(...tb) + 20;

  let warm = null, lastUnstable = null, lastRange = null;
  const f = T => {
    const { best, unstable, rangeError } = dewPSolutions(sys, y, T, warm);
    if (!best) { if (unstable) lastUnstable = { ...unstable, T }; if (rangeError) lastRange = rangeError; return NaN; }
    warm = best.x;
    return Math.log(best.P / P);
  };
  let bracket = null;
  // 1. step out from the Raoult's-law dew temperature (f rises with T)
  const raoult = T => Math.log(P * sys.psat(T).reduce((a, p, i) => a + y[i] / p, 0)); // falls with T
  let T0 = null;
  try { T0 = brent(raoult, lo, hi, { xtol: 1e-3 }); } catch { /* no Raoult estimate in range */ }
  if (T0 !== null) {
    const f0 = f(T0);
    if (Number.isFinite(f0)) {
      const dir = f0 < 0 ? 1 : -1;
      let a = T0, fa = f0;
      for (let step = 2; !bracket; step *= 2) {
        const T = Math.min(hi, Math.max(lo, a + dir * step));
        const fT = f(T);
        if (Number.isFinite(fT)) {
          if (fa * fT <= 0) bracket = dir > 0 ? [a, T] : [T, a];
          else { a = T; fa = fT; }
        }
        if (T === lo || T === hi) break;
      }
    }
  }
  // 2. otherwise scan the whole range; temperatures where no stable liquid is found are skipped
  if (!bracket) {
    const N = 40;
    let a = null, fa = NaN;
    for (let k = 0; k <= N && !bracket; k++) {
      const T = lo + (hi - lo) * k / N, fT = f(T);
      if (!Number.isFinite(fT)) continue;
      if (a !== null && fa * fT <= 0) bracket = [a, T];
      a = T; fa = fT;
    }
  }
  if (!bracket) {
    if (lastUnstable) throw splitError(what, lastUnstable, `${lastUnstable.T.toFixed(2)} K`);
    if (lastRange) throw lastRange;
    throw fail("NO_CONVERGENCE", `${what}: no dew point found between ${lo.toFixed(1)} K and ${hi.toFixed(1)} K (pure boiling points ${tb.map(t => t.toFixed(1)).join(", ")} K).`, { y, P });
  }
  const T = brent(f, bracket[0], bracket[1], { xtol: 1e-7 });
  const { best, lastX } = dewPSolutions(sys, y, T, warm);
  if (!best) throw fail("NO_CONVERGENCE", `${what}: the liquid composition did not converge at ${T.toFixed(3)} K.`, { y, P, T, lastX });
  return { T, x: best.x, gamma: best.gamma, iterations: best.iterations, warnings: sys.warnings ? sys.warnings(T, P) : [] };
}
