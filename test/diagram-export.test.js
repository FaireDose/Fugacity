// Excel export of the workbench diagrams (src/ui/diagram-export.js, src/ui/diagram-tables.js) and the
// Feedback links (src/ui/app-logic.js). The tables are built here from the engine's own results, as the
// views build them from what they draw; the values must be those results in the display units.
// Methods (docs/METHOD_SELECTION.md): ethanol + water and methanol + acetone + chloroform are polar
// liquids at 1 atm, so NRTL; naphthalene + toluene is a solid in a solvent, the ideal solution
// being the model the solid-liquid view falls back to (test/sle.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { system, pure, steamSat } from "../src/index.js";
import { crc32 } from "../src/ui/xlsx.js";
import { diagramSheets, diagramXlsx, exportFileName, sheetNames } from "../src/ui/diagram-export.js";
import { txyTables, ternaryTables, pxyTables, envelopeTables, sleTables, steamTables } from "../src/ui/diagram-tables.js";
import { feedbackLinks, REPO_URL } from "../src/ui/app-logic.js";

const C = { T: "C", P: "kPa" }, K = { T: "K", P: "bar" };

/** The stored entries of a zip: { path: text }, checking each CRC-32. */
function unzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), dec = new TextDecoder(), out = {};
  for (let p = 0; dv.getUint32(p, true) === 0x04034b50;) {
    const crc = dv.getUint32(p + 14, true), size = dv.getUint32(p + 18, true);
    const nlen = dv.getUint16(p + 26, true), xlen = dv.getUint16(p + 28, true);
    const name = dec.decode(bytes.subarray(p + 30, p + 30 + nlen)), data = bytes.subarray(p + 30 + nlen + xlen, p + 30 + nlen + xlen + size);
    assert.equal(crc32(data), crc, `CRC of ${name}`);
    out[name] = dec.decode(data);
    p += 30 + nlen + xlen + size;
  }
  return out;
}

/** Bubble points along x1 as the T-x-y view draws them (101 compositions). */
function txyPoints(sys, P, N = 101) {
  return Array.from({ length: N }, (_, k) => {
    const x = k / (N - 1);
    const r = sys.bubbleT([x, 1 - x], P);
    return { x, T: r.T, y: r.y[0], gamma: r.gamma, stable: sys.isLiquidStable([x, 1 - x], r.T, P) };
  });
}

test("workbook: an About sheet, then one sheet per table with title, note, labels, units and the rows", () => {
  const desc = { title: "Test diagram", file: "test", about: [["Model", "NRTL"]],
    tables: [{ name: "Data", note: "two rows", columns: [{ label: "x", unit: "mol/mol" }, { label: "T", unit: "°C" }], rows: [[0, 100], [1, NaN]] }] };
  const sheets = diagramSheets(desc, { version: "9.9.9", date: new Date("2026-10-09T00:00:00Z") });
  assert.deepEqual(sheets.map(s => s.name), ["About", "Data"]);
  assert.deepEqual(sheets[0].rows[2], ["Exported from", "CHEPTA 9.9.9"]);
  assert.deepEqual(sheets[0].rows[3], ["Date", "2026-10-09"]);
  assert.deepEqual(sheets[1].rows.slice(2, 4), [[{ v: "x", s: "bold" }, { v: "T", s: "bold" }], ["mol/mol", "°C"]]);
  assert.deepEqual(sheets[1].rows.slice(4), [[0, 100], [1, null]], "a value the engine has not got stays an empty cell");
  const files = unzip(diagramXlsx(desc, { version: "9.9.9" }));
  assert.ok(files["xl/workbook.xml"].includes('<sheet name="About"') && files["xl/workbook.xml"].includes('<sheet name="Data"'));
  assert.ok(files["xl/worksheets/sheet2.xml"].includes('<c r="B5"><v>100</v></c>'));
  assert.ok(!files["xl/worksheets/sheet2.xml"].includes('r="B6"'), "NaN is not written");
  // a row of the wrong width is a bug in the view: said, not written
  assert.throws(() => diagramSheets({ title: "t", tables: [{ name: "D", columns: [{ label: "a" }], rows: [[1, 2]] }] }), /row 1: 2 values for 1 columns/);
  assert.throws(() => diagramSheets({ title: "t", tables: [] }), /Nothing to export/);
});

