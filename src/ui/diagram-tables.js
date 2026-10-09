/**
 * The data tables behind each workbench diagram, for the Excel export (diagram-export.js).
 *
 * Each function takes what a view drew (engine values in K, kPa, mole fractions) and the display
 * settings, and returns the table descriptions of diagram-export.js: columns with units, one row
 * per calculated point, in the temperature and pressure units shown and, when the diagram is
 * drawn in wt %, with the mass fractions next to the mole fractions. Points where the engine found
 * no solution keep their row with empty cells, so a chart of the sheet shows the same gaps as the
 * canvas. DOM-free (tested in test/diagram-export.test.js).
 */
import { tToDisplay, pToDisplay } from "./properties-logic.js";

const tUnit = u => (u.T === "K" ? "K" : "°C");
const tCol = (u, label = "T") => ({ label, unit: tUnit(u) });
const pCol = (u, label = "P") => ({ label, unit: u.P });
const T = (K, u) => (K == null ? null : tToDisplay(K, u));
const P = (kPa, u) => (kPa == null ? null : pToDisplay(kPa, u));
const toMass = (x, MW) => { const m = x.map((v, i) => v * MW[i]); const s = m.reduce((a, b) => a + b, 0); return m.map(v => v / s); };
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Composition columns of the listed components: mole fractions, and wt % when the basis is mass. */
function composition(symbol, names, { basis, only } = {}) {
  const idx = only ?? names.map((_, i) => i);
  const mol = idx.map(i => ({ label: `${symbol} ${names[i]}`, unit: "mol/mol" }));
  const mass = basis === "mass" ? idx.map(i => ({ label: `${symbol === "x" ? "w" : `w(${symbol})`} ${names[i]}`, unit: "wt %" })) : [];
  return {
    columns: [...mol, ...mass],
    values: (x, MW) => {
      if (!x) return new Array(mol.length + mass.length).fill(null);
      const w = mass.length ? toMass(x, MW) : null;
      return [...idx.map(i => x[i]), ...(w ? idx.map(i => 100 * w[i]) : [])];
    },
  };
}

/**
 * T-x-y diagram: the 101 liquid compositions of the canvas with their bubble temperature,
 * vapour, activity coefficients and whether the liquid splits; the azeotropes found.
 */
export function txyTables({ names, MW, units, basis, points, azeotropes = [], activity = true }) {
  const xc = composition("x", names, { basis, only: [0] }), yc = composition("y", names, { basis, only: [0] });
  const rows = points.map((d, k) => {
    const x1 = d ? d.x : k / (points.length - 1);
    return [...xc.values([x1, 1 - x1], MW), ...yc.values(d ? [d.y, 1 - d.y] : null, MW), T(d?.T, units),
      ...(activity ? [d?.gamma?.[0] ?? null, d?.gamma?.[1] ?? null] : []),
      d ? (d.stable === false ? "splits into two liquids (spinodal): curve not reliable" : "one liquid") : "no bubble point found"];
  });
  const tables = [{
    name: "T-x-y", title: `Bubble and dew curves of ${names.join(" + ")}`,
    note: `${plural(points.length, "liquid composition")}, evenly spaced in mole fraction; the bubble curve is T against x, the dew curve T against y.`,
    columns: [...xc.columns, ...yc.columns, tCol(units, "T bubble = T dew"), ...(activity ? [{ label: `γ ${names[0]}` }, { label: `γ ${names[1]}` }] : []), { label: "Liquid" }],
    rows,
  }];
  if (azeotropes.length) {
    tables.push({
      name: "Azeotropes", note: "Located between two calculated points, by linear interpolation of y − x.",
      columns: [...xc.columns, tCol(units)],
      rows: azeotropes.map(z => [...xc.values([z.x, 1 - z.x], MW), T(z.T, units)]),
    });
  }
  return tables;
}

/** Ternary map: the bubble-temperature grid, the residue curves and the azeotropes. */
export function ternaryTables({ names, MW, units, basis, nodes, n, residueCurves = [], azeotropes = [] }) {
  const xc = composition("x", names, { basis }), yc = composition("y", names, { basis });
  const tables = [{
    name: "Bubble temperature grid", title: `Bubble temperature of ${names.join(" + ")}`,
    note: `Grid step ${(1 / n).toFixed(4)} in mole fraction: ${plural(nodes.length, "node")} with a bubble point${(n + 1) * (n + 2) / 2 > nodes.length ? ` (${(n + 1) * (n + 2) / 2 - nodes.length} without one are left out)` : ""}.`,
    columns: [...xc.columns, tCol(units, "T bubble"), ...yc.columns, { label: "Liquid" }],
    rows: nodes.map(d => [...xc.values(d.x, MW), T(d.T, units), ...yc.values(d.y, MW), d.stable === false ? "splits into two liquids (spinodal)" : "one liquid"]),
  }];
  if (residueCurves.length) {
    tables.push({
      name: "Residue curves", note: "Each curve from its lowest-boiling to its highest-boiling end (rising temperature); step 0.01 in composition.",
      columns: [{ label: "Curve" }, ...xc.columns, tCol(units, "T bubble")],
      rows: residueCurves.flatMap((c, k) => c.points.map(p => [k + 1, ...xc.values(p.x, MW), T(p.T, units)])),
    });
  }
  if (azeotropes.length) {
    tables.push({
      name: "Azeotropes", columns: [{ label: "Kind" }, ...xc.columns, tCol(units)],
      rows: azeotropes.map(z => [z.kind === "ternary" ? "ternary" : "binary", ...xc.values(z.x, MW), T(z.T, units)]),
    });
  }
  return tables;
}

