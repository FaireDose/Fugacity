/**
 * Flash for every model (proposal 0001): vapour + liquid (step 4); with activity models also
 * two liquids and vapour + two liquids (step 5).
 *
 *   sys.flash({ z, T, P })     isothermal flash
 *   sys.flash({ z, P, H })     given enthalpy (J/mol of feed): adiabatic flash, valve
 *   sys.flash({ z, P, VF })    given vapour fraction (0 = bubble point, 1 = dew point)
 *   sys.flash({ z, T, VF })
 * Options: { feed: { T, P } } adds the heat duty, Q = H_out - H_feed (J per mol of feed),
 * with H_feed the enthalpy of the same feed flashed at its own T and P. A heater with a
 * given duty is the P-H flash with H = H_feed + Q.
 *
 * Method (standard; open descriptions in the `chemicals` library documentation,
 * chemicals.rachford_rice, and the `thermo` library, thermo.flash.FlashVL, both MIT):
 *  - Rachford-Rice: sum z_i (K_i - 1) / (1 + V (K_i - 1)) = 0, solved by Newton steps kept
 *    inside the bracket (1/(1 - K_max), 1/(1 - K_min)) with bisection as a fallback;
 *  - K-values by successive substitution.
 *    Activity models: K_i = gamma_i P_i^sat phi_i^sat Poynting_i / (phi_i^V(y) P)
 *    (sys.lnKValues; all corrections 1 for the ideal-gas vapour). With the acid chemical
 *    theory, K_i = y_i(x) / x_i * P_bub(x) / P instead, with P_bub(x) and y(x) the bubble
 *    pressure and vapour of liquid x (sys.equilibrium): at the fixed point sum K_i x_i = 1,
 *    hence P_bub(x) = P, so the liquid is at its bubble point at P and y is its vapour.
 *    Equations of state: K_i = phi_i^L(x) / phi_i^V(y), started from Wilson's K-values.
 *  - Which phases exist: activity models compare P with the bubble and dew pressures of the
 *    feed at T; equations of state use Michelsen's tangent-plane test on the feed
 *    (eos-stability.js). Every liquid returned is checked with the tangent-plane test against
 *    a second liquid (stability.js liquidTangentPlane for activity models, eos-stability.js
 *    for equations of state).
 *  - Two liquids (activity models without the acid chemical theory; resolveSplit): the
 *    liquid-liquid split by successive substitution on K_i = gamma_i(x1) / gamma_i(x2), then
 *    the bubble pressure P3 of those liquids decides: P >= P3 gives two liquids; below it a
 *    binary has vapour + one liquid (Gibbs' phase rule: vapour + two liquids only at P3), and
 *    three or more components have vapour + two liquids (splitThree: successive substitution
 *    on the K-values of the vapour and of liquid 2 relative to liquid 1, with the convex
 *    phase-fraction function of Okuno, Johns and Sepehrnoori, multiphaseRR). For a binary the
 *    flash jumps at the three-phase temperature (at given P) or pressure (at given T); the
 *    P-H, P-VF and T-VF flashes find that point directly (P3(T) = P) and split the feed over
 *    the three phases by the lever rule with the vapour fraction or the energy balance.
 *    Still refused (PHASE_SPLIT): two liquids with the acid chemical theory or with an
 *    equation of state, and a third liquid.
 *  - Enthalpy and vapour-fraction specifications: Brent's method on T (or ln P), bracketed
 *    by the bubble and dew points; for a single phase, a bracket stepped out from them; for a
 *    P-H flash without bubble and dew points at that pressure (above the highest two-phase
 *    pressure), a bracket of T-P flashes stepped out from 300 K.
 *  - Not done (yet): Newton steps near a mixture critical point, where successive
 *    substitution is slow (the flash then stops with NO_CONVERGENCE), and a "supercritical"
 *    label: a single phase is called liquid or vapour by its root (equations of state).
 * Errors carry codes (util/errors.js); the mass balance closes to 1e-10 (checked).
 *
 * Units: T in K, P in kPa, enthalpy in J/mol, mole fractions.
 */
import { brent } from "../util/solve.js";
import { fail, failRange } from "../util/errors.js";
import { checkComposition, checkPressure, checkTemperature } from "../util/inputs.js";
import { bubbleTCore } from "./bubble.js";
import { dewP, dewT } from "./dew.js";
import { liquidTangentPlane } from "./stability.js";
import { tpdStability } from "./eos-stability.js";
import { wilsonLnK, eosBubbleT, eosDewT, eosBubbleP, eosDewP } from "./phi-phi.js";

const K_TOL = 1e-11;   // max |ln K_new - ln K| at convergence
// Below this width (K) the two-phase region is one temperature (a pure component or an
// azeotrope): the bubble and dew solvers agree only to their own tolerance there.
const NARROW_K = 1e-4;
const MAX_IT = 500;

// ------------------------------------------------------------------ Rachford-Rice

/** Vapour fraction V for feed z and K-values K (may lie outside [0, 1]: negative flash). */
export function rachfordRice(z, K) {
  let kmax = -Infinity, kmin = Infinity;
  for (let i = 0; i < z.length; i++) if (z[i] > 0) { kmax = Math.max(kmax, K[i]); kmin = Math.min(kmin, K[i]); }
  if (!(kmax > 1 && kmin < 1)) return kmax <= 1 ? -Infinity : Infinity; // all K on one side of 1
  let lo = 1 / (1 - kmax), hi = 1 / (1 - kmin);
  const f = V => { let s = 0; for (let i = 0; i < z.length; i++) if (z[i] > 0) s += z[i] * (K[i] - 1) / (1 + V * (K[i] - 1)); return s; };
  const df = V => { let s = 0; for (let i = 0; i < z.length; i++) if (z[i] > 0) { const d = K[i] - 1, q = 1 + V * d; s -= z[i] * d * d / (q * q); } return s; };
  let V = Math.min(Math.max(0.5, lo + 1e-12 * (hi - lo)), hi - 1e-12 * (hi - lo));
  for (let it = 0; it < 200; it++) {
    const fv = f(V);
    if (fv > 0) lo = V; else hi = V; // f decreases with V
    let Vn = V - fv / df(V);
    if (!(Vn > lo && Vn < hi)) Vn = 0.5 * (lo + hi);
    if (Math.abs(Vn - V) < 1e-15 * Math.max(1, Math.abs(V))) return Vn;
    V = Vn;
  }
  return V;
}

/**
 * Phase fractions of several phases: minimum of the convex function of Okuno, Johns and
 * Sepehrnoori (SPE J. 15 (2010) 141; open description: thermo library documentation,
 * chemicals.rachford_rice.Rachford_Rice_solutionN, MIT)
 *     F(beta) = sum_j beta_j - sum_i z_i ln t_i,   t_i = sum_j beta_j K_ji,   beta_j >= 0,
 * with K_ji = (mole fraction of i in phase j) / (mole fraction of i in the reference phase),
 * K_0i = 1. At the minimum every phase composition sums to 1 and the mass balance holds.
 * Projected Newton steps with a line search.
 * @param {number[]} z
 * @param {number[][]} Ks  K_ji for every phase j (the first is the reference, all ones)
 * @returns {{beta:number[], x:number[][]}}  phase fractions and compositions
 */
