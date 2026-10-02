import componentData from "../data/components.json" with { type: "json" };
import { vapourPressure } from "./psat.js";
import { nrtl } from "./activity/nrtl.js";
import { uniquac } from "./activity/uniquac.js";
import { dimerK, monomerPressure } from "./vapour.js";
import { createEosSystem, EOS_MODELS } from "./eos/system.js";
import { listComponents, findComponent } from "./components.js";
import { selection, choosePair, describePair, pairWarnings } from "./library.js";
import { fail } from "../util/errors.js";

export const MODELS = ["NRTL", "UNIQUAC", "ideal"];
export { EOS_MODELS, listComponents, findComponent };

/**
 * Build a thermodynamic system: components + liquid activity model + vapour model.
 *
 * @param {object} cfg
 * @param {string[]} cfg.components  names, ids, aliases or CAS numbers
 * @param {"NRTL"|"UNIQUAC"|"ideal"} [cfg.model="NRTL"]
 * @param {boolean} [cfg.allowMissingPairs=false]  treat pairs without parameters as ideal
 * @param {boolean} [cfg.association=true]         use the chemical theory for dimerizing acids
 * @param {number[]|((T:number)=>number[])} [cfg.psat]  override pure vapour pressures (kPa),
 *        e.g. with the pure-component values measured alongside an isothermal data set
 * @param {Object<string,string>} [cfg.sets]  parameter set per pair, e.g. { "acetone+chloroform": "chemsep" }
 *        (pair in any order, any component name); see Fugacity.library.sets()
 * @param {string[]} [cfg.prefer]  tiers in order of preference for every pair, e.g. ["fitted", "databank"];
 *        without sets or prefer each pair uses its default set
 */
export function createSystem(cfg) {
  const model = (cfg.model || "NRTL").toUpperCase() === "IDEAL" ? "ideal" : (cfg.model || "NRTL").toUpperCase();
  const isEos = EOS_MODELS.includes(model);
  if (!MODELS.includes(model) && !isEos) throw fail("BAD_INPUT", `Unknown model "${cfg.model}". Use one of: ${MODELS.join(", ")}, or an equation of state: ${EOS_MODELS.join(", ")}.`);
  if (!Array.isArray(cfg.components) || cfg.components.length < (isEos ? 1 : 2)) throw fail("BAD_INPUT", isEos ? "Give at least one component." : "Give at least two components.");
  const ids = cfg.components.map(findComponent);
  if (new Set(ids).size !== ids.length) throw fail("BAD_INPUT", "A component appears twice.");
  const sel = selection(cfg); // checked for every model, so that a typo never passes silently
  if (isEos) return createEosSystem(ids, { ...cfg, model }, sel); // Peng-Robinson / SRK: see eos/system.js
  const comps = ids.map(id => componentData.components[id]);
  for (const c of comps) {
    if (!c.vapourPressure && !cfg.psat) {
      throw fail("MISSING_DATA", `${c.name} has no vapour-pressure record, so it cannot be used with activity-coefficient models. Use an equation of state for gases.`);
    }
    if (model === "UNIQUAC" && !c.uniquac) throw fail("MISSING_DATA", `${c.name} has no UNIQUAC r and q.`);
  }
  const n = ids.length;
  const useAssoc = cfg.association !== false;

  // ---- interaction parameters
  const zeros = () => Array.from({ length: n }, () => new Array(n).fill(0));
  const a = zeros(), b = zeros(), alpha = zeros();
  const pairs = [], missing = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (model === "ideal") continue;
    const choice = choosePair(model, ids[i], ids[j], sel);
    if (!choice) { missing.push([comps[i].name, comps[j].name]); continue; }
    const p = choice.chosen.params;
    const [aij, aji, bij, bji] = choice.flipped ? [p.a_ji, p.a_ij, p.b_ji, p.b_ij] : [p.a_ij, p.a_ji, p.b_ij, p.b_ji];
    a[i][j] = aij; a[j][i] = aji; b[i][j] = bij; b[j][i] = bji;
    alpha[i][j] = alpha[j][i] = p.alpha ?? 0.3;
    pairs.push(describePair(choice, [comps[i].name, comps[j].name]));
  }
  if (missing.length && !cfg.allowMissingPairs) {
    const list = missing.map(m => m.join(" + ")).join("; ");
    throw fail("MISSING_DATA", `No ${model} parameters for: ${list}. Pass allowMissingPairs: true to treat them as ideal, or add parameters to data/binaries.json.`);
  }
  // missing pairs: NRTL with zero tau is ideal; UNIQUAC with tau = 1 keeps only the combinatorial term
  let gammas;
  if (model === "NRTL") { for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j && !alpha[i][j]) alpha[i][j] = 0.3; gammas = nrtl({ a, b, alpha }); }
  else if (model === "UNIQUAC") gammas = uniquac({ a, b, r: comps.map(c => c.uniquac.r), q: comps.map(c => c.uniquac.q), qp: comps.map(c => c.uniquac.qp ?? c.uniquac.q) });
  else gammas = () => new Array(n).fill(1);

  const assoc = comps.map(c => (useAssoc && c.association && c.association.type === "dimer") ? c.association : null);

  /** Vapour pressures, kPa. cfg.psat can override them (array in kPa, or a function of T). */
  const psat = cfg.psat
    ? (typeof cfg.psat === "function" ? cfg.psat : () => cfg.psat.slice())
    : T => comps.map(c => vapourPressure(c.vapourPressure, T) / 1000);

  /**
   * Partial pressures for a liquid x at T.
   * @returns {{P:number, y:number[], gamma:number[]}}  P in kPa, y as apparent (monomer + 2 x dimer) mole fractions
   */
  function equilibrium(x, T) {
    const ps = psat(T), g = gammas(x, T);
    const app = new Array(n);
    let Ptrue = 0;
    for (let i = 0; i < n; i++) {
      if (assoc[i]) {
        const K = dimerK(assoc[i], T);
        const pm = x[i] * g[i] * monomerPressure(ps[i], K);
        const pd = K * pm * pm;
        Ptrue += pm + pd;
        app[i] = pm + 2 * pd;
      } else {
        const p = x[i] * g[i] * ps[i];
        Ptrue += p; app[i] = p;
      }
    }
    const s = app.reduce((u, v) => u + v, 0);
    return { P: Ptrue, y: app.map(v => v / s), gamma: g };
  }

  const info = {
    components: comps.map((c, i) => ({ id: ids[i], name: c.name, formula: c.formula, Tb_K: c.Tb_K })),
    model, pairs, missingPairs: missing,
    vapour: assoc.some(Boolean) ? "chemical theory (dimerization) for " + comps.filter((_, i) => assoc[i]).map(c => c.name).join(", ") : "ideal gas",
  };

  /**
   * Warnings that apply to a calculation at T (K) and P (kPa): temperatures more than
   * RANGE_MARGIN_K (10 K) outside the data range of a set that carries one (temperature-dependent
   * fits), pressures outside a set's pressure range, and notes on the choice of sets.
   */
  function warnings(T, P) {
    return pairWarnings(pairs, T, P, p => `${model} parameters of ${p.pair.join(" + ")}${p.default ? "" : ` (set "${p.set}")`} come`);
  }

  return { ids, names: comps.map(c => c.name), n, model, gammas, psat, equilibrium, info, warnings };
}
