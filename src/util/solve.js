import { fail, failRange } from "./errors.js";

/**
 * Brent's method: find a root of f on [a, b], where f(a) and f(b) have opposite signs.
 * @param {(x:number)=>number} f
 * @param {number} a
 * @param {number} b
 * @param {{xtol?:number, maxIter?:number}} [opts]
 * @returns {number}
 */
export function brent(f, a, b, opts = {}) {
  const xtol = opts.xtol ?? 1e-9;
  const maxIter = opts.maxIter ?? 200;
  let fa = f(a), fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (fa * fb > 0) {
    throw failRange("NO_CONVERGENCE", `brent: no sign change on [${a}, ${b}] (f = ${fa}, ${fb})`);
  }
  let c = a, fc = fa, d = b - a, e = d;
  for (let i = 0; i < maxIter; i++) {
    if (fb * fc > 0) { c = a; fc = fa; d = b - a; e = d; }
    if (Math.abs(fc) < Math.abs(fb)) { a = b; b = c; c = a; fa = fb; fb = fc; fc = fa; }
    const tol = 2 * Number.EPSILON * Math.abs(b) + 0.5 * xtol;
    const m = 0.5 * (c - b);
    if (Math.abs(m) <= tol || fb === 0) return b;
    if (Math.abs(e) >= tol && Math.abs(fa) > Math.abs(fb)) {
      let p, q, r;
      const s = fb / fa;
      if (a === c) { p = 2 * m * s; q = 1 - s; }
      else {
        q = fa / fc; r = fb / fc;
        p = s * (2 * m * q * (q - r) - (b - a) * (r - 1));
        q = (q - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q; else p = -p;
      if (2 * p < Math.min(3 * m * q - Math.abs(tol * q), Math.abs(e * q))) { e = d; d = p / q; }
      else { d = m; e = m; }
    } else { d = m; e = m; }
    a = b; fa = fb;
    b += Math.abs(d) > tol ? d : (m > 0 ? tol : -tol);
    fb = f(b);
  }
  throw fail("NO_CONVERGENCE", "brent: did not converge");
}

/**
 * Find a bracket [lo, hi] with a sign change of f by scanning outward from a guess.
 * @param {(x:number)=>number} f
 * @param {number} lo
 * @param {number} hi
 * @param {number} [n]
 * @returns {[number, number]}
 */
export function scanBracket(f, lo, hi, n = 24) {
  let x0 = lo, f0 = f(lo);
  for (let k = 1; k <= n; k++) {
    const x1 = lo + (hi - lo) * k / n, f1 = f(x1);
    if (f0 * f1 <= 0) return [x0, x1];
    x0 = x1; f0 = f1;
  }
  throw failRange("NO_CONVERGENCE", `No solution between ${lo} and ${hi}.`);
}
