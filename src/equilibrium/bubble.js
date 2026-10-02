import { brent, scanBracket, scanBracketInRange } from "../util/solve.js";
import { checkComposition, checkPressure, checkTemperature } from "./inputs.js";
import { fail } from "../util/errors.js";

const clean = x => {
  const v = x.map(u => Math.max(0, +u));
  const s = v.reduce((a, b) => a + b, 0);
  if (!(s > 0)) throw fail("BAD_INPUT", "Composition must have a positive sum.");
  return v.map(u => Math.max(u / s, 1e-12));
};

/** Boiling point of each pure component at P (kPa), in K. */
export function pureBoilingPoints(sys, P) {
  if (sys.vapour && sys.vapour !== "ideal") {
    // With a cubic vapour, phi_sat is taken at the vapour pressure, so a pure component boils
    // exactly where P_sat(T) = P (gamma-phi-vapour.js); solving that directly avoids
    // evaluating the other components above their critical temperatures.
    return sys.ids.map((_, i) => {
      const f = T => Math.log(sys.psat(T)[i] / P);
      const [a, b] = scanBracket(f, 150, 900, 30);
      return brent(f, a, b, { xtol: 1e-7 });
    });
  }
  return sys.ids.map((_, i) => {
    const x = new Array(sys.n).fill(1e-12); x[i] = 1;
    const f = T => sys.equilibrium(x, T).P - P;
    const [a, b] = scanBracket(f, 150, 900, 30);
    return brent(f, a, b, { xtol: 1e-7 });
  });
}

const tbCache = new WeakMap();
function boilingRange(sys, P) {
  let m = tbCache.get(sys);
  if (!m) { m = new Map(); tbCache.set(sys, m); }
  if (!m.has(P)) m.set(P, pureBoilingPoints(sys, P));
  return m.get(P);
}

/**
 * Bubble-point temperature at fixed pressure.
 * @param {object} sys  from createSystem
 * @param {number[]} x  liquid mole fractions (normalized automatically; checked: one per
 *                      component, none negative)
 * @param {number} P    kPa
 * @returns {{T:number, y:number[], gamma:number[], warnings:string[]}}  T in K; warnings: temperatures outside the data range of a temperature-dependent pair
 */
export function bubbleT(sys, x, P) {
  return bubbleTCore(sys, checkComposition(x, sys.n, "Liquid composition"), checkPressure(P));
}

/**
 * bubbleT without the input checks, for solvers inside the engine whose iterates may
 * step a little outside the composition simplex (negative values are taken as zero).
 */
export function bubbleTCore(sys, x, P) {
  x = clean(x);
  const f = T => sys.equilibrium(x, T).P - P;
  const tb = boilingRange(sys, P);
  const lo = Math.min(...tb) - 80, hi = Math.max(...tb) + 20;
  const [a, b] = scanBracketInRange(f, lo, hi, 40);
  const T = brent(f, a, b, { xtol: 1e-7 });
  const e = sys.equilibrium(x, T);
  return { T, y: e.y, gamma: e.gamma, warnings: sys.warnings ? sys.warnings(T, P) : [] };
}

/**
 * Bubble-point pressure at fixed temperature.
 * @returns {{P:number, y:number[], gamma:number[], warnings:string[]}}  P in kPa
 */
export function bubbleP(sys, x, T) {
  return bubblePCore(sys, checkComposition(x, sys.n, "Liquid composition"), checkTemperature(T));
}

/** bubbleP without the input checks (see bubbleTCore). */
export function bubblePCore(sys, x, T) {
  x = clean(x);
  const e = sys.equilibrium(x, T);
  return { P: e.P, y: e.y, gamma: e.gamma, warnings: sys.warnings ? sys.warnings(T, e.P) : [] };
}
