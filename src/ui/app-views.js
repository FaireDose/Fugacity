/**
 * Workbench canvases (Fugacity.app): each function draws one view into the canvas, writes
 * the readout into the Results panel and returns { data } for the status bar. The source
 * browser (sourcesPanel) fills the Sources drawer. A view receives the state with
 * `components` set to the checked inputs of that view (and `z` to its own feed).
 *
 * Views only: every number comes from the public calculation functions (system(), pure(),
 * steam(), steamSat(), henry(), henryInfo(), gasSolubility()) or from the existing
 * renderers (renderTxy, renderTernary, mountProperties). Where the engine has no value or
 * throws, the view says so and draws nothing there; nothing is estimated. Sources come from
 * the library (Fugacity.library, src/thermo/library.js).
 */
import { h, s, text, ticks, basisView } from "./dom.js";
import { icon } from "./icons.js";
import { renderTxy } from "./txy.js";
import { renderTernary } from "./ternary.js";
import { mountProperties } from "./properties.js";
import { drawPlot } from "./plot.js";
import { system } from "../system.js";
import { listComponents } from "../thermo/system.js";
import { pure, PROPERTIES, PROPERTY_NAMES } from "../thermo/pure.js";
import { SOLID_UNITS, solidIn } from "./solubility-units.js";
import { steam, steamSat } from "../thermo/iapws/steam.js";
import { henry, henryInfo, gasSolubility } from "../thermo/henry.js";
import { ternaryAzeotropes, binaryAzeotropes } from "../equilibrium/azeotrope.js";
import { library, sourceEntry, componentSources } from "../thermo/library.js";
import {
  knownIssuesFor, pxyTemperature, tierCounts, tierSummary, normalizeComposition, interpolate, fmtP, fmtTemp, parseP, parseT,
  setsFor, filterSources, sourceUsedFor, modelLabel,
} from "./app-logic.js";
import { HENRY_PAIRS, isEosModel } from "./workspaces.js";
import { flowsheetView } from "./flowsheet-view.js";
import { runFlash, flashTable, flashCsv, phaseName, FLASH_SPECS, dutyKW, molarFlow } from "./flash-logic.js";
import pkg from "../../package.json" with { type: "json" };
import {
  txyTables, ternaryTables, pxyTables, envelopeTables, azeotropeTables, flashTables, henryTables, solidTables, sleTables, propertyTables, steamTables,
} from "./diagram-tables.js";
import {
  tToDisplay, tFromDisplay, pToDisplay, fmtNum, fmtShort, linspace, niceValues, TIER_LABEL, formatSource,
} from "./properties-logic.js";

const SERIES = n => `var(--fug-s${(n % 6) + 1})`;
const nameOf = id => listComponents().find(c => c.id === id)?.name ?? id;
const tU = u => (u.T === "K" ? "K" : "°C");

/**
 * Draw `view` into the canvas. ctx: { state, set, plot, side, notes, below, extra, compact, uid, badge }.
 * Returns { data, error?, record?, export? }: `export()` describes the numbers behind the diagram
 * for the Excel download (diagram-export.js), the points the view calculated and drew.
 */
export function renderView(view, ctx) {
  ctx.plot.dataset.view = view;
  switch (view) {
    case "txy": case "ternary": return vleView(view, ctx);
    case "azeotropes": return azeotropeView(ctx);
    case "pxy": return pxyView(ctx);
    case "envelope": return envelopeView(ctx);
    case "flash": return flashView(ctx);
    case "henry": return henryView(ctx);
    case "solid": return solidView(ctx);
    case "sle": return sleView(ctx);
    case "properties": return propertiesView(ctx);
    case "steam": return steamView(ctx);
    case "flowsheet": return flowsheetView({ ...ctx, saveText, copyText });
    default: throw new Error(`Unknown view "${view}".`);
  }
}

// ---------------------------------------------------------------------------------------
// shared pieces

function section(title, ...children) {
  return h("section", { class: "fa-sec" }, h("h3", {}, title), ...children);
}

function sourceList(ctx, items) {
  return h("ul", { class: "fa-sources" }, ...items.map(it => h("li", {},
    h("div", { class: "fa-src-head" }, h("span", {}, it.label), ctx.badge(it.tier)),
    it.text ? h("div", { class: "fa-src-text" + (it.text.length > 150 ? " is-clamped" : ""), title: it.text.length > 150 ? "Click to show all" : undefined,
      on: { click: ev => ev.currentTarget.classList.remove("is-clamped") } }, it.text) : null)));
}

const KIND_LABEL = {
  "standard": "Standard", "open-source library": "Open-source library", "databank": "Databank", "thermoml": "ThermoML Archive",
  "open-access article": "Open-access article", "free book": "Free book", "handbook via open compilation": "Handbook, open compilation", "user": "Given in this page",
};
const linkOf = s => s.url || (s.doi ? `https://doi.org/${s.doi}` : null);
const byline = s => [s.authors, s.published ?? s.year].filter(Boolean).join(", ");

/** Sources from the library, as short linked entries: title, authors and year, kind, why it is open. */
function sourceLinks(ids, { access = true } = {}) {
  const items = [...new Set(ids)].map(sourceEntry).filter(Boolean);
  if (!items.length) return null;
  return h("ul", { class: "fa-libsrc" }, ...items.map(s => {
    const href = linkOf(s);
    return h("li", {},
      href ? h("a", { href, target: "_blank", rel: "noopener", title: s.id }, s.title) : h("span", { title: s.id }, s.title),
      h("div", { class: "fa-libsrc-meta" }, [byline(s), KIND_LABEL[s.kind] ?? s.kind, s.via ? `via ${s.via}` : null].filter(Boolean).join(" · ")),
      access ? h("div", { class: "fa-libsrc-why" }, s.access) : null);
  }));
}

/** The pair parameter sets in use, each with its set name, tier, fit text and library sources. */
function pairSources(ctx, pairs, { kij = false } = {}) {
  return h("ul", { class: "fa-sources" }, ...pairs.map(p => h("li", {},
    h("div", { class: "fa-src-head" }, h("span", {}, p.pair.join(" + "), kij && p.tier !== "none" ? h("small", { class: "fa-kij" }, ` k_ij = ${fmtShort(p.kij, 4)}`) : null), ctx.badge(p.tier)),
    p.set ? h("div", { class: "fa-src-set" }, `Set “${p.set}”${p.default ? ", default" : ""}${p.alternatives?.length ? ` · ${p.alternatives.length} other${p.alternatives.length > 1 ? "s" : ""} in the Inputs panel` : ""}`) : null,
    p.note ? h("div", { class: "fa-src-note" }, p.note) : null,
    sourceLinks(p.source_ids ?? []),
    p.source ? h("div", { class: "fa-src-text" + (p.source.length > 150 ? " is-clamped" : ""), title: p.source.length > 150 ? "Click to show all" : undefined,
      on: { click: ev => ev.currentTarget.classList.remove("is-clamped") } }, p.source) : null)));
}

/** Library sources of the pure-component records of `ids` (only `keys`), grouped by source. */
function componentSourceList(ids, keys) {
  const bySource = new Map();
  for (const id of ids) for (const r of componentSources(id)) {
    if (keys && !keys.includes(r.key)) continue;
    for (const sid of r.source_ids) {
      if (!bySource.has(sid)) bySource.set(sid, new Map());
      const m = bySource.get(sid);
      if (!m.has(r.label)) m.set(r.label, []);
      m.get(r.label).push(nameOf(id));
    }
  }
  if (!bySource.size) return null;
  return h("ul", { class: "fa-sources" }, ...[...bySource].map(([sid, m]) => h("li", {},
    sourceLinks([sid], { access: false }),
    h("div", { class: "fa-src-text" }, [...m].map(([label, names]) => `${label[0].toUpperCase()}${label.slice(1)}: ${names.join(", ")}`).join("; ")))));
}

/** Known deviations apply to the default sets only (they were found with them). */
const onDefaults = sys => sys.info.pairs.every(p => p.default !== false);

function friendly(e) {
  const m = e.message;
  return m.startsWith("No ") && m.includes("parameters for")
    ? m.split(". Pass")[0] + ". Pick other components, or suggest these pairs for the databank (Help find open data)."
    : m;
}

/** Points the engine could not calculate: their count and one example message per kind of failure. */
function gapNote(reasons, what) {
  if (!reasons.size) return null;
  const total = [...reasons.values()].reduce((a, r) => a + r.n, 0);
  return h("div", { class: "fa-gaps" }, h("strong", {}, `${total} point${total === 1 ? "" : "s"} not drawn: the engine found no ${what} there.`),
    ...[...reasons.values()].slice(0, 3).map(r => h("div", {}, `${r.n === total ? "" : `${r.n}: `}${r.example}`)));
}

function addReason(map, msg) {
  // the kind of failure: the message without its numbers and its opening clause (which states the conditions)
  const text = String(msg);
  const key = text.replace(/^[^:]*:/, "").replace(/-?\d+(\.\d+)?(e[+-]?\d+)?/g, "#").slice(0, 120);
  const prev = map.get(key);
  if (prev) prev.n++; else map.set(key, { n: 1, example: text.length > 420 ? text.slice(0, 420) + "…" : text });
}


function kv(rows) {
  return h("table", { class: "fa-kv" }, h("tbody", {}, ...rows.filter(Boolean).map(([k, v, unit]) =>
    h("tr", {}, h("th", { scope: "row" }, k), h("td", { class: "fug-num" }, v ?? "–", unit ? h("small", {}, ` ${unit}`) : null)))));
}

/** "Methanol, acetone and chloroform". */
const listNames = names => names.join(", ").replace(/, ([^,]*)$/, " and $1");

/** The About rows of an export: components, model, conditions, units, parameters and their sources. */
function aboutRows(state, sys, conditions = []) {
  const u = state.units;
  const model = sys.kind === "eos" ? sys.info.equation : `${sys.model === "ideal" ? "Ideal solution" : sys.model}; vapour: ${sys.info.vapour}`;
  return [
    ["Components", sys.names.join(", ")], ["Model", model], ...conditions,
    ["Units", `T in ${tU(u)}, P in ${u.P}; compositions in mole fractions${state.basis === "mass" ? " and wt %" : ""}`],
    ["Parameters", pairData(sys)],
    ...sys.info.pairs.map(p => [`Pair ${p.pair.join(" + ")}`, [p.tier, p.set ? `set ${p.set}` : null, sys.kind === "eos" ? `k_ij = ${p.kij}` : null, p.source].filter(Boolean).join("; ")]),
  ];
}

// ---------------------------------------------------------------------------------------
// T-x-y and ternary: the existing renderers

