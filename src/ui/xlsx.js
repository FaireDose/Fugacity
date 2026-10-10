/**
 * A minimal .xlsx writer (Office Open XML spreadsheet, ECMA-376), with no library: the file is
 * a zip of a few XML parts. Enough for tables with numbers, text, formulas and four styles.
 *
 *   const bytes = xlsx([{ name: "Streams", cols: [18, 10], rows: [["Stream", "S1"], ["T", { v: 351.2, s: "value" }]] }],
 *                      { iterate: true });
 *
 * A cell is null (empty), a number, a string, or { v, f, s }: a value, a formula (without the
 * leading "="; the value is its cached result, shown before the sheet recalculates) and a style:
 * "bold", "input" (blue: a number the person may change), "value" (grey italic: calculated by
 * CHEPTA, not a formula) or "formula" (black). With { iterate: true } the workbook allows
 * circular references (a recycle written as formulas) and solves them by iteration.
 *
 * Zip: stored entries (no compression), CRC-32 per the zip specification (APPNOTE.TXT,
 * PKWARE, section 4.4.7); the format is openly documented.
 */
const STYLES = { default: 0, bold: 1, input: 2, value: 3, formula: 0, head: 4 };

const esc = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Column letters: 0 -> A, 25 -> Z, 26 -> AA. */
export function colName(i) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
/** A1-style reference of row r, column c (both 0-based). */
export const ref = (r, c) => `${colName(c)}${r + 1}`;

function cellXml(cell, r, c) {
  if (cell == null) return "";
  const o = typeof cell === "object" ? cell : { v: cell };
  const s = STYLES[o.s ?? (o.f ? "formula" : "default")] ?? 0;
  const at = `r="${ref(r, c)}"${s ? ` s="${s}"` : ""}`;
  const f = o.f ? `<f>${esc(o.f)}</f>` : "";
  if (typeof o.v === "number" && Number.isFinite(o.v)) return `<c ${at}>${f}<v>${o.v}</v></c>`;
  if (o.v == null || (typeof o.v === "number")) return f ? `<c ${at}>${f}</c>` : "";
  return f ? `<c ${at} t="str">${f}<v>${esc(o.v)}</v></c>` : `<c ${at} t="inlineStr"><is><t xml:space="preserve">${esc(o.v)}</t></is></c>`;
}

function sheetXml(sheet) {
  const cols = (sheet.cols ?? []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  const rows = sheet.rows.map((row, r) => {
    const cells = (row ?? []).map((cell, c) => cellXml(cell, r, c)).join("");
    return cells ? `<row r="${r + 1}">${cells}</row>` : "";
  }).join("");
  const freeze = sheet.freeze ? `<sheetViews><sheetView workbookViewId="0"><pane xSplit="${sheet.freeze[1]}" ySplit="${sheet.freeze[0]}" topLeftCell="${ref(sheet.freeze[0], sheet.freeze[1])}" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}${cols ? `<cols>${cols}</cols>` : ""}<sheetData>${rows}</sheetData></worksheet>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="5"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><sz val="11"/><color rgb="FF1F4E9A"/><name val="Calibri"/></font><font><i/><sz val="11"/><color rgb="FF6B6B6B"/><name val="Calibri"/></font><font><b/><sz val="13"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function workbookParts(sheets, { iterate = false } = {}) {
  const names = sheets.map(s => esc(String(s.name).slice(0, 31)));
  const parts = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"${iterate ? ' iterate="1" iterateCount="500" iterateDelta="0.000000001"' : ""}/></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": STYLES_XML,
  };
  sheets.forEach((s, i) => { parts[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s); });
  return parts;
}

// ---- zip (stored)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip archive of { path: text } with stored (uncompressed) entries, as bytes. */
export function zip(files) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  const u16 = v => [v & 0xff, (v >>> 8) & 0xff];
  const u32 = v => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  for (const [path, text] of Object.entries(files)) {
    const name = enc.encode(path), data = enc.encode(text), crc = crc32(data);
    const common = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)];
    const local = new Uint8Array([...u32(0x04034b50), ...common]);
    chunks.push(local, name, data);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
    offset += local.length + name.length + data.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0), count = Object.keys(files).length;
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(count), ...u16(count), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
  let p = 0;
  for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}

/** The bytes of an .xlsx workbook with these sheets. */
export function xlsx(sheets, opts = {}) {
  return zip(workbookParts(sheets, opts));
}