export function multiphaseRR(z, Ks) {
  const m = Ks.length, n = z.length;
  let beta = new Array(m).fill(1 / m);
  const tOf = b => z.map((_, i) => Ks.reduce((a, K, j) => a + b[j] * K[i], 0));
  const F = b => { const t = tOf(b); if (t.some((v, i) => z[i] > 0 && !(v > 0))) return Infinity; return b.reduce((a, v) => a + v, 0) - z.reduce((a, zi, i) => a + (zi > 0 ? zi * Math.log(t[i]) : 0), 0); };
  for (let it = 0; it < 200; it++) {
    const t = tOf(beta);
    const g = Ks.map(K => 1 - z.reduce((a, zi, i) => a + (zi > 0 ? zi * K[i] / t[i] : 0), 0));
    const free = beta.map((b, j) => b > 0 || g[j] < 0);
    const idx = free.map((f, j) => (f ? j : -1)).filter(j => j >= 0);
    let gmax = 0;
    for (const j of idx) gmax = Math.max(gmax, Math.abs(g[j]));
    if (gmax < 1e-14) break;
    // Newton step on the free fractions
    const k = idx.length;
    const A = idx.map(a => idx.map(b => z.reduce((s, zi, i) => s + (zi > 0 ? zi * Ks[a][i] * Ks[b][i] / (t[i] * t[i]) : 0), 0)));
    // the Hessian is singular when there are more phases than components (Gibbs' phase rule):
    // a small multiple of the identity keeps the step defined
    const tr = A.reduce((a, row, q) => a + row[q], 0) / Math.max(k, 1);
    A.forEach((row, q) => { row[q] += 1e-10 * tr + 1e-300; });
    const rhs = idx.map(j => -g[j]);
    for (let c = 0; c < k; c++) { // Gaussian elimination with partial pivoting
      let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]]; [rhs[c], rhs[p]] = [rhs[p], rhs[c]];
      for (let r = c + 1; r < k; r++) { const f = A[r][c] / A[c][c]; for (let q = c; q < k; q++) A[r][q] -= f * A[c][q]; rhs[r] -= f * rhs[c]; }
    }
    const d = new Array(k).fill(0);
    for (let c = k - 1; c >= 0; c--) { let v = rhs[c]; for (let q = c + 1; q < k; q++) v -= A[c][q] * d[q]; d[c] = v / A[c][c]; }
    const F0 = F(beta);
    const search = dir => {
      let alpha = 1;
      for (let ls = 0; ls < 60; ls++) {
        const b = beta.slice();
        idx.forEach((j, q) => { b[j] = Math.max(0, beta[j] + alpha * dir[q]); });
        const Fb = F(b);
        if (Fb <= F0 - 1e-16 * Math.abs(F0) || (Fb <= F0 && alpha < 1e-12)) return b;
        alpha /= 2;
      }
      return null;
    };
    let next = d.every(Number.isFinite) ? search(d) : null;
    if (!next) next = search(idx.map(j => -g[j])); // steepest descent
    if (!next) break;
    const moved = next.reduce((a, v, j) => Math.max(a, Math.abs(v - beta[j])), 0);
    beta = next;
    if (moved < 1e-16) break;
  }
  const t = tOf(beta);
  const xref = z.map((zi, i) => zi / t[i]);
  const x = Ks.map(K => { const v = xref.map((xi, i) => xi * K[i]); const sv = v.reduce((a, b) => a + b, 0); return v.map(q => q / sv); });
  return { beta, x };
}

const phaseCompositions = (z, K, V) => {
  const x = z.map((zi, i) => zi / (1 + V * (K[i] - 1)));
  const sx = x.reduce((a, b) => a + b, 0);
  const y = x.map((xi, i) => xi * K[i]);
  const sy = y.reduce((a, b) => a + b, 0);
  return { x: x.map(v => v / sx), y: y.map(v => v / sy) };
};

// ------------------------------------------------------------------ isothermal two-phase split

/** Activity models: two-phase split at T, P from a starting K. */
function splitActivity(sys, z, T, P, K) {
  for (let it = 1; it <= MAX_IT; it++) {
    const V = rachfordRice(z, K);
    const { x, y } = phaseCompositions(z, K, Math.min(Math.max(V, -1e3), 1e3));
    let Kn;
    if (sys.lnKValues) Kn = sys.lnKValues(x, y, T, P).map(Math.exp);
    else {
      const e = sys.equilibrium(x, T);
      Kn = x.map((xi, i) => (e.y[i] / Math.max(xi, 1e-300)) * e.P / P);
    }
    let d = 0;
    for (let i = 0; i < z.length; i++) if (z[i] > 0) d = Math.max(d, Math.abs(Math.log(Kn[i] / K[i])));
    K = Kn;
    if (d < K_TOL) {
      const Vf = rachfordRice(z, K);
      const pc = phaseCompositions(z, K, Vf);
      return { V: Vf, x: pc.x, y: pc.y, iterations: it, K };
    }
  }
  throw fail("NO_CONVERGENCE", `Flash at ${T.toFixed(2)} K and ${P.toPrecision(6)} kPa: the K-values did not converge in ${MAX_IT} steps.`, { z, T, P, K });
}

/** Equations of state: two-phase split at T, P from a starting K. */
function splitEos(sys, z, T, P, K) {
  const eos = sys.eos;
  for (let it = 1; it <= MAX_IT; it++) {
    const V = rachfordRice(z, K);
    const { x, y } = phaseCompositions(z, K, Math.min(Math.max(V, -1e3), 1e3));
    const L = eos.state(T, P, x, "liquid").lnPhi, G = eos.state(T, P, y, "vapour").lnPhi;
    const Kn = L.map((v, i) => Math.exp(v - G[i]));
    let d = 0, trivial = 0;
    for (let i = 0; i < z.length; i++) if (z[i] > 0) { d = Math.max(d, Math.abs(Math.log(Kn[i] / K[i]))); trivial += Math.log(Kn[i]) ** 2; }
    K = Kn;
    if (trivial < 1e-10) return null; // K -> 1: the phases became identical
    if (d < K_TOL) {
      const Vf = rachfordRice(z, K);
      const pc = phaseCompositions(z, K, Vf);
      return { V: Vf, x: pc.x, y: pc.y, iterations: it, K };
    }
  }
  throw fail("NO_CONVERGENCE", `Flash at ${T.toFixed(2)} K and ${P.toPrecision(6)} kPa: the K-values did not converge in ${MAX_IT} steps (near a critical point?).`, { z, T, P, K });
}

const isEos = sys => sys.kind === "eos";

/** Throw PHASE_SPLIT if liquid x at T would split into two liquids (tangent-plane test). */
function checkLiquid(sys, x, T, lead, P = null) {
  if (sys.n < 2) return;
  if (isEos(sys)) {
    const st = tpdStability(sys.eos, T, P, x, "liquid");
    if (!st.stable && st.trialRoot && st.trialRoot.startsWith("liquid")) {
      throw fail("PHASE_SPLIT", `${lead} splits into two liquid phases (tangent-plane distance ${st.tm.toFixed(3)}); two liquids are not supported yet with an equation of state (only with NRTL and UNIQUAC).`, { x, T });
    }
    return;
  }
  const st = liquidTangentPlane(sys, x, T);
  if (!st.stable) {
    const tr = st.trial.map(v => v.toPrecision(3)).join(", ");
    throw fail("PHASE_SPLIT", `${lead} would split into two liquids (tangent-plane distance ${st.tm.toFixed(3)}, second liquid about [${tr}]); two liquids need an activity model without the acid chemical theory.`, { x, T, trial: st.trial });
  }
}

/** Root of lower Gibbs energy for feed z (equations of state). */
function minGRoot(eos, T, P, z) {
  const L = eos.state(T, P, z, "liquid");
  if (L.roots === 1) return L.rootType.startsWith("liquid") ? "liquid" : "vapour";
  const V = eos.state(T, P, z, "vapour");
  const g = s => z.reduce((a, v, i) => a + (v > 0 ? v * s.lnPhi[i] : 0), 0);
  return g(L) <= g(V) ? "liquid" : "vapour";
}