function vleView(view, ctx) {
  const { state, plot, side, notes, extra } = ctx;
  const av = { use: state.components };
  const opts = setsFor(state, state.model);
  let sys;
  try { sys = modelSystem(state, av.use); } catch (e) { throw new Error(friendly(e)); }
  for (const k of onDefaults(sys) ? knownIssuesFor(sys.ids, sys.model) : []) {
    notes.append(h("div", { class: "fug-warn", role: "note" }, h("strong", {}, `Known deviation (${k.model}): `), k.message, ` Reference: ${k.reference}.`));
  }
  const look = { basis: state.basis, MW: sys.ids.map(id => pure(id).MW), T: state.units.T };
  const drawn = view === "txy" ? renderTxy(plot, side, sys, state.P_kPa, look)
    : renderTernary(plot, side, sys, state.P_kPa, {
      ...look, residueCurves: state.residueCurves, isotherms: state.isotherms, grid: state.grid,
      makePairSystem: ids => modelSystem(state, ids),
    });
  const exp = () => ({
    title: `${view === "txy" ? "T-x-y diagram" : "Ternary map"} of ${listNames(sys.names)} at ${fmtP(state.P_kPa, state.units)}`,
    file: `${view} ${sys.ids.join(" ")}`,
    about: aboutRows(state, sys, [["Pressure", fmtP(state.P_kPa, state.units)]]),
    tables: view === "txy"
      ? txyTables({ names: sys.names, MW: look.MW, units: state.units, basis: state.basis, ...drawn, activity: sys.kind !== "eos" })
      : ternaryTables({ names: sys.names, MW: look.MW, units: state.units, basis: state.basis, ...drawn }),
  });
  if (sys.kind === "eos") {
    extra.append(...eosSources(ctx, sys));
    return { data: tierSummary(tierCounts(sys.info.pairs), "k_ij pair"), export: exp };
  }
  const counts = tierCounts(sys.info.pairs, sys.info.missingPairs);
  extra.append(section("Parameter sources", sys.info.pairs.length
    ? pairSources(ctx, sys.info.pairs)
    : h("div", { class: "fa-empty" }, "Ideal solution: no binary parameters (activity coefficients equal 1)."),
  h("div", { class: "fug-foot" }, `Vapour: ${sys.info.vapour}. Predictions, not measurements.`)),
  section("Pure-component data", componentSourceList(sys.ids, ["vapourPressure", "uniquac", "association"]) ?? h("div", { class: "fa-empty" }, "No sources recorded.")));
  const alt = sys.info.pairs.filter(p => p.default === false).length;
  return { data: sys.model === "ideal" ? "Ideal solution, no pair parameters" : tierSummary(counts) + (alt ? `; ${alt} on a non-default set` : ""), export: exp };
}

// ---------------------------------------------------------------------------------------
// Azeotropes: one small T-x-y per pair, and the singular points in boiling order

/** T-x-y samples by the system's own bubble point; null where none is found (an engine error). */
function sampleTxy(sys, P, n) {
  const out = [];
  let missed = 0, message = null;
  for (let k = 0; k < n; k++) {
    const x = k / (n - 1);
    try { const r = sys.bubbleT([x, 1 - x], P); out.push({ x, T: r.T, y: r.y[0] }); } catch (e) {
      if (!(e && e.code)) throw e;
      out.push(null); missed++; message ??= e.message;
    }
  }
  if (!out.some(Boolean)) throw new Error(message ?? "No bubble point found.");
  return { data: out, missed, message };
}

function miniTxy(sys, data, azeo, P, u, bv) {
  const W1 = x1 => bv.conv([x1, 1 - x1])[0];   // drawn in the display basis
  const W = 260, H = 150, L = 34, R = 10, T = 10, B = 24;
  const Tc = data.filter(Boolean).map(d => tToDisplay(d.T, u));
  const lo = Math.min(...Tc), hi = Math.max(...Tc), pad = Math.max(0.5, (hi - lo) * 0.08);
  const y0 = lo - pad, y1 = hi + pad;
  const sx = v => L + v * (W - L - R), sy = v => H - B - (v - y0) / (y1 - y0) * (H - T - B);
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `T-x-y diagram of ${sys.names.join(" and ")} at ${P} kPa` });
  const g = s("g", { class: "fug-bg-layer" }, svg);
  for (const v of ticks(y0, y1, 3).values) {
    s("line", { x1: L, x2: W - R, y1: sy(v), y2: sy(v), stroke: "var(--fug-rule)" }, g);
    text(svg, L - 4, sy(v) + 3, String(+v.toFixed(1)), { "text-anchor": "end", "font-size": 9 });
  }
  s("line", { x1: L, x2: W - R, y1: H - B, y2: H - B, stroke: "var(--fug-muted)" }, svg);
  for (const v of [0, 0.5, 1]) text(svg, sx(v), H - B + 12, bv.mass ? bv.tick(v) : String(v), { "text-anchor": "middle", "font-size": 9 });
  text(svg, (L + W - R) / 2, H - 2, `x, y ${sys.names[0]}${bv.mass ? ", wt %" : ""}`, { "text-anchor": "middle", "font-size": 9, fill: "var(--fug-fg2)" });
  const path = key => data.map((d, k) => (d ? `${data[k - 1] ? "L" : "M"}${sx(W1(d[key])).toFixed(1)},${sy(tToDisplay(d.T, u)).toFixed(1)}` : "")).join("");
  s("path", { d: path("x"), fill: "none", stroke: "var(--fug-liq)", "stroke-width": 1.8 }, svg);
  s("path", { d: path("y"), fill: "none", stroke: "var(--fug-vap)", "stroke-width": 1.8, "stroke-dasharray": "5 3" }, svg);
  for (const z of azeo) s("circle", { cx: sx(W1(z.x)), cy: sy(tToDisplay(z.T, u)), r: 4, fill: "var(--fug-fg)", stroke: "var(--fug-halo)", "stroke-width": 2 }, svg);
  return svg;
}

function azeotropeView(ctx) {
  const { state, plot, side, below, extra, set } = ctx;
  const u = state.units, P = state.P_kPa;
  const ids = state.components;
  const MW = Object.fromEntries(ids.map(id => [id, pure(id).MW]));
  const opts = setsFor(state, state.model);
  const comp = (x, pairIds) => {
    const bv = basisView(state.basis, pairIds.map(id => MW[id]));
    const w = bv.conv(x);
    return pairIds.map((id, k) => (x[k] > 1e-6 ? `${nameOf(id)} ${state.basis === "mass" ? bv.f(w[k]) + " wt %" : fmtNum(x[k], 3)}` : null)).filter(Boolean).join(", ");
  };
  const cards = [], points = [], sources = new Map(), errors = [], drawnPairs = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const pair = [ids[i], ids[j]];
    let sys;
    try { sys = modelSystem(state, pair); } catch (e) {
      errors.push(friendly(e));
      cards.push(h("div", { class: "fa-card is-missing" }, h("div", { class: "fa-card-head" }, h("strong", {}, `${nameOf(pair[0])} + ${nameOf(pair[1])}`), ctx.badge("none")),
        h("div", { class: "fa-empty" }, friendly(e))));
      continue;
    }
    for (const p of sys.info.pairs) sources.set(p.pair.join(" + "), p);
    let sample, az;
    try { sample = sampleTxy(sys, P, 61); az = binaryAzeotropes(sys, P, 200, { gaps: true }); } catch (e) {
      if (!(e && e.code) && !/bubble point/i.test(e.message)) throw e;
      errors.push(`${nameOf(pair[0])} + ${nameOf(pair[1])}: ${e.message}`);
      cards.push(h("div", { class: "fa-card is-missing" }, h("div", { class: "fa-card-head" }, h("strong", {}, `${nameOf(pair[0])} + ${nameOf(pair[1])}`)),
        h("div", { class: "fa-empty" }, e.message)));
      continue;
    }
    const data = sample.data;
    drawnPairs.push({ names: sys.names, MW: pair.map(id => MW[id]), data });
    for (const z of az) points.push({ T: z.T, kind: z.type === "minimum-boiling" ? "Minimum-boiling azeotrope" : "Maximum-boiling azeotrope", what: comp([z.x, 1 - z.x], pair) });
    const tier = sys.info.pairs[0]?.tier ?? (state.model === "ideal" ? "ideal" : "none");
    cards.push(h("div", { class: "fa-card" },
      h("div", { class: "fa-card-head" }, h("strong", {}, `${nameOf(pair[0])} + ${nameOf(pair[1])}`), state.model === "ideal" ? null : ctx.badge(tier)),
      miniTxy(sys, data, az, P, u, basisView(state.basis, pair.map(id => MW[id]))),
      h("div", { class: "fa-card-text" }, az.length
        ? az.map(z => h("div", {}, `${z.type === "minimum-boiling" ? "Minimum" : "Maximum"}-boiling azeotrope at ${fmtTemp(z.T, u, 1)}: ${comp([z.x, 1 - z.x], pair)}`,
          z.within ? h("small", {}, ` (${nameOf(pair[0])} mole fraction between ${fmtNum(z.within[0], 4)} and ${fmtNum(z.within[1], 4)}: the equation-of-state solver stops at y = x)`) : null))
        : "No azeotrope at this pressure.",
      az.gaps ? h("div", { class: "fug-warn" }, `${az.gaps.points} of 200 search points had no bubble point from the solver and were skipped${sample.missed ? " (gaps in the curves)" : ""}: an azeotrope there would be missed. ${az.gaps.message}`) : null),
      h("button", { type: "button", class: "fa-link-btn", on: { click: () => set({ inputs: { txy: pair }, view: "txy" }) } }, "Open as T-x-y diagram")));
  }
  if (ids.length >= 3) {
    try {
      const tri = ids.slice(0, 3);
      const sys3 = modelSystem(state, tri);
      const found = ternaryAzeotropes(sys3, P, pids => modelSystem(state, pids), { gaps: true });
      if (found.notSearched) ctx.notes.append(h("div", { class: "fug-warn", role: "note" }, found.notSearched));
      for (const z of found.filter(z => z.kind === "ternary")) {
        points.push({ T: z.T, kind: "Ternary azeotrope", what: comp(z.x, tri) });
      }
      for (const k of onDefaults(sys3) ? knownIssuesFor(sys3.ids, sys3.model) : []) ctx.notes.append(h("div", { class: "fug-warn", role: "note" }, h("strong", {}, `Known deviation (${k.model}): `), k.message, ` Reference: ${k.reference}.`));
    } catch (e) { errors.push(`Ternary search (${ids.slice(0, 3).map(nameOf).join(", ")}): ${friendly(e)}`); }
  }
  // pure-component boiling points do not depend on the mixing rules: the vapour-pressure
  // correlations for activity models, the equation of state's own saturation curve otherwise
  try {
    const tb = (isEosModel(state.model) ? modelSystem(state, ids) : system({ components: ids, model: "ideal" })).boilingPoints(P);
    ids.forEach((id, k) => points.push({ T: tb[k], kind: "Pure component", what: nameOf(id) }));
  } catch (e) { errors.push(e.message); }
  points.sort((a, b) => a.T - b.T);

  plot.replaceChildren(h("div", { class: "fa-cards" }, ...cards),
    h("div", { class: "fug-legend" },
      h("span", { class: "fug-key", style: "color:var(--fug-liq)" }, h("i"), h("span", { style: "color:var(--fug-fg2)" }, "Bubble curve")),
      h("span", { class: "fug-key", style: "color:var(--fug-vap)" }, h("i", { style: "border-top-style:dashed" }), h("span", { style: "color:var(--fug-fg2)" }, "Dew curve")),
      h("span", {}, "● azeotrope"), h("span", {}, `T in ${tU(u)}`)));
  below.replaceChildren(section("Singular points, lowest to highest boiling",
    h("div", { class: "fug-scroll" }, h("table", { class: "fa-table" },
      h("thead", {}, h("tr", {}, h("th", {}, `T, ${tU(u)}`), h("th", {}, "Point"), h("th", {}, `Composition (${state.basis === "mass" ? "wt %" : "mole fraction"})`))),
      h("tbody", {}, ...points.map(p => h("tr", {}, h("td", { class: "fug-num" }, fmtShort(+tToDisplay(p.T, u).toFixed(2))), h("td", {}, p.kind), h("td", {}, p.what)))))),
    h("div", { class: "fug-foot" }, "The lowest-boiling point goes to the top of a distillation column, the highest to the bottom; azeotropes can split the composition space into separate distillation regions.")));
  const nAz = points.filter(p => p.kind !== "Pure component").length;
  const exp = () => ({
    title: `Azeotropes of ${listNames(ids.map(nameOf))} at ${fmtP(P, u)}`, file: `azeotropes ${ids.join(" ")}`,
    about: [["Components", ids.map(nameOf).join(", ")], ["Model", modelLabel(state)], ["Pressure", fmtP(P, u)],
      ["Units", `T in ${tU(u)}; compositions in mole fractions${state.basis === "mass" ? " and wt %" : ""}`], ...errors.map(e => ["Not calculated", e])],
    tables: azeotropeTables({ units: u, basis: state.basis, pairs: drawnPairs, points }),
  });
  side.replaceChildren(
    h("div", {}, h("div", { class: "fug-eyebrow" }, "Azeotropes found"), h("div", { class: "fug-big" }, String(nAz))),
    h("div", { class: "fug-sub" }, `${ids.length} components, ${ids.length * (ids.length - 1) / 2} pairs, at ${fmtP(P, u)}.`),
    ...(errors.length ? [h("div", { class: "fug-err" }, ...errors.map(e => h("div", {}, e)))] : []));
  if (isEosModel(state.model)) {
    extra.append(...eosSources(ctx, modelSystem(state, ids)));
    return { data: tierSummary(tierCounts([...sources.values()]), "k_ij pair"), error: errors.length ? errors[0] : null, export: exp };
  }
  extra.append(section("Parameter sources", sources.size
    ? pairSources(ctx, [...sources.values()])
    : h("div", { class: "fa-empty" }, state.model === "ideal" ? "Ideal solution: no binary parameters." : "No pair has parameters.")),
  section("Pure-component data", componentSourceList(ids, ["vapourPressure", "uniquac", "association"]) ?? h("div", { class: "fa-empty" }, "No sources recorded.")));
  return { data: tierSummary(tierCounts([...sources.values()])) || (state.model === "ideal" ? "Ideal solution" : ""), error: errors.length ? errors[0] : null, export: exp };
}

