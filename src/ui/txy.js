import { s, h, text, ticks, svgPoint, C, fmt, basisView } from "./dom.js";
import { txy } from "../equilibrium/diagrams.js";
import { bubbleT } from "../equilibrium/bubble.js";
import { isLiquidStable } from "../equilibrium/stability.js";

/**
 * T-x-y diagram for a binary system at pressure P (kPa).
 * Draws the bubble (liquid) and dew (vapour) curves, a hover tie line, and a readout.
 */
export function renderTxy(plot, side, sys, P, view = {}) {
  const bv = basisView(view.basis, view.MW);
  const data = txy(sys, P, 101);
  const W = 560, H = 380, L = 56, R = 16, T = 16, B = 44;
  const Tmin = Math.min(...data.map(d => d.T)), Tmax = Math.max(...data.map(d => d.T));
  const pad = Math.max(1, (Tmax - Tmin) * 0.06);
  const yt = ticks(C(Tmin - pad), C(Tmax + pad), 6);
  const y0 = yt.values[0] - (yt.values[0] > C(Tmin - pad) ? yt.step : 0), y1 = yt.values.at(-1) + (yt.values.at(-1) < C(Tmax + pad) ? yt.step : 0);
  const sx = v => L + v * (W - L - R);
  const sy = v => H - B - (v - y0) / (y1 - y0) * (H - T - B);

  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `T-x-y diagram of ${sys.names.join(" and ")}` });
  for (let v = y0; v <= y1 + 1e-9; v += yt.step) {
    s("line", { x1: L, x2: W - R, y1: sy(v), y2: sy(v), stroke: "var(--fug-rule)" }, svg);
    text(svg, L - 8, sy(v) + 4, +v.toFixed(2), { "text-anchor": "end", "font-size": 12 });
  }
  for (const v of [0, 0.2, 0.4, 0.6, 0.8, 1]) text(svg, sx(v), H - B + 18, v.toFixed(1), { "text-anchor": "middle", "font-size": 12 });
  s("line", { x1: L, x2: W - R, y1: H - B, y2: H - B, stroke: "var(--fug-muted)" }, svg);
  text(svg, (L + W - R) / 2, H - 6, `x, y  ${sys.names[0]} (mole fraction)`, { "text-anchor": "middle", fill: "var(--fug-fg2)", "font-size": 12 });
  text(svg, 14, (T + H - B) / 2, "T, °C", { "text-anchor": "middle", fill: "var(--fug-fg2)", "font-size": 12, transform: `rotate(-90 14 ${(T + H - B) / 2})` });

  // spinodal check: shade compositions where the liquid would split
  const unstable = data.filter(d => !isLiquidStable(sys, [d.x, 1 - d.x], d.T));
  if (unstable.length) {
    const x0 = Math.min(...unstable.map(d => d.x)), x1 = Math.max(...unstable.map(d => d.x));
    s("rect", { x: sx(x0), y: T, width: Math.max(2, sx(x1) - sx(x0)), height: H - B - T, fill: "var(--fug-err-bg)", opacity: 0.9 }, svg);
    text(svg, (sx(x0) + sx(x1)) / 2, T + 14, "two liquids", { "text-anchor": "middle", fill: "var(--fug-err-fg)", "font-size": 12 });
  }

  const path = key => "M" + data.map(d => `${sx(d[key]).toFixed(1)},${sy(C(d.T)).toFixed(1)}`).join("L");
  s("path", { d: path("x"), fill: "none", stroke: "var(--fug-liq)", "stroke-width": 2, "stroke-linejoin": "round" }, svg);
  s("path", { d: path("y"), fill: "none", stroke: "var(--fug-vap)", "stroke-width": 2, "stroke-dasharray": "6 4", "stroke-linejoin": "round" }, svg);

  // azeotropes: interior sign changes of (y - x)
  const azeo = [];
  for (let k = 2; k < data.length - 1; k++) {
    const a = data[k - 1], b = data[k];
    if ((a.y - a.x) * (b.y - b.x) < 0) {
      const f = (a.y - a.x) / ((a.y - a.x) - (b.y - b.x));
      azeo.push({ x: a.x + f * (b.x - a.x), T: a.T + f * (b.T - a.T) });
    }
  }
  for (const z of azeo) s("circle", { cx: sx(z.x), cy: sy(C(z.T)), r: 5, fill: "var(--fug-fg)", stroke: "var(--fug-halo)", "stroke-width": 2 }, svg);

  const hover = s("g", {}, svg);
  plot.replaceChildren(svg, h("div", { class: "fug-legend" },
    h("span", { class: "fug-key", style: "color:var(--fug-liq)" }, h("i"), h("span", { style: "color:var(--fug-fg2)" }, "Bubble curve (liquid)")),
    h("span", { class: "fug-key", style: "color:var(--fug-vap)" }, h("i", { style: "border-top-style:dashed" }), h("span", { style: "color:var(--fug-fg2)" }, "Dew curve (vapour)")),
    azeo.length ? h("span", {}, "● azeotrope") : null));

  const xOut = h("div", { class: "fug-num" }), tOut = h("div", { class: "fug-big" }), tab = h("tbody", { class: "fug-num" });
  side.replaceChildren(...[
    h("div", {}, h("div", { class: "fug-eyebrow" }, "Liquid composition"), xOut),
    h("div", {}, h("div", { class: "fug-eyebrow" }, "Bubble temperature"), tOut),
    h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, bv.short), h("th", {}, "x"), h("th", {}, "y"), h("th", {}, "γ"))), tab),
    unstable.length ? h("div", { class: "fug-err" }, "The liquid is predicted to split into two phases in the shaded range. The curves there assume a single liquid and are not reliable.") : null,
    h("div", { class: "fug-foot" }, azeo.length
      ? azeo.map(z => `Azeotrope near ${sys.names[0]} ${bv.f(bv.conv([z.x, 1 - z.x])[0])}${view.basis === "mass" ? " wt %" : ""}, T = ${fmt(C(z.T), 1)} °C`)
      : "No azeotrope at this pressure."),
  ].filter(Boolean));

  function show(x1) {
    x1 = Math.max(0, Math.min(1, x1));
    const r = bubbleT(sys, [x1, 1 - x1], P);
    const x = [x1, 1 - x1], xb = bv.conv(x), yb = bv.conv(r.y);
    xOut.textContent = `${sys.names[0]} ${bv.f(xb[0])} · ${sys.names[1]} ${bv.f(xb[1])}${view.basis === "mass" ? " (wt %)" : ""}`;
    tOut.textContent = `${fmt(C(r.T), 2)} °C`;
    tab.replaceChildren(...sys.names.map((n, i) => h("tr", {}, h("td", {}, n), h("td", {}, bv.f(xb[i])), h("td", {}, bv.f(yb[i])), h("td", {}, fmt(r.gamma[i])))));
    hover.replaceChildren();
    const yy = sy(C(r.T));
    s("line", { x1: sx(x1), x2: sx(r.y[0]), y1: yy, y2: yy, stroke: "var(--fug-fg)", "stroke-width": 1.5, "stroke-dasharray": "3 3" }, hover);
    s("circle", { cx: sx(x1), cy: yy, r: 5, fill: "var(--fug-halo)", stroke: "var(--fug-liq)", "stroke-width": 2.5 }, hover);
    s("circle", { cx: sx(r.y[0]), cy: yy, r: 5, fill: "var(--fug-vap)", stroke: "var(--fug-halo)", "stroke-width": 2 }, hover);
  }
  const onPointer = ev => { const p = svgPoint(svg, ev); show((p.x - L) / (W - L - R)); };
  svg.addEventListener("pointermove", onPointer);
  svg.addEventListener("pointerdown", onPointer);
  show(0.5);
}