const richLabel = (sys, x) => `${sys.names[x.indexOf(Math.max(...x))]}-rich`;

/**
 * Vapour + two liquids at T, P for activity models (successive substitution on K-values
 * relative to liquid 1, multiphaseRR for the fractions): K_V = sys.lnKValues(x1, y), K_L2 =
 * gamma_i(x1) / gamma_i(x2). Phases whose fraction goes to 0 drop out, so the result may be
 * vapour + liquid or two liquids. Returns a core, or null if the two liquids became one.
 */
function splitThree(sys, z, T, P, KV, KL2) {
  const n = z.length;
  let prev = null; // the previous step in ln K, for the acceleration
  for (let it = 1; it <= MAX_IT; it++) {
    const { x } = multiphaseRR(z, [z.map(() => 1), KV, KL2]);
    const [x1, y, x2] = x;
    const KVn = sys.lnKValues(x1, y, T, P).map(Math.exp);
    const g1 = sys.gammas(x1, T), g2 = sys.gammas(x2, T);
    const KL2n = g1.map((v, i) => v / g2[i]);
    let d = 0, triv = 0;
    for (let i = 0; i < n; i++) if (z[i] > 0) {
      d = Math.max(d, Math.abs(Math.log(KVn[i] / KV[i])), Math.abs(Math.log(KL2n[i] / KL2[i])));
      triv += Math.log(KL2n[i]) ** 2;
    }
    // Dominant-eigenvalue acceleration of successive substitution (Crowe and Nishio, AIChE J.
    // 21 (1975) 528; as used by Michelsen for the flash): every fifth step, extrapolate ln K
    // along the step by lambda / (1 - lambda), lambda = (step . previous) / (previous . previous).
    const step = [...KVn.map((v, i) => Math.log(v / KV[i])), ...KL2n.map((v, i) => Math.log(v / KL2[i]))];
    if (prev && it % 5 === 0) {
      const dot = (a, b) => a.reduce((q, v, i) => q + (Number.isFinite(v) && Number.isFinite(b[i]) ? v * b[i] : 0), 0);
      const lam = dot(step, prev) / dot(prev, prev);
      if (lam > 0 && lam < 0.98) {
        const f = lam / (1 - lam);
        for (let i = 0; i < n; i++) { KVn[i] *= Math.exp(f * step[i]); KL2n[i] *= Math.exp(f * step[n + i]); }
      }
    }
    prev = step;
    KV = KVn; KL2 = KL2n;
    if (triv < 1e-10) return null;
    if (d < K_TOL) {
      const f = multiphaseRR(z, [z.map(() => 1), KV, KL2]);
      const [b1, bV, b2] = f.beta, [l1, v, l2] = f.x;
      const tiny = 1e-12;
      const Ks = { KV, KL2 };
      if (b2 < tiny) return { V: bV, x: l1, y: v, single: bV < tiny ? "liquid" : null, iterations: it, Ks };
      if (b1 < tiny) return { V: bV, x: l2, y: v, single: bV < tiny ? "liquid" : null, iterations: it, Ks };
      return { V: bV < tiny ? 0 : bV, x: l1, y: v, liquid2: { fraction: b2, x: l2 }, single: null, iterations: it, K: null, Ks };
    }
  }
  throw fail("NO_CONVERGENCE", `Three-phase flash at ${T.toFixed(2)} K and ${P.toPrecision(6)} kPa: the K-values did not converge in ${MAX_IT} steps.`, { z, T, P });
}

/**
 * Two liquids at T (activity models: independent of P): successive substitution on
 * K_i = gamma_i(x1) / gamma_i(x2) with the two-phase Rachford-Rice equation (beta = fraction of
 * liquid 2; a negative flash when z lies outside the two-liquid region, which still gives the
 * two liquids of the binodal), with the dominant-eigenvalue acceleration of splitThree.
 * Returns { beta, x1, x2, K, iterations }, or null if the two liquids become one.
 */
function splitLL(sys, z, T, K) {
  const n = z.length;
  let prev = null;
  for (let it = 1; it <= MAX_IT; it++) {
    const beta = rachfordRice(z, K);
    if (!Number.isFinite(beta)) return null;
    const { x: x1, y: x2 } = phaseCompositions(z, K, Math.min(Math.max(beta, -1e3), 1e3));
    const g1 = sys.gammas(x1, T), g2 = sys.gammas(x2, T);
    const Kn = g1.map((v, i) => v / g2[i]);
    const step = Kn.map((v, i) => Math.log(v / K[i]));
    let d = 0, triv = 0;
    for (let i = 0; i < n; i++) if (z[i] > 0) { d = Math.max(d, Math.abs(step[i])); triv += Math.log(Kn[i]) ** 2; }
    if (triv < 1e-10) return null;
    if (d < K_TOL) {
      const b = rachfordRice(z, Kn), pc = phaseCompositions(z, Kn, b);
      return { beta: b, x1: pc.x, x2: pc.y, K: Kn, iterations: it };
    }
    if (prev && it % 5 === 0) {
      const lam = step.reduce((a, v, i) => a + (z[i] > 0 ? v * prev[i] : 0), 0) / prev.reduce((a, v, i) => a + (z[i] > 0 ? v * v : 0), 0);
      if (lam > 0 && lam < 0.98) { const f = lam / (1 - lam); for (let i = 0; i < n; i++) Kn[i] *= Math.exp(f * step[i]); }
    }
    prev = step;
    K = Kn;
  }
  throw fail("NO_CONVERGENCE", `Liquid-liquid split at ${T.toFixed(2)} K: the K-values did not converge in ${MAX_IT} steps (near a plait point?).`, { z, T });
}

const llCore = (sys, ll, iterations) => ({
  V: 0, x: ll.x1, y: null, liquid2: { fraction: ll.beta, x: ll.x2 }, single: null, iterations,
  labels: [richLabel(sys, ll.x1), richLabel(sys, ll.x2)],
});

/**
 * The liquid lx (the feed, or the liquid of a vapour-liquid split; y its vapour, Pbub its
 * bubble pressure if known) is not stable as one liquid (tangent-plane result st): find the
 * phases that are (activity models without the acid chemical theory), else throw PHASE_SPLIT.
 *  1. The two liquids of the binodal through lx and the second liquid of the test (splitLL, of
 *     the feed if the feed splits), and the pressure P3 at which they boil (both give the same
 *     vapour y3: they are in equilibrium).
 *  2. A feed that splits, at P >= P3: two liquids.
 *  3. A binary below P3 (or with a stable feed): vapour and one liquid, started from the
 *     three-phase K-values on the liquid that remains there: at the three-phase pressure the
 *     phase in the middle of the three compositions exists on one side only (Gibbs' phase rule;
 *     for a heterogeneous azeotrope the vapour, so below P3 the liquid on the feed's side of y3).
 *  4. Otherwise (three or more components): vapour + two liquids by splitThree.
 */