/** P-x-y diagram: bubble pressure and vapour at each liquid composition. */
export function pxyTables({ names, MW, units, basis, points }) {
  const xc = composition("x", names, { basis, only: [0] }), yc = composition("y", names, { basis, only: [0] });
  return [{
    name: "P-x-y", title: `Bubble and dew curves of ${names.join(" + ")}`,
    note: `${plural(points.length, "liquid composition")}, evenly spaced in mole fraction; the bubble curve is P against x, the dew curve P against y.`,
    columns: [...xc.columns, ...yc.columns, pCol(units, "P bubble = P dew")],
    rows: points.map((d, k) => {
      const x1 = d ? d.x : k / (points.length - 1);
      return [...xc.values([x1, 1 - x1], MW), ...yc.values(d ? [d.y, 1 - d.y] : null, MW), P(d?.P, units)];
    }),
  }];
}

/** Phase envelope: bubble and dew temperatures of the feed at each pressure; one component: its vapour pressure. */
export function envelopeTables({ names, units, z, points, single = false }) {
  if (single) {
    return [{
      name: "Vapour pressure", title: `Vapour pressure of ${names[0]} (equation of state)`,
      columns: [tCol(units), pCol(units, "P sat")],
      rows: points.map(d => [T(d.T, units), P(d.P, units)]),
    }];
  }
  return [{
    name: "Phase envelope", title: `Bubble and dew points of the feed: ${names.map((nm, i) => `${nm} ${z[i]}`).join(", ")} (mole fractions)`,
    note: `${plural(points.length, "pressure")}, evenly spaced in ln P.`,
    columns: [pCol(units), tCol(units, "T bubble"), tCol(units, "T dew")],
    rows: points.map(d => [P(d.P, units), T(d.Tb, units), T(d.Td, units)]),
  }];
}

/** Azeotropes view: the T-x-y of each pair (as on its card) and the singular points. */
export function azeotropeTables({ units, basis, pairs, points }) {
  const tables = pairs.map(pr => {
    const xc = composition("x", pr.names, { basis, only: [0] }), yc = composition("y", pr.names, { basis, only: [0] });
    return {
      name: pr.names.join(" + "), note: `${plural(pr.data.length, "liquid composition")}, evenly spaced in mole fraction.`,
      columns: [...xc.columns, ...yc.columns, tCol(units, "T bubble = T dew")],
      rows: pr.data.map((d, k) => {
        const x1 = d ? d.x : k / (pr.data.length - 1);
        return [...xc.values([x1, 1 - x1], pr.MW), ...yc.values(d ? [d.y, 1 - d.y] : null, pr.MW), T(d?.T, units)];
      }),
    };
  });
  tables.unshift({
    name: "Singular points", note: "Pure components and azeotropes, lowest to highest boiling.",
    columns: [tCol(units), { label: "Point" }, { label: `Composition (${basis === "mass" ? "wt %" : "mole fraction"})` }],
    rows: points.map(p => [T(p.T, units), p.kind, p.what]),
  });
  return tables;
}

/** Flash: the stream table (feed and phases) and the summary, as on the canvas. */
export function flashTables({ table, summary }) {
  return [
    { name: "Streams", columns: [{ label: "Stream" }, { label: "Unit" }, ...table.columns.map(c => ({ label: c }))],
      rows: table.rows.map(r => [r.label, r.unit ?? "", ...r.values.map(v => v ?? null)]) },
    { name: "Summary", columns: [{ label: "Quantity" }, { label: "Value" }, { label: "Unit" }],
      rows: summary.map(([label, value, unit]) => [label, value ?? null, unit ?? ""]) },
  ];
}

/** Gas solubility: one table per gas, mole fraction against temperature over the equation's range. */
export function henryTables({ units, solvent, p_kPa, gases }) {
  return gases.map(g => ({
    name: `${g.name} in ${solvent}`, title: `${g.name} in ${solvent.toLowerCase()} at a gas partial pressure of ${P(p_kPa, units)} ${units.P}`,
    note: `${plural(g.points.length, "temperature")} across the validity range of the equation; x = p / H.`,
    columns: [tCol(units), { label: "x gas", unit: "mol/mol" }, { label: "H", unit: units.P }],
    rows: g.points.map(d => [T(d.T, units), d.x, P(d.H, units)]),
  }));
}