test("sheet and file names follow Excel's rules", () => {
  const names = sheetNames(["About", "Methanol + acetone [1:2]", "x".repeat(40), "x".repeat(40), "about"]);
  assert.equal(names[1], "Methanol + acetone  1 2");
  assert.ok(names.every(n => n.length <= 31 && !/[[\]:*?/\\]/.test(n)));
  assert.equal(new Set(names.map(n => n.toLowerCase())).size, names.length, "unique, ignoring case");
  assert.equal(exportFileName({ file: "txy ethanol water" }), "chepta-txy-ethanol-water.xlsx");
  assert.equal(exportFileName({ title: "Solubility of β-carotène / 2" }), "chepta-solubility-of-carotene-2.xlsx");
});

test("T-x-y: every one of the 101 compositions drawn, T in the display unit, wt % next to mole fractions", () => {
  const sys = system({ components: ["ethanol", "water"], model: "NRTL" });
  const points = txyPoints(sys, 101.325);
  const MW = ["ethanol", "water"].map(id => pure(id).MW);
  const [t] = txyTables({ names: sys.names, MW, units: C, basis: "mole", points });
  assert.equal(t.rows.length, 101);
  assert.deepEqual(t.columns.map(c => c.label), ["x Ethanol", "y Ethanol", "T bubble = T dew", "γ Ethanol", "γ Water", "Liquid"]);
  assert.equal(t.columns[2].unit, "°C");
  points.forEach((d, k) => {
    assert.equal(t.rows[k][0], d.x);
    assert.equal(t.rows[k][1], d.y);
    assert.ok(Math.abs(t.rows[k][2] - (d.T - 273.15)) < 1e-12);
    assert.deepEqual(t.rows[k].slice(3, 5), d.gamma);
  });
  // in wt %: the mass fractions follow the mole fractions; the engine values are unchanged
  const [m] = txyTables({ names: sys.names, MW, units: K, basis: "mass", points });
  assert.deepEqual(m.columns.slice(0, 5).map(c => `${c.label} ${c.unit}`), ["x Ethanol mol/mol", "w Ethanol wt %", "y Ethanol mol/mol", "w(y) Ethanol wt %", "T bubble = T dew K"]);
  const k = 30, w = points[k].x * MW[0] / (points[k].x * MW[0] + (1 - points[k].x) * MW[1]);
  assert.ok(Math.abs(m.rows[k][1] - 100 * w) < 1e-10);
  assert.equal(m.rows[k][4], points[k].T);
  // a point without a bubble point keeps its row with empty cells; the azeotrope table when one was found
  const gap = points.slice(); gap[50] = null;
  const [g, az] = txyTables({ names: sys.names, MW, units: C, basis: "mole", points: gap, azeotropes: [{ x: 0.9, T: 351.3 }] });
  assert.deepEqual(g.rows[50], [0.5, null, null, null, null, "no bubble point found"]);
  assert.equal(az.name, "Azeotropes");
  // an equation of state has no activity coefficients
  assert.equal(txyTables({ names: sys.names, MW, units: C, basis: "mole", points, activity: false })[0].columns.length, 4);
});

