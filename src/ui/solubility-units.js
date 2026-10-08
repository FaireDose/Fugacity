/**
 * Units of a solid solubility (Solubility workspace, Solid view). The engine gives the mole
 * fraction x of the solid in the saturated solution (src/equilibrium/sle.js); these are the
 * other ways a lab or plant states the same number:
 *
 *   mass fraction        w = x M1 / (x M1 + (1 − x) M2)
 *   g per 100 g solvent  100 · x M1 / ((1 − x) M2)
 *   g per L of solvent   ρ2(T) · x M1 / ((1 − x) M2)   (ρ2 in kg/m3 = g/L: the pure solvent's
 *                        saturated-liquid density at T, from its databank correlation; the
 *                        volume of the solvent before the solid is dissolved, not of the solution)
 *
 * M1, M2: molar masses of the solid and the solvent. Definitions only: no thermodynamics here.
 */

export const SOLID_UNITS = [
  { id: "mole", label: "mol frac", axis: "mole fraction", title: "Mole fraction of the solid in the saturated solution" },
  { id: "mass", label: "wt %", axis: "wt %", title: "Mass fraction of the solid in the saturated solution, %" },
  { id: "g100g", label: "g/100 g", axis: "g per 100 g solvent", title: "Grams of the solid dissolved per 100 g of solvent" },
  { id: "gL", label: "g/L", axis: "g per L solvent", title: "Grams of the solid dissolved per litre of solvent (pure solvent at the same temperature)" },
];

export const solidUnitIds = SOLID_UNITS.map(u => u.id);

/**
 * The solubility x (mole fraction of the solid) in another unit.
 * @param {string} unit   "mole" | "mass" (wt %, 0–100) | "g100g" | "gL"
 * @param {number} x      mole fraction of the solid, 0 ≤ x < 1
 * @param {number[]} MW   [solid, solvent] molar masses, g/mol
 * @param {number} [rho]  solvent liquid density at T, kg/m3 (needed for "gL")
 */
export function solidIn(unit, x, MW, rho) {
  if (unit === "mole") return x;
  const m1 = x * MW[0], m2 = (1 - x) * MW[1];
  if (unit === "mass") return 100 * m1 / (m1 + m2);
  if (unit === "g100g") return 100 * m1 / m2;
  if (unit === "gL") {
    if (!(rho > 0)) throw new Error("g/L needs the liquid density of the solvent at this temperature.");
    return rho * m1 / m2;
  }
  throw new Error(`Unknown solubility unit "${unit}". Known: ${solidUnitIds.join(", ")}.`);
}