function resolveSplit(sys, z, T, P, lx, y, Pbub, st, lead, ctx = {}) {
  const tr = st.trial.map(v => v.toPrecision(3)).join(", ");
  if (!sys.lnKValues) {
    throw fail("PHASE_SPLIT", `${lead} would split into two liquids (tangent-plane distance ${st.tm.toFixed(3)}, second liquid about [${tr}]); the three-phase flash needs an activity model without the acid chemical theory.`, { x: lx, T, trial: st.trial });
  }
  if (lx !== z) {
    // the liquid of a vapour-liquid split splits: perhaps the feed itself does
    const sf = liquidTangentPlane(sys, z, T);
    if (!sf.stable) return resolveSplit(sys, z, T, P, z, null, null, sf, lead, ctx);
  }
  const feedSplits = lx === z;
  const binary = z.filter(v => v > 0).length === 2;
  let KV = lx.map((xi, i) => (y ? y[i] / Math.max(xi, 1e-300) * (Pbub ?? P) / P : 1));
  let KL2 = lx.map((xi, i) => Math.max(st.trial[i], 1e-300) / Math.max(xi, 1e-300));
  let x1 = lx;
  if (feedSplits || binary) {
    const base = feedSplits ? z : lx.map((v, i) => 0.5 * (v + st.trial[i]));
    let ll = null;
    if (ctx.ll) { try { ll = splitLL(sys, base, T, ctx.ll.slice()); } catch (e) { if (!(e && e.code === "NO_CONVERGENCE")) throw e; } }
    if (!ll) ll = splitLL(sys, base, T, KL2);
    if (ll) {
      ctx.ll = ll.K;
      const e3 = sys.equilibrium(ll.x1, T); // P3 and y3
      if (feedSplits && P >= e3.P && ll.beta > 0 && ll.beta < 1) return llCore(sys, ll, ll.iterations);
      x1 = ll.x1; KL2 = ll.K;
      KV = ll.x1.map((xi, i) => e3.y[i] / Math.max(xi, 1e-300) * e3.P / P);
      if (binary) {
        const c = z.findIndex(v => v > 0); // compare compositions on one component
        const [a, b, v3, zc] = [ll.x1[c], ll.x2[c], e3.y[c], z[c]];
        let useA;
        if ((v3 - a) * (v3 - b) < 0) useA = (zc - v3) * (a - v3) > 0;          // vapour in the middle
        else if (P < e3.P) useA = Math.abs(a - v3) > Math.abs(b - v3);          // the outer liquid
        else useA = Math.abs(zc - a) < Math.abs(zc - b);
        const xl = useA ? ll.x1 : ll.x2;
        const K0 = xl.map((xi, i) => e3.y[i] / Math.max(xi, 1e-300) * e3.P / P);
        const r = splitActivity(sys, z, T, P, K0);
        if (r.V >= 1) return { V: 1, x: r.x, y: z, single: "vapour", iterations: ll.iterations + r.iterations };
        if (r.V <= 0) {
          if (!liquidTangentPlane(sys, z, T).stable) throw fail("NO_CONVERGENCE", `${lead}: no stable vapour-liquid or liquid-liquid state was found.`, { z, T, P });
          return { V: 0, x: z, y: e3.y, single: "liquid", iterations: ll.iterations + r.iterations };
        }
        if (!liquidTangentPlane(sys, r.x, T).stable) throw fail("NO_CONVERGENCE", `${lead}: the vapour-liquid split below the three-phase pressure (${e3.P.toPrecision(6)} kPa) still has a liquid that splits.`, { z, T, P });
        ctx.K = r.K;
        return { ...r, single: null, iterations: ll.iterations + r.iterations };
      }
    }
  }
  // three or more components: vapour + two liquids, warm-started in loops
  let r = null;
  if (ctx.three) {
    try { r = splitThree(sys, z, T, P, ctx.three.KV.slice(), ctx.three.KL2.slice()); } catch (e) { if (!(e && e.code === "NO_CONVERGENCE")) throw e; }
    if (r && !r.liquid2) r = null;
  }
  if (!r) r = splitThree(sys, z, T, P, KV, KL2);
  if (!r) throw fail("NO_CONVERGENCE", `${lead} is not stable as one liquid, but the two-liquid split converged back to one liquid.`, { x: x1, T });
  const st1 = liquidTangentPlane(sys, r.x, T);
  if (!st1.stable) {
    if (!r.liquid2) throw fail("NO_CONVERGENCE", `${lead} is not stable as one liquid, but the three-phase iteration lost the second liquid.`, { x: r.x, T });
    throw fail("PHASE_SPLIT", `${lead}: even with two liquids a further liquid would split off; more than two liquids are not supported.`, { x: r.x, T });
  }
  if (r.liquid2) {
    r.labels = [richLabel(sys, r.x), richLabel(sys, r.liquid2.x)];
    ctx.three = r.Ks;
  }
  return r;
}

/**
 * Isothermal flash, no enthalpy: { V, x, y, single: "liquid"|"vapour"|null, iterations }.
 * Throws PHASE_SPLIT when the liquid is not stable as one liquid.
 * ctx (optional, for loops over T or P): ctx.K warm-starts the K-values and is updated with
 * the converged ones; ctx.check = false skips the liquid tangent-plane test (the caller
 * then tests the final result).
 */
function tpCore(sys, z, T, P, ctx = {}) {
  const what = `${sys.model} flash at ${T.toFixed(2)} K and ${P.toPrecision(6)} kPa`;
  const check = ctx.check !== false;
  if (isEos(sys)) {
    const root = minGRoot(sys.eos, T, P, z);
    const st = tpdStability(sys.eos, T, P, z, root);
    if (st.stable) return { V: root === "vapour" ? 1 : 0, x: z, y: z, single: root, iterations: 0 };
    let r = ctx.K ? splitEos(sys, z, T, P, ctx.K) : null;
    if (!r || !(r.V > 0 && r.V < 1)) r = splitEos(sys, z, T, P, wilsonLnK(sys.eos.comps, T, P).map(Math.exp));
    if (!r && st.trial) {
      // start from the trial phase of the stability test
      const K = z.map((v, i) => (v > 0 ? (st.trialRoot?.startsWith("vapour") ? st.trial[i] / v : v / Math.max(st.trial[i], 1e-300)) : 1));
      r = splitEos(sys, z, T, P, K);
    }
    if (!r || !(r.V >= -1e-9 && r.V <= 1 + 1e-9)) {
      throw fail("NO_CONVERGENCE", `${what}: the feed is not stable as one phase (tangent-plane distance ${st.tm.toFixed(4)}), but no vapour-liquid split was found; it may split into two liquids, which is not supported yet with an equation of state.`, { z, T, P });
    }
    if (check) checkLiquid(sys, r.x, T, `${what}: the liquid`, P);
    ctx.K = r.K;
    return { ...r, V: Math.min(Math.max(r.V, 0), 1), single: null };
  }
  // activity models: compare P with the bubble pressure of the feed
  const bub = sys.equilibrium(z, T);
  if (P >= bub.P) {
    if (check && sys.n > 1) {
      const st = liquidTangentPlane(sys, z, T);
      if (!st.stable) return resolveSplit(sys, z, T, P, z, bub.y, bub.P, st, `${what}: the feed liquid`, ctx);
    }
    return { V: 0, x: z, y: bub.y, single: "liquid", iterations: 0 };
  }
  // Below the bubble pressure: split from warm K-values or from those of the bubble point.
  // A converged split with V >= 1 (the negative flash) means a superheated vapour; only when
  // the iteration does not converge does the dew pressure decide (it costs more).
  let r = null;
  for (const K0 of [ctx.K, z.map((zi, i) => bub.y[i] / Math.max(zi, 1e-300) * bub.P / P)]) {
    if (!K0) continue;
    try { r = splitActivity(sys, z, T, P, K0); } catch (e) { if (!(e && e.code === "NO_CONVERGENCE")) throw e; r = null; }
    if (r) break;
  }
  if (r && r.V >= 1) return { V: 1, x: r.x, y: z, single: "vapour", iterations: r.iterations };
  if (!r || !(r.V > 0)) {
    const dew = dewP(sys, z, T);
    if (P <= dew.P) return { V: 1, x: dew.x, y: z, single: "vapour", iterations: 0 };
    // start between the bubble (V = 0) and dew (V = 1) points
    const w = Math.log(bub.P / P) / Math.log(bub.P / dew.P);
    const K = z.map((zi, i) => {
      const Kb = bub.y[i] / Math.max(zi, 1e-300) * bub.P / P, Kd = zi / Math.max(dew.x[i], 1e-300) * dew.P / P;
      return Math.exp((1 - w) * Math.log(Kb) + w * Math.log(Kd));
    });
    r = splitActivity(sys, z, T, P, K);
  }
  if (check && sys.n > 1) {
    if (!(r.V > 0)) {
      // no vapour after all: the feed is a liquid, perhaps two
      const st = liquidTangentPlane(sys, z, T);
      if (!st.stable) return resolveSplit(sys, z, T, P, z, bub.y, bub.P, st, `${what}: the feed liquid`, ctx);
      return { V: 0, x: z, y: bub.y, single: "liquid", iterations: r.iterations };
    }
    const st = liquidTangentPlane(sys, r.x, T);
    if (!st.stable) return resolveSplit(sys, z, T, P, r.x, r.y, null, st, `${what}: the liquid of the vapour-liquid split`, ctx);
  }
  ctx.K = r.K;
  return { ...r, V: Math.min(Math.max(r.V, 0), 1), single: null };
}

