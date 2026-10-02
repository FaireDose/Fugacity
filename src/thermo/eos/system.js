/**
 * Systems described by a cubic equation of state (model "PR" or "SRK"), with binary k_ij
 * from src/data/kij.json (ChemSep, Artistic License 2.0, or fitted to open data). Pairs
 * without a k_ij use 0 and are reported in info.pairs (tier "none") and info.missingPairs;
 * bubble and dew points also return them in `warnings`, with temperatures outside the
 * data range of a stored k_ij.
 *
 * Equations: see cubic.js. Units: T in K, P in kPa, mole fractions.
 */
import componentData from "../../data/components.json" with { type: "json" };
import { cubicEos, CUBICS } from "./cubic.js";
import { RANGE_MARGIN_K, selection, choosePair, describePair, pairWarnings } from "../library.js";

export const EOS_MODELS = Object.keys(CUBICS);

/** A k_ij is used without a warning up to this far (K) outside its data range. */
export { RANGE_MARGIN_K };

/**
 * @param {string[]} ids        component ids (already resolved)
 * @param {object} cfg
 * @param {"PR"|"SRK"} cfg.model
 * @param {number[][]} [cfg.kij] user k_ij matrix (n x n, symmetric); overrides the databank
 * @param {object} [cfg.sets]    k_ij set per pair, and [cfg.prefer] tiers in order (see library.js)
 * @param {object} [sel]  cfg.sets and cfg.prefer as checked by library.selection()
 */
export function createEosSystem(ids, cfg, sel = selection(cfg)) {
  const model = String(cfg.model).toUpperCase();
  const comps = ids.map(id => componentData.components[id]);
  const n = ids.length;
  const K = Array.from({ length: n }, () => new Array(n).fill(0));
  const pairs = [], missing = [];
  if (cfg.kij !== undefined) {
    const u = cfg.kij;
    if (!Array.isArray(u) || u.length !== n || u.some(r => !Array.isArray(r) || r.length !== n || r.some(v => !Number.isFinite(v)))) {
      throw new Error(`kij must be an ${n} x ${n} matrix of numbers.`);
    }
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (u[i][j] !== u[j][i]) throw new Error(`kij must be symmetric (k_${i}${j} = ${u[i][j]}, k_${j}${i} = ${u[j][i]}).`);
    }
  }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const pair = [comps[i].name, comps[j].name];
    if (cfg.kij !== undefined) {
      K[i][j] = K[j][i] = cfg.kij[i][j];
      pairs.push({ pair, kij: cfg.kij[i][j], tier: "user", source: "given in the system's setup" });
      continue;
    }
    const choice = choosePair(model, ids[i], ids[j], sel);
    if (choice) {
      const k = choice.chosen.params.kij;
      K[i][j] = K[j][i] = k;
      pairs.push({ kij: k, ...describePair(choice, pair) });
    } else {
      missing.push(pair);
      pairs.push({ pair, kij: 0, tier: "none", source: `no ${model} k_ij in the databank; k_ij = 0 used` });
    }
  }
  const eos = cubicEos(model, comps.map(c => ({ name: c.name, Tc_K: c.Tc_K, Pc_Pa: c.Pc_Pa, omega: c.omega })), K);
  const MW = comps.map(c => c.MW);

  const gammaPhiOnly = what => () => {
    throw new Error(`${what} belongs to activity-coefficient (gamma-phi) systems; this is a ${model} equation-of-state system. Use bubbleT, bubbleP, dewT, dewP, Z, lnPhi or density.`);
  };

  // Accept (x, T, P, phase) as well as (T, P, x, phase).
  const args = (a, b, c, d) => Array.isArray(a) ? { x: a, T: b, P: c, phase: d } : { T: a, P: b, x: c, phase: d };

  /** Full state of one phase (see cubic.js state()). Arguments (T, P, x, phase) or (x, T, P, phase). */
  function state(a, b, c, d) {
    const q = args(a, b, c, d);
    return eos.state(q.T, q.P, q.x, q.phase ?? "vapour");
  }

  const info = {
    components: comps.map((c, i) => ({ id: ids[i], name: c.name, formula: c.formula, Tc_K: c.Tc_K, Pc_kPa: c.Pc_Pa / 1000, omega: c.omega })),
    model, equation: eos.name, pairs, missingPairs: missing,
    vapour: eos.name, liquid: eos.name,
    notes: [
      "No volume translation: liquid densities from a cubic equation of state are typically 5-20 % off.",
      "Root choice: smallest Z for the liquid, largest for the vapour; with one real root the same root is used for both and labelled liquid-like or vapour-like.",
    ],
  };

  /**
   * Warnings that apply to a calculation at T (K) and P (kPa): pairs with k_ij = 0 (no data),
   * temperatures more than RANGE_MARGIN_K outside the data range of a stored k_ij, pressures
   * outside a set's pressure range, and notes on the choice of sets.
   */
  function warnings(T, P) {
    const w = [];
    for (const p of pairs) {
      if (p.tier === "none") w.push(`No ${model} k_ij for ${p.pair.join(" + ")}: k_ij = 0 used; results for this pair are a prediction without binary data.`);
      else w.push(...pairWarnings([p], T, P, q => `k_ij of ${q.pair.join(" + ")} (${q.kij}) comes`));
    }
    return w;
  }

  return {
    ids, names: comps.map(c => c.name), n, model, kind: "eos", eos, kij: K, info,
    state, warnings,
    /** Compressibility factor Z. Arguments (T, P, x, phase) or (x, T, P, phase); phase defaults to "vapour". */
    Z: (a, b, c, d) => state(a, b, c, d).Z,
    /** ln phi_i. Arguments (T, P, x, phase) or (x, T, P, phase). */
    lnPhi: (a, b, c, d) => state(a, b, c, d).lnPhi,
    /** Mass density, kg/m3. Arguments (x, T, P, phase) or (T, P, x, phase). */
    density(a, b, c, d) {
      const q = args(a, b, c, d);
      const s = eos.state(q.T, q.P, q.x, q.phase ?? "vapour");
      const sum = q.x.reduce((u, v) => u + v, 0);
      const mw = q.x.reduce((u, v, i) => u + v / sum * MW[i], 0) / 1000;
      return mw / s.v_m3_mol;
    },
    /** Residual enthalpy H - H_ideal-gas at the same T and P, J/mol. */
    hResidual: (a, b, c, d) => state(a, b, c, d).hR_J_mol,
    gammas: gammaPhiOnly("gammas"),
    psat: gammaPhiOnly("psat (Raoult vapour pressures)"),
    equilibrium: gammaPhiOnly("equilibrium(x, T)"),
  };
}
