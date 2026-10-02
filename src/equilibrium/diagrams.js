import { bubbleT, bubbleP } from "./bubble.js";
import { fail } from "../util/errors.js";

/**
 * Isobaric T-x-y data for a binary system.
 * @returns {{x:number, T:number, y:number}[]}  x, y of the first component; T in K
 */
export function txy(sys, P, points = 51) {
  if (sys.n !== 2) throw fail("BAD_INPUT", "T-x-y needs exactly two components.");
  const out = [];
  for (let k = 0; k < points; k++) {
    const x1 = k / (points - 1);
    const r = bubbleT(sys, [x1, 1 - x1], P);
    out.push({ x: x1, T: r.T, y: r.y[0] });
  }
  return out;
}

/**
 * Isothermal P-x-y data for a binary system.
 * @returns {{x:number, P:number, y:number}[]}  P in kPa
 */
export function pxy(sys, T, points = 51) {
  if (sys.n !== 2) throw fail("BAD_INPUT", "P-x-y needs exactly two components.");
  const out = [];
  for (let k = 0; k < points; k++) {
    const x1 = k / (points - 1);
    const r = bubbleP(sys, [x1, 1 - x1], T);
    out.push({ x: x1, P: r.P, y: r.y[0] });
  }
  return out;
}

/**
 * Bubble temperatures on a triangular grid for a ternary system.
 * Node (i, j) has x = [i/n, j/n, (n-i-j)/n].
 * @returns {{n:number, nodes:{i:number,j:number,x:number[],T:number,y:number[]}[]}}
 */
export function ternaryGrid(sys, P, n = 40) {
  if (sys.n !== 3) throw fail("BAD_INPUT", "A ternary grid needs exactly three components.");
  const nodes = [];
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
    const x = [i / n, j / n, (n - i - j) / n];
    const r = bubbleT(sys, x, P);
    nodes.push({ i, j, x, T: r.T, y: r.y });
  }
  return { n, nodes };
}