// ---------------------------------------------------------------------------------------
// The system of a diagram: the model of the Model group (activity model with its vapour
// model, or an equation of state), with the parameter sets of the Library

function modelSystem(state, ids) {
  return system({ components: ids, model: state.model, ...setsFor(state, state.model) });
}

/** Parameter and pure-component sources of an activity-model system. */
function activitySources(ctx, sys) {
  return [section("Parameter sources", sys.info.pairs.length
    ? pairSources(ctx, sys.info.pairs)
    : h("div", { class: "fa-empty" }, "Ideal solution: no binary parameters (activity coefficients equal 1)."),
  h("div", { class: "fug-foot" }, `Vapour: ${sys.info.vapour}. Predictions, not measurements.`)),
  section("Pure-component data", componentSourceList(sys.ids, ["vapourPressure", "uniquac", "association"]) ?? h("div", { class: "fa-empty" }, "No sources recorded."))];
}
const sourcesOf = (ctx, sys) => (sys.kind === "eos" ? eosSources(ctx, sys) : activitySources(ctx, sys));
const pairData = sys => (sys.kind === "eos" ? tierSummary(tierCounts(sys.info.pairs), "k_ij pair")
  : sys.model === "ideal" ? "Ideal solution, no pair parameters" : tierSummary(tierCounts(sys.info.pairs, sys.info.missingPairs)));

function eosSources(ctx, sys) {
  const pairs = sys.info.pairs.map(p => (p.tier === "none" ? { ...p, source: "No k_ij in the databank; 0 is used.", kij: 0 }
    : { ...p, source: `${p.source}${p.T_range_K ? `; data range ${p.T_range_K[0]}–${p.T_range_K[1]} K` : ""}` }));
  return [section("Model and sources",
    h("div", { class: "fa-src-text" }, `${sys.info.equation}, both phases.`),
    pairs.length ? pairSources(ctx, pairs, { kij: true }) : null,
    ...(sys.info.notes || []).map(n => h("div", { class: "fug-foot" }, n))),
  section("Critical constants and acentric factors", componentSourceList(sys.ids, ["constants_source", "omega_source"])
    ?? h("div", { class: "fa-empty" }, "From the component records (no source recorded for the critical constants of these liquids yet)."))];
}

/** Bubble and dew points of the feed at a given T or P, with the model in use (any model). */
function bubbleDewCalculator(ctx, sys, ids) {
  const { state, set, uid } = ctx;
  const u = state.units;
  const z = normalizeComposition(state.z, ids.length);
  const calc = { T: pxyTemperature(state), P: state.P_kPa };
  const out = h("div", { class: "fa-calc-out", "aria-live": "polite" });
  const zIns = ids.map((id, k) => h("input", { type: "text", inputmode: "decimal", id: `fa-z${k}-${uid}`, value: fmtShort(z[k], 4), "aria-label": `Mole fraction of ${nameOf(id)}` }));
  const commitZ = () => {
    const v = zIns.map(i => Number(i.value));
    if (v.some(x => !(x >= 0)) || !(v.reduce((a, b) => a + b, 0) > 0)) return;
    set({ z: v });
  };
  zIns.forEach(i => i.addEventListener("change", commitZ));
  const tIn = h("input", { type: "text", inputmode: "decimal", id: `fa-ct-${uid}`, value: String(+tToDisplay(calc.T, u).toFixed(3)),
    on: { change: ev => { const v = parseT(ev.target.value, u); if (v) { calc.T = v; run(); } } } });
  const pIn = h("input", { type: "text", inputmode: "decimal", id: `fa-cp-${uid}`, value: fmtShort(pToDisplay(calc.P, u), 6),
    on: { change: ev => { const v = parseP(ev.target.value, u); if (v) { calc.P = v; run(); } } } });
  function run() {
    const rows = [
      ["Bubble pressure", `at ${fmtTemp(calc.T, u)}`, () => { const r = sys.bubbleP(z, calc.T); return [fmtP(r.P, u), "vapour", r.y]; }],
      ["Dew pressure", `at ${fmtTemp(calc.T, u)}`, () => { const r = sys.dewP(z, calc.T); return [fmtP(r.P, u), "liquid", r.x]; }],
      ["Bubble temperature", `at ${fmtP(calc.P, u)}`, () => { const r = sys.bubbleT(z, calc.P); return [fmtTemp(r.T, u), "vapour", r.y]; }],
      ["Dew temperature", `at ${fmtP(calc.P, u)}`, () => { const r = sys.dewT(z, calc.P); return [fmtTemp(r.T, u), "liquid", r.x]; }],
    ];
    out.replaceChildren(...rows.map(([label, at, f]) => {
      try {
        const [v, phase, comp] = f();
        return h("div", { class: "fa-result" }, h("div", { class: "fa-result-head" }, h("span", {}, `${label} `, h("small", {}, at)), h("b", { class: "fug-num" }, v)),
          ids.length > 1 ? h("div", { class: "fug-sub" }, `Incipient ${phase}: ${comp.map((c, k) => `${nameOf(ids[k])} ${fmtNum(c, 3)}`).join(", ")}`) : null);
      } catch (e) {
        return h("div", { class: "fa-result is-err" }, h("div", { class: "fa-result-head" }, h("span", {}, `${label} `, h("small", {}, at)), h("b", {}, "none")),
          h("div", { class: "fug-sub" }, e.message.length > 240 ? e.message.slice(0, 240) + "…" : e.message));
      }
    }));
  }
  run();
  return section("Bubble and dew points",
    h("div", { class: "fa-form" },
      ...ids.map((id, k) => h("label", { for: zIns[k].id }, h("span", {}, `z ${nameOf(id)}`), zIns[k])),
      h("label", { for: tIn.id }, h("span", {}, `T, ${tU(u)}`), tIn), h("label", { for: pIn.id }, h("span", {}, `P, ${u.P}`), pIn)),
    h("div", { class: "fug-foot" }, "Feed mole fractions are normalized to sum to 1. The feed is also the composition of the phase envelope."),
    out);
}

/** Split sampled values (null = no value) into drawable segments. */
function segmentsOf(points) {
  const segs = [];
  let cur = null;
  for (const p of points) {
    if (!p) { cur = null; continue; }
    if (!cur) { cur = { points: [] }; segs.push(cur); }
    cur.points.push(p);
  }
  return segs;
}
const interpSegs = (segs, x) => { for (const g of segs) { const v = interpolate(g.points, x); if (v != null) return v; } return null; };

function pxyView(ctx) {
  const { state, plot, side, notes, extra, compact } = ctx;
  const u = state.units, ids = state.components;
  let sys;
  try { sys = modelSystem(state, ids); } catch (e) { throw new Error(friendly(e)); }
  const T = pxyTemperature(state);
  // the composition axis in the display basis: mole fraction, or wt % (0 to 100)
  const bv = basisView(state.basis, ids.map(id => pure(id).MW));
  const scale = bv.mass ? 100 : 1;
  const X = x1 => scale * bv.conv([x1, 1 - x1])[0];
  const fromX = v => bv.inv([v / scale, 1 - v / scale])[0];
  const N = 51, bub = [], dew = [], raw = [], reasons = new Map(), warnings = new Set();
  for (let i = 0; i < N; i++) {
    const x = i / (N - 1);
    try {
      const r = sys.bubbleP([x, 1 - x], T);
      (r.warnings || []).forEach(w => warnings.add(w));
      bub.push({ x: X(x), y: pToDisplay(r.P, u) }); dew.push({ x: X(r.y[0]), y: pToDisplay(r.P, u) });
      raw.push({ x, y: r.y[0], P: r.P });
    } catch (e) { if (!(e && e.code)) throw e; addReason(reasons, e.message); bub.push(null); dew.push(null); raw.push(null); }
  }
  const bs = segmentsOf(bub), ds = segmentsOf(dew);
  if (!bs.length) throw new Error(`No two-phase region at ${fmtTemp(T, u)} for ${sys.names.join(" + ")} (${sys.info.equation ?? sys.model}). ${[...reasons.values()][0]?.example ?? ""}`);
  for (const w of warnings) notes.append(h("div", { class: "fug-warn", role: "note" }, w));
  const series = [
    { name: "Bubble", color: "var(--fug-liq)", segments: bs, label: false },
    { name: "Dew", color: "var(--fug-vap)", dash: "6 4", label: false, segments: ds.map(g => ({ points: g.points.slice().sort((a, b) => a.x - b.x) })) },
  ];
  const read = h("div", { class: "fa-read" });
  const show = zx => {
    const pb = interpSegs(series[0].segments, zx), pd = interpSegs(series[1].segments, zx);
    read.replaceChildren(
      h("div", { class: "fug-eyebrow" }, `Feed: ${sys.names[0]} ${bv.mass ? `${fmtNum(zx, 3)} wt %` : fmtNum(zx, 3)} (mole fraction ${fmtNum(fromX(zx), 3)})`),
      h("div", { class: "fa-row" }, h("span", {}, "Bubble pressure"), h("b", {}, pb == null ? "–" : `${fmtNum(pb, 4)} ${u.P}`)),
      h("div", { class: "fa-row" }, h("span", {}, "Dew pressure"), h("b", {}, pd == null ? "–" : `${fmtNum(pd, 4)} ${u.P}`)),
      h("div", { class: "fug-sub" }, "Liquid above the bubble curve, vapour below the dew curve, two phases between. Values read from the sampled curves; the calculator below solves exactly."));
    return [pb, pd];
  };
  const move = drawPlot(plot, { compact, series, x0: 0, x1: scale, xLabel: `x, y  ${sys.names[0]} (${bv.axis})`, yLabel: `P, ${u.P}`, show,
    aria: `P-x-y diagram of ${sys.names.join(" and ")} at ${fmtTemp(T, u)}` });
  plot.append(h("div", { class: "fug-legend" },
    h("span", { class: "fug-key", style: "color:var(--fug-liq)" }, h("i"), h("span", { style: "color:var(--fug-fg2)" }, "Bubble curve (liquid)")),
    h("span", { class: "fug-key", style: "color:var(--fug-vap)" }, h("i", { style: "border-top-style:dashed" }), h("span", { style: "color:var(--fug-fg2)" }, "Dew curve (vapour)"))),
  gapNote(reasons, "two-phase solution") ?? "");
  side.replaceChildren(read);
  move(0.5 * scale);
  extra.append(bubbleDewCalculator(ctx, sys, ids), ...sourcesOf(ctx, sys));
  return { data: pairData(sys), export: () => ({
    title: `P-x-y diagram of ${listNames(sys.names)} at ${fmtTemp(T, u)}`, file: `pxy ${ids.join(" ")}`,
    about: aboutRows(state, sys, [["Temperature", fmtTemp(T, u)]]),
    tables: pxyTables({ names: sys.names, MW: ids.map(id => pure(id).MW), units: u, basis: state.basis, points: raw }),
  }) };
}

