/**
 * Property explorer: pure-component properties against temperature (proposal 0002, section 7).
 *
 * A view (layer 6). It only calls layer 1: `pure(id)` and `PROPERTIES` (src/thermo/pure.js)
 * and `listComponents()` / `findComponent()` (src/thermo/system.js). All values come from
 * the engine in SI units; this file converts them for display only (see properties-logic.js
 * for the conversions and for the sampling rules that keep every curve inside the
 * validity range of the data behind it).
 */
import { injectPropertiesStyles } from "./styles.js";
import { h } from "./dom.js";
import { drawPlot } from "./plot.js";
import { pure, PROPERTIES } from "../thermo/pure.js";
import { listComponents, findComponent } from "../thermo/system.js";
import {
  normalizeUnits, UNIT_CHOICES, toDisplay, unitLabel, tToDisplay, tFromDisplay, pToDisplay, pFromDisplay,
  parsePressures, explorerProperties, findExplorerProperty, STATE_PROPERTIES, sampleTemperatureProperty,
  sampleStateProperty, stateDomain, statePoint, saturationTable, SAT_COLUMNS, singleState,
  fmtNum, fmtShort, fmtT, formatSource, TIER_LABEL, missingMessage,
} from "./properties-logic.js";

const SERIES = n => `var(--fug-s${(n % 6) + 1})`;
const FEEDBACK = "https://github.com/FaireDose/Fugacity/issues/new/choose";

/**
 * Put a pure-component property explorer into a page element.
 *
 * @param {string|HTMLElement} target  element or CSS selector
 * @param {object} [cfg]
 * @param {string} [cfg.component="water"]   name, id, alias, formula or CAS number
 * @param {string} [cfg.property="density"]  "density", "enthalpy", "cp", "viscosity",
 *   "conductivity" (state properties, from props(T, P)), "vapourPressure", or a name in
 *   PROPERTIES (temperature-only correlations, e.g. "liquidDensity", "heatOfVaporization")
 * @param {number[]} [cfg.pressures_kPa=[100, 500, 1000]]  pressures of the state-property curves
 * @param {object} [cfg.units]  { T: "C"|"K", P: "bar"|"kPa", energy: "kJ/kg"|"J/mol",
 *   viscosity: "mPa s"|"Pa s" }
 * @param {[number, number]} [cfg.T_K]  temperature range of the plot, K (default: the data's range)
 * @param {boolean} [cfg.logScale]      logarithmic property axis (default: automatic)
 * @param {string} [cfg.title]
 * @param {boolean} [cfg.controls=true]  false hides the title, the component and property
 *   menus and the unit switches (for a page, like the workbench, that sets them through update())
 * @returns {{update:(patch:object)=>void, state:object}}
 *
 * @example
 * Fugacity.mountProperties("#app", { component: "water", property: "enthalpy", pressures_kPa: [100, 1000] });
 */
