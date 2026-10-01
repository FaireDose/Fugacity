/**
 * Phase stability of a mixture described by an equation of state: Michelsen's
 * tangent-plane-distance test.
 *
 * M. L. Michelsen, The isothermal flash problem. Part I. Stability, Fluid Phase Equilib. 9
 * (1982) 1-19. Open descriptions: Penn State PNG 520 course notes, "The Stability
 * Criteria", https://courses.ems.psu.edu/png520/m17_p7.html (CC BY-NC-SA 4.0), and the
 * thermo library documentation (thermo.eos_mix.GCEOSMIX, stability_Michelsen and
 * _d_TPD_Michelson_modified, MIT).
 *
 * For a phase of composition z at T, P, with d_i = ln z_i + ln phi_i(z), a trial phase of
 * mole numbers W is iterated to a stationary point of the tangent plane distance by
 *   ln W_i = d_i - ln phi_i(w),   w = W / sum(W)
 * At a stationary point the modified tangent plane distance is tm = 1 - sum(W); tm < 0
 * means the phase z is unstable (it lowers its Gibbs energy by splitting). Trial phases
 * converging back to z (sum (ln(w_i / z_i))^2 < 1e-4) are trivial and ignored. For each
 * trial composition the root of the cubic with the lower Gibbs energy is used.
 *
 * Starting guesses: one near-pure trial phase per component (liquid-liquid splits) and
 * the Wilson vapour-like and liquid-like guesses z_i K_i and z_i / K_i.
 */
import { wilsonLnK } from "./phi-phi.js";

const TRIAL_TOL = 1e-11;
const MAX_IT = 300;

/** ln phi of the lower-Gibbs-energy root for composition w. */
function lnPhiMinG(eos, T, P, w) {
  const L = eos.state(T, P, w, "liquid");
  if (L.roots === 1) return { lnPhi: L.lnPhi, Z: L.Z, root: L.rootType };
  const V = eos.state(T, P, w, "vapour");
  const g = s => w.reduce((a, v, i) => a + (v > 0 ? v * s.lnPhi[i] : 0), 0);
  return g(L) <= g(V) ? { lnPhi: L.lnPhi, Z: L.Z, root: "liquid" } : { lnPhi: V.lnPhi, Z: V.Z, root: "vapour" };
}

/**
 * Tangent-plane stability test of phase `phase` ("liquid" or "vapour") of composition z.
 * @returns {{stable:boolean, tm:number, trial:number[]|null, trialRoot:string|null, tested:number}}
 *   tm: the most negative modified tangent plane distance found (0 if none below 0);
 *   trial: the normalized composition of that trial phase.
 */
export function tpdStability(eos, T, P, z, phase = "liquid", opts = {}) {
  const n = eos.n;
  const threshold = opts.threshold ?? -1e-6;
  const zs = eos.state(T, P, z, phase);
  const d = z.map((v, i) => (v > 0 ? Math.log(v) + zs.lnPhi[i] : -Infinity));
  const guesses = [];
  for (let k = 0; k < n; k++) {
    if (!(z[k] > 0)) continue;
    guesses.push(z.map((v, i) => (i === k ? 1 : v > 0 ? 1e-3 * v : 0)));
  }
  const lnKw = wilsonLnK(eos.comps, T, P);
  guesses.push(z.map((v, i) => v * Math.exp(lnKw[i])), z.map((v, i) => v * Math.exp(-lnKw[i])));

  let best = { tm: 0, trial: null, trialRoot: null };
  for (const g0 of guesses) {
    let W = g0.slice(), tm = null, root = null, w = null;
    for (let it = 0; it < MAX_IT; it++) {
      const S = W.reduce((a, b) => a + b, 0);
      w = W.map(v => v / S);
      const f = lnPhiMinG(eos, T, P, w);
      root = f.root;
      const Wn = d.map((di, i) => (Number.isFinite(di) ? Math.exp(di - f.lnPhi[i]) : 0));
      const change = Math.max(...Wn.map((v, i) => Math.abs(Math.log(v || 1e-300) - Math.log(W[i] || 1e-300))));
      W = Wn;
      if (change < TRIAL_TOL) break;
      // stop early on the trivial solution
      const triv = w.reduce((a, v, i) => a + (z[i] > 0 && v > 0 ? Math.log(v / z[i]) ** 2 : 0), 0);
      if (triv < 1e-8 && it > 3) break;
    }
    const S = W.reduce((a, b) => a + b, 0);
    w = W.map(v => v / S);
    const trivial = w.reduce((a, v, i) => a + (z[i] > 0 && v > 0 ? Math.log(v / z[i]) ** 2 : 0), 0) < 1e-4;
    if (trivial) continue;
    tm = 1 - S;
    if (tm < best.tm) best = { tm, trial: w, trialRoot: root };
  }
  return { stable: !(best.tm < threshold), ...best, tested: guesses.length };
}