function envelopeView(ctx) {
  const { state, plot, side, extra, compact } = ctx;
  const u = state.units, ids = state.components;
  let sys;
  try { sys = modelSystem(state, ids); } catch (e) { throw new Error(friendly(e)); }
  const z = normalizeComposition(state.z, ids.length);
  const reasons = new Map();
  let series, xLo, xHi, raw;
  const comps = ids.map(id => pure(id));
  if (ids.length === 1) {
    const Tc = comps[0].Tc_K;
    raw = linspace(0.45 * Tc, 0.9995 * Tc, 70).map(T => { const ps = sys.psatEos(T)[0]; return { T, P: ps > 0 ? ps : null }; });
    const pts = raw.map(d => (d.P != null ? { x: tToDisplay(d.T, u), y: pToDisplay(d.P, u) } : null));
    series = [{ name: "Saturation", color: "var(--fug-liq)", segments: segmentsOf(pts),
      transitions: [{ x: tToDisplay(Tc, u), y0: pToDisplay(comps[0].Pc_kPa, u), y1: null }] }];
    [xLo, xHi] = [tToDisplay(0.45 * Tc, u), tToDisplay(Tc, u)];
  } else {
    // an equation of state reaches the mixture critical region; the vapour-pressure
    // correlations of an activity model end at the lowest critical pressure
    const Pmax = sys.kind === "eos" ? 1.4 * Math.max(...comps.map(c => c.Pc_kPa)) : Math.min(...comps.map(c => c.Pc_kPa));
    const Ps = linspace(Math.log(10), Math.log(Pmax), 46).map(Math.exp);
    const bub = [], dew = [];
    raw = [];
    for (const P of Ps) {
      const d = { P, Tb: null, Td: null };
      try { d.Tb = sys.bubbleT(z, P).T; bub.push({ x: tToDisplay(d.Tb, u), y: pToDisplay(P, u) }); } catch (e) { if (!(e && e.code)) throw e; addReason(reasons, e.message); bub.push(null); }
      try { d.Td = sys.dewT(z, P).T; dew.push({ x: tToDisplay(d.Td, u), y: pToDisplay(P, u) }); } catch (e) { if (!(e && e.code)) throw e; addReason(reasons, e.message); dew.push(null); }
      raw.push(d);
    }
    series = [{ name: "Bubble", color: "var(--fug-liq)", segments: segmentsOf(bub) }, { name: "Dew", color: "var(--fug-vap)", dash: "6 4", segments: segmentsOf(dew) }];
    const xs = [...bub, ...dew].filter(Boolean).map(p => p.x);
    if (!xs.length) throw new Error(`No bubble or dew point found for this feed between ${fmtP(Ps[0], u)} and ${fmtP(Pmax, u)}. ${[...reasons.values()][0]?.example ?? ""}`);
    const span = Math.max(...xs) - Math.min(...xs) || 10;
    [xLo, xHi] = [Math.min(...xs) - 0.04 * span, Math.max(...xs) + 0.04 * span];
  }
  const read = h("div", { class: "fa-read" });
  const show = Tx => {
    const vals = series.map(sr => interpSegs(sr.segments, Tx));
    read.replaceChildren(h("div", { class: "fug-eyebrow" }, `At ${fmtShort(+Tx.toFixed(2))} ${tU(u)}`),
      ...series.map((sr, i) => h("div", { class: "fa-row" }, h("span", {}, ids.length === 1 ? "Vapour pressure" : `${sr.name} pressure`), h("b", {}, vals[i] == null ? "–" : `${fmtNum(vals[i], 4)} ${u.P}`))),
      h("div", { class: "fug-sub" }, ids.length === 1
        ? `Equation-of-state vapour pressure up to the critical point (open circle), ${fmtTemp(comps[0].Tc_K, u)}, ${fmtP(comps[0].Pc_kPa, u)}.`
        : sys.kind === "eos"
          ? "Liquid left of the bubble curve, vapour right of the dew curve. Near the mixture critical point the solver stops; no curve is drawn there."
          : `Liquid left of the bubble curve, vapour right of the dew curve. With an activity model the curves end at the lowest critical pressure (${fmtP(Math.min(...comps.map(c => c.Pc_kPa)), u)}); an equation of state reaches the critical region.`));
    return vals;
  };
  const move = drawPlot(plot, { compact, series, x0: xLo, x1: xHi, log: true, xLabel: `T, ${tU(u)}`, yLabel: `P, ${u.P}`, show,
    aria: `Phase envelope of ${sys.names.join(", ")}` });
  plot.append(h("div", { class: "fug-legend" },
    h("span", { class: "fug-key", style: "color:var(--fug-liq)" }, h("i"), h("span", { style: "color:var(--fug-fg2)" }, ids.length === 1 ? "Vapour pressure" : "Bubble points")),
    ids.length > 1 ? h("span", { class: "fug-key", style: "color:var(--fug-vap)" }, h("i", { style: "border-top-style:dashed" }), h("span", { style: "color:var(--fug-fg2)" }, "Dew points")) : null,
    ids.length > 1 ? h("span", {}, `Feed: ${ids.map((id, k) => `${nameOf(id)} ${fmtNum(z[k], 3)}`).join(", ")}`) : null),
  gapNote(reasons, "bubble or dew point") ?? "");
  side.replaceChildren(read);
  move((xLo + xHi) / 2);
  extra.append(bubbleDewCalculator(ctx, sys, ids), ...sourcesOf(ctx, sys));
  return { data: ids.length > 1 ? pairData(sys) : "Critical constants from the component record", export: () => ({
    title: ids.length > 1 ? `Phase envelope of ${listNames(sys.names)}` : `Vapour pressure of ${sys.names[0]}`, file: `envelope ${ids.join(" ")}`,
    about: aboutRows(state, sys, ids.length > 1 ? [["Feed", ids.map((id, k) => `${nameOf(id)} ${fmtNum(z[k], 4)}`).join(", ") + " (mole fractions)"]] : []),
    tables: envelopeTables({ names: sys.names, units: u, z, points: raw, single: ids.length === 1 }),
  }) };
}

// ---------------------------------------------------------------------------------------
// Flash (proposal 0001, step 6): the feed flashed with the model of the Model group; a bar of
// the phase split, the stream table (feed and phases), CSV export; readouts and sources

const PHASE_COLOR = { vapour: "var(--fug-vap)", liquid: "var(--fug-liq)" };

/**
 * Save text as a file (a Blob link), or say why the page cannot. `copyLabel` names the
 * fallback button; `bom` prefixes a byte-order mark (spreadsheets then read UTF-8, as °C).
 */
export function saveText(text, name, type, status, { copyLabel = "Copy CSV", bom = true } = {}) {
  try {
    const url = URL.createObjectURL(new Blob([(bom ? "\uFEFF" : "") + text], { type }));
    const a = h("a", { href: url, download: name, style: "display:none" });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    status.textContent = `Saved ${name}. If nothing was downloaded, the page does not allow downloads: use ${copyLabel}.`;
  } catch (e) { status.textContent = `This page cannot save files (${e.message}); use ${copyLabel}.`; }
}

/** Copy text to the clipboard, falling back to a selected text area the reader can copy from. */
export function copyText(text, status, box, { what = "CSV", done = "CSV copied: paste it into a spreadsheet." } = {}) {
  const fallback = () => {
    const ta = h("textarea", { class: "fa-csv-text", rows: 6, readonly: true, "aria-label": what });
    ta.value = text;
    box.replaceChildren(ta); ta.focus(); ta.select();
    status.textContent = `The clipboard is not available here: the ${what} is selected below, copy it with Ctrl+C (Cmd+C).`;
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => { status.textContent = done; }, fallback);
  else fallback();
}

