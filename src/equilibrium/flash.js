/**
 * Two-phase (vapour-liquid) flash for every model (proposal 0001, step 4).
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
 *    Activity models: K_i = y_i(x) / x_i * P_bub(x) / P, with P_bub(x) and y(x) the bubble
 *    pressure and vapour of liquid x at T (sys.equilibrium: ideal gas, chemical theory for
 *    acids, or a PR/SRK vapour). At the fixed point sum K_i x_i = 1, hence P_bub(x) = P and
 *    y = y(x): the liquid is at its bubble point at P and the vapour is its equilibrium vapour,
 *    whatever the vapour model.
 *    Equations of state: K_i = phi_i^L(x) / phi_i^V(y), started from Wilson's K-values.
 *  - Which phases exist: activity models compare P with the bubble and dew pressures of the
 *    feed at T; equations of state use Michelsen's tangent-plane test on the feed
 *    (eos-stability.js). A liquid that is not stable as one liquid (spinodal test for activity
 *    models, tangent plane for equations of state) gives a PHASE_SPLIT error: the
 *    three-phase flash is step 5.
 *  - Enthalpy and vapour-fraction specifications: Brent's method on T (or ln P), bracketed
 *    by the bubble and dew points; for a single phase, a bracket stepped out from them.
 * Errors carry codes (util/errors.js); the mass balance closes to 1e-10 (checked).
 *
 * Units: T in K, P in kPa, enthalpy in J/mol, mole fractions.
 */
import { brent } from "../util/solve.js";
import { fail, failRange } from "../util/errors.js";
import { checkComposition, checkPressure, checkTemperature } from "../util/inputs.js";
import { bubbleTCore } from "./bubble.js";
import { dewP, dewT } from "./dew.js";
import { isLiquidStable } from "./stability.js";
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
    const { x } = phaseCompositions(z, K, Math.min(Math.max(V, -1e3), 1e3));
    const e = sys.equilibrium(x, T);
    const Kn = x.map((xi, i) => (e.y[i] / Math.max(xi, 1e-300)) * e.P / P);
    let d = 0;
    for (let i = 0; i < z.length; i++) if (z[i] > 0) d = Math.max(d, Math.abs(Math.log(Kn[i] / K[i])));
    K = Kn;
    if (d < K_TOL) {
      const Vf = rachfordRice(z, K);
      const pc = phaseCompositions(z, K, Vf);
      return { V: Vf, x: pc.x, y: pc.y, iterations: it };
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
      return { V: Vf, x: pc.x, y: pc.y, iterations: it };
    }
  }
  throw fail("NO_CONVERGENCE", `Flash at ${T.toFixed(2)} K and ${P.toPrecision(6)} kPa: the K-values did not converge in ${MAX_IT} steps (near a critical point?).`, { z, T, P, K });
}

const isEos = sys => sys.kind === "eos";

/** Root of lower Gibbs energy for feed z (equations of state). */
function minGRoot(eos, T, P, z) {
  const L = eos.state(T, P, z, "liquid");
  if (L.roots === 1) return L.rootType.startsWith("liquid") ? "liquid" : "vapour";
  const V = eos.state(T, P, z, "vapour");
  const g = s => z.reduce((a, v, i) => a + (v > 0 ? v * s.lnPhi[i] : 0), 0);
  return g(L) <= g(V) ? "liquid" : "vapour";
}

/**
 * Isothermal flash, no enthalpy: { V, x, y, single: "liquid"|"vapour"|null, iterations }.
 * Throws PHASE_SPLIT when the liquid is not stable as one liquid.
 */
