import { injectStyles } from "./styles.js";
import { h } from "./dom.js";
import { createSystem, listComponents, findComponent } from "../thermo/system.js";
import { renderTxy } from "./txy.js";
import { renderTernary } from "./ternary.js";
import { pure } from "../thermo/pure.js";
import knownIssues from "../data/known-issues.json" with { type: "json" };
import { normalizeSets, normalizePrefer, setsFor, setChoices, pairKeyOf } from "./app-logic.js";

const TIER = { fitted: "fitted to experimental data", databank: "databank", predicted: "predicted", user: "given in this page" };

/**
 * Put an interactive phase-equilibrium view into a page element.
 *
 * @param {string|HTMLElement} target  element or CSS selector
 * @param {object} cfg
 * @param {string[]} cfg.components      2 components -> T-x-y diagram, 3 -> ternary diagram
 * @param {"NRTL"|"UNIQUAC"|"ideal"} [cfg.model="NRTL"]
 * @param {number} [cfg.P_kPa=101.325]
 * @param {string} [cfg.title]
 * @param {boolean} [cfg.picker=true]         let the viewer choose components
 * @param {boolean} [cfg.residueCurves=true]  ternary only
 * @param {boolean} [cfg.isotherms=true]      ternary only
 * @param {number} [cfg.grid=40]              ternary grid divisions
 * @param {boolean} [cfg.allowMissingPairs=false]
 * @param {"mole"|"mass"} [cfg.basis="mole"]  compositions in the readouts: mole fractions or wt %
 * @param {Object<string,string>} [cfg.sets]  parameter set per pair, e.g. { "acetone+chloroform": "chemsep" };
 *   pairs with more than one set also get a selector under "Parameter sources"
 * @param {"best"|"fitted"|"databank"|string[]} [cfg.prefer]  rule for every pair (see Fugacity.library)
 * @returns {{update:(patch:object)=>void, state:object}}
 *
 * @example
 * Fugacity.mount("#app", { components: ["water", "acetic acid", "ethylene glycol"] });
 */