function flashView(ctx) {
  const { state, plot, side, notes, below, extra } = ctx;
  const u = state.units, ids = state.components;
  let sys;
  try { sys = modelSystem(state, ids); } catch (e) { throw new Error(friendly(e)); }
  for (const k of sys.kind !== "eos" && onDefaults(sys) ? knownIssuesFor(sys.ids, sys.model) : []) {
    notes.append(h("div", { class: "fug-warn", role: "note" }, h("strong", {}, `Known deviation (${k.model}): `), k.message, ` Reference: ${k.reference}.`));
  }
  const { result: r, z } = runFlash(sys, state.flash);
  const names = sys.names, MW = ids.map(id => pure(id).MW);
  const fu = state.flash.flowUnit;
  const flow = molarFlow(state.flash, z.reduce((a, v, i) => a + v * MW[i], 0));   // kmol/h
  const table = flashTable(r, { names, MW, z, units: u, flow, flowUnit: fu });
  const feedFlowText = `${fmtShort(state.flash.flow, 6)} ${fu}${fu === "kmol/h" ? "" : ` (${fmtShort(flow, 6)} kmol/h)`}`;
  const spec = FLASH_SPECS.find(f => f.id === state.flash.spec);
  const ml = isEosModel(state.model) ? (state.model === "PR" ? "Peng–Robinson" : "SRK")
    : `${state.model === "ideal" ? "Ideal solution" : state.model}${state.vapour !== "ideal" ? ` with a ${state.vapour} vapour` : ""}`;

  // the phase split as one bar
  const bar = h("div", { class: "fa-split", role: "img", "aria-label": `Phase split: ${r.phases.map(p => `${phaseName(p)} ${fmtNum(p.fraction, 4)}`).join(", ")}` },
    ...r.phases.map((p, k) => h("div", { class: "fa-split-part" + (k ? " is-next" : ""), style: `flex:${Math.max(p.fraction, 0.002)};--c:${PHASE_COLOR[p.type]}` + (p.type === "liquid" && k > 1 ? ";--hatch:1" : ""),
      title: `${phaseName(p)}: ${fmtNum(p.fraction, 4)} of the feed` },
    p.fraction > 0.12 ? h("span", {}, `${phaseName(p)} ${fmtNum(100 * p.fraction, 3)} %`) : null)));

  // the stream table, compositions in the display basis (the CSV has both)
  const mass = state.basis === "mass";
  const fmtCell = (row, v) => {
    if (v == null) return "–";
    if (row.key === "T") return (+v.toFixed(3)).toString();
    if (row.key === "P") return fmtShort(v, 6);
    if (row.key === "h") return Math.round(v).toLocaleString("en-US").replace(/,/g, " ");
    if (row.key === "MW") return v.toFixed(3);
    if (row.key === "flow" || row.key === "mflow" || /^f\d/.test(row.key)) return fmtShort(v, 6);
    if (row.key.startsWith("w")) return (100 * v).toFixed(3);
    return v.toFixed(5);
  };
  const shownRows = table.rows.filter(row => !(mass ? row.key.startsWith("x") : row.key.startsWith("w")))
    .map(row => (row.key.startsWith("w") ? { ...row, label: row.label.replace("Mass fraction", "Mass"), unit: "wt %" } : row));
  const tableEl = h("div", { class: "fug-scroll" }, h("table", { class: "fa-table fa-stream" },
    h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Stream"), h("th", { scope: "col" }, "Unit"), ...table.columns.map(c => h("th", { scope: "col", class: "fug-num" }, c)))),
    h("tbody", {}, ...shownRows.map(row => h("tr", {}, h("th", { scope: "row" }, row.label), h("td", {}, row.unit),
      ...row.values.map(v => h("td", { class: "fug-num" }, fmtCell(row, v))))))));

  const summary = [
    ["Temperature", +tToDisplay(r.T, u).toFixed(4), tU(u)], ["Pressure", +pToDisplay(r.P, u).toPrecision(8), u.P], ["Vapour fraction", r.VF, "mol/mol"],
    ["Enthalpy of the outlet", r.H_J_mol, "J/mol of feed"],
    ...(r.duty_J_mol != null ? [["Heat duty Q", r.duty_J_mol, "J/mol of feed"], ["Heat duty Q", dutyKW(r.duty_J_mol, flow), `kW at ${feedFlowText} of feed`]] : []),
    ["Feed flow", state.flash.flow, fu], ...(fu === "kmol/h" ? [] : [["Feed molar flow", flow, "kmol/h"]]),
  ];
  const meta = {
    title: names.join(", "), model: ml, spec: `${spec.title}: ${JSON.stringify(state.flash.spec === "PH" ? { P_kPa: r.P, Q_J_mol: state.flash.Q_J_mol, feed: { T_K: state.flash.feedT_K, P_kPa: state.flash.feedP_kPa } } : { TP: { T_K: r.T, P_kPa: r.P }, PVF: { P_kPa: r.P, VF: state.flash.VF }, TVF: { T_K: r.T, VF: state.flash.VF } }[state.flash.spec])}`,
    summary, version: pkg.version,
    sources: (r.sources ?? []).map(s => `${s.pair ? s.pair.join(" + ") + ": " : ""}${s.set ? `set ${s.set}, ` : ""}${s.tier ?? ""}${s.source ? `; ${s.source}` : ""}`),
  };
  const csv = flashCsv(table, meta);
  const status = h("div", { class: "fug-foot", "aria-live": "polite" }), csvBox = h("div");
  const file = `fugacity-flash-${ids.join("-")}.csv`;
  const tools = h("div", { class: "fa-in-actions" },
    h("button", { type: "button", class: "fa-mini", "data-fk": "csv-save", on: { click: () => saveText(csv, file, "text/csv;charset=utf-8", status) } }, icon("download", 15), "Download CSV"),
    h("button", { type: "button", class: "fa-mini", "data-fk": "csv-copy", on: { click: () => copyText(csv, status, csvBox) } }, icon("copy", 15), "Copy CSV"));

  plot.replaceChildren(h("div", { class: "fa-flash" },
    h("div", { class: "fug-eyebrow" }, `${r.phases.length === 1 ? `One phase: ${phaseName(r.phases[0]).toLowerCase()}` : `${r.phases.length} phases`} at ${fmtTemp(r.T, u, 2)} and ${fmtP(r.P, u)}`),
    bar, tableEl, tools, status, csvBox,
    h("div", { class: "fug-foot" }, `Enthalpy reference: each component as an ideal gas at 298.15 K (h = 0); the heat duty does not depend on it. Compositions in ${mass ? "wt %" : "mole fractions"}; the CSV has both, and the model, specification and sources.`)));

  side.replaceChildren(
    h("div", {}, h("div", { class: "fug-eyebrow" }, "Vapour fraction"), h("div", { class: "fug-big" }, fmtNum(r.VF, 4))),
    h("div", { class: "fug-sub" }, r.phases.map(p => `${phaseName(p)} ${fmtNum(p.fraction, 4)}`).join(" · ")),
    kv([
      ["Temperature", fmtTemp(r.T, u, 3)], ["Pressure", fmtP(r.P, u)],
      ["Outlet enthalpy", r.H_J_mol == null ? null : Math.round(r.H_J_mol).toString(), "J/mol"],
      r.feed ? ["Feed enthalpy", Math.round(r.feed.H_J_mol).toString(), "J/mol"] : null,
      r.duty_J_mol != null ? ["Heat duty Q", Math.round(r.duty_J_mol).toString(), "J/mol of feed"] : null,
      r.duty_J_mol != null ? ["Heat duty Q", fmtShort(dutyKW(r.duty_J_mol, flow), 5), `kW at ${feedFlowText}`] : null,
      ["Iterations", String(r.iterations)],
    ]),
    ...(r.warnings ?? []).map(w => h("div", { class: "fug-warn" }, w)),
    h("div", { class: "fug-foot" }, spec.hint));
  extra.append(...sourcesOf(ctx, sys));
  // the stream table as a record for project files (src/ui/project.js), each row with its unit
  const record = { columns: table.columns, rows: table.rows.map(r => ({ key: r.key, label: r.label, unit: r.unit, values: r.values })),
    summary: meta.summary.map(([label, value, unit]) => ({ label, value, unit })), model: meta.model, spec: meta.spec, sources: meta.sources };
  return { data: pairData(sys), record: { flash: record }, export: () => ({
    title: `${spec.title} flash of ${listNames(names)}`, file: `flash ${ids.join(" ")}`,
    about: [...aboutRows(state, sys), ["Specification", meta.spec], ["Enthalpy reference", "each component as an ideal gas at 298.15 K (h = 0)"]],
    tables: flashTables({ table, summary }),
  }) };
}

// ---------------------------------------------------------------------------------------
// Gas solubility: Henry's law for the chosen gas and solvent

function henryView(ctx) {
  const { state, plot, side, extra, compact } = ctx;
  const u = state.units, p = state.henryP_kPa, Tset = state.henryT_K;
  const { gas, solvent } = state.inputs.henry;
  const solventName = nameOf(solvent);
  const others = state.compareGases ? HENRY_PAIRS.filter(q => q.solvent === solvent && q.gas !== gas).map(q => q.gas) : [];
  const gases = [gas, ...others].map(id => ({ id, info: henryInfo(id, solvent) }));
  const drawnGases = [];
  const series = gases.map((g, i) => {
    const temps = linspace(g.info.Tmin_K, g.info.Tmax_K, 90);
    drawnGases.push({ name: nameOf(g.id), points: temps.map(T => ({ T, x: gasSolubility(g.id, T, p, solvent), H: henry(g.id, solvent, T) })) });
    const pts = drawnGases[i].points.map(d => ({ x: tToDisplay(d.T, u), y: d.x }));
    return { name: nameOf(g.id), color: SERIES(i), width: i === 0 && gases.length > 1 ? 2.6 : undefined, segments: [{ points: pts }] };
  });
  const x0 = tToDisplay(Math.min(...gases.map(g => g.info.Tmin_K)), u), x1 = tToDisplay(Math.max(...gases.map(g => g.info.Tmax_K)), u);

  // the result at the chosen conditions
  const result = h("div", { class: "fa-result-card" });
  try {
    const H = henry(gas, solvent, Tset), x = gasSolubility(gas, Tset, p, solvent);
    const ratio = x / (1 - x) * pure(gas).MW / pure(solvent).MW * 1e6; // mg of gas per kg of solvent
    result.append(
      h("div", { class: "fug-eyebrow" }, `${nameOf(gas)} in ${solventName.toLowerCase()} at ${fmtTemp(Tset, u)}, ${fmtP(p, u)}`),
      h("div", { class: "fa-result-main" }, h("span", {}, "Mole fraction x"), h("b", { class: "fug-big" }, fmtNum(x, 4))),
      kv([["Henry's constant H", fmtNum(pToDisplay(H, u), 4), u.P], ["Mass ratio", fmtNum(ratio, 4), `mg per kg ${solventName.toLowerCase()}`]]),
      h("div", { class: "fug-foot" }, `x = p / H, valid for dilute solutions. Mass ratio = x / (1 − x) × M gas / M ${solventName.toLowerCase()}.`));
  } catch (e) {
    result.append(h("div", { class: "fug-eyebrow" }, `${nameOf(gas)} in ${solventName.toLowerCase()}`),
      h("div", { class: "fug-err", role: "alert" }, e.message),
      h("div", { class: "fug-foot" }, `Change the temperature in the inputs: the equation is valid from ${fmtTemp(info0(gases).Tmin_K, u, 1)} to ${fmtTemp(info0(gases).Tmax_K, u, 1)}.`));
  }

  const read = h("div", { class: "fa-read" });
  const show = Tx => {
    const T = tFromDisplay(Tx, u);
    const vals = gases.map(g => (T >= g.info.Tmin_K && T <= g.info.Tmax_K ? gasSolubility(g.id, T, p, solvent) : null));
    read.replaceChildren(h("div", { class: "fug-eyebrow" }, `On the curve${gases.length > 1 ? "s" : ""}: mole fraction at ${fmtShort(+Tx.toFixed(2))} ${tU(u)}`),
      ...gases.map((g, i) => h("div", { class: "fa-row" }, h("span", {}, h("span", { class: "sw", style: `border-color:${SERIES(i)}` }), nameOf(g.id)),
        h("b", { class: "fug-num" }, vals[i] == null ? "outside range" : fmtNum(vals[i], 3)))));
    return vals;
  };
  const move = drawPlot(plot, { compact, series, x0, x1, log: true, xLabel: `T, ${tU(u)}`, yLabel: "x gas (mole fraction)", show,
    aria: `Solubility of ${gases.map(g => nameOf(g.id)).join(", ")} in ${solventName.toLowerCase()} against temperature` });
  plot.append(h("div", { class: "fug-legend" }, `Each curve spans the validity range of its equation. Gas partial pressure ${fmtP(p, u)}; x = p / H, valid for dilute solutions.`));
  side.replaceChildren(result, read);
  move(Math.min(x1, Math.max(x0, tToDisplay(Tset, u))));

  extra.append(
    section("Sources", sourceList(ctx, gases.map(g => ({ label: `${nameOf(g.id)} in ${solventName.toLowerCase()}`, tier: g.info.tier,
      text: `${g.info.source}; valid ${fmtTemp(g.info.Tmin_K, u, 1)} to ${fmtTemp(g.info.Tmax_K, u, 1)}` }))),
    sourceLinks(gases.flatMap(g => g.info.source_ids ?? []))));
  return { data: tierSummary(tierCounts(gases.map(g => ({ tier: g.info.tier }))), "gas", "gases"), export: () => ({
    title: `Solubility of ${listNames(drawnGases.map(g => g.name))} in ${solventName.toLowerCase()}`, file: `solubility ${[gas, ...others].join(" ")} ${solvent}`,
    about: [["Gas partial pressure", fmtP(p, u)], ["Model", "Henry's law, x = p / H (dilute solutions)"],
      ...gases.map(g => [`${nameOf(g.id)} in ${solventName.toLowerCase()}`, `${g.info.tier}; ${g.info.source}; valid ${fmtTemp(g.info.Tmin_K, u, 1)} to ${fmtTemp(g.info.Tmax_K, u, 1)}`])],
    tables: henryTables({ units: u, solvent: solventName, p_kPa: p, gases: drawnGases }),
  }) };
}
const info0 = gases => gases[0].info;