// ------------------------------------------------------------------ enthalpy and results

/** Phase enthalpies and the total; null (with a note) when enthalpy is not available. */
function withEnthalpy(sys, core, T, P) {
  const notes = [];
  const phases = [];
  let H = 0, available = true;
  const add = (type, fraction, comp) => {
    let h = null;
    try { const st = sys.phase(type, T, P, comp); h = st.h_J_mol; notes.push(...st.warnings.filter(w => !notes.includes(w))); } catch (e) {
      if (e && e.code === "NOT_AVAILABLE") { available = false; if (!notes.includes(e.message)) notes.push(e.message); } else throw e;
    }
    phases.push({ type, fraction, composition: comp, h_J_mol: h });
    if (h !== null) H += fraction * h;
  };
  if (core.single === "liquid") add("liquid", 1, core.x);
  else if (core.single === "vapour") add("vapour", 1, core.y);
  else {
    const f2 = core.liquid2 ? core.liquid2.fraction : 0;
    if (core.V > 0 || !core.liquid2) add("vapour", core.V, core.y);
    add("liquid", 1 - core.V - f2, core.x);
    if (core.liquid2) add("liquid", f2, core.liquid2.x);
    if (core.labels) phases.filter(p => p.type === "liquid").forEach((p, k) => { p.label = core.labels[k]; });
  }
  return { phases, H: available ? H : null, notes };
}

function sourcesOf(sys) {
  const out = [];
  for (const p of [...(sys.info.pairs ?? []), ...(sys.info.vapourPairs ?? [])]) {
    out.push({ pair: p.pair, set: p.set ?? null, tier: p.tier, source: p.source ?? null, source_ids: p.source_ids ?? [] });
  }
  return out;
}

function result(sys, spec, z, T, P, core, extra = {}) {
  const e = withEnthalpy(sys, core, T, P);
  // mass balance check
  const V = core.single === "vapour" ? 1 : core.single === "liquid" ? 0 : core.V;
  if (core.single === null) {
    const err = z.reduce((m, zi, i) => Math.max(m, Math.abs(e.phases.reduce((a, ph) => a + ph.fraction * ph.composition[i], 0) - zi)), 0);
    if (err > 1e-10) throw fail("NO_CONVERGENCE", `${sys.model} flash: the mass balance does not close (${err.toExponential(2)}).`, { z, T, P });
  }
  const warnings = [...new Set([...(sys.warnings ? sys.warnings(T, P) : []), ...e.notes])];
  return {
    spec, T, P, VF: V, H_J_mol: e.H, phases: e.phases,
    iterations: core.iterations, warnings, sources: sourcesOf(sys), ...extra,
  };
}

// ------------------------------------------------------------------ the flash

// bubble and dew points of the feed; null (before the dew point, which costs more) when
// `splits` says that the feed at its bubble point splits into two liquids
function pressureBubbleDew(sys, z, T, splits = () => false) {
  const b = isEos(sys) ? eosBubbleP(sys, z, T) : { ...sys.equilibrium(z, T) };
  if (splits(T)) return null;
  const d = isEos(sys) ? eosDewP(sys, z, T) : dewP(sys, z, T);
  return { Pb: b.P, Pd: d.P, yb: b.y, xd: d.x };
}
function temperatureBubbleDew(sys, z, P, splits = () => false) {
  const b = isEos(sys) ? eosBubbleT(sys, z, P) : bubbleTCore(sys, z, P);
  if (splits(b.T)) return null;
  const d = isEos(sys) ? eosDewT(sys, z, P) : dewT(sys, z, P);
  return { Tb: b.T, Td: d.T, yb: b.y, xd: d.x };
}
const single = (type, z) => ({ V: type === "vapour" ? 1 : 0, x: z, y: z, single: type, iterations: 0 });
/** The first bubble (VF = 0) or drop (VF = 1) at the solution, for the result. */
const incipient = (VF, bd) => (VF === 0 ? { type: "vapour", composition: bd.yb } : VF === 1 ? { type: "liquid", composition: bd.xd } : null);

/** Enthalpy of the feed z flashed at T, P (J/mol); throws NOT_AVAILABLE as phase() does. */
function enthalpyAt(sys, z, T, P, ctx = {}) {
  const core = tpCore(sys, z, T, P, ctx);
  const r = withEnthalpy(sys, core, T, P);
  if (r.H === null) throw fail("NOT_AVAILABLE", r.notes[0] ?? `${sys.model}: enthalpy not available.`);
  return { H: r.H, core };
}

/** Bracket a root of f (increasing in T) by stepping from T0 in direction dir. */
function stepBracket(f, T0, dir, limit, step = 5) {
  let a = T0, fa = f(a);
  for (let k = 0; k < 60; k++) {
    const b = dir > 0 ? Math.min(a + step, limit) : Math.max(a - step, limit);
    const fb = f(b);
    if (fa * fb <= 0) return dir > 0 ? [a, b] : [b, a];
    if (b === limit) break;
    a = b; fa = fb; step *= 1.6;
  }
  return null;
}

const T_FLOOR = 30, T_CEIL = 2000; // K: limits of the temperature search of a P-H flash

// ------------------------------------------------------------------ specifications across two liquids

/** Activity models without the acid chemical theory can resolve two liquids (splitThree). */
const canThree = sys => !isEos(sys) && sys.n >= 2 && !!sys.lnKValues;
const isSplitError = e => e && e.code === "PHASE_SPLIT";

/**
 * A binary at given P has its vapour and two liquids at one temperature only (at given T, at one
 * pressure only; Gibbs' phase rule), where the flash jumps from two liquids to vapour + liquid.
 * From the two sides of the jump, A and B: the liquids of the two-liquid side, the vapour of the
 * other, and the fractions from the mass balance and the specification row . beta = rhs (the
 * lever rule of three phases). Returns a core, or null if the sides are not of that kind.
 */
