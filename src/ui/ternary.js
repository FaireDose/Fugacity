import { s, h, text, svgPoint, rampColor, RAMP, tempUnit, fmt, basisView } from "./dom.js";
import { ternaryAzeotropes } from "../equilibrium/azeotrope.js";

// First component at the top, second bottom-left, third bottom-right.
const V = [[300, 52], [64, 460], [536, 460]];
const toXYmole = x => [0, 1].map(d => x[0] * V[0][d] + x[1] * V[1][d] + x[2] * V[2][d]);
const START = [[0.1, 0.1, 0.8], [0.2, 0.6, 0.2], [0.6, 0.2, 0.2], [0.3, 0.3, 0.4], [0.1, 0.45, 0.45],
  [0.45, 0.1, 0.45], [0.05, 0.8, 0.15], [0.8, 0.05, 0.15], [0.15, 0.25, 0.6], [0.25, 0.15, 0.6]];

/**
 * Ternary diagram at pressure P (kPa): bubble-temperature map, isotherms,
 * residue curves, and a hover readout with the liquid-vapour tie line.
 * opts.T: "C" (default) or "K", the temperature display unit. opts.basis: "mole" or "mass":
 * the triangle is drawn in mole fractions or in mass fractions (wt %). The colour map, the
 * two-liquid hatching and the isotherms carry the class "fug-bg-layer" (background layers).
 * Works with any system that has bubbleT (activity models and equations of state); grid
 * nodes where the bubble point is not found are left blank, and the readout says how many.
 */