// ---------------------------------------------------------------------------------------
// Solids (proposal 0007, step 4): the solubility of a pure solid, and the solid-liquid diagram of a binary

/**
 * The system of a solid view: the model of the Model group, or the ideal solution where the pair has no parameters
 * for it (most solid-solvent pairs: none are fitted yet), with the reason to show.
 */
function sleSystem(state, ids) {
  try { return { sys: system({ components: ids, model: state.model, ...setsFor(state, state.model) }), note: null }; } catch (e) {
    if (e.code !== "MISSING_DATA" || state.model === "ideal") throw e;
    return { sys: system({ components: ids, model: "ideal" }),
      note: `No ${state.model} parameters for ${ids.map(nameOf).join(" + ")} (none fitted to solid-liquid or vapour-liquid data yet): this shows the ideal solubility (γ = 1), which can be far off for chemically different components.` };
  }
}

const meltText = (f, u) => `${fmtTemp(f.Tm_K, u)}, ΔH_fus ${fmtShort(f.Hfus_J_mol / 1000, 4)} kJ/mol`;

function fusionSources(ctx, ids) {
  return sourceList(ctx, ids.map(id => {
    const f = pure(id).fusion;
    return { label: `${nameOf(id)}: melting temperature and enthalpy of fusion`, tier: f.tier ?? "databank",
      text: `${formatSource(f.source)}${f.source.selection ? `. ${f.source.selection}` : ""}` };
  }));
}

function solidView(ctx) {
  const { state, plot, side, notes, extra, compact } = ctx;
  const u = state.units, [solid, solvent] = state.components;
  const { sys, note } = sleSystem(state, [solid, solvent]);
  if (note) notes.append(h("div", { class: "fug-warn", role: "note" }, note));
  const f = sys.fusion[0], fs = sys.fusion[1];
  const MW = [pure(solid).MW, pure(solvent).MW];
  const unit = SOLID_UNITS.find(su => su.id === state.solidUnit) ?? SOLID_UNITS[0];
  // the solvent's liquid density (g/L): only for "g per L of solvent"; null where its correlation has no value
  const rho = T => { try { return pure(solvent).property("liquidDensity", T); } catch { return null; } };
  const conv = (x, T, id = unit.id) => {
    if (id === "gL") { const r = rho(T); return r == null ? null : solidIn(id, x, MW, r); }
    return solidIn(id, x, MW);
  };
  // per gram of solvent the amount grows without limit at the melting point (x -> 1): those curves stop at x = XMAX
  const ratio = unit.id === "g100g" || unit.id === "gL", XMAX = 0.9;
  // from the solvent's melting point (it freezes below), or 150 K below the solid's, up to just below T_m
  const T1 = f.Tm_K - 0.05, T0 = Math.min(T1 - 5, Math.max(f.Tm_K - 150, fs ? fs.Tm_K + 0.5 : 0, 0.5 * f.Tm_K));
  const pts = [], ideal = [], raw = [], reasons = new Map();
  let splits = false, cut = false, noRho = false;
  const add = (list, x, T) => {
    if (ratio && x > XMAX) { cut = true; return; }
    const y = conv(x, T);
    if (y == null) { noRho = true; return; }
    list.push({ x: tToDisplay(T, u), y });
  };
  for (const T of linspace(T0, T1, 90)) {
    try {
      const r = sys.solidSolubility(0, T);
      add(pts, r.xSolute, T); add(ideal, r.xIdeal, T);
      const shown = x => (ratio && x > XMAX ? null : conv(x, T));
      raw.push({ T, x: r.xSolute, y: shown(r.xSolute), xIdeal: r.xIdeal, yIdeal: shown(r.xIdeal), gamma: r.gamma });
      splits ||= r.splits;
    } catch (e) { addReason(reasons, e.message); }
  }
  const series = [{ name: sys.model === "ideal" ? "ideal" : sys.model, color: SERIES(0), segments: [{ points: pts }] }];
  if (sys.model !== "ideal") series.push({ name: "ideal", color: "var(--fug-muted)", dash: "5 4", segments: [{ points: ideal }] });
  if (splits) notes.append(h("div", { class: "fug-warn", role: "note" }, `The ${sys.model} model splits the liquid into two phases at some temperatures: the solvent-rich solubility is drawn there; a liquid-liquid check is needed.`));
  if (noRho) notes.append(h("div", { class: "fug-warn", role: "note" }, `No liquid density of ${nameOf(solvent).toLowerCase()} at some of these temperatures (outside its correlation): g/L is not drawn there. g/100 g needs no density.`));
  const gap = gapNote(reasons, "solubility");
  if (gap) notes.append(gap);

  // the result at the chosen temperature, in every unit
  const result = h("div", { class: "fa-result-card" });
  const T = state.sleT_K;
  result.append(h("div", { class: "fug-eyebrow" }, `${nameOf(solid)} in ${nameOf(solvent).toLowerCase()} at ${fmtTemp(T, u)}`));
  try {
    const r = sys.solidSolubility(0, T);
    const val = (x, id) => { const y = conv(x, T, id); return y == null ? "–" : fmtNum(y, 4); };
    const rhoT = rho(T);
    const rows = [["Mole fraction x", val(r.xSolute, "mole")], ["Mass fraction", val(r.xSolute, "mass"), "wt %"],
      ["Per 100 g of solvent", val(r.xSolute, "g100g"), "g"],
      ["Per litre of solvent", val(r.xSolute, "gL"), rhoT == null ? "g (no solvent density at this T)" : `g (solvent ${fmtNum(rhoT, 4)} kg/m³)`]];
    const main = rows[SOLID_UNITS.indexOf(unit)];
    result.append(
      h("div", { class: "fa-result-main" }, h("span", {}, unit.title), h("b", { class: "fug-big" }, `${main[1]}${unit.id === "mole" ? "" : ` ${unit.id === "mass" ? "%" : unit.id === "gL" ? "g/L" : "g"}`}`)),
      kv([...rows.filter(row => row !== main),
        ["Activity coefficient γ", fmtNum(r.gamma, 4)],
        ["Ideal solubility", val(r.xIdeal, unit.id), unit.axis],
        ["Melting point of the solid", meltText(f, u)]]),
      ...r.notes.filter(n => !/ΔCp/.test(n)).map(n => h("div", { class: "fug-warn" }, n)),
      h("div", { class: "fug-foot" }, `x is the mole fraction of ${nameOf(solid).toLowerCase()} in the saturated solution (moles of dissolved solid per mole of solution), not the share of the solid that dissolves: x = 0.5 is one mole of solid per mole of solvent. At the melting point x reaches 1: the molten solid mixes with the solvent in any ratio. g/L is per litre of pure solvent at this temperature, before the solid is added.`),
      h("div", { class: "fug-foot" }, "Pure solid in equilibrium with the solution: ln(x γ) = −(ΔH_fus / R T)(1 − T / T_m), ΔCp of fusion taken as 0."));
  } catch (e) {
    result.append(h("div", { class: "fug-err", role: "alert" }, e.message));
  }
  const read = h("div", { class: "fa-read" });
  const show = Tx => {
    const Tk = tFromDisplay(Tx, u);
    const vals = series.map(sr => interpolate(sr.segments[0].points, Tx));
    read.replaceChildren(h("div", { class: "fug-eyebrow" }, `On the curve at ${fmtShort(+Tx.toFixed(2))} ${tU(u)}, ${unit.axis}`),
      ...series.map((sr, i) => h("div", { class: "fa-row" }, h("span", {}, h("span", { class: "sw", style: `border-color:${sr.color}` }), sr.name),
        h("b", { class: "fug-num" }, vals[i] == null || Tk >= f.Tm_K ? "–" : fmtNum(vals[i], 3)))));
    return vals;
  };
  const x0 = tToDisplay(T0, u), x1 = tToDisplay(f.Tm_K, u);
  if (!pts.length) {
    plot.replaceChildren(h("div", { class: "fug-err", role: "alert" }, "No solubility could be calculated in this temperature range."));
  } else {
    const move = drawPlot(plot, { compact, series, x0, x1, log: true, xLabel: `T, ${tU(u)}`,
      yLabel: `${nameOf(solid)} (${unit.axis})`, show,
      aria: `Solubility of ${nameOf(solid)} in ${nameOf(solvent).toLowerCase()} against temperature, ${unit.axis}` });
    plot.append(h("div", { class: "fug-legend" }, `Up to the melting point of ${nameOf(solid).toLowerCase()} (${fmtTemp(f.Tm_K, u)})${fs && T0 <= fs.Tm_K + 0.6 ? `, from the melting point of ${nameOf(solvent).toLowerCase()} (below it the solvent freezes)` : ""}.${cut ? ` Drawn up to x = ${XMAX}: per gram of solvent the solubility grows without limit at the melting point.` : ""}`));
    move(Math.min(x1, Math.max(x0, tToDisplay(T, u))));
  }
  side.replaceChildren(result, read);
  extra.append(section("Sources", fusionSources(ctx, [solid]), sys.model !== "ideal" ? pairSources(ctx, sys.info.pairs) : null,
    unit.id === "gL" ? componentSourceList([solvent], ["liquidDensity"]) : null));
  return { data: `${sys.model === "ideal" ? "Ideal solution" : sys.model}${note ? " (no pair parameters)" : ""}`, export: () => ({
    title: `Solubility of ${nameOf(solid)} in ${nameOf(solvent).toLowerCase()}`, file: `solubility ${solid} ${solvent}`,
    about: [...aboutRows(state, sys), ["Melting point of the solid", meltText(f, u)], ...(note ? [["Note", note]] : []),
      ["Equation", "ln(x γ) = −(ΔH_fus / R T)(1 − T / T_m), ΔCp of fusion taken as 0"]],
    tables: solidTables({ units: u, solid: nameOf(solid), solvent: nameOf(solvent), model: sys.model, unit, points: raw }),
  }) };
}

