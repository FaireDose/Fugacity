/**
 * Vapour-phase models.
 *
 * Components are ideal gases unless they carry an `association` record of type
 * "dimer". Those follow the chemical theory: the vapour holds monomers A and
 * dimers A2 in equilibrium, p_A2 = K p_A^2. Cross-dimers between different
 * acids are not modelled.
 */

const MMHG_PER_KPA = 7.50062;

/**
 * Dimerization constant in 1/kPa.
 * @param {object} assoc  component `association` record
 * @param {number} T      K
 */
export function dimerK(assoc, T) {
  const K = Math.pow(10, assoc.log10K.A + assoc.log10K.B / T); // 1/mmHg
  if (assoc.K_unit !== "1/mmHg") throw new Error(`Unsupported K unit ${assoc.K_unit}`);
  return K * MMHG_PER_KPA;
}

/**
 * Monomer partial pressure of a pure associating vapour at total pressure P.
 * P = p1 + K p1^2  ->  p1 = (-1 + sqrt(1 + 4 K P)) / (2 K)
 * @param {number} P  kPa
 * @param {number} K  1/kPa
 */
export function monomerPressure(P, K) {
  return (-1 + Math.sqrt(1 + 4 * K * P)) / (2 * K);
}
