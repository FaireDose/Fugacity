// Excel export of a flowsheet (src/ui/flowsheet-excel.js, src/ui/xlsx.js): a valid zip of
// spreadsheet XML; formulas where Excel can calculate (feeds, mixers, splitters, separators,
// totals, duties) and values from Fugacity where the thermodynamic model is needed (drums).
// The workbooks were also opened and recalculated in LibreOffice (see the pull request).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import zlib from "node:zlib";
import { runFlowsheet, normalizeFlowsheet } from "../src/index.js";
import { crc32, colName, xlsx } from "../src/ui/xlsx.js";
import { flowsheetSheets, flowsheetXlsx } from "../src/ui/flowsheet-excel.js";

/** The stored entries of a zip: { path: text }, checking each CRC-32. */
function unzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), dec = new TextDecoder(), out = {};
  for (let p = 0; dv.getUint32(p, true) === 0x04034b50;) {
    const method = dv.getUint16(p + 8, true), crc = dv.getUint32(p + 14, true), size = dv.getUint32(p + 18, true);
    const nlen = dv.getUint16(p + 26, true), xlen = dv.getUint16(p + 28, true);
    const name = dec.decode(bytes.subarray(p + 30, p + 30 + nlen)), data = bytes.subarray(p + 30 + nlen + xlen, p + 30 + nlen + xlen + size);
    assert.equal(method, 0, "stored");
    assert.equal(crc32(data), crc, `CRC of ${name}`);
    out[name] = dec.decode(data);
    p += 30 + nlen + xlen + size;
  }
  return out;
}

test("the zip writer: CRC-32 as Node's zlib computes it; column names", () => {
  for (const t of ["", "a", "Fugacity", "x".repeat(1000)]) assert.equal(crc32(new TextEncoder().encode(t)), zlib.crc32(t));
  assert.deepEqual([0, 25, 26, 27, 701, 702].map(colName), ["A", "Z", "AA", "AB", "ZZ", "AAA"]);
  const files = unzip(xlsx([{ name: "S", rows: [["a", 1, { f: "B1*2", v: 2 }]] }]));
  assert.ok(files["xl/workbook.xml"].includes('<sheet name="S"'));
  assert.ok(files["xl/worksheets/sheet1.xml"].includes("<f>B1*2</f><v>2</v>"));
});

test("a recycle flowsheet: formulas for the balances, values for the drum, iterative calculation on", () => {
  const p = JSON.parse(readFileSync(new URL("../examples/flowsheet-recycle.fugacity.json", import.meta.url)));
  const fs = normalizeFlowsheet(p.flowsheet), res = runFlowsheet(fs);
  const files = unzip(flowsheetXlsx(fs, res, { version: "test" }));
  assert.ok(files["xl/workbook.xml"].includes('iterate="1"'), "circular references allowed (recycles)");
  const { sheets } = flowsheetSheets(fs, res);
  const streams = sheets.find(s => s.name === "Streams"), header = streams.rows[0].map(c => c?.v ?? c);
  const cell = (label, sid) => streams.rows.find(r => r?.[0] === label)[header.indexOf(sid)];
  // S1 (feed): from the Inputs sheet; S2 (mixer): sum of its inlets; S5 (splitter): inlet × fraction
  assert.match(cell("Flow Ethanol", "S1").f, /^Inputs!C\d+$/);
  assert.match(cell("Flow Ethanol", "S2").f, /^[A-Z]+\d+\+[A-Z]+\d+$/);
  assert.match(cell("Flow Ethanol", "S5").f, /\*Inputs!C\d+$/);
  // S3 (drum vapour): a value from Fugacity, marked as such
  assert.equal(cell("Flow Ethanol", "S3").s, "value");
  assert.ok(Math.abs(cell("Flow Ethanol", "S3").v - res.streams.S3.flows[0]) < 1e-12);
  // cached values are Fugacity's results
  assert.ok(Math.abs(cell("Flow Water", "S5").v - res.streams.S5.flows[1]) < 1e-12);
  assert.match(cell("Mass flow", "S2").f, /^SUMPRODUCT\(/);
  // the splitter's "rest" fraction is 1 minus the others
  const inputs = sheets.find(s => s.name === "Inputs");
  assert.ok(inputs.rows.some(r => r?.[2]?.f?.startsWith("1-SUM(")), "rest fraction as a formula");
  // the drum's duty: enthalpy flows out minus in
  const energy = sheets.find(s => s.name === "Energy and balances");
  const q = energy.rows.find(r => r?.[0] === "Q-V1");
  assert.match(q[2].f, /^Streams!/);
  assert.ok(Math.abs(q[2].v - res.energy["Q-V1"].duty_kW) < 1e-9);
});
