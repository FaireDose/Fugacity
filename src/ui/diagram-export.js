/**
 * Excel export of the diagram on the canvas (roadmap B1): the numbers behind what is drawn,
 * every point the view calculated, in the units and composition basis shown.
 *
 * A view describes its data as
 *
 *   { title: "T-x-y diagram of ethanol and water at 101.325 kPa",
 *     file: "txy ethanol water",                        // the file name, without extension
 *     about: [["Model", "NRTL, ideal-gas vapour"], ...],
 *     tables: [{ name: "T-x-y", note: "101 compositions ...",
 *                columns: [{ label: "x Ethanol", unit: "mol/mol" }, ...],
 *                rows: [[0, 0, 100.0], ...] }] }
 *
 * and diagramXlsx(desc, { version, date }) returns the bytes of a workbook: an "About" sheet
 * (what was calculated, the settings and the CHEPTA version), then one sheet per table with a
 * title, the note, a row of column labels, a row of units and the data. Values only, no
 * formulas: every number comes from the engine, as on the canvas. A cell that the engine could
 * not calculate is left empty. DOM-free (tested in test/diagram-export.test.js).
 */
import { xlsx } from "./xlsx.js";

const BAD_SHEET_CHARS = /[[\]:*?/\\]/g;

/** Sheet names: at most 31 characters, none of []:*?/\, unique (Excel's rules). */
export function sheetNames(names) {
  const used = new Set();
  return names.map(n => {
    const base = String(n || "Data").replace(BAD_SHEET_CHARS, " ").trim().slice(0, 31) || "Data";
    let name = base, k = 2;
    while (used.has(name.toLowerCase())) { const tag = ` (${k++})`; name = base.slice(0, 31 - tag.length) + tag; }
    used.add(name.toLowerCase());
    return name;
  });
}

const cell = v => (typeof v === "number" ? (Number.isFinite(v) ? v : null) : v ?? null);

/** The sheets of the workbook (for xlsx()): About, then one per table. */
export function diagramSheets(desc, { version = "", date = new Date() } = {}) {
  if (!desc || !Array.isArray(desc.tables) || !desc.tables.length) throw new Error("Nothing to export: the view has no data table.");
  const names = sheetNames(["About", ...desc.tables.map(t => t.name)]);
  const about = {
    name: names[0], cols: [34, 90],
    rows: [
      [{ v: desc.title, s: "head" }],
      [],
      ["Exported from", `CHEPTA ${version}`.trim()],
      ["Date", date.toISOString().slice(0, 10)],
      ...(desc.about ?? []).map(([k, v]) => [k, cell(v)]),
      [],
      [{ v: "Sheets", s: "bold" }],
      ...desc.tables.map((t, i) => [names[i + 1], `${t.rows.length} row${t.rows.length === 1 ? "" : "s"}${t.note ? `. ${t.note}` : ""}`]),
      [],
      ["", "Values calculated by CHEPTA with the settings above, as drawn on the canvas; no formulas. Empty cells: the engine found no solution there (the canvas leaves a gap)."],
    ],
  };
  const sheets = desc.tables.map((t, i) => {
    const width = t.columns.length;
    t.rows.forEach((r, k) => {
      if (r.length !== width) throw new Error(`Table "${t.name}", row ${k + 1}: ${r.length} values for ${width} columns.`);
    });
    return {
      name: names[i + 1],
      cols: t.columns.map(c => Math.max(12, Math.min(28, String(c.label).length + 2))),
      freeze: [4, 0],
      rows: [
        [{ v: t.title ?? t.name, s: "bold" }],
        [t.note ?? ""],
        t.columns.map(c => ({ v: c.label, s: "bold" })),
        t.columns.map(c => c.unit ?? ""),
        ...t.rows.map(r => r.map(cell)),
      ],
    };
  });
  return [about, ...sheets];
}

/** The workbook's bytes. */
export function diagramXlsx(desc, opts) {
  return xlsx(diagramSheets(desc, opts));
}

/** "chepta-txy-ethanol-water.xlsx": lower case, letters, digits and hyphens only. */
export function exportFileName(desc) {
  const slug = String(desc.file ?? desc.title ?? "diagram").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return `chepta-${slug || "diagram"}.xlsx`;
}