export function mount(target, cfg = {}) {
  const root = typeof target === "string" ? document.querySelector(target) : target;
  if (!root) throw new Error(`Fugacity.mount: no element matches "${target}".`);
  injectStyles(root.ownerDocument);

  const norm = m => (String(m || "NRTL").toUpperCase() === "IDEAL" ? "ideal" : String(m || "NRTL").toUpperCase());
  const state = {
    components: (cfg.components || []).slice(),
    model: norm(cfg.model),
    basis: cfg.basis === "mass" ? "mass" : "mole",
    P: cfg.P_kPa ?? 101.325,
    picker: cfg.picker !== false,
    residueCurves: cfg.residueCurves !== false,
    isotherms: cfg.isotherms !== false,
    grid: cfg.grid ?? 40,
    allowMissingPairs: !!cfg.allowMissingPairs,
    title: cfg.title,
    feedbackUrl: cfg.feedbackUrl ?? "https://github.com/FaireDose/Fugacity/issues/new/choose",
    sets: normalizeSets(cfg.sets),
    prefer: normalizePrefer(cfg.prefer),
  };
  const uid = Math.random().toString(36).slice(2, 7);
  const all = listComponents().filter(c => c.activity);

  const box = h("div", { class: "fug" });
  root.replaceChildren(box);

  function picker() {
    const ids = state.components.map(c => { try { return findComponent(c); } catch { return null; } });
    const sel = (k, allowNone) => {
      const el = h("select", { id: `fug-c${k}-${uid}`, "aria-label": `Component ${k + 1}`, on: { change: ev => {
        const v = ev.target.value;
        const next = ids.slice();
        if (v === "") next.splice(k, 1);
        else {
          const other = next.indexOf(v);
          if (other >= 0 && other !== k) next[other] = next[k];   // picking a component already shown swaps the two
          next[k] = v;
        }
        state.components = next.filter(Boolean);
        state.title = undefined;
        render();
      } } },
        allowNone ? h("option", { value: "" }, "(none)") : null,
        ...all.map(c => h("option", { value: c.id, selected: ids[k] === c.id }, c.name)));
      if (allowNone && !ids[k]) el.value = "";
      return el;
    };
    return h("div", { class: "fug-controls" }, h("span", { class: "fug-sub" }, "Components"), sel(0), sel(1), sel(2, true));
  }

  function render() {
    const models = [["NRTL", "NRTL"], ["UNIQUAC", "UNIQUAC"], ["ideal", "Ideal"]];
    const seg = h("div", { class: "fug-seg", role: "group", "aria-label": "Activity model" },
      ...models.map(([m, label]) => h("button", {
        type: "button", "aria-pressed": String(state.model === m),
        on: { click: () => { state.model = m; render(); } },
      }, label)));
    const basisSeg = h("div", { class: "fug-seg", role: "group", "aria-label": "Composition basis" },
      ...[["mole", "mol frac"], ["mass", "wt %"]].map(([b, label]) => h("button", {
        type: "button", "aria-pressed": String(state.basis === b),
        on: { click: () => { state.basis = b; render(); } },
      }, label)));
    const pIn = h("input", { type: "number", id: `fug-p-${uid}`, value: state.P, min: 1, max: 1000, step: "any",
      on: { change: ev => { const v = +ev.target.value; if (v > 0) { state.P = v; render(); } } } });

    let sys, error = null;
    try {
      sys = createSystem({ components: state.components, model: state.model, allowMissingPairs: state.allowMissingPairs, ...setsFor(state, state.model) });
    } catch (e) {
      error = e.message.startsWith("No ") && e.message.includes("parameters for")
        ? e.message.split(". Pass")[0] + ". Pick other components, or suggest these pairs for the databank."
        : e.message;
    }
    const n = sys ? sys.n : state.components.length;
    const issues = sys && sys.info.pairs.every(p => p.default !== false) ? knownIssues.issues.filter(k => k.model === sys.model && k.components.length === sys.ids.length &&
      k.components.every(c => sys.ids.includes(c))) : [];
    const view = { basis: state.basis, MW: sys ? sys.ids.map(id => pure(id).MW) : [] };
    const checks = n === 3 ? [
      h("label", {}, h("input", { type: "checkbox", id: `fug-rc-${uid}`, checked: state.residueCurves, on: { change: ev => { state.residueCurves = ev.target.checked; render(); } } }), "Residue curves"),
      h("label", {}, h("input", { type: "checkbox", id: `fug-iso-${uid}`, checked: state.isotherms, on: { change: ev => { state.isotherms = ev.target.checked; render(); } } }), "Isotherms"),
    ] : [];

    const plot = h("div", { class: "fug-plot" }), side = h("div", { class: "fug-side", "aria-live": "polite" });
    const title = state.title || (sys ? sys.names.join(" + ") : "Phase equilibrium");
    const sources = sys ? sys.info.pairs.map((p, k) => {
      const choices = setChoices(p);
      if (!choices.length) return h("div", {}, `${p.pair.join(" + ")} (${TIER[p.tier] || p.tier}): ${p.source}`);
      const idOf = new Map(sys.info.components.map(c => [c.name, c.id]));
      const key = pairKeyOf(idOf.get(p.pair[0]), idOf.get(p.pair[1]));
      const sel = h("select", { id: `fug-set${k}-${uid}`, "aria-label": `Parameter set for ${p.pair.join(" + ")}`, on: { change: ev => {
        const v = ev.target.value, pick = choices.find(c => c.set === v);
        state.sets = normalizeSets({ [key]: pick?.default && !state.prefer ? null : v }, state.sets);
        render();
      } } }, ...choices.map(c => h("option", { value: c.set, selected: c.current }, c.label)));
      return h("div", {}, `${p.pair.join(" + ")} (${TIER[p.tier] || p.tier}), set `, sel, `: ${p.source}`);
    }) : [];
    if (sys && sys.info.missingPairs.length) sources.push(h("div", {}, `Treated as ideal (no parameters): ${sys.info.missingPairs.map(m => m.join(" + ")).join("; ")}.`));

    box.replaceChildren(
      h("div", { class: "fug-head" },
        h("h3", { class: "fug-title" }, title),
        sys ? h("span", { class: "fug-sub" }, `${n === 2 ? "T-x-y" : "Ternary"} · P = ${state.P} kPa · ${state.model} · vapour: ${sys.info.vapour}`) : null),
      state.picker ? picker() : null,
      h("div", { class: "fug-controls" }, seg, h("label", { for: pIn.id }, "Pressure, kPa", pIn), basisSeg, ...checks),
      ...issues.map(k => h("div", { class: "fug-warn", role: "note" }, h("strong", {}, `Known deviation (${k.model}): `), k.message, ` Reference: ${k.reference}.`)),
      h("div", { class: "fug-main" }, plot, side),
      h("div", { class: "fug-foot" }, sources.length ? h("div", {}, "Parameter sources:") : null, ...sources,
        h("div", {}, "Calculated live in this page by Fugacity. Predictions, not measurements. ",
          state.feedbackUrl ? h("a", { href: state.feedbackUrl, target: "_blank", rel: "noopener" }, "Report a problem or suggest data") : null)));

    if (error) { plot.replaceChildren(h("div", { class: "fug-err", role: "alert" }, error)); side.hidden = true; return; }
    try {
      if (n === 2) renderTxy(plot, side, sys, state.P, view);
      else if (n === 3) renderTernary(plot, side, sys, state.P, {
        ...state, ...view, makePairSystem: ids => createSystem({ components: ids, model: state.model, allowMissingPairs: state.allowMissingPairs, ...setsFor(state, state.model) }),
      });
      else throw new Error("The interface shows 2 or 3 components so far. Use the calculation functions for more.");
    } catch (e) {
      plot.replaceChildren(h("div", { class: "fug-err", role: "alert" }, e.message));
      side.hidden = true;
    }
  }

  render();
  return {
    state,
    update(patch) {
      if (patch.P_kPa != null) state.P = patch.P_kPa;
      if (patch.model) state.model = norm(patch.model);
      if ("sets" in patch) state.sets = patch.sets === null ? {} : normalizeSets(patch.sets, state.sets);
      if ("prefer" in patch) state.prefer = normalizePrefer(patch.prefer);
      Object.assign(state, Object.fromEntries(Object.entries(patch).filter(([k]) => !["P_kPa", "model", "sets", "prefer"].includes(k))));
      render();
    },
  };
}
