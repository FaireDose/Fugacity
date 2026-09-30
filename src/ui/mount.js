import { injectStyles } from "./styles.js";
import { h } from "./dom.js";
import { createSystem } from "../thermo/system.js";
import { renderTxy } from "./txy.js";
import { renderTernary } from "./ternary.js";

/**
 * Put an interactive phase-equilibrium view into a page element.
 *
 * @param {string|HTMLElement} target  element or CSS selector
 * @param {object} cfg
 * @param {string[]} cfg.components      2 components -> T-x-y diagram, 3 -> ternary diagram
 * @param {"NRTL"|"UNIQUAC"|"ideal"} [cfg.model="NRTL"]
 * @param {number} [cfg.P_kPa=101.325]
 * @param {string} [cfg.title]
 * @param {boolean} [cfg.residueCurves=true]  ternary only
 * @param {boolean} [cfg.isotherms=true]      ternary only
 * @param {number} [cfg.grid=40]              ternary grid divisions
 * @param {boolean} [cfg.allowMissingPairs=false]
 * @returns {{update:(patch:object)=>void, state:object}}
 *
 * @example
 * Fugacity.mount("#app", { components: ["water", "acetic acid", "ethylene glycol"] });
 */
export function mount(target, cfg = {}) {
  const root = typeof target === "string" ? document.querySelector(target) : target;
  if (!root) throw new Error(`Fugacity.mount: no element matches "${target}".`);
  injectStyles(root.ownerDocument);

  const state = {
    components: cfg.components || [],
    model: (cfg.model || "NRTL").toUpperCase() === "IDEAL" ? "ideal" : (cfg.model || "NRTL").toUpperCase(),
    P: cfg.P_kPa ?? 101.325,
    residueCurves: cfg.residueCurves !== false,
    isotherms: cfg.isotherms !== false,
    grid: cfg.grid ?? 40,
    allowMissingPairs: !!cfg.allowMissingPairs,
    title: cfg.title,
  };

  const box = h("div", { class: "fug" });
  root.replaceChildren(box);

  function render() {
    let sys;
    try {
      sys = createSystem({ components: state.components, model: state.model, allowMissingPairs: state.allowMissingPairs });
    } catch (e) {
      box.replaceChildren(h("div", { class: "fug-err", role: "alert" }, e.message));
      return;
    }
    const n = sys.n;
    const models = [["NRTL", "NRTL"], ["UNIQUAC", "UNIQUAC"], ["ideal", "Ideal"]];
    const seg = h("div", { class: "fug-seg", role: "group", "aria-label": "Activity model" },
      ...models.map(([m, label]) => h("button", {
        type: "button", "aria-pressed": String(state.model === m),
        on: { click: () => { state.model = m; render(); } },
      }, label)));
    const pIn = h("input", { type: "number", id: "fug-p-" + Math.random().toString(36).slice(2, 7), value: state.P, min: 1, max: 1000, step: "any",
      on: { change: ev => { const v = +ev.target.value; if (v > 0) { state.P = v; render(); } } } });
    const checks = n === 3 ? [
      h("label", {}, h("input", { type: "checkbox", checked: state.residueCurves, on: { change: ev => { state.residueCurves = ev.target.checked; render(); } } }), "Residue curves"),
      h("label", {}, h("input", { type: "checkbox", checked: state.isotherms, on: { change: ev => { state.isotherms = ev.target.checked; render(); } } }), "Isotherms"),
    ] : [];

    const plot = h("div", { class: "fug-plot" }), side = h("div", { class: "fug-side", "aria-live": "polite" });
    const title = state.title || sys.names.join(" + ");
    const sources = sys.info.pairs.map(p => h("div", {}, `${p.pair.join(" + ")}: ${p.source}`));
    if (sys.info.missingPairs.length) sources.push(h("div", {}, `Treated as ideal (no parameters): ${sys.info.missingPairs.map(m => m.join(" + ")).join("; ")}.`));

    box.replaceChildren(
      h("div", { class: "fug-head" },
        h("h3", { class: "fug-title" }, title),
        h("span", { class: "fug-sub" }, `${n === 2 ? "T-x-y" : "Ternary"} · P = ${state.P} kPa · ${state.model} · vapour: ${sys.info.vapour}`)),
      h("div", { class: "fug-controls" }, seg, h("label", { for: pIn.id }, "Pressure, kPa", pIn), ...checks),
      h("div", { class: "fug-main" }, plot, side),
      h("div", { class: "fug-foot" }, h("div", {}, "Parameter sources:"), ...sources, h("div", {}, "Calculated live in this page by Fugacity. Predictions, not measurements.")));

    try {
      if (n === 2) renderTxy(plot, side, sys, state.P);
      else if (n === 3) renderTernary(plot, side, sys, state.P, state);
      else throw new Error("The interface shows 2 or 3 components so far. Use the calculation functions for more.");
    } catch (e) {
      plot.replaceChildren(h("div", { class: "fug-err", role: "alert" }, e.message));
    }
  }

  render();
  return {
    state,
    update(patch) {
      if (patch.P_kPa != null) state.P = patch.P_kPa;
      Object.assign(state, Object.fromEntries(Object.entries(patch).filter(([k]) => k !== "P_kPa")));
      render();
    },
  };
}