function sleView(ctx) {
  const { state, plot, side, notes, extra, compact } = ctx;
  const u = state.units, ids = state.components;
  const { sys, note } = sleSystem(state, ids);
  if (note) notes.append(h("div", { class: "fug-warn", role: "note" }, note));
  const MW = ids.map(id => pure(id).MW);
  const bv = basisView(state.basis, MW);
  const conv1 = x1 => bv.conv([x1, 1 - x1])[0];
  let d;
  try { d = sys.sleDiagram({ n: 61 }); } catch (e) {
    plot.replaceChildren(h("div", { class: "fug-err", role: "alert" }, e.message));
    side.replaceChildren();
    return { data: "No diagram" };
  }
  for (const n of d.notes) notes.append(h("div", { class: "fug-warn", role: "note" }, n));
  // unlabelled curves (their names would collide at the eutectic): the legend under the plot names them
  const branch = (b, k) => ({ name: "", label: `solid ${nameOf(ids[k]).toLowerCase()}`, color: SERIES(k), segments: [{ points: b.points.map(p => ({ x: conv1(p.x1), y: tToDisplay(p.T_K, u) })) }] });
  const Te = tToDisplay(d.eutectic.T_K, u);
  const series = [branch(d.branches[0], 0), branch(d.branches[1], 1),
    { name: "", label: "eutectic", color: "var(--fug-muted)", dash: "5 4", segments: [{ points: [{ x: 0, y: Te }, { x: 1, y: Te }] }] }];
  const read = h("div", { class: "fa-read" });
  const show = xv => {
    const vals = series.map(sr => interpolate(sr.segments[0].points.slice().sort((a, b) => a.x - b.x), xv));
    read.replaceChildren(h("div", { class: "fug-eyebrow" }, `At ${bv.mass ? "w" : "x"} ${nameOf(ids[0]).toLowerCase()} = ${bv.f(xv)}${bv.mass ? " wt %" : ""}`),
      ...series.slice(0, 2).map((sr, i) => h("div", { class: "fa-row" }, h("span", {}, h("span", { class: "sw", style: `border-color:${sr.color}` }), `${sr.label} appears at`),
        h("b", { class: "fug-num" }, vals[i] == null ? "–" : `${fmtNum(vals[i], 4)} ${tU(u)}`))));
    return vals;
  };
  const move = drawPlot(plot, { compact, series, x0: 0, x1: 1, xLabel: `${nameOf(ids[0])} (${bv.axis})`, yLabel: `T, ${tU(u)}`, show,
    aria: `Solid-liquid diagram of ${ids.map(nameOf).join(" and ")} with the eutectic` });
  plot.append(h("div", { class: "fug-legend" },
    ...series.map(sr => h("span", { class: "fa-leg" }, h("span", { class: "sw", style: `border-color:${sr.color}${sr.dash ? ";border-top-style:dashed" : ""}` }), ` ${sr.label}   `)),
    h("div", {}, `Above the curves: one liquid. Below each curve: that pure solid and liquid. Below the eutectic (${fmtTemp(d.eutectic.T_K, u)}): both solids.`)));
  // the result at the chosen temperature: where each solid starts to crystallize
  const T = state.sleT_K, f = sys.fusion;
  const rows = [["Eutectic temperature", fmtShort(+Te.toFixed(2)), tU(u)],
    [`Eutectic composition, ${bv.mass ? "wt %" : "mole fraction"} ${nameOf(ids[0]).toLowerCase()}`, bv.f(conv1(d.eutectic.x1))]];
  const at = [];
  const xn = `${bv.mass ? "w" : "x"} ${nameOf(ids[0]).toLowerCase()}`;
  if (T < d.eutectic.T_K) at.push(`Below the eutectic: both solids, no liquid.`);
  else for (const k of [0, 1]) {
    if (T >= f[k].Tm_K) { at.push(`No solid ${nameOf(ids[k]).toLowerCase()}: above its melting point (${fmtTemp(f[k].Tm_K, u)}).`); continue; }
    try {
      const r = sys.solidSolubility(k, T), x1 = k === 0 ? r.xSolute : 1 - r.xSolute;
      at.push(`Solid ${nameOf(ids[k]).toLowerCase()} appears where ${xn} ${k === 0 ? "≥" : "≤"} ${bv.f(conv1(x1))}${bv.mass ? " wt %" : ""}.`);
    } catch (e) { at.push(e.message); }
  }
  side.replaceChildren(h("div", { class: "fa-result-card" },
    h("div", { class: "fug-eyebrow" }, `${ids.map(nameOf).join(" + ")}`),
    kv([...rows, ...[0, 1].map(k => [`Melting point, ${nameOf(ids[k]).toLowerCase()}`, fmtShort(+tToDisplay(f[k].Tm_K, u).toFixed(2)), tU(u)])]),
    h("div", { class: "fug-eyebrow" }, `At ${fmtTemp(T, u)}`),
    h("ul", { class: "fa-plain" }, ...at.map(t => h("li", {}, t))),
    h("div", { class: "fug-foot" }, "Each liquidus: ln(x γ) = −(ΔH_fus / R T)(1 − T / T_m) for that pure solid; no solid solutions, ΔCp of fusion taken as 0.")), read);
  move(conv1(d.eutectic.x1));
  extra.append(section("Sources", fusionSources(ctx, ids), sys.model !== "ideal" ? pairSources(ctx, sys.info.pairs) : null));
  return { data: `Eutectic ${fmtTemp(d.eutectic.T_K, u)}`, export: () => ({
    title: `Solid-liquid diagram of ${listNames(ids.map(nameOf))}`, file: `sle ${ids.join(" ")}`,
    about: [...aboutRows(state, sys), ...(note ? [["Note", note]] : []), ...[0, 1].map(k => [`Melting point, ${nameOf(ids[k]).toLowerCase()}`, meltText(f[k], u)])],
    tables: sleTables({ names: sys.names, MW, units: u, basis: state.basis, diagram: d }),
  }) };
}

// ---------------------------------------------------------------------------------------
// Property explorer

function propertiesView(ctx) {
  const { state, plot, side, extra } = ctx;
  const id = state.components[0];
  const p = pure(id), u = state.units;
  const explorer = mountProperties(plot, { component: id, property: state.property, units: u, controls: false });
  side.replaceChildren(
    h("div", {}, h("div", { class: "fug-eyebrow" }, p.formula), h("div", { class: "fa-comp-name" }, p.name), h("div", { class: "fug-sub" }, `CAS ${p.cas}`)),
    kv([["Molar mass", fmtNum(p.MW, 5), "g/mol"], ["Critical temperature", fmtShort(+tToDisplay(p.Tc_K, u).toFixed(2)), tU(u)],
      ["Critical pressure", fmtNum(pToDisplay(p.Pc_kPa, u), 4), u.P], ["Normal boiling point", p.Tb_K ? fmtShort(+tToDisplay(p.Tb_K, u).toFixed(2)) : null, tU(u)],
      ["Acentric factor", fmtNum(p.omega, 3)]]));
  const names = ["vapourPressure", ...PROPERTY_NAMES];
  let have = 0;
  const rows = names.map(n => {
    const r = p.record(n), label = n === "vapourPressure" ? "Vapour pressure" : PROPERTIES[n].label;
    if (r) have++;
    return r ? { label, tier: r.tier ?? "databank", text: `${formatSource(r.source)}${Number.isFinite(r.Tmin_K) ? `; valid ${fmtTemp(r.Tmin_K, u, 1)} to ${fmtTemp(r.Tmax_K, u, 1)}` : ""}` }
      : { label, tier: "none", text: "No open data in the databank yet." };
  });
  extra.append(section(`Correlations for ${p.name}`, sourceList(ctx, rows)),
    section("Sources in the library", componentSourceList([id]) ?? h("div", { class: "fa-empty" }, "No sources recorded.")));
  return { data: `${have} of ${names.length} correlations with open data`, export: () => {
    const plotted = explorer.plotted();
    if (!plotted) throw new Error(`No curve is drawn for ${p.name}: the property has no data in this range.`);
    return {
      title: `${plotted.property.label} of ${p.name}`, file: `${state.property} ${id}`,
      about: [["Component", `${p.name} (${p.formula}), CAS ${p.cas}`], ["Property", plotted.property.label], ...plotted.about],
      tables: propertyTables({ component: p.name, property: plotted.property, curves: plotted.curves }),
    };
  } };
}

// ---------------------------------------------------------------------------------------
// Steam: T-s chart, saturation table, state calculator (IAPWS-IF97)

const T_TRIPLE = 273.16, T_CRIT = 647.096, P_CRIT = 22064;