test("ternary map: the bubble-temperature grid, the residue curves and the azeotropes", () => {
  const ids = ["methanol", "acetone", "chloroform"];
  const sys = system({ components: ids, model: "NRTL" });
  const n = 10, nodes = [];
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
    const x = [i / n, j / n, (n - i - j) / n], r = sys.bubbleT(x, 101.325);
    nodes.push({ x, T: r.T, y: r.y, stable: true });
  }
  const curve = sys.residueCurve([0.3, 0.3, 0.4], 101.325);
  const tables = ternaryTables({ names: sys.names, MW: ids.map(id => pure(id).MW), units: C, basis: "mole", nodes, n,
    residueCurves: [{ start: [0.3, 0.3, 0.4], points: curve }], azeotropes: [{ kind: "ternary", x: [0.3, 0.3, 0.4], T: 330 }] });
  assert.deepEqual(tables.map(t => t.name), ["Bubble temperature grid", "Residue curves", "Azeotropes"]);
  assert.equal(tables[0].rows.length, 66);
  assert.ok(Math.abs(tables[0].rows[5][3] - (nodes[5].T - 273.15)) < 1e-12);
  assert.equal(tables[1].rows.length, curve.length);
  assert.deepEqual(tables[1].rows[0].slice(1, 4), curve[0].x);
});

test("P-x-y, phase envelope, solid-liquid diagram and steam: the engine values in the display units", () => {
  const sys = system({ components: ["ethanol", "water"], model: "NRTL" });
  const pts = [0, 0.5, 1].map(x => { const r = sys.bubbleP([x, 1 - x], 350); return { x, y: r.y[0], P: r.P }; });
  const [pxy] = pxyTables({ names: sys.names, MW: [46, 18], units: K, basis: "mole", points: pts });
  assert.equal(pxy.columns[2].unit, "bar");
  assert.ok(Math.abs(pxy.rows[1][2] - pts[1].P / 100) < 1e-12);

  const env = envelopeTables({ names: sys.names, units: C, z: [0.5, 0.5], points: [{ P: 101.325, Tb: 353, Td: null }] })[0];
  assert.deepEqual(env.rows[0].map(v => (v == null ? v : +v.toFixed(3))), [101.325, 79.85, null]);

  const s = system({ components: ["naphthalene", "toluene"], model: "ideal" });
  const d = s.sleDiagram({ n: 21 });
  const sle = sleTables({ names: s.names, MW: [128, 92], units: K, basis: "mole", diagram: d });
  assert.deepEqual(sle.map(t => t.name), ["Liquidus, solid Naphthalene", "Liquidus, solid Toluene", "Eutectic"]);
  assert.equal(sle[0].rows.length, d.branches[0].points.length);
  assert.deepEqual(sle[2].rows[0], [d.eutectic.x1, d.eutectic.T_K]);

  const sat = [steamSat({ T_K: 373.15 })];
  const st = steamTables({ units: C, dome: sat, isobars: [{ P: 100, points: [{ T_K: 400, s: 7.5, h: 2730, rho: 0.55, phase: "vapour" }] }], table: sat });
  assert.deepEqual(st.map(t => t.name), ["Saturation dome", "Isobar 100 kPa", "Saturation table"]);
  assert.ok(Math.abs(st[0].rows[0][0] - 100) < 1e-9 && st[0].rows[0][1] === sat[0].P_kPa);
});

test("feedback: the bug form opens with the setup in its 'What happened' field; the forum is GitHub Discussions", () => {
  const links = feedbackLinks({ version: "0.3.0", setup: "Phase equilibrium, T-x-y diagram: Ethanol and water; NRTL" });
  assert.deepEqual(links.map(l => l.id), ["bug", "idea", "forum", "data"]);
  const bug = new URL(links[0].url);
  assert.equal(bug.origin + bug.pathname, `${REPO_URL}/issues/new`);
  assert.equal(bug.searchParams.get("template"), "bug.yml");
  assert.match(bug.searchParams.get("what"), /^CHEPTA 0\.3\.0\. Phase equilibrium, T-x-y diagram: Ethanol and water; NRTL\.\n\nWhat happened:/);
  assert.equal(links[2].url, `${REPO_URL}/discussions`);
  // the templates and the field id exist in the repository
  for (const l of links.filter(l => l.url.includes("template="))) {
    const file = new URL(l.url).searchParams.get("template");
    const yml = readFileSync(new URL(`../.github/ISSUE_TEMPLATE/${file}`, import.meta.url), "utf8");
    if (l.id === "bug") assert.match(yml, /\n\s+id: what\n/);
  }
});
