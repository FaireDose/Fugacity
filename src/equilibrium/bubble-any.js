/**
 * The bubble point of a system, whatever its model: the gamma-phi solvers (bubble.js) for
 * activity-coefficient models, the phi-phi solvers (phi-phi.js) for equations of state.
 * Used by the diagram algorithms (T-x-y, P-x-y, ternary grid, residue curves, azeotropes),
 * so that every diagram can be drawn with either kind of model. Without input checks, for
 * solvers whose iterates may step a little outside the composition simplex (negative values
 * are taken as zero).
 *
 * Units: T in K, P in kPa.
 */
import { bubbleTCore, bubblePCore } from "./bubble.js";
import { eosBubbleT, eosBubbleP } from "./phi-phi.js";

const simplex = x => {
  const v = x.map(u => Math.max(0, +u));
  const s = v.reduce((a, b) => a + b, 0);
  return s > 0 ? v.map(u => u / s) : v;
};

/** Bubble temperature at P: { T, y, ... }. opts (equations of state only): see phi-phi.js. */
export function anyBubbleT(sys, x, P, opts) {
  return sys.kind === "eos" ? eosBubbleT(sys, simplex(x), P, opts) : bubbleTCore(sys, x, P);
}

/** Bubble pressure at T: { P, y, ... }. */
export function anyBubbleP(sys, x, T) {
  return sys.kind === "eos" ? eosBubbleP(sys, simplex(x), T) : bubblePCore(sys, x, T);
}
