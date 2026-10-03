/**
 * Fugacity.system(): a thermodynamic system (layer 1, src/thermo/system.js) with the
 * calculation methods of layer 2 attached. Kept in its own file so that both the public
 * entry point (src/index.js) and the workbench view (src/ui/app.js) use the same function.
 */
import { createSystem } from "./thermo/system.js";
import { bubbleT, bubbleP, pureBoilingPoints } from "./equilibrium/bubble.js";
import { dewT, dewP } from "./equilibrium/dew.js";
import { txy, pxy, ternaryGrid } from "./equilibrium/diagrams.js";
import { residueCurve } from "./equilibrium/residue.js";
import { binaryAzeotropes, findAzeotrope } from "./equilibrium/azeotrope.js";
import { isLiquidStable } from "./equilibrium/stability.js";
import { eosMethods } from "./equilibrium/phi-phi.js";
import { flash } from "./equilibrium/flash.js";

/**
 * Create a system with calculation methods attached.
 *
 * @example
 * const s = Fugacity.system({ components: ["water", "acetic acid"], model: "NRTL" });
 * s.bubbleT([0.5, 0.5], 101.325)   // { T: 377.2, y: [...], gamma: [...] }
 */
export function system(cfg) {
  const sys = createSystem(cfg);
  sys.flash = (spec, opts) => flash(sys, spec, opts);
  if (sys.kind === "eos") return Object.assign(sys, eosMethods(sys)); // model "PR" or "SRK"
  return Object.assign(sys, {
    bubbleT: (x, P) => bubbleT(sys, x, P),
    bubbleP: (x, T) => bubbleP(sys, x, T),
    dewT: (y, P) => dewT(sys, y, P),
    dewP: (y, T) => dewP(sys, y, T),
    boilingPoints: P => pureBoilingPoints(sys, P),
    txy: (P, points) => txy(sys, P, points),
    pxy: (T, points) => pxy(sys, T, points),
    ternaryGrid: (P, n) => ternaryGrid(sys, P, n),
    residueCurve: (x0, P, opts) => residueCurve(sys, x0, P, opts),
    azeotropes: P => binaryAzeotropes(sys, P),
    findAzeotrope: (x0, P) => findAzeotrope(sys, x0, P),
    isLiquidStable: (x, T) => isLiquidStable(sys, x, T),
  });
}