function steamView(ctx) {
  const { state, plot, side, below, extra, compact, uid } = ctx;
  const u = state.units;
  // saturation dome, denser near the critical point
  const domeT = linspace(0, 1, 70).map(f => T_TRIPLE + (T_CRIT - 0.01 - T_TRIPLE) * (1 - (1 - f) ** 2));
  const sat = domeT.map(T => steamSat({ T_K: T }));
  const dome = [...sat.map(sv => ({ x: sv.liquid.s_kJ_kgK, y: tToDisplay(sv.T_K, u) })), ...sat.slice().reverse().map(sv => ({ x: sv.vapour.s_kJ_kgK, y: tToDisplay(sv.T_K, u) }))];
  const Tmax = 1073.15;
  const isobars = state.steamP_kPa.map((P, i) => {
    const raw = [];
    let ts = null;
    if (P < P_CRIT) { ts = steamSat({ P_kPa: P }); }
    for (const T of linspace(T_TRIPLE, Tmax, 120)) {
      if (ts && Math.abs(T - ts.T_K) < 1e-6) continue;
      try { const st = steam(T, P); raw.push({ T_K: T, s: st.s_kJ_kgK, h: st.h_kJ_kg, rho: st.rho_kg_m3, phase: st.phase }); } catch { /* outside IF97 */ }
    }
    if (ts) raw.push({ T_K: ts.T_K, s: ts.liquid.s_kJ_kgK, h: ts.liquid.h_kJ_kg, rho: ts.liquid.rho_kg_m3, phase: "saturated liquid" },
      { T_K: ts.T_K, s: ts.vapour.s_kJ_kgK, h: ts.vapour.h_kJ_kg, rho: ts.vapour.rho_kg_m3, phase: "saturated vapour" });
    raw.sort((a, b) => a.s - b.s);
    const pts = raw.map(q => ({ x: q.s, y: tToDisplay(q.T_K, u) }));
    return { P, ts, raw, series: { name: fmtP(P, u), color: SERIES(i), segments: [{ points: pts }] } };
  });
  const series = [{ name: "", color: "var(--fug-fg)", width: 1.6, segments: [{ points: dome }] }, ...isobars.map(b => b.series)];
  const xMax = Math.ceil(Math.max(...series.flatMap(sr => sr.segments[0].points.map(q => q.x))));
  const read = h("div", { class: "fa-read" });
  const show = sx => {
    const vals = [null];
    const rows = [h("div", { class: "fug-eyebrow" }, `Along each isobar at s = ${fmtNum(sx, 4)} kJ/(kg·K)`)];
    isobars.forEach((b, i) => {
      const Ty = interpolate(b.series.segments[0].points, sx);
      vals.push(Ty);
      let phase = "";
      if (Ty != null && b.ts && sx > b.ts.liquid.s_kJ_kgK && sx < b.ts.vapour.s_kJ_kgK) {
        const q = (sx - b.ts.liquid.s_kJ_kgK) / (b.ts.vapour.s_kJ_kgK - b.ts.liquid.s_kJ_kgK);
        phase = `wet steam, quality ${fmtNum(q, 3)}`;
      } else if (Ty != null) phase = b.ts ? (sx <= b.ts.liquid.s_kJ_kgK ? "liquid" : "superheated vapour") : "supercritical";
      rows.push(h("div", { class: "fa-row" }, h("span", {}, h("span", { class: "sw", style: `border-color:${SERIES(i)}` }), b.series.name, phase ? h("small", {}, ` ${phase}`) : null),
        h("b", { class: "fug-num" }, Ty == null ? "–" : `${fmtNum(Ty, 4)} ${tU(u)}`)));
    });
    read.replaceChildren(...rows);
    return vals;
  };
  const move = drawPlot(plot, { compact, series, x0: 0, x1: xMax, xLabel: "s, kJ/(kg·K)", yLabel: `T, ${tU(u)}`, show, labels: "top",
    aria: "Temperature-entropy chart of water with the saturation dome and isobars" });
  plot.append(h("div", { class: "fug-legend" },
    h("span", { class: "fug-key", style: "color:var(--fug-fg)" }, h("i"), h("span", { style: "color:var(--fug-fg2)" }, "Saturation dome")),
    h("span", {}, "Coloured lines: isobars, labelled where they leave the chart. Wet-steam quality from the lever rule on entropy.")));
  side.replaceChildren(read);
  move(6.5);

  // saturation table at round temperatures
  const rowsT = niceValues(tToDisplay(T_TRIPLE, u), tToDisplay(T_CRIT - 0.01, u), 12).map(v => tFromDisplay(v, u)).filter(T => T >= T_TRIPLE && T < T_CRIT);
  const th = (a, b) => h("th", { scope: "col" }, a, h("span", { class: "u" }, b));
  below.replaceChildren(section("Saturated water and steam",
    h("div", { class: "fug-scroll", tabindex: "0", role: "region", "aria-label": "Saturation table" }, h("table", { class: "fa-table fa-num-table" },
      h("thead", {}, h("tr", {}, th("T", tU(u)), th("Psat", u.P), th("ρ liquid", "kg/m³"), th("ρ vapour", "kg/m³"), th("h liquid", "kJ/kg"), th("h vapour", "kJ/kg"),
        th("Δh vap", "kJ/kg"), th("s liquid", "kJ/(kg·K)"), th("s vapour", "kJ/(kg·K)"))),
      h("tbody", { class: "fug-num" }, ...rowsT.map(T => {
        const r = steamSat({ T_K: T });
        return h("tr", {}, h("td", {}, fmtShort(+tToDisplay(T, u).toFixed(2))), h("td", {}, fmtNum(pToDisplay(r.P_kPa, u), 5)),
          h("td", {}, fmtNum(r.liquid.rho_kg_m3, 5)), h("td", {}, fmtNum(r.vapour.rho_kg_m3, 4)), h("td", {}, fmtNum(r.liquid.h_kJ_kg, 5)),
          h("td", {}, fmtNum(r.vapour.h_kJ_kg, 5)), h("td", {}, fmtNum(r.hfg_kJ_kg, 5)), h("td", {}, fmtNum(r.liquid.s_kJ_kgK, 4)), h("td", {}, fmtNum(r.vapour.s_kJ_kgK, 4)));
      })))),
    h("div", { class: "fug-foot" }, "IAPWS-IF97 (IAPWS R7-97(2012)). Reference state: internal energy and entropy of the saturated liquid at the triple point are zero. Steam-table units (per kg) whatever the energy basis.")));

  // state calculator
  const calc = { T: 573.15, P: 1000 };
  const tIn = h("input", { type: "text", inputmode: "decimal", id: `fa-st-${uid}`, value: String(+tToDisplay(calc.T, u).toFixed(3)) });
  const pIn = h("input", { type: "text", inputmode: "decimal", id: `fa-sp-${uid}`, value: fmtShort(pToDisplay(calc.P, u), 6) });
  const out = h("div", { class: "fa-calc-out", "aria-live": "polite" });
  const run = () => {
    const T = parseT(tIn.value, u), P = parseP(pIn.value, u);
    if (!T || P == null) { out.replaceChildren(h("div", { class: "fug-err" }, "Enter a temperature and a positive pressure.")); return; }
    try {
      const st = steam(T, P);
      out.replaceChildren(h("div", { class: "fa-phase" }, `${st.phase[0].toUpperCase()}${st.phase.slice(1)}`, h("small", {}, ` IF97 region ${st.region}`)),
        kv([["Density ρ", fmtNum(st.rho_kg_m3, 5), "kg/m³"], ["Specific volume v", fmtNum(st.v_m3_kg, 5), "m³/kg"], ["Enthalpy h", fmtNum(st.h_kJ_kg, 5), "kJ/kg"],
          ["Entropy s", fmtNum(st.s_kJ_kgK, 5), "kJ/(kg·K)"], ["Internal energy u", fmtNum(st.u_kJ_kg, 5), "kJ/kg"], ["cp", fmtNum(st.cp_kJ_kgK, 5), "kJ/(kg·K)"],
          ["cv", fmtNum(st.cv_kJ_kgK, 5), "kJ/(kg·K)"], ["Speed of sound w", fmtNum(st.w_m_s, 5), "m/s"],
          ["Viscosity μ", st.mu_Pa_s == null ? null : fmtNum(st.mu_Pa_s * 1000, 5), "mPa·s"], ["Conductivity k", st.k_W_mK == null ? null : fmtNum(st.k_W_mK, 4), "W/(m·K)"]]),
        ...st.notes.map(n => h("div", { class: "fug-foot" }, n)));
    } catch (e) { out.replaceChildren(h("div", { class: "fug-err" }, e.message)); }
  };
  tIn.addEventListener("change", run); pIn.addEventListener("change", run);
  run();
  extra.append(
    section("State calculator", h("div", { class: "fa-form" }, h("label", { for: tIn.id }, h("span", {}, `T, ${tU(u)}`), tIn), h("label", { for: pIn.id }, h("span", {}, `P, ${u.P}`), pIn)), out),
    section("Sources", sourceList(ctx, [
      { label: "Thermodynamic properties", tier: "standard", text: "IAPWS-IF97, IAPWS R7-97(2012), www.iapws.org" },
      { label: "Viscosity", tier: "standard", text: "IAPWS R12-08, industrial form" },
      { label: "Thermal conductivity", tier: "standard", text: "IAPWS R15-11, industrial form" }]),
    sourceLinks(["iapws-r7-97", "iapws-r12-08", "iapws-r15-11"])));
  return { data: `IAPWS-IF97 (${TIER_LABEL.standard})`, export: () => ({
    title: "Water and steam: temperature-entropy chart and saturation table", file: "steam",
    about: [["Standard", "IAPWS-IF97 (IAPWS R7-97(2012)); viscosity IAPWS R12-08, thermal conductivity IAPWS R15-11"],
      ["Reference state", "internal energy and entropy of the saturated liquid at the triple point are zero"], ["Units", `T in ${tU(u)}, P in ${u.P}; per kg`]],
    tables: steamTables({ units: u, dome: sat, isobars: isobars.map(b => ({ P: b.P, points: b.raw, note: `${b.raw.length} points, ordered by entropy as drawn` })),
      table: rowsT.map(T => steamSat({ T_K: T })) }),
  }) };
}

// ---------------------------------------------------------------------------------------
// Sources: the library browser (the Sources panel, a drawer over the workspace)

/**
 * The source browser: search, kind filter, "used by this calculation", one card per source.
 * @param {{ids:string[], what:string, uid:string, look:{query:string, kind:string, mine:boolean}}} o
 *   ids: the components of the calculation on the canvas; what: how to name it ("Methanol,
 *   acetone and chloroform"); look: the filters, kept by the caller so they survive closing.
 */
export function sourcesPanel({ ids, what, uid, look }) {
  const all = library.sources();
  const names = ids.map(nameOf);
  const kinds = [...new Set(all.map(s => s.kind))];
  const list = h("div", { class: "fa-srcs", role: "list" });
  const count = h("div", { class: "fa-hint", "aria-live": "polite" });
  const draw = () => {
    const shown = filterSources(all, look.query, look.kind).filter(s => !look.mine || sourceUsedFor(s, ids, names));
    count.textContent = `${shown.length} of ${all.length} sources`;
    list.replaceChildren(...shown.map(sourceCard), ...(shown.length ? [] : [h("div", { class: "fa-empty" }, "No source matches. Clear the search or the filters.")]));
  };
  const search = h("input", { type: "search", id: `fa-sq-${uid}`, placeholder: "Title, author, DOI, component, pair…", value: look.query, "aria-label": "Search the sources",
    "data-fk": "src-search", on: { input: ev => { look.query = ev.target.value; draw(); } } });
  const kindSel = h("select", { id: `fa-sk-${uid}`, "aria-label": "Kind of source", on: { change: ev => { look.kind = ev.target.value; draw(); } } },
    h("option", { value: "all" }, "All kinds"), ...kinds.map(k => h("option", { value: k, selected: look.kind === k }, KIND_LABEL[k] ?? k)));
  const mine = h("input", { type: "checkbox", id: `fa-sm-${uid}`, checked: look.mine && ids.length > 0, disabled: !ids.length, on: { change: ev => { look.mine = ev.target.checked; draw(); } } });
  const byKind = kinds.map(k => [KIND_LABEL[k] ?? k, all.filter(s => s.kind === k).length]).sort((a, b) => b[1] - a[1]);
  draw();
  return h("div", { class: "fa-src-panel" },
    h("p", { class: "fa-src-summary" }, `${all.length} open sources (${byKind.map(([k, n]) => `${k}: ${n}`).join(", ")}). Every number in Fugacity comes from one of them, each free to read.`),
    h("div", { class: "fa-src-tools" },
      h("div", { class: "fa-search fa-src-search" }, icon("search", 16), search), kindSel,
      h("label", { class: "fa-check-label", for: mine.id }, mine, ids.length ? `Only those used by the current calculation (${what})` : "Only those used by the current calculation (no inputs chosen)"), count),
    list,
    h("details", { class: "fa-dev" }, h("summary", {}, "In code"),
      h("div", { class: "fa-src-text" }, "Fugacity.library.sources(), .source(id), .sets(i, j, model), .usedBy(id); Fugacity.system({ …, sets: { \"acetone+chloroform\": \"chemsep\" }, prefer: [\"databank\"] })."),
      h("div", { class: "fa-src-text" }, "Fugacity.library.add({ model, i, j, set, params, source }) adds a set from a paper for this page only (tier “user”); nothing is saved."),
      h("div", { class: "fa-src-text" }, "A new source is cited once in src/data/sources.json and referred to by id (AGENTS.md).")));
}

function sourceCard(s) {
  const href = linkOf(s);
  const uses = s.usedBy ?? [];
  const records = uses.filter(u => u.type !== "file"), files = uses.filter(u => u.type === "file");
  const groups = new Map();
  for (const u of records) {
    const g = u.type === "component" ? `Pure-component data: ${u.label.split(": ")[1]}` : u.type === "kij" ? "Equation-of-state k_ij"
      : u.type === "pair-set" ? `${u.model} parameter sets` : u.type === "henry" ? "Henry's law" : "Known-deviation notes";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(u.type === "component" ? nameOf(u.component) : u.type === "pair-set" || u.type === "kij" ? `${u.pair.join(" + ")}${u.default ? "" : ` (${u.set}, alternative)`}` : u.label);
  }
  const usedRows = [...groups].map(([g, items]) => h("li", {}, h("b", {}, `${g}: `), [...new Set(items)].join("; ")));
  if (files.length) usedRows.push(h("li", {}, h("b", {}, "Files: "), files.map(f => f.file).join(", ")));
  return h("article", { class: "fa-src-card", role: "listitem" },
    h("div", { class: "fa-src-card-head" },
      href ? h("a", { href, target: "_blank", rel: "noopener", class: "fa-src-title" }, s.title) : h("span", { class: "fa-src-title" }, s.title),
      h("span", { class: `fa-kind fa-kind-${s.kind.replace(/[^a-z]+/g, "-")}` }, KIND_LABEL[s.kind] ?? s.kind)),
    byline(s) ? h("div", { class: "fa-libsrc-meta" }, byline(s)) : null,
    h("dl", { class: "fa-src-dl" },
      h("dt", {}, "Why it is open"), h("dd", {}, s.access),
      s.via ? h("dt", {}, "Taken via") : null, s.via ? h("dd", {}, s.via) : null,
      s.doi ? h("dt", {}, "DOI") : null, s.doi ? h("dd", {}, h("a", { href: `https://doi.org/${s.doi}`, target: "_blank", rel: "noopener" }, s.doi)) : null,
      s.note ? h("dt", {}, "Note") : null, s.note ? h("dd", {}, s.note) : null),
    usedRows.length ? h("details", { class: "fa-src-uses" }, h("summary", {}, `Used for: ${records.length ? `${records.length} record${records.length === 1 ? "" : "s"}` : ""}${records.length && files.length ? ", " : ""}${files.length ? `${files.length} file${files.length === 1 ? "" : "s"}` : ""}`),
      h("ul", {}, ...usedRows)) : h("div", { class: "fa-hint" }, "Not used yet."),
    h("div", { class: "fa-src-id" }, h("code", {}, s.id)));
}