function tpCore(sys, z, T, P) {
  const what = `${sys.model} flash at ${T.toFixed(2)} K and ${P.toPrecision(6)} kPa`;
  if (isEos(sys)) {
    const root = minGRoot(sys.eos, T, P, z);
    const st = tpdStability(sys.eos, T, P, z, root);
    if (st.stable) return { V: root === "vapour" ? 1 : 0, x: z, y: z, single: root, iterations: 0 };
    const lnK = wilsonLnK(sys.eos.comps, T, P);
    let r = splitEos(sys, z, T, P, lnK.map(Math.exp));
    if (!r && st.trial) {
      // start from the trial phase of the stability test
      const K = z.map((v, i) => (v > 0 ? (st.trialRoot?.startsWith("vapour") ? st.trial[i] / v : v / Math.max(st.trial[i], 1e-300)) : 1));
      r = splitEos(sys, z, T, P, K);
    }
    if (!r || !(r.V >= -1e-9 && r.V <= 1 + 1e-9)) {
      throw fail("NO_CONVERGENCE", `${what}: the feed is not stable as one phase (tangent-plane distance ${st.tm.toFixed(4)}), but no vapour-liquid split was found; it may split into two liquids, which needs the three-phase flash (step 5).`, { z, T, P });
    }
    const Ls = tpdStability(sys.eos, T, P, r.x, "liquid");
    if (!Ls.stable && Ls.trialRoot && Ls.trialRoot.startsWith("liquid")) {
      throw fail("PHASE_SPLIT", `${what}: the liquid splits into two liquid phases (tangent-plane distance ${Ls.tm.toFixed(3)}); three-phase equilibrium is not supported yet (proposal 0001, step 5).`, { x: r.x });
    }
    return { ...r, V: Math.min(Math.max(r.V, 0), 1), single: null };
  }
  // activity models: compare P with the bubble and dew pressures of the feed
  const bub = sys.equilibrium(z, T);
  if (P >= bub.P) {
    if (sys.n > 1 && !isLiquidStable(sys, z, T)) {
      throw fail("PHASE_SPLIT", `${what}: the feed is liquid but lies inside the two-liquid region (not stable as one liquid); three-phase equilibrium is not supported yet (proposal 0001, step 5).`, { z, T, P });
    }
    return { V: 0, x: z, y: bub.y, single: "liquid", iterations: 0 };
  }
  const dew = dewP(sys, z, T);
  if (P <= dew.P) return { V: 1, x: dew.x, y: z, single: "vapour", iterations: 0 };
  // start between the bubble (V = 0) and dew (V = 1) points
  const w = Math.log(bub.P / P) / Math.log(bub.P / dew.P);
  const K = z.map((zi, i) => {
    const Kb = bub.y[i] / Math.max(zi, 1e-300) * bub.P / P, Kd = zi / Math.max(dew.x[i], 1e-300) * dew.P / P;
    return Math.exp((1 - w) * Math.log(Kb) + w * Math.log(Kd));
  });
  const r = splitActivity(sys, z, T, P, K);
  if (sys.n > 1 && !isLiquidStable(sys, r.x, T)) {
    throw fail("PHASE_SPLIT", `${what}: the liquid lies inside the two-liquid region (not stable as one liquid); three-phase equilibrium is not supported yet (proposal 0001, step 5).`, { x: r.x });
  }
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
  else { add("vapour", core.V, core.y); add("liquid", 1 - core.V, core.x); }
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
  const xs = core.single === "vapour" ? core.y : core.x, ys = core.single === "liquid" ? core.x : core.y;
  if (core.single === null) {
    const err = z.reduce((m, zi, i) => Math.max(m, Math.abs((1 - V) * xs[i] + V * ys[i] - zi)), 0);
    if (err > 1e-10) throw fail("NO_CONVERGENCE", `${sys.model} flash: the mass balance does not close (${err.toExponential(2)}).`, { z, T, P });
  }
  const warnings = [...new Set([...(sys.warnings ? sys.warnings(T, P) : []), ...e.notes])];
  return {
    spec, T, P, VF: V, H_J_mol: e.H, phases: e.phases,
    iterations: core.iterations, warnings, sources: sourcesOf(sys), ...extra,
  };
}

// ------------------------------------------------------------------ the flash

function pressureBubbleDew(sys, z, T) {
  if (isEos(sys)) return { Pb: eosBubbleP(sys, z, T).P, Pd: eosDewP(sys, z, T).P };
  return { Pb: sys.equilibrium(z, T).P, Pd: dewP(sys, z, T).P };
}
function temperatureBubbleDew(sys, z, P) {
  if (isEos(sys)) return { Tb: eosBubbleT(sys, z, P).T, Td: eosDewT(sys, z, P).T };
  return { Tb: bubbleTCore(sys, z, P).T, Td: dewT(sys, z, P).T };
}

/** Enthalpy of the feed z flashed at T, P (J/mol); throws NOT_AVAILABLE as phase() does. */
function enthalpyAt(sys, z, T, P) {
  const core = tpCore(sys, z, T, P);
  const r = withEnthalpy(sys, core, T, P);
  if (r.H === null) throw fail("NOT_AVAILABLE", r.notes[0] ?? `${sys.model}: enthalpy not available.`);
  return { H: r.H, core };
}

