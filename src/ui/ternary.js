import { s, h, text, svgPoint, rampColor, RAMP, C, fmt, basisView } from "./dom.js";
import { ternaryGrid } from "../equilibrium/diagrams.js";
import { residueCurve } from "../equilibrium/residue.js";
import { isLiquidStable } from "../equilibrium/stability.js";
import { ternaryAzeotropes } from "../equilibrium/azeotrope.js";

// First component at the top, second bottom-left, third bottom-right.
const V = [[300, 52], [64, 460], [536, 460]];
const toXY = x => [0, 1].map(d => x[0] * V[0][d] + x[1] * V[1][d] + x[2] * V[2][d]);
const START = [[0.1, 0.1, 0.8], [0.2, 0.6, 0.2], [0.6, 0.2, 0.2], [0.3, 0.3, 0.4], [0.1, 0.45, 0.45],
  [0.45, 0.1, 0.45], [0.05, 0.8, 0.15], [0.8, 0.05, 0.15], [0.15, 0.25, 0.6], [0.25, 0.15, 0.6]];

/**
 * Ternary diagram at pressure P (kPa): bubble-temperature map, isotherms,
 * residue curves, and a hover readout with the liquid-vapour tie line.
 */
export function renderTernary(plot, side, sys, P, opts) {
  const bv = basisView(opts.basis, opts.MW);
  const n = opts.grid ?? 40;
  const grid = ternaryGrid(sys, P, n);
  const node = new Map(grid.nodes.map(d => [d.i + "," + d.j, d]));
  const get = (i, j) => node.get(i + "," + j);
  for (const d of grid.nodes) d.stable = isLiquidStable(sys, d.x, d.T);
  const anyUnstable = grid.nodes.some(d => !d.stable);
  const Ts = grid.nodes.map(d => C(d.T));
  const Tlo = Math.min(...Ts), Thi = Math.max(...Ts);

  const tris = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) {
    tris.push([[i, j], [i + 1, j], [i, j + 1]]);
    if (i + j + 2 <= n) tris.push([[i + 1, j], [i + 1, j + 1], [i, j + 1]]);
  }

  const svg = s("svg", { viewBox: "0 0 600 540", role: "img", "aria-label": `Ternary diagram of ${sys.names.join(", ")}` });
  const gFill = s("g", {}, svg);
  for (const t of tris) {
    const nd = t.map(([i, j]) => get(i, j));
    const v = nd.reduce((a, d) => a + C(d.T), 0) / 3;
    const c = rampColor((v - Tlo) / (Thi - Tlo));
    s("polygon", { points: nd.map(d => toXY(d.x).map(q => q.toFixed(2)).join(",")).join(" "), fill: c, stroke: c, "stroke-width": 0.6 }, gFill);
  }
  if (anyUnstable) {
    const pid = "fug-hatch-" + Math.random().toString(36).slice(2, 8);
    const pat = s("pattern", { id: pid, width: 7, height: 7, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, s("defs", {}, svg));
    s("rect", { width: 7, height: 7, fill: "rgba(255,255,255,.35)" }, pat);
    s("line", { x1: 0, y1: 0, x2: 0, y2: 7, stroke: "#8a1c1c", "stroke-width": 2.2 }, pat);
    for (const t of tris) {
      const nd = t.map(([i, j]) => get(i, j));
      if (nd.every(d => d.stable)) continue;
      s("polygon", { points: nd.map(d => toXY(d.x).map(q => q.toFixed(2)).join(",")).join(" "), fill: `url(#${pid})`, stroke: "none" }, gFill);
    }
  }

  if (opts.isotherms) {
    const step = (Thi - Tlo) > 60 ? 10 : 5;
    for (let L = Math.ceil(Tlo / step) * step; L < Thi; L += step) {
      let d = "";
      for (const t of tris) {
        const nd = t.map(([i, j]) => get(i, j)), vs = nd.map(q => C(q.T)), ps = nd.map(q => toXY(q.x));
        const cuts = [];
        for (let k = 0; k < 3; k++) {
          const a = vs[k], b = vs[(k + 1) % 3];
          if ((a - L) * (b - L) < 0) {
            const f = (L - a) / (b - a), A = ps[k], B = ps[(k + 1) % 3];
            cuts.push([A[0] + f * (B[0] - A[0]), A[1] + f * (B[1] - A[1])]);
          }
        }
        if (cuts.length === 2) d += `M${cuts[0][0].toFixed(1)},${cuts[0][1].toFixed(1)}L${cuts[1][0].toFixed(1)},${cuts[1][1].toFixed(1)}`;
      }
      if (d) s("path", { d, fill: "none", stroke: "var(--fug-iso)", "stroke-width": 0.9 }, svg);
    }
  }

  if (opts.residueCurves) {
    for (const x0 of START) {
      const pts = residueCurve(sys, x0, P).map(p => toXY(p.x));
      const d = "M" + pts.map(p => p.map(q => q.toFixed(1)).join(",")).join("L");
      s("path", { d, fill: "none", stroke: "var(--fug-halo)", "stroke-width": 3.2, "stroke-linejoin": "round" }, svg);
      s("path", { d, fill: "none", stroke: "var(--fug-fg)", "stroke-width": 1.2, "stroke-linejoin": "round" }, svg);
      const k = Math.floor(pts.length / 2), a = pts[k], b = pts[Math.min(pts.length - 1, k + 2)];
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), r = 6;
      const tri = [0, 2.5, -2.5].map(o => [a[0] + Math.cos(ang + o) * r, a[1] + Math.sin(ang + o) * r]);
      s("polygon", { points: tri.map(p => p.join(",")).join(" "), fill: "var(--fug-fg)", stroke: "var(--fug-halo)", "stroke-width": 1 }, svg);
    }
  }

  const azeo = opts.makePairSystem ? ternaryAzeotropes(sys, P, opts.makePairSystem) : [];
  for (const z of azeo) {
    const [px, py] = toXY(z.x);
    s("circle", { cx: px, cy: py, r: 6, fill: z.kind === "ternary" ? "var(--fug-vap)" : "var(--fug-fg)", stroke: "var(--fug-halo)", "stroke-width": 2.5 }, svg);
  }

  // frame, ticks, vertex labels
  s("polygon", { points: V.map(p => p.join(",")).join(" "), fill: "none", stroke: "var(--fug-fg)", "stroke-width": 1.2 }, svg);
  for (let k = 1; k < 10; k++) {
    const f = k / 10;
    const a = toXY([0, 1 - f, f]); s("line", { x1: a[0], y1: a[1], x2: a[0], y2: a[1] + 5, stroke: "var(--fug-muted)" }, svg); text(svg, a[0], a[1] + 18, f.toFixed(1), { "text-anchor": "middle", "font-size": 11 });
    const b = toXY([f, 1 - f, 0]); s("line", { x1: b[0], y1: b[1], x2: b[0] - 5, y2: b[1] + 2, stroke: "var(--fug-muted)" }, svg); text(svg, b[0] - 8, b[1] + 4, f.toFixed(1), { "text-anchor": "end", "font-size": 11 });
    const c = toXY([1 - f, 0, f]); s("line", { x1: c[0], y1: c[1], x2: c[0] + 5, y2: c[1] + 2, stroke: "var(--fug-muted)" }, svg); text(svg, c[0] + 8, c[1] + 4, (1 - f).toFixed(1), { "text-anchor": "start", "font-size": 11 });
  }
  const tb = [C(get(n, 0).T), C(get(0, n).T), C(get(0, 0).T)]; // pure-component corners
  const vl = (i, dx, dy, anchor) => {
    text(svg, V[i][0] + dx, V[i][1] + dy, sys.names[i], { "text-anchor": anchor, "font-size": 15, "font-weight": 600, fill: "var(--fug-fg)", style: "font-family:inherit" });
    text(svg, V[i][0] + dx, V[i][1] + dy + 16, `Tb ${fmt(tb[i], 1)} °C`, { "text-anchor": anchor, fill: "var(--fug-fg2)", "font-size": 11 });
  };
  vl(0, 0, -32, "middle"); vl(1, -44, 38, "start"); vl(2, 44, 38, "end");
  text(svg, 300, 512, `mole fraction ${sys.names[2]} →`, { "text-anchor": "middle" });

  const hover = s("g", {}, svg);
  const ramp = h("div", { class: "fug-ramp" },
    h("div", { class: "fug-sub" }, "Bubble temperature, °C"),
    h("div", { class: "bar", style: `background:linear-gradient(90deg,${RAMP.join(",")})` }),
    h("div", { class: "ticks" }, ...[0, 0.25, 0.5, 0.75, 1].map(f => h("span", {}, (Tlo + f * (Thi - Tlo)).toFixed(0)))));
  plot.replaceChildren(svg, h("div", { class: "fug-legend" }, ramp,
    opts.residueCurves ? h("span", { class: "fug-key" }, h("i", { style: "border-color:var(--fug-fg)" }), "Residue curve, arrow toward rising T") : null));

  const xOut = h("div", { class: "fug-num" }), tOut = h("div", { class: "fug-big" }), tab = h("tbody", { class: "fug-num" });
  side.replaceChildren(...[
    h("div", {}, h("div", { class: "fug-eyebrow" }, "Liquid composition"), xOut),
    h("div", {}, h("div", { class: "fug-eyebrow" }, "Bubble temperature"), tOut),
    h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, bv.short), h("th", {}, "x"), h("th", {}, "y"))), tab),
    anyUnstable ? h("div", { class: "fug-err" }, "The liquid is predicted to split into two liquid phases in the hatched region. Results there assume a single liquid and are not reliable.") : null,
    h("div", {}, h("div", { class: "fug-eyebrow" }, "Azeotropes at this pressure"),
      azeo.length ? h("div", { class: "fug-num" }, ...azeo.map(z => { const w = bv.conv(z.x); return h("div", {}, `${fmt(C(z.T), 1)} °C  ${z.x.map((v, k) => v > 1e-6 ? `${sys.names[k]} ${opts.basis === "mass" ? bv.f(w[k]) : fmt(v, 2)}` : null).filter(Boolean).join(", ")}${opts.basis === "mass" ? " wt %" : ""}${z.kind === "ternary" ? " (ternary)" : ""}`); }))
        : h("div", { class: "fug-sub" }, "None found.")),
    h("div", { class: "fug-foot" }, "Hover or tap the diagram. ○ liquid, ● equilibrium vapour. Grid step " + (1 / n).toFixed(3) + "." + (opts.basis === "mass" ? " The triangle is drawn in mole fractions; readouts are in wt %." : "")),
  ].filter(Boolean));

  function show(i, j) {
    const d = get(i, j); if (!d) return;
    const xb = bv.conv(d.x), yb = bv.conv(d.y);
    xOut.textContent = xb.map((v, k) => `${sys.names[k]} ${bv.f(v)}`).join(" · ") + (opts.basis === "mass" ? " (wt %)" : "");
    tOut.textContent = `${fmt(C(d.T), 1)} °C` + (d.stable ? "" : "  (two liquids)");
    tab.replaceChildren(...sys.names.map((nm, k) => h("tr", {}, h("td", {}, nm), h("td", {}, bv.f(xb[k])), h("td", {}, bv.f(yb[k])))));
    hover.replaceChildren();
    const a = toXY(d.x), b = toXY(d.y);
    s("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: "var(--fug-halo)", "stroke-width": 4 }, hover);
    s("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: "var(--fug-fg)", "stroke-width": 1.5, "stroke-dasharray": "4 3" }, hover);
    s("circle", { cx: a[0], cy: a[1], r: 5.5, fill: "var(--fug-halo)", stroke: "var(--fug-fg)", "stroke-width": 2 }, hover);
    s("circle", { cx: b[0], cy: b[1], r: 5.5, fill: "var(--fug-fg)", stroke: "var(--fug-halo)", "stroke-width": 2 }, hover);
  }
  const onPointer = ev => {
    const p = svgPoint(svg, ev);
    const [[x1, y1], [x2, y2], [x3, y3]] = V;
    const det = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
    let a = ((y2 - y3) * (p.x - x3) + (x3 - x2) * (p.y - y3)) / det;
    let b = ((y3 - y1) * (p.x - x3) + (x1 - x3) * (p.y - y3)) / det;
    if (a < -0.03 || b < -0.03 || 1 - a - b < -0.03) return;
    a = Math.max(0, a); b = Math.max(0, b);
    let i = Math.round(a * n), j = Math.round(b * n);
    if (i + j > n) { if (a > b) i = n - j; else j = n - i; }
    show(i, j);
  };
  svg.addEventListener("pointermove", onPointer);
  svg.addEventListener("pointerdown", onPointer);
  show(Math.round(n * 0.3), Math.round(n * 0.3));
}