function threeFromSides(sys, z, A, B, row, rhs) {
  if (sys.n !== 2) return null;
  const LL = [A, B].find(c => c.liquid2 && !(c.V > 0));
  const VL = [A, B].find(c => !c.liquid2 && (c.single === "vapour" || (c.single === null && c.V > 0)));
  if (!LL || !VL) return null;
  const xa = LL.x, xb = LL.liquid2.x, y = VL.single === "vapour" ? z : VL.y;
  const M = [[1, 1, 1], [xa[0], xb[0], y[0]], row(xa, xb, y)], b = [1, z[0], rhs];
  const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M);
  if (!(Math.abs(D) > 0)) return null;
  const beta = [0, 1, 2].map(k => det(M.map((r, i) => r.map((v, j) => (j === k ? b[i] : v)))) / D);
  if (beta.some(v => !(v > -1e-12))) return null;
  const [, fb, V] = beta.map(v => Math.max(v, 0));
  return { V, x: xa, y, liquid2: { fraction: fb, x: xb }, labels: [richLabel(sys, xa), richLabel(sys, xb)], single: null, iterations: A.iterations + B.iterations };
}

/**
 * Solve value(state) = target, where value does not decrease with s (s = T, or ln P at given
 * T), with fully checked T-P flashes (two liquids resolved): a bracket stepped out from s0,
 * then Brent's method. Where the value jumps over the target (a binary's three-phase point),
 * the three phases from the two sides of the jump (threeFromSides; o.row gives the
 * specification row at that point), or, for VF = 0 and 1, the side on the boundary (o.side).
 */
function searchSpec(sys, z, o) {
  const ctx = {}, memo = new Map();
  const ev = s => {
    if (memo.has(s)) return memo.get(s);
    const { T, P } = o.at(s);
    const core = tpCore(sys, z, T, P, ctx);
    const r = { T, P, core, v: o.value(core, T, P) };
    memo.set(s, r);
    return r;
  };
  const f = s => ev(s).v - o.target;
  const f0 = f(o.s0);
  const dir = f0 < 0 ? 1 : -1;
  const br = f0 === 0 ? [o.s0, o.s0] : stepBracket(f, o.s0, dir, dir > 0 ? o.sMax : o.sMin, o.step);
  if (!br) throw failRange("OUT_OF_RANGE", `${o.what}: no solution in the range searched.`, { z });
  let [lo, hi] = br;
  // Where the two liquids of the feed start to boil, found directly (a smooth equation) rather
  // than by bisection. For a binary the flash jumps there (vapour + two liquids at one point);
  // the two ends of the jump are the two liquids of the feed and the vapour with the liquid
  // that remains. With more components the vapour fraction grows from 0 there.
  const tp = lo < hi ? boilingOfLiquids(sys, z, o, ev(lo).core, ev(hi).core, lo, hi) : null;
  if (tp) {
    const { s: s3, T, P, ll, y3 } = tp;
    const LLc = ll.beta > 0 && ll.beta < 1 ? llCore(sys, ll, ll.iterations) : null;
    if (LLc && tp.binary) {
      const VLc = vapourEnd(z, ll, y3);
      if (VLc) {
        const ends = [{ T, P, core: LLc, v: o.value(LLc, T, P) }, { T, P, core: VLc, v: o.value(VLc, T, P) }];
        const [A, B] = o.alongT ? ends : ends.reverse();
        if (A.v <= o.target && o.target <= B.v) {
          if (o.side) return o.side(A, B);
          const r = o.row(T, P);
          const three = threeFromSides(sys, z, LLc, VLc, r.row, r.rhs);
          if (three) return { T, P, core: three, v: o.target };
        } else if (o.target < A.v) hi = s3 - o.eps;
        else lo = s3 + o.eps;
      }
    } else if (LLc) {
      if (o.side && o.vf === 0) return { T, P, core: LLc, incipient: { type: "vapour", composition: y3 } };
      if (!o.side) {
        const v = o.value(LLc, T, P);
        memo.set(s3, { T, P, core: LLc, v });
        // the two liquids lie on the low side of s3 along T, on the high side along ln P
        if ((v - o.target) * (o.alongT ? 1 : -1) >= 0) { if (o.alongT) hi = s3; else lo = s3; } else if (o.alongT) lo = s3; else hi = s3;
      }
    }
  }
  const s = lo === hi ? lo : brent(f, lo, hi, { xtol: o.xtol });
  const mid = ev(s);
  if (!o.side && Math.abs(mid.v - o.target) <= o.tol) return mid;
  const A = ev(s - 2 * o.xtol), B = ev(s + 2 * o.xtol);
  if (o.side) return { ...o.side(A, B), sides: [A, B] };
  const r = o.row(mid.T, mid.P);
  const three = threeFromSides(sys, z, A.core, B.core, r.row, r.rhs);
  if (three) return { ...mid, core: three };
  if (Math.abs(mid.v - o.target) <= o.looseTol) return mid; // a steep, continuous value
  throw fail("NO_CONVERGENCE", `${o.what}: the result jumps across the specification at ${mid.T.toFixed(4)} K and ${mid.P.toPrecision(6)} kPa, and no three-phase state explains the jump.`, { z });
}

/**
 * Where the two liquids of the feed start to boil, between the states a and b (one with two
 * liquids and no vapour, the other with vapour): at given T the pressure P3 = P_bub(x1) of the
 * liquids of the feed's split (s = ln P3); at given P the temperature where P3(T) = P (Brent's
 * method). Null otherwise, or when the liquid-liquid split fails on the way.
 */
function boilingOfLiquids(sys, z, o, a, b, lo, hi) {
  if (!canThree(sys)) return null;
  const binary = z.filter(v => v > 0).length === 2;
  const isLL = c => !!c.liquid2 && !(c.V > 0);
  const hasV = c => c.single === "vapour" || (c.single === null && c.V > 0 && (!binary || !c.liquid2));
  const LL = isLL(a) ? a : isLL(b) ? b : null;
  if (!LL || !(hasV(a) || hasV(b))) return null;
  let K = LL.liquid2.x.map((v, i) => Math.max(v, 1e-300) / Math.max(LL.x[i], 1e-300));
  const at = T => {
    const ll = splitLL(sys, z, T, K.slice());
    if (!ll) throw fail("NO_CONVERGENCE", "no two liquids");
    K = ll.K;
    return { ll, e: sys.equilibrium(ll.x1, T) };
  };
  try {
    let s3;
    if (!o.alongT) {
      s3 = Math.log(at(o.at(lo).T).e.P);
      if (!(s3 > lo && s3 < hi)) return null;
    } else {
      const P = o.at(lo).P;
      s3 = brent(T => Math.log(at(T).e.P / P), lo, hi, { xtol: o.xtol });
    }
    const { T, P } = o.at(s3);
    const { ll, e } = at(T);
    return { s: s3, T, P, ll, y3: e.y, binary };
  } catch (e) {
    if (e && (e.code === "NO_CONVERGENCE" || e.code === "OUT_OF_RANGE")) return null;
    throw e;
  }
}

/** At a binary's three-phase point: the vapour y3 with the liquid that remains (lever rule). */
function vapourEnd(z, ll, y3) {
  const c = z.findIndex(v => v > 0);
  for (const xl of [ll.x1, ll.x2]) {
    const V = (z[c] - xl[c]) / (y3[c] - xl[c]);
    if (V > 1 + 1e-12) continue;
    if (V >= 1 - 1e-12) return { V: 1, x: xl, y: z, single: "vapour", iterations: 0 };
    if (V > 0) return { V, x: xl, y: y3, single: null, iterations: 0 };
  }
  return null;
}

/** The enthalpy of a core (J/mol), or NOT_AVAILABLE. */
function coreH(sys, core, T, P) {
  const r = withEnthalpy(sys, core, T, P);
  if (r.H === null) throw fail("NOT_AVAILABLE", r.notes[0] ?? `${sys.model}: enthalpy not available.`);
  return r.H;
}