export function mountProperties(target, cfg = {}) {
  const root = typeof target === "string" ? document.querySelector(target) : target;
  if (!root) throw new Error(`Fugacity.mountProperties: no element matches "${target}".`);
  injectPropertiesStyles(root.ownerDocument);

  const state = {
    component: findComponent(cfg.component ?? "water"),
    property: findExplorerProperty(cfg.property ?? "density").key,
    pressures_kPa: cleanPressures(cfg.pressures_kPa ?? [100, 500, 1000]),
    units: normalizeUnits(cfg.units),
    T_K: cfg.T_K ? checkRange(cfg.T_K) : null,
    logScale: cfg.logScale ?? null,
    title: cfg.title,
    calc: { T_K: 298.15, P_kPa: 101.325 },
    feedbackUrl: cfg.feedbackUrl ?? FEEDBACK,
    controls: cfg.controls !== false,
  };
  const uid = Math.random().toString(36).slice(2, 7);
  const components = listComponents();
  const box = h("div", { class: "fug fug-props" });
  root.replaceChildren(box);

  // narrow containers (phones) get a plot with fewer, larger units per pixel
  const isCompact = () => (root.clientWidth || 600) < 560;
  let compact = isCompact();
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => { if (isCompact() !== compact) { compact = isCompact(); render(); } }).observe(root);
  }

  function render() {
    const p = pure(state.component);
    const prop = findExplorerProperty(state.property);
    const u = state.units;
    const tU = unitLabel("temperature", u);

    // ---- header and controls
    const compSel = h("select", { id: `fug-pc-${uid}`, on: { change: ev => { state.component = ev.target.value; state.T_K = null; state.title = undefined; render(); } } },
      ...components.map(c => h("option", { value: c.id, selected: c.id === p.id }, c.name)));
    const groups = [["state", "Depend on T and P"], ["T", "Depend on T only (correlations)"]];
    const propSel = h("select", { id: `fug-pp-${uid}`, on: { change: ev => { state.property = ev.target.value; state.T_K = null; state.logScale = null; render(); } } },
      ...groups.map(([kind, label]) => h("optgroup", { label },
        ...explorerProperties().filter(x => x.kind === kind).map(x => h("option", { value: x.key, selected: x.key === prop.key },
          x.label + (x.kind === "T" && !p.has(x.key) ? "  (no data)" : ""))))));
    const seg = (key, aria) => h("div", { class: "fug-seg", role: "group", "aria-label": aria },
      ...UNIT_CHOICES[key].map(([v, label]) => h("button", { type: "button", "aria-pressed": String(u[key] === v),
        on: { click: () => { state.units = { ...u, [key]: v }; render(); } } }, label)));

    const head = h("div", { class: "fug-head" },
      h("h3", { class: "fug-title" }, state.title || `${p.name} (${p.formula})`),
      h("span", { class: "fug-sub" }, [
        `M = ${fmtNum(p.MW, 5)} g/mol`,
        `Tc = ${fmtT(p.Tc_K, u)} ${tU}`,
        `Pc = ${fmtNum(pToDisplay(p.Pc_kPa, u), 4)} ${u.P}`,
        `Tb = ${fmtT(p.Tb_K, u)} ${tU}`,
        `ω = ${fmtNum(p.omega, 3)}`,
      ].join(" · ")));
    const controls = h("div", { class: "fug-controls" },
      h("label", { for: compSel.id }, "Component", compSel), h("label", { for: propSel.id }, "Property", propSel));
    const units = h("div", { class: "fug-controls", "aria-label": "Units" },
      h("span", { class: "fug-sub" }, "Units"), seg("T", "Temperature unit"), seg("P", "Pressure unit"),
      seg("basis", "Energy basis"), seg("viscosity", "Viscosity unit"));

    const plot = h("div", { class: "fug-plot" }), side = h("div", { class: "fug-side", "aria-live": "polite" });
    const srcs = h("div", { class: "fug-srcs" });
    const curve = prop.kind === "state" ? stateCurves(p, prop, plot, side, srcs) : tCurve(p, prop, plot, side, srcs);

    box.replaceChildren(...(state.controls ? [head, controls, units] : []), curve.controls, h("div", { class: "fug-main" }, plot, side), srcs,
      satSection(p, prop), calcSection(p),
      h("div", { class: "fug-foot" },
        h("div", {}, "Calculated live in this page by Fugacity from the engine's SI values; units are converted for display only. Enthalpy reference: ideal gas at 25 °C (298.15 K) = 0."),
        h("div", {}, "Correlations are never drawn outside their stated temperature range. ",
          state.feedbackUrl ? h("a", { href: state.feedbackUrl, target: "_blank", rel: "noopener" }, "Report a problem or suggest data") : null)));
  }

  // ---- range and scale controls shared by both kinds of plot
  function rangeControls(domain, extra = [], logAllowed = true, logAuto = false) {
    const u = state.units, tU = unitLabel("temperature", u);
    const [lo, hi] = state.T_K ?? domain ?? [NaN, NaN];
    const num = (id, v, set) => h("input", { type: "number", id, step: "any", value: Number.isFinite(v) ? +tToDisplay(v, u).toFixed(2) : "",
      on: { change: ev => { const x = +ev.target.value; if (ev.target.value !== "" && Number.isFinite(x)) set(tFromDisplay(x, u)); } } });
    const from = num(`fug-t0-${uid}`, lo, v => { state.T_K = [v, state.T_K?.[1] ?? hi]; render(); });
    const to = num(`fug-t1-${uid}`, hi, v => { state.T_K = [state.T_K?.[0] ?? lo, v]; render(); });
    const log = h("input", { type: "checkbox", id: `fug-log-${uid}`, checked: logAllowed && (state.logScale ?? logAuto), disabled: !logAllowed,
      on: { change: ev => { state.logScale = ev.target.checked; render(); } } });
    return h("div", { class: "fug-controls" }, ...extra,
      h("label", { for: from.id }, `T from, ${tU}`, from), h("label", { for: to.id }, "to", to),
      state.T_K ? h("button", { type: "button", class: "fug-tier", style: "cursor:pointer; padding:3px 10px",
        on: { click: () => { state.T_K = null; render(); } } }, "Data range") : null,
      h("label", { title: logAllowed ? "" : "Not available: the values include zero or negative numbers." }, log, "Log scale"));
  }

  // ---- temperature-only property: one curve over the record's range
  function tCurve(p, prop, plot, side, srcs) {
    const u = state.units, MW = p.MW;
    const rec = p.record(prop.key);
    const domain = rec ? [rec.Tmin_K, rec.Tmax_K] : null;
    const [lo, hi] = state.T_K ?? domain ?? [0, 0];
    const smp = sampleTemperatureProperty(p, prop.key, { Tmin: lo, Tmax: hi });
    const q = prop.quantity, yU = q ? unitLabel(q, u) : prop.rawUnits;
    const conv = v => (q ? toDisplay(q, v, u, MW) : v);
    srcs.replaceChildren(h("div", { class: "k" }, `${prop.label}: source`), ...recordLines(p, prop.key));
    if (!smp.available || !smp.points.length) {
      plot.replaceChildren(noData(p, prop.label, smp.message));
      side.hidden = true;
      return { controls: rec ? rangeControls(domain) : h("div") };
    }
    const ys = smp.points.map(pt => conv(pt.v));
    const logAllowed = ys.every(v => v > 0), logAuto = logAllowed && Math.max(...ys) / Math.min(...ys) > 50;
    const log = logAllowed && (state.logScale ?? logAuto);
    const series = [{ name: "", color: SERIES(0), segments: [{ cls: "liquid", points: smp.points.map((pt, i) => ({ x: tToDisplay(pt.T, u), y: ys[i] })) }], transitions: [] }];
    const read = h("div", { class: "fug-read" });
    const show = Tx => {
      const T = tFromDisplay(Tx, u);
      let v = null;
      if (T >= smp.points[0].T && T <= smp.points.at(-1).T) { try { v = conv(p.property(prop.key, T)); } catch { v = null; } }
      read.replaceChildren(row(`${prop.symbol} at ${fmtShort(+Tx.toFixed(2))} ${unitLabel("temperature", u)}`, v == null ? "outside the data" : `${fmtNum(v, 4)} ${yU}`));
      return [v];
    };
    const move = drawPlot(plot, { compact, series, xLabel: `T, ${unitLabel("temperature", u)}`, yLabel: `${prop.symbol}, ${yU}`, log, show,
      x0: tToDisplay(smp.points[0].T, u), x1: tToDisplay(smp.points.at(-1).T, u), aria: `${prop.label} of ${p.name} against temperature` });
    side.replaceChildren(h("div", { class: "fug-eyebrow" }, prop.label), read,
      h("div", { class: "fug-foot" }, `Data range ${fmtT(smp.range[0], u)} to ${fmtT(smp.range[1], u)} ${unitLabel("temperature", u)}. Point at the plot to read values.`));
    move(tToDisplay(clamp(p.Tb_K, smp.points[0].T, smp.points.at(-1).T), u));
    return { controls: rangeControls(domain, [], logAllowed, logAuto) };
  }

  // ---- state property: one curve per pressure, with the phase change marked
  function stateCurves(p, prop, plot, side, srcs) {
    const u = state.units, MW = p.MW, def = STATE_PROPERTIES[prop.key];
    const yU = unitLabel(def.quantity, u), tU = unitLabel("temperature", u);
    const pressures = state.pressures_kPa;
    const pIn = h("input", { type: "text", id: `fug-pl-${uid}`, inputmode: "decimal",
      value: pressures.map(P => fmtShort(pToDisplay(P, u), 6)).join(", "),
      on: { change: ev => { const list = parsePressures(ev.target.value, u); if (list.length) { state.pressures_kPa = list; render(); } else ev.target.value = pressures.map(P => fmtShort(pToDisplay(P, u), 6)).join(", "); } } });
    const pressureControl = h("label", { for: pIn.id, title: "Up to six pressures, separated by commas" }, `Pressures, ${u.P}`, pIn);

    const domain = stateDomain(p, prop.key, pressures[0]);
    srcs.replaceChildren(...stateSourceLines(p, def, []));
    if (!domain && !state.T_K) {
      plot.replaceChildren(noData(p, prop.label, `${p.name} has no temperature-dependent data for this property yet.`));
      side.hidden = true;
      return { controls: rangeControls(null, [pressureControl]) };
    }
    const [lo, hi] = state.T_K ?? domain;
    const samples = pressures.map(P => sampleStateProperty(p, prop.key, P, { Tmin: lo, Tmax: hi }));
    srcs.replaceChildren(...stateSourceLines(p, def, samples));
    const conv = v => toDisplay(def.quantity, v, u, MW);
    const ys = samples.flatMap(sm => sm.segments.flatMap(g => g.points.map(pt => conv(pt.v))));
    if (!ys.length) {
      plot.replaceChildren(noData(p, prop.label, `No values between ${fmtT(lo, u)} and ${fmtT(hi, u)} ${tU} at these pressures. The sources below say what is missing.`));
      side.hidden = true;
      return { controls: rangeControls(domain, [pressureControl]) };
    }
    const logAllowed = ys.every(v => v > 0), logAuto = logAllowed && Math.max(...ys) / Math.min(...ys) > 50;
    const log = logAllowed && (state.logScale ?? logAuto);
    const series = samples.map((sm, i) => ({
      name: `${fmtShort(pToDisplay(sm.P_kPa, u), 4)} ${u.P}`, color: SERIES(i),
      segments: sm.segments.map(g => ({ cls: g.cls, points: g.points.map(pt => ({ x: tToDisplay(pt.T, u), y: conv(pt.v) })) })),
      transitions: sm.transitions.map(t => ({ x: tToDisplay(t.T, u), y0: conv(t.vFrom), y1: conv(t.vTo), kind: t.kind })),
    }));

    const read = h("div", { class: "fug-read" });
    const show = Tx => {
      const T = tFromDisplay(Tx, u);
      const vals = [];
      const rows = [h("div", { class: "fug-eyebrow" }, `At ${fmtShort(+Tx.toFixed(2))} ${tU}`)];
      pressures.forEach((P, i) => {
        const pt = T >= lo && T <= hi ? statePoint(p, prop.key, T, P) : null;
        const v = pt?.v != null ? conv(pt.v) : null;
        vals.push(v);
        rows.push(h("div", { class: "row" }, h("span", {}, h("span", { class: "sw", style: `border-color:${SERIES(i)}` }), series[i].name, pt ? ` · ${pt.phase}` : ""),
          h("b", {}, v == null ? "–" : `${fmtNum(v, 4)} ${yU}`)));
      });
      read.replaceChildren(...rows);
      return vals;
    };
    const move = drawPlot(plot, { compact, series, xLabel: `T, ${tU}`, yLabel: `${prop.symbol}, ${yU}`, log, show,
      x0: tToDisplay(lo, u), x1: tToDisplay(hi, u), aria: `${prop.label} of ${p.name} against temperature at ${series.map(s => s.name).join(", ")}` });
    const legend = samples.map((sm, i) => {
      const t = sm.transitions[0];
      const what = !sm.count ? "no values in this range"
        : t ? (t.kind === "critical"
          ? `above Pc: liquid values up to Tc = ${fmtT(t.T, u)} ${tU}, gas above`
          : `boils at ${fmtT(t.T, u)} ${tU}`)
          : sm.segments.every(g => g.cls === "liquid") ? "liquid only in this range" : "gas only in this range";
      return h("div", { class: "row" }, h("span", {}, h("span", { class: "sw", style: `border-color:${SERIES(i)}` }), series[i].name), h("span", { class: "fug-sub" }, what));
    });
    side.replaceChildren(h("div", { class: "fug-eyebrow" }, prop.label), h("div", { class: "fug-read" }, ...legend),
      h("div", { class: "fug-foot" }, "Vertical dotted line: phase change (the property jumps from the saturated liquid to the vapour). Point at the plot to read values." +
        (prop.key === "enthalpy" ? " Reference: ideal gas at 25 °C (298.15 K), h = 0." : "")),
      read);
    move(tToDisplay(clamp(p.Tb_K, lo, hi), u));
    return { controls: rangeControls(domain, [pressureControl], logAllowed, logAuto) };
  }

  // ---- sources
  function recordLines(p, name) {
    const u = state.units, tU = unitLabel("temperature", u);
    const r = p.record(name);
    const label = name === "vapourPressure" ? "Vapour pressure" : PROPERTIES[name]?.label ?? name;
    if (!r) return [h("div", { class: "miss" }, missingMessage(p, name) ?? `${label}: no data.`)];
    const range = Number.isFinite(r.Tmin_K) ? ` · valid ${fmtT(r.Tmin_K, u)} to ${fmtT(r.Tmax_K, u)} ${tU}` : " · no stated range";
    return [h("div", {}, `${label}: ${formatSource(r.source)}${range} `, h("span", { class: "fug-tier" }, TIER_LABEL[r.tier] ?? r.tier ?? "tier not stated"))];
  }

  function stateSourceLines(p, def, samples) {
    const lines = [];
    for (const [cls, title] of [["liquid", "Liquid"], ["gas", "Vapour and gas"]]) {
      lines.push(h("div", { class: "k" }, title));
      const fromRecords = new Set(def.depends[cls].map(n => p.record(n)).filter(Boolean).map(r => formatSource(r.source)));
      // sources the engine reported that are not one of the records (ideal-gas law, IAPWS, an equation of state)
      const other = new Map();
      let points = 0, standard = 0;
      for (const sm of samples) for (const g of sm.segments) if (g.cls === cls) {
        for (const pt of g.points) {
          const src = statePointSource(p, def, pt, sm.P_kPa);
          points++;
          if (src?.tier === "standard") standard++;
          if (src && !fromRecords.has(formatSource(src.source))) other.set(formatSource(src.source), src);
        }
      }
      // the records behind props(), unless every point drawn came from an official standard (e.g. IAPWS for water)
      if (!(points > 0 && standard === points)) for (const n of def.depends[cls]) lines.push(...recordLines(p, n));
      for (const src of other.values()) lines.push(h("div", {}, `${def.label}: ${formatSource(src.source)} `, h("span", { class: "fug-tier" }, TIER_LABEL[src.tier] ?? src.tier ?? "")));
      if (!def.depends[cls].length && !other.size) lines.push(h("div", {}, "From the engine's model for this phase (see notes)."));
    }
    // the vapour pressure the engine used for the phase (e.g. IAPWS-IF97 for water), else the record
    const psSrc = new Map();
    for (const sm of samples) for (const x of sm.psatSources || []) psSrc.set(formatSource(x.source), x);
    lines.push(h("div", { class: "k" }, "Phase boundary"), ...(psSrc.size
      ? [...psSrc.values()].map(x => h("div", {}, `Vapour pressure: ${formatSource(x.source)} `, h("span", { class: "fug-tier" }, TIER_LABEL[x.tier] ?? x.tier ?? "")))
      : recordLines(p, "vapourPressure")));
    // temperature runs where no curve is drawn, and why (merged across pressures when equal)
    const u = state.units, tU = unitLabel("temperature", u), gapText = new Map();
    for (const sm of samples) for (const g of sm.gaps || []) {
      const why = g.reason === "phase"
        ? "the phase is unknown (outside the vapour-pressure range)"
        : `no ${g.cls === "liquid" ? "liquid" : "vapour"} data valid at these temperatures`;
      const key = `${fmtT(g.T0, u)} to ${fmtT(g.T1, u)} ${tU}: ${why}`;
      gapText.set(key, [...(gapText.get(key) || []), `${fmtShort(pToDisplay(sm.P_kPa, u), 4)} ${u.P}`]);
    }
    if (gapText.size) {
      lines.push(h("div", { class: "k" }, "Not drawn"),
        ...[...gapText].map(([k, ps]) => h("div", {}, `${ps.length === samples.length ? "All pressures" : ps.join(", ")}, ${k}.`)));
    }
    const notes = groupNotes(samples.flatMap(sm => sm.notes).filter(n => !/not in the databank|No open data/.test(n)));
    if (notes.length) lines.push(h("div", { class: "k" }, "Notes from the engine"), ...notes.map(n => h("div", {}, n)));
    return lines;
  }

  // the props() source of one sampled point (first and last point of each segment are enough)
  const srcCache = new Map();
  function statePointSource(p, def, pt, P) {
    const key = `${p.id}|${def.field}|${pt.phase}|${P}`;
    if (srcCache.has(key)) return srcCache.get(key);
    let src = null;
    try { src = p.props(pt.T, P).sources?.[def.field] ?? null; } catch { src = null; }
    srcCache.set(key, src);
    return src;
  }

  function noData(p, label, message) {
    return h("div", { class: "fug-nodata", role: "status" },
      h("strong", {}, `No curve: ${label} of ${p.name}`),
      h("div", {}, message || "No open data."),
      h("div", { class: "fug-sub" }, "Nothing is estimated silently. ",
        h("a", { href: "https://github.com/FaireDose/Fugacity/blob/main/docs/DATA_WANTED.md", target: "_blank", rel: "noopener" }, "Help find open data")));
  }

  // ---- saturation ("steam") table
  function satSection(p, prop) {
    const u = state.units, MW = p.MW, tU = unitLabel("temperature", u);
    const tab = saturationTable(p, u, { rows: 12, Tmin: state.T_K?.[0], Tmax: state.T_K?.[1] });
    const title = h("h4", {}, "Saturation table");
    if (!tab.rows.length) {
      return h("div", { class: "fug-sec" }, title, h("div", { class: "fug-nodata" }, tab.message || "No vapour pressure in range: the saturation table needs it."));
    }
    const defaults = ["rhoL", "rhoV", "hL", "hV", "dHvap"];
    const sel = prop.kind === "state" ? SAT_COLUMNS.filter(c => c[1] === STATE_PROPERTIES[prop.key].field).map(c => c[0]) : [];
    const cols = SAT_COLUMNS.filter(c => (defaults.includes(c[0]) || sel.includes(c[0])) && tab.columns.includes(c[0]));
    const missing = SAT_COLUMNS.filter(c => (defaults.includes(c[0]) || sel.includes(c[0])) && !tab.columns.includes(c[0])).map(c => c[4]);
    const th = (label, unit) => h("th", { scope: "col" }, label, h("span", { class: "u" }, unit));
    const table = h("table", {},
      h("thead", {}, h("tr", {}, th("T", tU), th("Psat", u.P), ...cols.map(c => th(c[4], unitLabel(c[2], u))))),
      h("tbody", { class: "fug-num" }, ...tab.rows.map(r => h("tr", {},
        h("td", {}, fmtT(r.T, u)), h("td", {}, fmtNum(pToDisplay(r.psat, u), 4)),
        ...cols.map(c => h("td", {}, fmtNum(toDisplay(c[2], r[c[0]], u, MW), 4)))))));
    return h("div", { class: "fug-sec" }, title,
      h("div", { class: "fug-scroll", tabindex: "0", role: "region", "aria-label": "Saturation table" }, table),
      h("div", { class: "fug-foot" },
        `Saturated liquid (just above Psat) and saturated vapour (just below Psat) from the engine. “–”: no data at that temperature.` +
        (tab.psatSource ? ` Psat: ${formatSource(tab.psatSource.source)} (${TIER_LABEL[tab.psatSource.tier] ?? tab.psatSource.tier ?? "tier not stated"}).` : "") +
        (missing.length ? ` No data yet for: ${missing.join(", ")}.` : "")));
  }

  // ---- single-state calculator
  function calcSection(p) {
    const u = state.units, MW = p.MW, tU = unitLabel("temperature", u);
    const tIn = h("input", { type: "number", id: `fug-ct-${uid}`, step: "any", value: +tToDisplay(state.calc.T_K, u).toFixed(3),
      on: { change: ev => { const v = tFromDisplay(+ev.target.value, u); if (v > 0) { state.calc.T_K = v; out.replaceChildren(...cells()); } } } });
    const pIn = h("input", { type: "number", id: `fug-cp-${uid}`, step: "any", min: 0, value: fmtShort(pToDisplay(state.calc.P_kPa, u), 6),
      on: { change: ev => { const v = pFromDisplay(+ev.target.value, u); if (v > 0) { state.calc.P_kPa = v; out.replaceChildren(...cells()); } } } });
    const out = h("div", { class: "fug-calc", "aria-live": "polite" });
    function cells() {
      let st;
      try { st = singleState(p, state.calc.T_K, state.calc.P_kPa); } catch (e) { return [h("div", { class: "fug-err", role: "alert" }, e.message)]; }
      const src = f => {
        if (st.outOfRange.includes(f)) return "outside the data range";
        const x = st.sources?.[f];
        if (x) return TIER_LABEL[x.tier] ?? x.tier ?? "";
        if (f === "h_J_mol" && st[f] != null) return st.phase === "liquid" ? "from cp° and ΔHvap" : "from cp°";
        return st[f] == null ? "no data" : "";
      };
      const cell = (label, v, unit, f) => h("div", {}, h("div", { class: "fug-eyebrow" }, label),
        h("div", { class: "v" }, v == null ? "–" : [fmtNum(v, 5), " ", h("small", {}, unit)]), f ? h("div", { class: "s" }, src(f)) : null);
      const list = [
        h("div", {}, h("div", { class: "fug-eyebrow" }, "Phase"), h("div", { class: "v" }, st.phase ?? "unknown"),
          h("div", { class: "s" }, [st.phase === "liquid" ? "P ≥ Psat" : st.phase === "vapour" ? "P < Psat" : st.phase === "supercritical" ? "T ≥ Tc" : "",
            st.region != null ? `IF97 region ${st.region}` : ""].filter(Boolean).join(" · "))),
        cell("Psat", toDisplay("pressure", st.psat_kPa, u), u.P, "psat_kPa"),
        cell("Density ρ", toDisplay("density", st.rho_kg_m3, u), unitLabel("density", u), "rho_kg_m3"),
        cell("Enthalpy h", toDisplay("energy", st.h_J_mol, u, MW), unitLabel("energy", u), "h_J_mol"),
        cell("Heat capacity cp", toDisplay("heatCapacity", st.cp_J_molK, u, MW), unitLabel("heatCapacity", u), "cp_J_molK"),
        "cv_J_molK" in st ? cell("Heat capacity cv", toDisplay("heatCapacity", st.cv_J_molK, u, MW), unitLabel("heatCapacity", u), "cv_J_molK") : null,
        "s_J_molK" in st ? cell("Entropy s", toDisplay("heatCapacity", st.s_J_molK, u, MW), unitLabel("heatCapacity", u), "s_J_molK") : null,
        st.phase === "liquid" || st.dHvap_J_mol != null ? cell("ΔHvap at T", toDisplay("energy", st.dHvap_J_mol, u, MW), unitLabel("energy", u), "dHvap_J_mol") : null,
        cell("Viscosity μ", toDisplay("viscosity", st.mu_Pa_s, u), unitLabel("viscosity", u), "mu_Pa_s"),
        cell("Conductivity k", toDisplay("conductivity", st.k_W_mK, u), unitLabel("conductivity", u), "k_W_mK"),
      ];
      const notes = [...new Set(st.notes || [])];
      return [...list.filter(Boolean), notes.length ? h("div", { style: "grid-column:1/-1; background:none; padding:0" }, ...notes.map(n => h("div", { class: "fug-sub" }, n))) : null].filter(Boolean);
    }
    out.replaceChildren(...cells());
    return h("div", { class: "fug-sec" }, h("h4", {}, "Single state"),
      h("div", { class: "fug-controls" }, h("label", { for: tIn.id }, `T, ${tU}`, tIn), h("label", { for: pIn.id }, `P, ${u.P}`, pIn)),
      out);
  }

  render();
  return {
    state,
    /** Change the view: any of component, property, pressures_kPa, units, T_K, logScale, title. */
    update(patch = {}) {
      if (patch.component != null) { state.component = findComponent(patch.component); state.T_K = null; }
      if (patch.property != null) { state.property = findExplorerProperty(patch.property).key; state.T_K = null; state.logScale = null; }
      if (patch.pressures_kPa != null) state.pressures_kPa = cleanPressures(patch.pressures_kPa);
      if (patch.units != null) state.units = normalizeUnits(patch.units, state.units);
      if ("T_K" in patch) state.T_K = patch.T_K ? checkRange(patch.T_K) : null;
      if ("logScale" in patch) state.logScale = patch.logScale;
      if ("title" in patch) state.title = patch.title;
      if ("controls" in patch) state.controls = patch.controls !== false;
      render();
    },
  };
}