/** Bracket a root of f (increasing in T) by stepping from T0 in direction dir. */
function stepBracket(f, T0, dir, limit) {
  let a = T0, fa = f(a), step = 5;
  for (let k = 0; k < 60; k++) {
    const b = dir > 0 ? Math.min(a + step, limit) : Math.max(a - step, limit);
    const fb = f(b);
    if (fa * fb <= 0) return dir > 0 ? [a, b] : [b, a];
    if (b === limit) break;
    a = b; fa = fb; step *= 1.6;
  }
  return null;
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
    if (kind === "PVF") {
      const { Tb, Td } = temperatureBubbleDew(sys, z, P);
      if (Td - Tb < NARROW_K) {
        const core = VF === 0 ? { V: 0, x: z, y: z, single: "liquid", iterations: 0 }
          : VF === 1 ? { V: 1, x: z, y: z, single: "vapour", iterations: 0 } : { V: VF, x: z, y: z, single: null, iterations: 0 };
        out = result(sys, "PVF", z, Tb + VF * (Td - Tb), P, core);
      } else {
        const Tsol = VF === 0 ? Tb : VF === 1 ? Td : brent(Tq => tpCore(sys, z, Tq, P).V - VF, Tb, Td, { xtol: 1e-9 });
        const core = VF === 0 ? { ...tpCore(sys, z, Tb, P), V: 0, x: z, single: "liquid" }
          : VF === 1 ? { ...tpCore(sys, z, Td, P), V: 1, y: z, single: "vapour" } : tpCore(sys, z, Tsol, P);
        out = result(sys, "PVF", z, Tsol, P, core);
      }
    } else {
      const { Pb, Pd } = pressureBubbleDew(sys, z, T);
      let Psol;
      if (VF === 0 || Pb - Pd < 1e-9 * Pb) Psol = VF === 1 ? Pd : Pb;
      else if (VF === 1) Psol = Pd;
      else Psol = Math.exp(brent(u => VF - tpCore(sys, z, T, Math.exp(u)).V, Math.log(Pd), Math.log(Pb), { xtol: 1e-12 }));
      out = result(sys, "TVF", z, T, Psol, tpCore(sys, z, T, Psol));
    }
  } else {
    // P-H flash
    const H = Number(spec.H);
    if (!Number.isFinite(H)) throw fail("BAD_INPUT", `flash: H must be a number of J/mol (got ${JSON.stringify(spec.H)}).`);
    const { Tb, Td } = temperatureBubbleDew(sys, z, P);
    const hb = enthalpyAt(sys, z, Tb, P);
    const hLiq = Tq => sys.phase("liquid", Tq, P, z).h_J_mol - H;
    const hVap = Tq => sys.phase("vapour", Tq, P, z).h_J_mol - H;
    let Tsol, core;
    if (H <= hb.H) {
      const br = stepBracket(hLiq, Tb, -1, 150);
      if (!br) throw failRange("OUT_OF_RANGE", `${sys.model} P-H flash: the enthalpy ${H.toFixed(1)} J/mol is below that of the liquid at 150 K.`, { z, P, H });
      Tsol = brent(hLiq, br[0], br[1], { xtol: 1e-9 });
      core = { V: 0, x: z, y: z, single: "liquid", iterations: 0 };
    } else {
      const hd = enthalpyAt(sys, z, Td, P);
      if (H >= hd.H) {
        const br = stepBracket(hVap, Td, +1, 2000);
        if (!br) throw failRange("OUT_OF_RANGE", `${sys.model} P-H flash: the enthalpy ${H.toFixed(1)} J/mol is above that of the vapour at 2000 K.`, { z, P, H });
        Tsol = brent(hVap, br[0], br[1], { xtol: 1e-9 });
        core = { V: 1, x: z, y: z, single: "vapour", iterations: 0 };
      } else if (Td - Tb < NARROW_K) {
        // one component, or an azeotrope: the two-phase region is a single temperature
        const V = (H - hb.H) / (hd.H - hb.H);
        Tsol = Tb + V * (Td - Tb);
        core = { V, x: z, y: z, single: null, iterations: 0 };
      } else {
        Tsol = brent(Tq => enthalpyAt(sys, z, Tq, P).H - H, Tb, Td, { xtol: 1e-9 });
        core = tpCore(sys, z, Tsol, P);
      }
    }
    out = result(sys, "PH", z, Tsol, P, core);
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
