/**
 * Solid-liquid equilibrium (proposal 0007, step 4): the solubility of a solid in a liquid, the liquidus of a
 * binary and its eutectic, for a pure solid in equilibrium with the solution (no solid solution).
 *
 * Equilibrium condition (J. Gmehling, B. Kolbe, M. Kleiber, J. Rarey, Chemical Thermodynamics for Process
 * Simulation, Wiley-VCH 2012, solid-liquid equilibrium of a pure solid; as implemented in the open-source
 * `chemicals` library, chemicals.solubility.solubility_eutectic, MIT license):
 *
 *   ln(x_i γ_i) = -(ΔH_fus,i / R T)(1 - T / T_m,i) + (ΔC_p,i / R T)(T_m,i - T) - (ΔC_p,i / R) ln(T_m,i / T)
 *
 * with T_m the melting (triple-point) temperature, ΔH_fus the enthalpy of fusion and ΔC_p = C_p,liquid - C_p,solid
 * of the solute (0 unless given: the usual simplification, a few per cent in x near T_m and more far below it).
 * The sign of the first term: the solubility is below 1 below the melting point (the docstring of
 * solubility_eutectic prints it with a + sign, its code uses the - sign written here, which its worked example
 * confirms; test/sle.test.js checks that example).
 *
 * γ_i comes from the system's activity model (NRTL, UNIQUAC, or 1 for "ideal": the ideal solubility). At a fixed
 * temperature x_i is found by bracketing ln x_i + ln γ_i(x) - RHS on a grid in ln x_i, then Brent's method. Where the
 * activity model splits the liquid into two phases, ln x γ is not monotonic and there can be several roots: the
 * solvent-rich one is returned and the result says that the liquid can split there.
 */
import { brent } from "../util/solve.js";
import { fail, failRange } from "../util/errors.js";

const R = 8.314462618;

/** ln(x_i γ_i) of the saturated solution of solid i at T (the right-hand side above). */
export function sleRhs(Tm, Hfus, T, dCp = 0) {
  return -(Hfus / (R * T)) * (1 - T / Tm) + (dCp / (R * T)) * (Tm - T) - (dCp / R) * Math.log(Tm / T);
}

function index(sys, solute) {
  const i = typeof solute === "number" ? solute
    : sys.ids.findIndex((id, k) => id === solute || sys.names[k].toLowerCase() === String(solute).toLowerCase());
  if (!(i >= 0 && i < sys.n)) throw fail("BAD_INPUT", `"${solute}" is not a component of this system (${sys.names.join(", ")}).`);
  return i;
}

function fusionOf(sys, i, opts) {
  const f = sys.fusion?.[i];
  const Tm = opts.Tm_K ?? f?.Tm_K, Hfus = opts.Hfus_J_mol ?? f?.Hfus_J_mol;
  if (!(Tm > 0) || !(Hfus > 0)) {
    throw fail("MISSING_DATA", `${sys.names[i]}: no melting temperature and enthalpy of fusion (no open data in the ` +
      `NIST WebBook or ChemSep); give Tm_K and Hfus_J_mol.`);
  }
  return { Tm, Hfus, dCp: opts.dCp_J_molK ?? 0 };
}

/** Mole fractions of the solvent (all components but i), normalized; a binary needs none. */
function solventOf(sys, i, solvent) {
  const others = sys.n - 1;
  if (solvent == null) {
    if (others === 1) return [1];
    throw fail("BAD_INPUT", `Give the solvent composition (solvent: mole fractions of ${sys.names.filter((_, k) => k !== i).join(", ")}, without the solute).`);
  }
  if (!Array.isArray(solvent) || solvent.length !== others || solvent.some(v => !(v >= 0)) || !(solvent.reduce((a, b) => a + b, 0) > 0)) {
    throw fail("BAD_INPUT", `solvent: give ${others} non-negative mole fractions (the solvent without the solute).`);
  }
  const s = solvent.reduce((a, b) => a + b, 0);
  return solvent.map(v => v / s);
}

function liquid(sys, i, w, xi) {
  const x = new Array(sys.n);
  let k = 0;
  for (let j = 0; j < sys.n; j++) x[j] = j === i ? xi : (1 - xi) * w[k++];
  return x;
}

