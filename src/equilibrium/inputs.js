/**
 * Input checks shared by the public equilibrium functions (proposal 0001, section 5).
 * Every check throws a BAD_INPUT error that says what is wrong, before any solver runs.
 */
import { fail, failRange } from "../util/errors.js";

/** Mole fractions slightly below zero from rounding (1 - 0.3 - 0.7) are taken as zero. */
const NEG_TOL = 1e-9;

/**
 * Check a composition and return it normalized to a sum of 1.
 * @param {number[]} z
 * @param {number} n  number of components of the system
 * @param {string} [what="Composition"]  name used in messages, e.g. "Vapour composition"
 * @returns {number[]}
 */
export function checkComposition(z, n, what = "Composition") {
  if (ArrayBuffer.isView(z)) z = Array.from(z); // Float64Array and the like
  if (!Array.isArray(z) || z.length !== n) {
    throw fail("BAD_INPUT", `${what}: give ${n} mole fractions${Array.isArray(z) ? ` (got ${z.length})` : ""}.`);
  }
  const v = z.map(toNumber);
  v.forEach((u, i) => {
    if (!Number.isFinite(u)) throw fail("BAD_INPUT", `${what}: mole fraction ${i + 1} is not a number (got ${JSON.stringify(z[i])}).`);
    if (u < -NEG_TOL) throw fail("BAD_INPUT", `${what}: mole fractions must not be negative (got ${u} for component ${i + 1}).`);
  });
  const c = v.map(u => Math.max(u, 0));
  const s = c.reduce((a, b) => a + b, 0);
  if (!(s > 0)) throw fail("BAD_INPUT", `${what}: the mole fractions must have a positive sum.`);
  return c.map(u => u / s);
}

/**
 * Numbers, and numeric strings such as the value of an input field ("101.325"), as before
 * these checks existed; anything else (empty string, "abc", null, an object) gives NaN.
 */
function toNumber(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return NaN;
}

/** Check a temperature in K; returns it as a number. */
export function checkTemperature(T, what = "Temperature") {
  const v = toNumber(T);
  if (!(Number.isFinite(v) && v > 0)) {
    throw failRange("BAD_INPUT", `${what} must be a positive number of kelvin (got ${JSON.stringify(T)}).`);
  }
  return v;
}

/** Check a pressure in kPa; returns it as a number. */
export function checkPressure(P, what = "Pressure") {
  const v = toNumber(P);
  if (!(Number.isFinite(v) && v > 0)) {
    throw failRange("BAD_INPUT", `${what} must be a positive number of kPa (got ${JSON.stringify(P)}).`);
  }
  return v;
}