/** P-H flash with fully checked T-P flashes (two liquids resolved), from T0. */
function phSearch(sys, z, P, H, T0) {
  const hRow = (T, Pq) => ({
    row: (xa, xb, y) => [sys.phase("liquid", T, Pq, xa).h_J_mol, sys.phase("liquid", T, Pq, xb).h_J_mol, sys.phase("vapour", T, Pq, y).h_J_mol],
    rhs: H,
  });
  const r = searchSpec(sys, z, {
    what: `${sys.model} P-H flash at ${P.toPrecision(6)} kPa`, at: T => ({ T, P }), value: coreH.bind(null, sys),
    target: H, s0: T0, sMin: T_FLOOR, sMax: T_CEIL, step: 5, xtol: 1e-9, eps: 1e-8, alongT: true, tol: 1e-3, looseTol: 1, row: hRow,
  });
  return [r.T, r.P, r.core];
}

/** Vapour-fraction flash with fully checked T-P flashes, along T (given P) or ln P (given T). */
function vfSearch(sys, z, VF, given, s0) {
  const alongT = given.P !== undefined;
  const at = alongT ? T => ({ T, P: given.P }) : u => ({ T: given.T, P: Math.exp(u) });
  const sign = alongT ? 1 : -1; // V rises with T and falls with P
  const vapourOf = c => (c.single === "vapour" ? z : c.y);
  const what = `${sys.model} flash at ${alongT ? given.P.toPrecision(6) + " kPa" : given.T.toFixed(2) + " K"}, VF = ${VF}`;
  const range = alongT ? { sMin: T_FLOOR, sMax: T_CEIL, step: 5, xtol: 1e-9, eps: 1e-8 } : { sMin: Math.log(1e-6), sMax: Math.log(1e6), step: 0.05, xtol: 1e-12, eps: 1e-10 };
  let o;
  if (VF === 0 || VF === 1) {
    // the boundary where the first bubble (VF = 0) or the last drop (VF = 1) appears
    const on = c => (VF === 0 ? c.single !== "liquid" && c.V > 1e-12 : c.single === "vapour" || c.V >= 1 - 1e-12);
    o = {
      value: c => (alongT ? (on(c) ? 1 : 0) : (on(c) ? 0 : 1)), target: 0.5,
      side: (A, B) => {
        const [lo, hi] = alongT ? [A, B] : [B, A]; // lo: the side without vapour (VF = 0) or with liquid
        if (VF === 0) return { ...lo, incipient: { type: "vapour", composition: vapourOf(hi.core) } };
        const L = lo.core;
        return { ...hi, incipient: { type: "liquid", composition: L.x, ...(L.liquid2 ? { composition2: L.liquid2.x } : {}) } };
      },
    };
  } else {
    o = { value: c => sign * c.V, target: sign * VF, tol: 1e-9, looseTol: 1e-6, row: () => ({ row: () => [0, 0, 1], rhs: VF }) };
  }
  return searchSpec(sys, z, { what, at, s0, alongT, vf: VF, ...range, ...o });
}


/**
 * P-H flash: [T, P, core]. Budget (decided on pull request #35): 20 ms for up to 5 components
 * (the T-P flash: 5 ms), since every heater, valve and column stage of a flowsheet runs one.
 *
 * From the bubble point of the feed at P: below its enthalpy, a liquid (Brent on the liquid
 * enthalpy, bracket stepped down). Above it, T-P flashes stepped up from the bubble point,
 * each warm-started from the previous K-values, until the enthalpy is passed; then Brent on T
 * inside that step (two-phase), or on the vapour enthalpy once the feed is all vapour. When
 * the two-phase region is a single temperature (a pure component, an azeotrope), the lever
 * rule between the bubble and dew enthalpies. Without a bubble point at that pressure (above
 * the highest two-phase pressure), T-P flashes stepped out from 300 K. The liquid of the
 * result is checked with the tangent-plane test.
 */
function phFast(sys, z, P, H) {
  const what = `${sys.model} P-H flash at ${P.toPrecision(6)} kPa`;
  const hLiq = Tq => sys.phase("liquid", Tq, P, z).h_J_mol - H;
  const hVap = Tq => sys.phase("vapour", Tq, P, z).h_J_mol - H;
  const ctx = { check: false };
  const finish = T => {
    const core = tpCore(sys, z, T, P, { K: ctx.K });
    return [T, P, core];
  };
  let Tb = null;
  try { Tb = (isEos(sys) ? eosBubbleT(sys, z, P, { stability: false }) : bubbleTCore(sys, z, P)).T; } catch (e) {
    if (!(e && (e.code === "NO_CONVERGENCE" || e.code === "PHASE_SPLIT" || e.code === "OUT_OF_RANGE"))) throw e;
  }
  if (Tb === null) {
    const f = Tq => enthalpyAt(sys, z, Tq, P, ctx).H - H;
    const f300 = f(300);
    const br = stepBracket(f, 300, f300 < 0 ? +1 : -1, f300 < 0 ? T_CEIL : T_FLOOR);
    if (!br) throw failRange("OUT_OF_RANGE", `${what}: no temperature between ${T_FLOOR} K and ${T_CEIL} K gives the enthalpy ${H.toFixed(1)} J/mol.`, { z, P, H });
    return finish(brent(f, br[0], br[1], { xtol: 1e-9 }));
  }
  const hb = sys.phase("liquid", Tb, P, z).h_J_mol;
  if (H <= hb) {
    const br = stepBracket(hLiq, Tb, -1, T_FLOOR);
    if (!br) throw failRange("OUT_OF_RANGE", `${what}: the enthalpy ${H.toFixed(1)} J/mol is below that of the liquid at ${T_FLOOR} K.`, { z, P, H });
    const T = brent(hLiq, br[0], br[1], { xtol: 1e-9 });
    checkLiquid(sys, z, T, `${what}: the liquid feed at ${T.toFixed(2)} K`, P);
    return [T, P, single("liquid", z)];
  }
  // a single-temperature two-phase region: all vapour just above the bubble point
  const probe = tpCore(sys, z, Tb + 2 * NARROW_K, P, ctx);
  if (probe.single === "vapour") {
    const Td = (isEos(sys) ? eosDewT(sys, z, P, { stability: false }) : dewT(sys, z, P)).T;
    const hd = sys.phase("vapour", Td, P, z).h_J_mol;
    if (H < hd) {
      const V = (H - hb) / (hd - hb);
      checkLiquid(sys, z, Tb, `${what}: the liquid`, P);
      return [Tb + V * (Td - Tb), P, { V, x: z, y: z, single: null, iterations: 0 }];
    }
    const br = stepBracket(hVap, Td, +1, T_CEIL);
    if (!br) throw failRange("OUT_OF_RANGE", `${what}: the enthalpy ${H.toFixed(1)} J/mol is above that of the vapour at ${T_CEIL} K.`, { z, P, H });
    return [brent(hVap, br[0], br[1], { xtol: 1e-9 }), P, single("vapour", z)];
  }
  // step up from the bubble point with warm-started T-P flashes
  let a = Tb, step = 2;
  for (let k = 0; k < 80; k++) {
    const b = Math.min(a + step, T_CEIL);
    const core = tpCore(sys, z, b, P, ctx);
    if (core.single === "vapour") {
      if (hVap(b) >= 0) {
        // the root lies in [a, b]: two-phase up to the dew point, vapour above
        const f = Tq => enthalpyAt(sys, z, Tq, P, ctx).H - H;
        const T = brent(f, a, b, { xtol: 1e-9 });
        return finish(T);
      }
      const br = stepBracket(hVap, b, +1, T_CEIL);
      if (!br) throw failRange("OUT_OF_RANGE", `${what}: the enthalpy ${H.toFixed(1)} J/mol is above that of the vapour at ${T_CEIL} K.`, { z, P, H });
      return [brent(hVap, br[0], br[1], { xtol: 1e-9 }), P, single("vapour", z)];
    }
    const fb = withEnthalpy(sys, core, b, P).H - H;
    if (fb >= 0) {
      const f = Tq => enthalpyAt(sys, z, Tq, P, ctx).H - H;
      return finish(brent(f, a, b, { xtol: 1e-9 }));
    }
    if (b === T_CEIL) break;
    a = b; step *= 1.5;
  }
  throw failRange("OUT_OF_RANGE", `${what}: the enthalpy ${H.toFixed(1)} J/mol is not reached below ${T_CEIL} K.`, { z, P, H });
}

