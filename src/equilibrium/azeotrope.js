import { bubbleTCore as bubbleT } from "./bubble.js";
import { brent } from "../util/solve.js";
import { fail } from "../util/errors.js";

/**
 * Azeotrope near a starting composition (any number of components): solves y = x
 * with a damped Newton method. Returns null if it does not converge inside the simplex.
 * @returns {{x:number[], T:number}|null}
 */
export function findAzeotrope(sys, x0, P, opts = {}) {
  const n = sys.n, tol = opts.tol ?? 1e-9, h = 1e-6;
  let u = x0.slice(0, n - 1);                         // independent mole fractions
  const full = v => [...v, 1 - v.reduce((a, b) => a + b, 0)];
  const F = v => { const x = full(v); const r = bubbleT(sys, x, P); return r.y.slice(0, n - 1).map((yi, i) => yi - x[i]); };
  for (let it = 0; it < 60; it++) {
    const f = F(u);
    if (Math.hypot(...f) < tol) break;
    const J = u.map((_, k) => { const v = u.slice(); v[k] += h; const fk = F(v); return fk.map((q, i) => (q - f[i]) / h); });
    // J[k][i] = dF_i/du_k -> solve (J^T) du = -f by Gaussian elimination
    const m = n - 1, A = Array.from({ length: m }, (_, i) => [...Array.from({ length: m }, (_, k) => J[k][i]), -f[i]]);
    for (let c = 0; c < m; c++) {
      let p = c; for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]];
      if (Math.abs(A[c][c]) < 1e-14) return null;
      for (let r = 0; r < m; r++) if (r !== c) { const q = A[r][c] / A[c][c]; for (let k = c; k <= m; k++) A[r][k] -= q * A[c][k]; }
    }
    const du = A.map((row, i) => row[m] / row[i]);
    let lam = 1;
    while (lam > 1e-3) {
      const v = u.map((ui, i) => ui + lam * du[i]);
      const x = full(v);
      if (Math.min(...x) >= 0 && Math.hypot(...F(v)) < Math.hypot(...f)) { u = v; break; }
      lam /= 2;
    }
    if (lam <= 1e-3) return null;
  }
  const x = full(u);
  if (Math.min(...x) < 1e-6 || Math.hypot(...F(u)) > 1e-6) return null;
  return { x, T: bubbleT(sys, x, P).T };
}

/**
 * Binary azeotropes at pressure P: compositions where y1 = x1 (0 < x1 < 1).
 * @returns {{x:number, T:number, type:"minimum-boiling"|"maximum-boiling"}[]}  x of the first component, T in K
 */
export function binaryAzeotropes(sys, P, scan = 200) {
  if (sys.n !== 2) throw fail("BAD_INPUT", "binaryAzeotropes needs exactly two components.");
  const f = x1 => bubbleT(sys, [x1, 1 - x1], P).y[0] - x1;
  const out = [];
  let x0 = 1e-4, f0 = f(x0);
  for (let k = 1; k <= scan; k++) {
    const x1 = Math.min(1 - 1e-4, k / scan), f1 = f(x1);
    if (f0 * f1 < 0) {
      const x = brent(f, x0, x1, { xtol: 1e-10 });
      const T = bubbleT(sys, [x, 1 - x], P).T;
      const Tl = bubbleT(sys, [Math.max(0, x - 0.01), 1 - Math.max(0, x - 0.01)], P).T;
      out.push({ x, T, type: Tl > T ? "minimum-boiling" : "maximum-boiling" });
    }
    x0 = x1; f0 = f1;
  }
  return out;
}

/**
 * All azeotropes of a ternary system at pressure P: binary ones on the edges and
 * ternary ones inside the triangle (searched from a set of starting points).
 * @param {object} sys      ternary system
 * @param {Function} makePairSystem  (ids) => binary system with the same model
 * @returns {{x:number[], T:number, kind:"binary"|"ternary"}[]}
 */
export function ternaryAzeotropes(sys, P, makePairSystem) {
  const out = [];
  for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) {
    const pair = makePairSystem([sys.ids[i], sys.ids[j]]);
    for (const z of binaryAzeotropes(pair, P, 120)) {
      const x = [0, 0, 0]; x[i] = z.x; x[j] = 1 - z.x;
      out.push({ x, T: z.T, kind: "binary" });
    }
  }
  const starts = [[1 / 3, 1 / 3, 1 / 3], [0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.2, 0.2, 0.6], [0.45, 0.45, 0.1], [0.45, 0.1, 0.45], [0.1, 0.45, 0.45]];
  for (const x0 of starts) {
    const z = findAzeotrope(sys, x0, P);
    if (z && Math.min(...z.x) > 1e-3 && !out.some(o => Math.hypot(...o.x.map((v, k) => v - z.x[k])) < 0.01)) out.push({ ...z, kind: "ternary" });
  }
  return out;
}