/**
 * Solubility of solid i at temperature T: the mole fraction of i in the saturated liquid.
 * @param {object} sys     an activity-model system (createSystem)
 * @param {string|number} solute  id, name or index of the solid
 * @param {number} T       K, below the melting temperature of the solid
 * @param {object} [opts]  solvent (mole fractions of the other components, without the solute; not needed for a
 *                         binary), Tm_K, Hfus_J_mol, dCp_J_molK (override the databank values)
 * @returns {{T_K:number, x:number[], xSolute:number, gamma:number, xIdeal:number, Tm_K:number, Hfus_J_mol:number,
 *            dCp_J_molK:number, splits:boolean, notes:string[]}}
 */
export function solidSolubility(sys, solute, T, opts = {}) {
  const i = index(sys, solute);
  if (!(T > 0)) throw fail("BAD_INPUT", `Temperature must be a positive number of kelvin (got ${T}).`);
  const { Tm, Hfus, dCp } = fusionOf(sys, i, opts);
  if (T >= Tm) {
    throw failRange("OUT_OF_RANGE", `${sys.names[i]} melts at ${Tm.toFixed(2)} K: at ${T.toFixed(2)} K there is no solid, ` +
      `so no solubility limit (the liquids mix as the activity model says).`);
  }
  const w = solventOf(sys, i, opts.solvent);
  const rhs = sleRhs(Tm, Hfus, T, dCp);
  const f = u => { const xi = Math.exp(u); return u + Math.log(sys.gammas(liquid(sys, i, w, xi), T)[i]) - rhs; };
  // grid in ln x from 1e-12 to 1 (f(0) = ln γ at x = 1 = 0 minus rhs > 0): every sign change is a root
  const uLo = Math.log(1e-12), N = 240;
  const roots = [];
  let u0 = uLo, f0 = f(u0);
  if (!(f0 < 0)) {
    throw fail("NO_SOLUTION", `${sys.names[i]} at ${T.toFixed(2)} K: the activity model gives ln(x γ) above the ` +
      `equilibrium value even at x = 1e-12 (γ at infinite dilution ${Math.exp(f0 + rhs - uLo).toExponential(3)}); ` +
      `the solubility is below 1e-12.`);
  }
  for (let k = 1; k <= N; k++) {
    const u1 = uLo * (1 - k / N), f1 = f(u1);
    if (f0 < 0 && f1 >= 0) roots.push(brent(f, u0, u1, { xtol: 1e-12 }));
    else if (f0 >= 0 && f1 < 0) roots.push(null);   // a falling crossing: the unstable middle root
    u0 = u1; f0 = f1;
  }
  if (!roots.length) throw fail("NO_CONVERGENCE", `${sys.names[i]} at ${T.toFixed(2)} K: no solubility found between x = 1e-12 and 1.`);
  const xi = Math.exp(roots[0]);
  const x = liquid(sys, i, w, xi);
  const gamma = sys.gammas(x, T)[i];
  const splits = roots.length > 1;
  const notes = [];
  if (splits) {
    notes.push(`The ${sys.model} model splits this liquid into two phases near x = ${xi.toPrecision(3)}: the solvent-rich ` +
      `solubility is given; a liquid-liquid check is needed.`);
  }
  if (dCp === 0) notes.push("ΔCp of fusion taken as 0.");
  return { T_K: T, x, xSolute: xi, gamma, xIdeal: Math.exp(rhs), Tm_K: Tm, Hfus_J_mol: Hfus, dCp_J_molK: dCp, splits, notes };
}

/**
 * Solubility of solid i against temperature, from T_from to T_to (both below T_m), n points.
 * @returns {{T_K:number, xSolute:number, gamma:number, xIdeal:number, splits:boolean}[]}
 */
export function solubilityCurve(sys, solute, opts = {}) {
  const i = index(sys, solute);
  const { Tm } = fusionOf(sys, i, opts);
  const T1 = opts.T_to ?? Tm - 0.01, T0 = opts.T_from ?? Math.max(T1 - 100, 0.5 * Tm), n = opts.n ?? 41;
  if (!(T0 < T1) || T1 >= Tm) throw fail("BAD_INPUT", `Give T_from < T_to < ${Tm.toFixed(2)} K (melting temperature of ${sys.names[i]}).`);
  return Array.from({ length: n }, (_, k) => {
    const T = T0 + (T1 - T0) * k / (n - 1);
    const r = solidSolubility(sys, i, T, opts);
    return { T_K: T, xSolute: r.xSolute, gamma: r.gamma, xIdeal: r.xIdeal, splits: r.splits };
  });
}