/** Solid solubility against temperature, with the model and the ideal solution, as mole fraction and in the unit shown. */
export function solidTables({ units, solid, solvent, model, unit, points }) {
  const ideal = model === "ideal", other = unit.id !== "mole";
  const pair = (tag, x, y) => [{ label: `x (${tag})`, unit: "mol/mol" }, ...(other ? [{ label: `Solubility (${tag})`, unit: unit.axis }] : [])];
  const vals = (x, y) => [x, ...(other ? [y] : [])];
  return [{
    name: "Solubility", title: `${solid} in ${solvent.toLowerCase()}`,
    note: `${plural(points.length, "temperature")} up to the melting point of the solid. x: mole fraction of the solid in the saturated solution.`,
    columns: [tCol(units), ...pair(model), ...(ideal ? [] : pair("ideal")), { label: "γ solid" }],
    rows: points.map(d => [T(d.T, units), ...vals(d.x, d.y), ...(ideal ? [] : vals(d.xIdeal, d.yIdeal)), d.gamma ?? null]),
  }];
}

/** Solid-liquid diagram: the two liquidus branches and the eutectic. */
export function sleTables({ names, MW, units, basis, diagram }) {
  const xc = composition("x", names, { basis, only: [0] });
  const e = diagram.eutectic;
  return [
    ...diagram.branches.map((b, k) => ({
      name: `Liquidus, solid ${names[k]}`, note: `Where solid ${names[k].toLowerCase()} starts to crystallize; ${plural(b.points.length, "point")}.`,
      columns: [...xc.columns, tCol(units)],
      rows: b.points.map(p => [...xc.values([p.x1, 1 - p.x1], MW), T(p.T_K, units)]),
    })),
    { name: "Eutectic", columns: [...xc.columns, tCol(units)], rows: [[...xc.values([e.x1, 1 - e.x1], MW), T(e.T_K, units)]] },
  ];
}

/** Property explorer: one table per curve (each pressure of a state property), as plotted. */
export function propertyTables({ component, property, curves }) {
  return curves.map(c => ({
    name: c.name || property.label, title: `${property.label} of ${component}${c.name ? ` at ${c.name}` : ""}`,
    note: c.note ?? "",
    columns: [{ label: "T", unit: c.tUnit }, { label: property.symbol, unit: c.yUnit }, ...(c.phase ? [{ label: "Phase" }] : [])],
    rows: c.points.map(p => [p.T, p.y, ...(c.phase ? [p.phase ?? ""] : [])]),
  }));
}

/** Steam: the saturation dome, each isobar of the T-s chart, and the saturation table. */
export function steamTables({ units, dome, isobars, table }) {
  return [
    { name: "Saturation dome", note: "Saturated liquid and vapour from the triple point to just below the critical point (IAPWS-IF97).",
      columns: [tCol(units), pCol(units, "P sat"), { label: "s liquid", unit: "kJ/(kg·K)" }, { label: "s vapour", unit: "kJ/(kg·K)" }, { label: "h liquid", unit: "kJ/kg" }, { label: "h vapour", unit: "kJ/kg" }],
      rows: dome.map(r => [T(r.T_K, units), P(r.P_kPa, units), r.liquid.s_kJ_kgK, r.vapour.s_kJ_kgK, r.liquid.h_kJ_kg, r.vapour.h_kJ_kg]) },
    ...isobars.map(b => ({
      name: `Isobar ${P(b.P, units)} ${units.P}`, note: b.note ?? "",
      columns: [tCol(units), { label: "s", unit: "kJ/(kg·K)" }, { label: "h", unit: "kJ/kg" }, { label: "ρ", unit: "kg/m³" }, { label: "Phase" }],
      rows: b.points.map(p => [T(p.T_K, units), p.s, p.h, p.rho, p.phase]),
    })),
    { name: "Saturation table", columns: [tCol(units), pCol(units, "P sat"), { label: "ρ liquid", unit: "kg/m³" }, { label: "ρ vapour", unit: "kg/m³" },
      { label: "h liquid", unit: "kJ/kg" }, { label: "h vapour", unit: "kJ/kg" }, { label: "Δh vap", unit: "kJ/kg" }, { label: "s liquid", unit: "kJ/(kg·K)" }, { label: "s vapour", unit: "kJ/(kg·K)" }],
      rows: table.map(r => [T(r.T_K, units), P(r.P_kPa, units), r.liquid.rho_kg_m3, r.vapour.rho_kg_m3, r.liquid.h_kJ_kg, r.vapour.h_kJ_kg, r.hfg_kJ_kg, r.liquid.s_kJ_kgK, r.vapour.s_kJ_kgK]) },
  ];
}
