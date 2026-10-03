import { anyBubbleT as bubbleT } from "./bubble-any.js"; // activity models and equations of state

/**
 * Residue curve through x0 at pressure P: dx/dxi = x - y.
 * Integrated in both directions with fixed steps in composition space,
 * from the low-boiling end to the high-boiling end.
 *
 * @param {object} sys
 * @param {number[]} x0
 * @param {number} P  kPa
 * @param {{step?:number, maxSteps?:number}} [opts]
 * @returns {{x:number[], T:number}[]}  ordered by rising temperature
 */
export function residueCurve(sys, x0, P, opts = {}) {
  const h = opts.step ?? 0.01, maxSteps = opts.maxSteps ?? 3000;
  const run = dir => {
    let x = x0.slice();
    const seg = [];
    for (let k = 0; k < maxSteps; k++) {
      const r = bubbleT(sys, x, P);
      seg.push({ x: x.slice(), T: r.T });
      const d = x.map((xi, i) => xi - r.y[i]);
      const nd = Math.hypot(...d);
      if (nd < 1e-6 || Math.max(...x) > 0.995) break;
      let xn = x.map((xi, i) => xi + dir * h * d[i] / nd);
      if (Math.min(...xn) < 0) {
        xn = xn.map(v => Math.max(v, 0));
        const s = xn.reduce((a, b) => a + b, 0);
        xn = xn.map(v => v / s);
        seg.push({ x: xn, T: bubbleT(sys, xn, P).T });
        break;
      }
      x = xn;
    }
    return seg;
  };
  const down = run(-1).reverse();
  const up = run(+1);
  return down.concat(up.slice(1));
}
