/**
 * A line plot of curves (series of segments) for the views: axes, grid lines, direct labels
 * at the end of each curve, phase-change markers and a hover crosshair that calls `show(x)`.
 * Used by the property explorer (properties.js) and the workbench (app.js). Drawing only:
 * every value comes from the caller.
 */
import { s, text, ticks, svgPoint } from "./dom.js";
import { logTicks, fmtShort } from "./properties-logic.js";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Tick label with as many decimals as the step needs. */
export function tickLabel(v, step) {
  if (v === 0) return "0";
  if (step == null) return fmtShort(v, 3);
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-3) return v.toExponential(step && Math.abs(step / v) < 0.1 ? 2 : 1).replace("e+", "e");
  const d = step ? Math.max(0, -Math.floor(Math.log10(step) + 1e-9)) : 2;
  return v.toFixed(Math.min(d + (step && String(step).includes("25") ? 1 : 0), 6));
}

/**
 * Draw curves into `plot` (replacing its content) and return `move(x)`, which places the
 * crosshair at x and calls `show(x)`; `show` returns one value (or null) per series, drawn
 * as dots on the crosshair.
 *
 * @param {HTMLElement} plot
 * @param {object} o
 * @param {{name:string, color:string, dash?:string, segments:{points:{x:number,y:number}[]}[],
 *   transitions?:{x:number,y0:number|null,y1:number|null}[]}[]} o.series
 * @param {boolean} [o.compact]  smaller drawing for narrow containers
 * @param {boolean} [o.log]      logarithmic y axis
 * @param {number} o.x0, o.x1   x range
 * @param {[number, number]} [o.y]  y range (default: from the data)
 * @param {"end"|"top"} [o.labels="end"]  curve names right of each curve's last point, or
 *   above it (for curves that leave the plot at the top, e.g. isobars on a T-s chart)
 */