function cleanPressures(list) {
  const out = [...new Set((Array.isArray(list) ? list : [list]).map(Number))].filter(v => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!out.length) throw new Error("pressures_kPa must contain at least one positive pressure in kPa.");
  return out.slice(0, 6);
}

function checkRange(r) {
  if (!Array.isArray(r) || r.length !== 2 || !(r[0] > 0) || !(r[1] > r[0])) throw new Error("T_K must be [Tmin, Tmax] in K with 0 < Tmin < Tmax.");
  return [+r[0], +r[1]];
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Merge notes that differ only in their numbers (one per sampled temperature): first one, with a count. */
function groupNotes(notes) {
  const groups = new Map();
  for (const n of notes) {
    const key = n.replace(/-?\d+(\.\d+)?(e-?\d+)?/g, "#");
    const g = groups.get(key);
    if (g) { if (g.text !== n) g.count++; } else groups.set(key, { text: n, count: 1 });
  }
  const tidy = s => s.replace(/\d+\.\d{5,}/g, m => String(+(+m).toFixed(2)));   // 1173.2536683 -> 1173.25
  return [...groups.values()].map(g => tidy(g.count > 1 ? `${g.text} (and ${g.count - 1} other sampled temperatures)` : g.text));
}

function row(label, value) {
  return h("div", { class: "row" }, h("span", {}, label), h("b", {}, value));
}
