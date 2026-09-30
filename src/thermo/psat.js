/**
 * Pure-component vapour pressure.
 * DIPPR equation 101: ln(P/Pa) = A + B/T + C ln T + D T^E
 * @param {object} vp  the component's `vapourPressure` record
 * @param {number} T   temperature, K
 * @returns {number}   vapour pressure, Pa
 */
export function vapourPressure(vp, T) {
  if (vp.equation !== "DIPPR101") throw new Error(`Unknown vapour pressure equation ${vp.equation}`);
  return Math.exp(vp.A + vp.B / T + vp.C * Math.log(T) + vp.D * Math.pow(T, vp.E));
}
