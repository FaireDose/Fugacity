/**
 * Fugacity: chemical process simulation that runs in the browser.
 *
 * Units in the programming interface: temperature in K, pressure in kPa,
 * compositions as mole fractions. The interface (mount) displays °C.
 */
import { createSystem, listComponents, findComponent, MODELS } from "./thermo/system.js";
import { bubbleT, bubbleP, pureBoilingPoints } from "./equilibrium/bubble.js";
import { txy, pxy, ternaryGrid } from "./equilibrium/diagrams.js";
import { residueCurve } from "./equilibrium/residue.js";
import { binaryAzeotropes, findAzeotrope } from "./equilibrium/azeotrope.js";
import { isLiquidStable } from "./equilibrium/stability.js";
import { checkPackage, validCas } from "./contrib/package-check.js";
import { pure, PROPERTIES, PROPERTY_NAMES } from "./thermo/pure.js";
import { steam, steamSat } from "./thermo/iapws/steam.js";
import { mount } from "./ui/mount.js";
import { mountProperties } from "./ui/properties.js";
import { EOS_MODELS } from "./thermo/system.js";
import { eosMethods, eosBubbleP, eosBubbleT, eosDewP, eosDewT } from "./equilibrium/phi-phi.js";
import { cubicEos } from "./thermo/eos/cubic.js";
import { henry, henryInfo, gasSolubility, HENRY_GASES } from "./thermo/henry.js";
import pkg from "../package.json" with { type: "json" };

export const version = pkg.version;

/**
 * Create a system with calculation methods attached.
 *
 * @example
 * const s = Fugacity.system({ components: ["water", "acetic acid"], model: "NRTL" });
 * s.bubbleT([0.5, 0.5], 101.325)   // { T: 377.2, y: [...], gamma: [...] }
 */
export function system(cfg) {
  const sys = createSystem(cfg);
  if (sys.kind === "eos") return Object.assign(sys, eosMethods(sys)); // model "PR" or "SRK"
  return Object.assign(sys, {
    bubbleT: (x, P) => bubbleT(sys, x, P),
    bubbleP: (x, T) => bubbleP(sys, x, T),
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

export {
  mount, createSystem, listComponents, findComponent, MODELS,
  bubbleT, bubbleP, pureBoilingPoints, txy, pxy, ternaryGrid, residueCurve,
  binaryAzeotropes, findAzeotrope, isLiquidStable, checkPackage, validCas,
  pure, PROPERTIES, PROPERTY_NAMES,
  mountProperties,
  EOS_MODELS, cubicEos, eosBubbleP, eosBubbleT, eosDewP, eosDewT,
  henry, henryInfo, gasSolubility, HENRY_GASES,
  steam, steamSat,
};