export function renderTernary(plot, side, sys, P, opts) {
  const bv = basisView(opts.basis, opts.MW);
  const toXY = x => toXYmole(bv.conv(x));   // mole fractions -> drawing, in the display basis
  const { conv: C, label: tl } = tempUnit(opts.T);
  const n = opts.grid ?? 40;
  const nodes = [];
  let missed = 0, firstError = null;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
    const x = [i / n, j / n, (n - i - j) / n];
    try { const r = sys.bubbleT(x, P); nodes.push({ i, j, x, T: r.T, y: r.y }); } catch (e) {
      if (!(e && e.code)) throw e;
      missed++; firstError ??= e;
    }
  }
  if (nodes.length < 3) throw firstError ?? new Error("No bubble point found on the grid.");
  const node = new Map(nodes.map(d => [d.i + "," + d.j, d]));
  const get = (i, j) => node.get(i + "," + j);
  for (const d of nodes) d.stable = sys.isLiquidStable(d.x, d.T, P);
  const anyUnstable = nodes.some(d => !d.stable);
  const Ts = nodes.map(d => C(d.T));
  const Tlo = Math.min(...Ts), Thi = Math.max(...Ts);

  const tris = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) {
    tris.push([[i, j], [i + 1, j], [i, j + 1]]);
    if (i + j + 2 <= n) tris.push([[i + 1, j], [i + 1, j + 1], [i, j + 1]]);
  }
  const solved = t => t.every(([i, j]) => get(i, j));
  const triNodes = tris.filter(solved).map(t => t.map(([i, j]) => get(i, j)));

  const svg = s("svg", { viewBox: "0 0 600 540", role: "img", "aria-label": `Ternary diagram of ${sys.names.join(", ")}` });
  const gFill = s("g", { class: "fug-bg-layer" }, svg);
  for (const nd of triNodes) {
    const v = nd.reduce((a, d) => a + C(d.T), 0) / 3;
    const c = rampColor((v - Tlo) / (Thi - Tlo));
    s("polygon", { points: nd.map(d => toXY(d.x).map(q => q.toFixed(2)).join(",")).join(" "), fill: c, stroke: c, "stroke-width": 0.6 }, gFill);
  }
  if (anyUnstable) {
    const pid = "fug-hatch-" + Math.random().toString(36).slice(2, 8);
    const pat = s("pattern", { id: pid, width: 7, height: 7, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, s("defs", {}, svg));
    s("rect", { width: 7, height: 7, fill: "rgba(255,255,255,.35)" }, pat);
    s("line", { x1: 0, y1: 0, x2: 0, y2: 7, stroke: "#8a1c1c", "stroke-width": 2.2 }, pat);
    for (const nd of triNodes) {
      if (nd.every(d => d.stable)) continue;
      s("polygon", { points: nd.map(d => toXY(d.x).map(q => q.toFixed(2)).join(",")).join(" "), fill: `url(#${pid})`, stroke: "none" }, gFill);
    }
  }

  if (opts.isotherms) {
    const gIso = s("g", { class: "fug-bg-layer" }, svg);
    const step = (Thi - Tlo) > 60 ? 10 : 5;
    for (let L = Math.ceil(Tlo / step) * step; L < Thi; L += step) {
      let d = "";
      for (const nd of triNodes) {
        const vs = nd.map(q => C(q.T)), ps = nd.map(q => toXY(q.x));
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
      if (d) s("path", { d, fill: "none", stroke: "var(--fug-iso)", "stroke-width": 0.9 }, gIso);
    }
  }

  if (opts.residueCurves) {
    for (const x0 of START) {
      let pts;
      try { pts = sys.residueCurve(x0, P).map(p => toXY(p.x)); } catch (e) { if (!(e && e.code)) throw e; continue; }
      if (pts.length < 2) continue;
      const d = "M" + pts.map(p => p.map(q => q.toFixed(1)).join(",")).join("L");
      s("path", { d, fill: "none", stroke: "var(--fug-halo)", "stroke-width": 3.2, "stroke-linejoin": "round" }, svg);
      s("path", { d, fill: "none", stroke: "var(--fug-fg)", "stroke-width": 1.2, "stroke-linejoin": "round" }, svg);
      const k = Math.floor(pts.length / 2), a = pts[k], b = pts[Math.min(pts.length - 1, k + 2)];
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), r = 6;
      const tri = [0, 2.5, -2.5].map(o => [a[0] + Math.cos(ang + o) * r, a[1] + Math.sin(ang + o) * r]);
      s("polygon", { points: tri.map(p => p.join(",")).join(" "), fill: "var(--fug-fg)", stroke: "var(--fug-halo)", "stroke-width": 1 }, svg);
    }
  }

  let azeo = [], azeoError = null;
  if (opts.makePairSystem) {
    try { azeo = ternaryAzeotropes(sys, P, opts.makePairSystem, { gaps: true }); } catch (e) { if (!(e && e.code)) throw e; azeoError = e; }
  }
  for (const z of azeo) {
    const [px, py] = toXY(z.x);
    s("circle", { cx: px, cy: py, r: 6, fill: z.kind === "ternary" ? "var(--fug-vap)" : "var(--fug-fg)", stroke: "var(--fug-halo)", "stroke-width": 2.5 }, svg);
  }

  // frame, ticks, vertex labels
  s("polygon", { points: V.map(p => p.join(",")).join(" "), fill: "none", stroke: "var(--fug-fg)", "stroke-width": 1.2 }, svg);
  for (let k = 1; k < 10; k++) {
    const f = k / 10;
    // ticks on the frame, which is the same in either basis: f is a fraction in the display basis
    const a = toXYmole([0, 1 - f, f]); s("line", { x1: a[0], y1: a[1], x2: a[0], y2: a[1] + 5, stroke: "var(--fug-muted)" }, svg); text(svg, a[0], a[1] + 18, bv.tick(f), { "text-anchor": "middle", "font-size": 11 });
    const b = toXYmole([f, 1 - f, 0]); s("line", { x1: b[0], y1: b[1], x2: b[0] - 5, y2: b[1] + 2, stroke: "var(--fug-muted)" }, svg); text(svg, b[0] - 8, b[1] + 4, bv.tick(f), { "text-anchor": "end", "font-size": 11 });
    const c = toXYmole([1 - f, 0, f]); s("line", { x1: c[0], y1: c[1], x2: c[0] + 5, y2: c[1] + 2, stroke: "var(--fug-muted)" }, svg); text(svg, c[0] + 8, c[1] + 4, bv.tick(1 - f), { "text-anchor": "start", "font-size": 11 });
  }
  const tb = [get(n, 0), get(0, n), get(0, 0)].map(d => (d ? C(d.T) : null)); // pure-component corners
  const vl = (i, dx, dy, anchor) => {
    text(svg, V[i][0] + dx, V[i][1] + dy, sys.names[i], { "text-anchor": anchor, "font-size": 15, "font-weight": 600, fill: "var(--fug-fg)", style: "font-family:inherit" });
    text(svg, V[i][0] + dx, V[i][1] + dy + 16, tb[i] == null ? "Tb not found" : `Tb ${fmt(tb[i], 1)} ${tl}`, { "text-anchor": anchor, fill: "var(--fug-fg2)", "font-size": 11 });
  };
  vl(0, 0, -32, "middle"); vl(1, -44, 38, "start"); vl(2, 44, 38, "end");
  text(svg, 300, 512, `${bv.axis} ${sys.names[2]} →`, { "text-anchor": "middle" });

  const hover = s("g", {}, svg);
  const ramp = h("div", { class: "fug-ramp fug-bg-layer" },
    h("div", { class: "fug-sub" }, `Bubble temperature, ${tl}`),
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
      azeo.length ? h("div", { class: "fug-num" }, ...azeo.map(z => { const w = bv.conv(z.x); return h("div", {}, `${fmt(C(z.T), 1)} ${tl}  ${z.x.map((v, k) => v > 1e-6 ? `${sys.names[k]} ${opts.basis === "mass" ? bv.f(w[k]) : fmt(v, 2)}` : null).filter(Boolean).join(", ")}${opts.basis === "mass" ? " wt %" : ""}${z.kind === "ternary" ? " (ternary)" : ""}`); }))
        : h("div", { class: "fug-sub" }, azeoError ? `Search stopped: ${azeoError.message}` : "None found."),
      azeo.notSearched ? h("div", { class: "fug-sub" }, azeo.notSearched) : null,
      azeo.gaps ? h("div", { class: "fug-warn" }, `${azeo.gaps.points} points of the search had no bubble point from the solver and were skipped, so an azeotrope there would be missed. ${azeo.gaps.message}`) : null),
    missed ? h("div", { class: "fug-warn" }, `${missed} grid points left blank: no bubble point found there. ${firstError.message}`) : null,
    h("div", { class: "fug-foot" }, "Hover or tap the diagram. ○ liquid, ● equilibrium vapour. Grid step " + (1 / n).toFixed(3) + " in mole fraction." + (opts.basis === "mass" ? " The triangle and the readouts are in wt %." : "")),
  ].filter(Boolean));

  function show(i, j) {
    const d = get(i, j); if (!d) return;
    const xb = bv.conv(d.x), yb = bv.conv(d.y);
    xOut.textContent = xb.map((v, k) => `${sys.names[k]} ${bv.f(v)}`).join(" · ") + (opts.basis === "mass" ? " (wt %)" : "");
    tOut.textContent = `${fmt(C(d.T), 1)} ${tl}` + (d.stable ? "" : "  (two liquids)");
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
    // the pointer is in the display basis; the grid is in mole fractions
    const xm = bv.inv([a, b, Math.max(0, 1 - a - b)]);
    a = xm[0]; b = xm[1];
    let i = Math.round(a * n), j = Math.round(b * n);
    if (i + j > n) { if (a > b) i = n - j; else j = n - i; }
    show(i, j);
  };
  svg.addEventListener("pointermove", onPointer);
  svg.addEventListener("pointerdown", onPointer);
  show(Math.round(n * 0.3), Math.round(n * 0.3));
}