/**
 * Liquidus temperature of solid i for a liquid of composition x (all components): the temperature at which the
 * first crystals of i appear on cooling. Solved in T between T_low and T_m.
 */
export function liquidusT(sys, solute, x, opts = {}) {
  const i = index(sys, solute);
  const { Tm, Hfus, dCp } = fusionOf(sys, i, opts);
  if (!(x[i] > 0)) throw fail("BAD_INPUT", `${sys.names[i]}: the liquid has none of it, so it does not crystallize.`);
  if (x[i] >= 1) return Tm;
  const g = T => Math.log(x[i] * sys.gammas(x, T)[i]) - sleRhs(Tm, Hfus, T, dCp);
  const Tlow = opts.T_low ?? 0.2 * Tm;
  // g(Tm) = ln(x γ) < 0 normally; g rises as T falls (the right-hand side falls)
  if (!(g(Tlow) > 0)) {
    throw failRange("OUT_OF_RANGE", `${sys.names[i]} does not crystallize above ${Tlow.toFixed(1)} K from this liquid.`);
  }
  if (!(g(Tm) < 0)) return Tm;
  return brent(g, Tlow, Tm, { xtol: 1e-8 });
}

/**
 * Solid-liquid phase diagram of a binary with a simple eutectic: the liquidus of each solid against x1, and the
 * eutectic point where the two meet. Needs the melting data of both components.
 * @returns {{branches: {solid:string, points:{x1:number, T_K:number}[]}[], eutectic:{x1:number, T_K:number}, notes:string[]}}
 */
export function sleBinary(sys, opts = {}) {
  if (sys.n !== 2) throw fail("BAD_INPUT", "The solid-liquid diagram is for two components.");
  const o = [opts[0] ?? {}, opts[1] ?? {}];
  fusionOf(sys, 0, o[0]); fusionOf(sys, 1, o[1]);
  const T1 = x1 => liquidusT(sys, 0, [x1, 1 - x1], o[0]);   // solid 1 crystallizes (rich in 1)
  const T2 = x1 => liquidusT(sys, 1, [x1, 1 - x1], o[1]);   // solid 2 crystallizes (rich in 2)
  // a liquidus that does not reach down to T_low counts as 0 K (that solid does not crystallize there)
  const low = f => x1 => { try { return f(x1); } catch (e) { if (e.code === "OUT_OF_RANGE") return 0; throw e; } };
  const d = x1 => low(T1)(x1) - low(T2)(x1);
  // T1 rises with x1 and T2 falls: one crossing, the eutectic; bracketed on a grid, then Brent's method
  // (logarithmic near both ends: a eutectic can lie at x = 0.001, naphthalene + toluene)
  const grid = [];
  for (let e = -9; e < -2; e += 0.25) grid.push(10 ** e);
  for (let k = 1; k < 100; k++) grid.push(k / 100);
  for (let e = -2.25; e >= -9; e -= 0.25) grid.push(1 - 10 ** e);
  let k = grid.findIndex((xa, j) => j + 1 < grid.length && d(xa) < 0 && d(grid[j + 1]) >= 0);
  if (k < 0) throw fail("NO_CONVERGENCE", `No eutectic found between ${sys.names[0]} and ${sys.names[1]}.`);
  const xe = brent(d, grid[k], grid[k + 1], { xtol: 1e-12 });
  const Te = T1(xe);
  const n = opts.n ?? 41;
  const branch = (from, to, fn) => Array.from({ length: n }, (_, k) => {
    const x1 = from + (to - from) * k / (n - 1);
    return { x1, T_K: fn(x1) };
  });
  const notes = [];
  for (const [k, xs] of [[0, [xe, 1]], [1, [0, xe]]]) {
    const mid = (xs[0] + xs[1]) / 2;
    if (sys.isLiquidStable && !sys.isLiquidStable([mid, 1 - mid], k === 0 ? T1(mid) : T2(mid))) {
      notes.push(`The ${sys.model} model splits the liquid along the liquidus of ${sys.names[k]}: a liquid-liquid check is needed.`);
    }
  }
  return {
    branches: [{ solid: sys.ids[0], points: branch(xe, 1, T1) }, { solid: sys.ids[1], points: branch(0, xe, T2) }],
    eutectic: { x1: xe, T_K: Te },
    notes,
  };
}
