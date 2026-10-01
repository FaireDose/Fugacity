/**
 * Temperature correlations for pure-component properties, in the DIPPR equation forms.
 *
 * The equation forms (not any coefficients) are those documented openly in:
 * - ChemSep book and pure-component database documentation, "Temperature correlations"
 *   (Kooijman & Taylor; http://www.chemsep.org/, Artistic License 2.0), equations 100-107.
 * - The open-source `chemicals` library (MIT), module chemicals.dippr, which implements
 *   EQ100, EQ101, EQ102, EQ104, EQ105, EQ106 and EQ107 with the same symbols.
 *
 * A record looks like
 *   { equation: "DIPPR105", coefficients: { A, B, C, D }, units: "kg/m3",
 *     Tmin_K, Tmax_K, tier, source: { ... } }
 * Coefficients that are not given are 0. DIPPR106 also needs `Tc_K` in the record.
 * The value is returned in the record's `units`; pure.js converts to engine units.
 */

const EQUATIONS = {
  // Y = A + B T + C T^2 + D T^3 + E T^4
  DIPPR100: (T, c) => c.A + T * (c.B + T * (c.C + T * (c.D + T * c.E))),
  // Y = exp(A + B/T + C ln T + D T^E)
  DIPPR101: (T, c) => Math.exp(c.A + c.B / T + c.C * Math.log(T) + c.D * Math.pow(T, c.E)),
  // Y = A T^B / (1 + C/T + D/T^2)
  DIPPR102: (T, c) => c.A * Math.pow(T, c.B) / (1 + c.C / T + c.D / (T * T)),
  // Y = A + B/T + C/T^3 + D/T^8 + E/T^9
  DIPPR104: (T, c) => c.A + c.B / T + c.C / T ** 3 + c.D / T ** 8 + c.E / T ** 9,
  // Y = A / B^(1 + (1 - T/C)^D)
  DIPPR105: (T, c) => c.A / Math.pow(c.B, 1 + Math.pow(1 - T / c.C, c.D)),
  // Y = A (1 - Tr)^(B + C Tr + D Tr^2 + E Tr^3),  Tr = T/Tc
  DIPPR106: (T, c, Tc) => {
    const r = T / Tc;
    return c.A * Math.pow(1 - r, c.B + r * (c.C + r * (c.D + r * c.E)));
  },
  // Y = A + B [(C/T)/sinh(C/T)]^2 + D [(E/T)/cosh(E/T)]^2   (Aly-Lee)
  DIPPR107: (T, c) => {
    const s = (c.C / T) / Math.sinh(c.C / T);
    const h = (c.E / T) / Math.cosh(c.E / T);
    return c.A + c.B * s * s + c.D * h * h;
  },
};

export const CORRELATION_EQUATIONS = Object.keys(EQUATIONS);

/**
 * Evaluate a correlation record at temperature T (K).
 * Outside [Tmin_K, Tmax_K] it throws, unless opts.extrapolate is true.
 * @param {object} rec
 * @param {number} T  K
 * @param {{extrapolate?: boolean}} [opts]
 * @returns {number}  value in rec.units
 */
export function evaluate(rec, T, opts = {}) {
  const f = EQUATIONS[rec.equation];
  if (!f) throw new Error(`Unknown correlation "${rec.equation}". Known: ${CORRELATION_EQUATIONS.join(", ")}.`);
  if (!(T > 0)) throw new RangeError(`Temperature must be positive (got ${T} K).`);
  if (!opts.extrapolate && ((rec.Tmin_K != null && T < rec.Tmin_K - 1e-9) || (rec.Tmax_K != null && T > rec.Tmax_K + 1e-9))) {
    throw new RangeError(`T = ${T.toFixed(2)} K is outside the range of this correlation (${rec.Tmin_K}-${rec.Tmax_K} K).`);
  }
  const c = { A: 0, B: 0, C: 0, D: 0, E: 0, ...rec.coefficients };
  if (rec.equation === "DIPPR106" && !(rec.Tc_K > 0)) throw new Error("DIPPR106 needs Tc_K in the record.");
  const y = f(T, c, rec.Tc_K);
  if (!Number.isFinite(y)) throw new RangeError(`Correlation ${rec.equation} gave a non-finite value at ${T} K.`);
  return y;
}
