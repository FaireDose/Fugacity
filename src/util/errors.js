/**
 * Errors with a code (proposal 0001, section 5: "converge or throw").
 *
 * Every error the engine throws on purpose carries `code`, one of ERROR_CODES, and
 * optionally `details` (for example the last iterate of a solver). The message is written
 * for an engineer. Errors keep their class: range problems stay RangeErrors, so pages and
 * scripts that test `instanceof RangeError` or show `e.message` keep working, and
 * `e instanceof Fugacity.FugacityError` is true for all of them.
 *
 *   BAD_INPUT       the input is wrong: unknown name, wrong number of mole fractions,
 *                   negative pressure, a mistyped option
 *   OUT_OF_RANGE    the input is valid, but outside the range of the data or equation
 *   MISSING_DATA    a parameter or property needed for this calculation is not in the data
 *   NO_CONVERGENCE  a solver did not find a solution; the message says what was tried
 *   PHASE_SPLIT     the state splits into more phases than this calculation handles
 *                   (for example two liquids before the three-phase flash exists)
 *   NOT_AVAILABLE   the calculation does not exist for this model yet
 */

export const ERROR_CODES = Object.freeze([
  "BAD_INPUT", "OUT_OF_RANGE", "MISSING_DATA", "NO_CONVERGENCE", "PHASE_SPLIT", "NOT_AVAILABLE",
]);

const BRAND = Symbol.for("fugacity.error");

function brand(e, code, details) {
  if (!ERROR_CODES.includes(code)) throw new Error(`Internal: unknown error code "${code}".`);
  Object.defineProperty(e, BRAND, { value: true });
  e.code = code;
  if (details !== undefined) e.details = details;
  return e;
}

/**
 * The class to test against: `e instanceof FugacityError` is true for every error made by
 * `fail` or `failRange`, whatever its base class.
 */
export class FugacityError extends Error {
  constructor(code, message, details) {
    super(message);
    brand(this, code, details);
  }
  static [Symbol.hasInstance](obj) {
    return obj != null && obj[BRAND] === true;
  }
}

/** An Error with a code. Use as `throw fail("BAD_INPUT", "message")`. */
export function fail(code, message, details) {
  return brand(new Error(message), code, details);
}

/** A RangeError with a code, for errors that were RangeErrors before codes existed. */
export function failRange(code, message, details) {
  return brand(new RangeError(message), code, details);
}

/** True when e is a Fugacity error with the given code (or any code if none is given). */
export function isFugacityError(e, code) {
  return e instanceof FugacityError && (code == null || e.code === code);
}