export function drawPlot(plot, { compact, series, xLabel, yLabel, log, show, x0, x1, aria, y: yRange, labels: labelMode = "end" }) {
  const W = compact ? 400 : 600, H = compact ? 320 : 360, R = labelMode === "top" ? 24 : 60, T = labelMode === "top" ? 44 : 14, B = 42;
  let L = 58;
  const all = series.flatMap(sr => sr.segments.flatMap(g => g.points.map(pt => pt.y))).filter(v => Number.isFinite(v) && (!log || v > 0));
  let y0 = yRange ? yRange[0] : Math.min(...all), y1 = yRange ? yRange[1] : Math.max(...all);
  let yt;
  if (log) {
    if (!yRange) { y0 /= 1.25; y1 *= 1.25; }
    yt = { values: logTicks(y0, y1), step: null };
  } else {
    const pad = yRange ? 0 : (y1 - y0) * 0.06 || Math.abs(y1) * 0.05 || 1;
    yt = ticks(y0 - pad, y1 + pad, compact ? 5 : 6);
    if (!yRange) { y0 = Math.min(y0 - pad, yt.values[0]); y1 = Math.max(y1 + pad, yt.values.at(-1)); }
  }
  // room for the longest tick label left of the axis
  const longest = Math.max(...yt.values.map(v => tickLabel(v, yt.step).length));
  L = Math.max(L, 26 + 6.7 * longest);
  const xt = ticks(x0, x1, compact ? 4 : 6);
  const sx = v => L + (v - x0) / (x1 - x0 || 1) * (W - L - R);
  const sy = log ? v => H - B - (Math.log(v) - Math.log(y0)) / (Math.log(y1) - Math.log(y0)) * (H - T - B)
    : v => H - B - (v - y0) / (y1 - y0 || 1) * (H - T - B);

  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": aria });
  // grid lines are a background layer: the workbench can hide them
  const grid = s("g", { class: "fug-bg-layer" }, svg);
  for (const v of yt.values) {
    if (v < y0 - 1e-12 * Math.abs(y0) || v > y1 + 1e-12 * Math.abs(y1)) continue;
    s("line", { x1: L, x2: W - R, y1: sy(v), y2: sy(v), stroke: "var(--fug-rule)" }, grid);
  }
  for (const v of yt.values) {
    if (v < y0 - 1e-12 * Math.abs(y0) || v > y1 + 1e-12 * Math.abs(y1)) continue;
    text(svg, L - 6, sy(v) + 4, tickLabel(v, yt.step), { "text-anchor": "end", "font-size": 11 });
  }
  for (const v of xt.values) {
    if (v < x0 - 1e-9 || v > x1 + 1e-9) continue;
    s("line", { x1: sx(v), x2: sx(v), y1: H - B, y2: H - B + 4, stroke: "var(--fug-muted)" }, svg);
    text(svg, sx(v), H - B + 17, tickLabel(v, xt.step), { "text-anchor": "middle", "font-size": 11 });
  }
  s("line", { x1: L, x2: W - R, y1: H - B, y2: H - B, stroke: "var(--fug-muted)" }, svg);
  text(svg, (L + W - R) / 2, H - 6, xLabel, { "text-anchor": "middle", fill: "var(--fug-fg2)", "font-size": 12 });
  text(svg, 13, (T + H - B) / 2, yLabel, { "text-anchor": "middle", fill: "var(--fug-fg2)", "font-size": 12, transform: `rotate(-90 13 ${(T + H - B) / 2})` });

  const inY = v => Number.isFinite(v) && (!log || v > 0);
  const labels = [];
  series.forEach(sr => {
    for (const g of sr.segments) {
      const pts = g.points.filter(pt => inY(pt.y));
      if (!pts.length) continue;
      const d = "M" + pts.map(pt => `${sx(pt.x).toFixed(1)},${sy(pt.y).toFixed(1)}`).join("L");
      s("path", { d, fill: "none", stroke: sr.color, "stroke-width": sr.width ?? 2, "stroke-dasharray": sr.dash, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
    }
    for (const t of sr.transitions || []) {
      const X = sx(t.x);
      if (t.y0 != null && t.y1 != null) {
        s("line", { x1: X, x2: X, y1: sy(t.y0), y2: sy(t.y1), stroke: sr.color, "stroke-width": 1.5, "stroke-dasharray": "2 3" }, svg);
      }
      for (const y of [t.y0, t.y1]) if (y != null) s("circle", { cx: X, cy: sy(y), r: 4, fill: "var(--fug-bg)", stroke: sr.color, "stroke-width": 2 }, svg);
    }
    const last = sr.segments.filter(g => g.points.some(pt => inY(pt.y))).at(-1);
    if (sr.name && last && sr.label !== false) {
      const pt = last.points.filter(q => inY(q.y)).at(-1);
      labels.push({ y: sy(pt.y), x: sx(pt.x), name: sr.name });
    }
  });
  if (labelMode === "top") {
    // above the last points, in up to three rows so that neighbours do not overlap
    labels.sort((a, b) => a.x - b.x);
    const rows = [];
    for (const lb of labels) {
      const w = 6.6 * lb.name.length, x = Math.min(lb.x, W - w / 2 - 2);
      let r = rows.findIndex(right => x - w / 2 > right + 4);
      if (r < 0) r = rows.length < 3 ? rows.length : 0;
      rows[r] = x + w / 2;
      text(svg, x, lb.y - 7 - 12 * r, lb.name, { fill: "var(--fug-fg2)", "font-size": 11, "text-anchor": "middle" });
    }
  } else {
    // direct labels, spread so they do not overlap
    labels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 13);
    const over = labels.length ? labels.at(-1).y - (H - B) : 0;
    if (over > 0) for (const lb of labels) lb.y -= over;
    for (const lb of labels) text(svg, Math.min(lb.x + 6, W - R + 6), lb.y + 4, lb.name, { fill: "var(--fug-fg2)", "font-size": 11 });
  }

  const hover = s("g", { "pointer-events": "none" }, svg);
  const move = x => {
    x = clamp(x, x0, x1);
    const vals = show(x) || [];
    hover.replaceChildren();
    s("line", { x1: sx(x), x2: sx(x), y1: T, y2: H - B, stroke: "var(--fug-muted)", "stroke-dasharray": "3 3" }, hover);
    vals.forEach((v, i) => {
      if (v == null || !inY(v) || v < Math.min(y0, y1) || v > Math.max(y0, y1)) return;
      s("circle", { cx: sx(x), cy: sy(v), r: 4.5, fill: series[i]?.color ?? "var(--fug-fg)", stroke: "var(--fug-halo)", "stroke-width": 2 }, hover);
    });
  };
  const onPointer = ev => { const pt = svgPoint(svg, ev); move(x0 + (pt.x - L) / (W - L - R) * (x1 - x0)); };
  svg.addEventListener("pointermove", onPointer);
  svg.addEventListener("pointerdown", onPointer);
  plot.replaceChildren(svg);
  return move;
}