/**
 * P-H flash: the fast path above; where the feed or a liquid splits into two liquids (activity
 * models without the acid chemical theory), the general search with fully checked T-P flashes,
 * which also finds a binary's three-phase temperature (phSearch).
 */
function phFlash(sys, z, P, H) {
  if (!canThree(sys)) return phFast(sys, z, P, H);
  let out = null;
  try { out = phFast(sys, z, P, H); } catch (e) { if (!(isSplitError(e) || (e && e.code === "NO_CONVERGENCE"))) throw e; }
  if (out) {
    const [T, Pq, core] = out;
    if (!core.liquid2 && Math.abs(coreH(sys, core, T, Pq) - H) <= 0.05) return out;
  }
  return phSearch(sys, z, P, H, out ? out[0] : bubbleStart(sys, z, P));
}

/** A start for the searches: the bubble temperature of the feed as one liquid, else 300 K. */
function bubbleStart(sys, z, P) {
  let T0 = 300;
  try { T0 = bubbleTCore(sys, z, P).T; } catch (e) { if (!(e && (e.code === "NO_CONVERGENCE" || e.code === "OUT_OF_RANGE"))) throw e; }
  return Math.min(Math.max(T0, T_FLOOR), T_CEIL);
}

/**
 * The flash. See the file header for the specifications.
 * @returns {{spec:string, T:number, P:number, VF:number, H_J_mol:number|null,
 *   phases:{type:string, fraction:number, composition:number[], h_J_mol:number|null}[],
 *   iterations:number, warnings:string[], sources:object[], duty_J_mol?:number}}
 */
export function flash(sys, spec = {}, opts = {}) {
  if (!spec || typeof spec !== "object") throw fail("BAD_INPUT", "flash needs a specification such as { z, T, P }.");
  const z = checkComposition(spec.z, sys.n, "Feed composition");
  const has = k => spec[k] !== undefined && spec[k] !== null;
  const keys = ["T", "P", "H", "VF"].filter(has);
  const kind = keys.slice().sort().join("");
  const SPECS = { PT: "TP", HP: "PH", PVF: "PVF", TVF: "TVF" };
  if (!SPECS[kind]) {
    throw fail("BAD_INPUT", `flash: give the feed z and two of T, P, H, VF as { z, T, P }, { z, P, H }, { z, P, VF } or { z, T, VF } (got ${keys.join(", ") || "none"}).`);
  }
  const T = has("T") ? checkTemperature(spec.T) : null;
  const P = has("P") ? checkPressure(spec.P) : null;
  let out;
  if (kind === "PT") out = result(sys, "TP", z, T, P, tpCore(sys, z, T, P));
  else if (kind === "PVF" || kind === "TVF") {
    const VF = Number(spec.VF);
    if (!(VF >= 0 && VF <= 1)) throw fail("BAD_INPUT", `flash: VF must be between 0 and 1 (got ${JSON.stringify(spec.VF)}).`);
    // the fast path returns null when the feed splits into two liquids at its bubble point
    const general = r => result(sys, kind, z, r.T, r.P, r.core, { incipient: r.incipient ?? null });
    const run = (fast, slow) => {
      if (!canThree(sys)) return fast();
      let r;
      try { r = fast(); } catch (e) { if (!isSplitError(e)) throw e; r = null; }
      return r ?? slow();
    };
    const splits = Tq => canThree(sys) && VF < 1 && !liquidTangentPlane(sys, z, Tq).stable;
    if (kind === "PVF") {
      let bd = null;
      out = run(() => {
        bd = temperatureBubbleDew(sys, z, P, splits);
        if (!bd) return null;
        const { Tb, Td } = bd;
        let Tsol, core;
        if (Td - Tb < NARROW_K) {
          Tsol = Tb + VF * (Td - Tb);
          core = VF === 0 ? single("liquid", z) : VF === 1 ? single("vapour", z) : { V: VF, x: z, y: z, single: null, iterations: 0 };
        } else if (VF === 0 || VF === 1) {
          Tsol = VF === 0 ? Tb : Td;
          core = single(VF === 0 ? "liquid" : "vapour", z);
        } else {
          Tsol = brent(Tq => tpCore(sys, z, Tq, P).V - VF, Tb, Td, { xtol: 1e-9 });
          core = tpCore(sys, z, Tsol, P);
        }
        if (core.single !== "vapour" && !core.liquid2) checkLiquid(sys, core.x, Tsol, `${sys.model} flash at ${P.toPrecision(6)} kPa, VF = ${VF}: the liquid`, P);
        return result(sys, "PVF", z, Tsol, P, core, { incipient: incipient(VF, bd) });
      }, () => general(vfSearch(sys, z, VF, { P }, bd ? bd.Td : bubbleStart(sys, z, P))));
    } else {
      let bd = null;
      out = run(() => {
        bd = pressureBubbleDew(sys, z, T, splits);
        if (!bd) return null;
        const { Pb, Pd } = bd;
        let Psol, core;
        if (Pb - Pd < 1e-7 * Pb) {
          Psol = Pd + (1 - VF) * (Pb - Pd);
          core = VF === 0 ? single("liquid", z) : VF === 1 ? single("vapour", z) : { V: VF, x: z, y: z, single: null, iterations: 0 };
        } else if (VF === 0 || VF === 1) {
          Psol = VF === 0 ? Pb : Pd;
          core = single(VF === 0 ? "liquid" : "vapour", z);
        } else {
          Psol = Math.exp(brent(u => VF - tpCore(sys, z, T, Math.exp(u)).V, Math.log(Pd), Math.log(Pb), { xtol: 1e-12 }));
          core = tpCore(sys, z, T, Psol);
        }
        if (core.single !== "vapour" && !core.liquid2) checkLiquid(sys, core.x, T, `${sys.model} flash at ${T.toFixed(2)} K, VF = ${VF}: the liquid`, Psol);
        return result(sys, "TVF", z, T, Psol, core, { incipient: incipient(VF, bd) });
      }, () => general(vfSearch(sys, z, VF, { T }, Math.log(bd ? bd.Pd : sys.equilibrium(z, T).P))));
    }
  } else {
    // P-H flash
    const H = Number(spec.H);
    if (!Number.isFinite(H)) throw fail("BAD_INPUT", `flash: H must be a number of J/mol (got ${JSON.stringify(spec.H)}).`);
    out = result(sys, "PH", z, ...phFlash(sys, z, P, H));
  }
  if (opts && opts.feed) {
    const Tf = checkTemperature(opts.feed.T, "Feed temperature"), Pf = checkPressure(opts.feed.P, "Feed pressure");
    if (out.H_J_mol === null) throw fail("NOT_AVAILABLE", `flash: the heat duty needs enthalpies, which are not available for this system (${out.warnings[0] ?? sys.model}).`);
    const Hf = enthalpyAt(sys, z, Tf, Pf).H;
    out.feed = { T: Tf, P: Pf, H_J_mol: Hf };
    out.duty_J_mol = out.H_J_mol - Hf;
  }
  return out;
}
