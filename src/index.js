/**
 * Fugacity: chemical process simulation that runs in the browser.
 *
 * Units in the programming interface: temperature in K, pressure in kPa,
 * compositions as mole fractions. The interfaces (mount, mountProperties, app) convert
 * for display (°C, bar, wt %).
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
import { app } from "./ui/app.js";
import { system } from "./system.js";
import { EOS_MODELS } from "./thermo/system.js";
import { eosBubbleP, eosBubbleT, eosDewP, eosDewT } from "./equilibrium/phi-phi.js";
import { cubicEos } from "./thermo/eos/cubic.js";
import { henry, henryInfo, gasSolubility, HENRY_GASES } from "./thermo/henry.js";
import { library } from "./thermo/library.js";
import pkg from "../package.json" with { type: "json" };

export const version = pkg.version;

export {
  system, app,
  mount, createSystem, listComponents, findComponent, MODELS,
  bubbleT, bubbleP, pureBoilingPoints, txy, pxy, ternaryGrid, residueCurve,
  binaryAzeotropes, findAzeotrope, isLiquidStable, checkPackage, validCas,
  pure, PROPERTIES, PROPERTY_NAMES,
  mountProperties,
  EOS_MODELS, cubicEos, eosBubbleP, eosBubbleT, eosDewP, eosDewT,
  henry, henryInfo, gasSolubility, HENRY_GASES,
  steam, steamSat,
  library,
};
