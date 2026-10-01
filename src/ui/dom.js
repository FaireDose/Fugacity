const SVGNS = "http://www.w3.org/2000/svg";

/** Create an SVG element. */
export function s(tag, attrs = {}, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) if (attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

/** Create an HTML element. Children may be strings or nodes. */
export function h(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const k in attrs) {
    if (k === "on") for (const ev in attrs.on) e.addEventListener(ev, attrs.on[ev]);
    else if (attrs[k] !== undefined && attrs[k] !== false) e.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
  }
  for (const c of children.flat()) if (c != null) e.append(c);
  return e;
}

/** Text node in an SVG. */
export function text(parent, x, y, str, attrs = {}) {
  const t = s("text", { x, y, "font-size": 10, fill: "var(--fug-muted)", ...attrs }, parent);
  t.textContent = str;
  return t;
}

/** "Nice" axis ticks between lo and hi. */
export function ticks(lo, hi, target = 5) {
  const span = hi - lo, raw = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(st => span / st <= target + 1) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return { values: out, step };
}

/** Pointer position in SVG user units. */
export function svgPoint(svg, ev) {
  const p = svg.createSVGPoint();
  p.x = ev.clientX; p.y = ev.clientY;
  return p.matrixTransform(svg.getScreenCTM().inverse());
}

// Sequential blue ramp (light -> dark) for temperatures, and a helper to sample it.
export const RAMP = ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95"];
export function rampColor(t, ramp = RAMP) {
  t = Math.max(0, Math.min(1, t));
  const f = t * (ramp.length - 1), i = Math.min(ramp.length - 2, Math.floor(f)), u = f - i;
  const p = hex => [1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16));
  const a = p(ramp[i]), b = p(ramp[i + 1]);
  return "#" + a.map((v, k) => Math.round(v + (b[k] - v) * u).toString(16).padStart(2, "0")).join("");
}

export const C = T => T - 273.15;

/** Temperature display: "C" (default) or "K". Returns the conversion from K and the unit label. */
export function tempUnit(unit) {
  return unit === "K" ? { conv: T => T, label: "K" } : { conv: C, label: "°C" };
}
export const fmt = (v, d = 3) => Number(v).toFixed(d);

/**
 * Composition in the display basis: mole fractions as they are, or mass fractions
 * (w_i = x_i M_i / sum x_j M_j). Returns [values, formatter, label].
 */
export function basisView(basis, MW) {
  if (basis !== "mass") return { conv: x => x, f: v => fmt(v), unit: "mole fraction", short: "mol" };
  return {
    conv: x => { const m = x.map((v, i) => v * MW[i]); const t = m.reduce((a, b) => a + b, 0); return m.map(v => v / t); },
    f: v => `${(100 * v).toFixed(1)}`,
    unit: "wt %", short: "wt %",
  };
}
