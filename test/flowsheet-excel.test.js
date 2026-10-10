// Excel export of a flowsheet (src/ui/flowsheet-excel.js, src/ui/xlsx.js): a valid zip of
// spreadsheet XML; formulas where Excel can calculate (feeds, mixers, splitters, separators,
// totals, duties) and values from CHEPTA where the thermodynamic model is needed (drums).
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
  for (const t of ["", "a", "CHEPTA", "x".repeat(1000)]) assert.equal(crc32(new TextEncoder().encode(t)), zlib.crc32(t));
  assert.deepEqual([0, 25, 26, 27, 701, 702].map(colName), ["A", "Z", "AA", "AB", "ZZ", "AAA"]);
  const files = unzip(xlsx([{ name: "S", rows: [["a", 1, { f: "B1*2", v: 2 }]] }]));
  assert.ok(files["xl/workbook.xml"].includes('<sheet name="S"'));
  assert.ok(files["xl/worksheets/sheet1.xml"].includes("<f>B1*2</f><v>2</v>"));
});

test("a recycle flowsheet: formulas for the balances, values for the drum, iterative calculation on", () => {
  const p = JSON.parse(readFileSync(new URL("../examples/flowsheet-recycle.chepta.json", import.meta.url)));
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
  // S3 (drum vapour): a value from CHEPTA, marked as such
  assert.equal(cell("Flow Ethanol", "S3").s, "value");
  assert.ok(Math.abs(cell("Flow Ethanol", "S3").v - res.streams.S3.flows[0]) < 1e-12);
  // cached values are CHEPTA's results
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

test("the concept model: drums as formulas (K = γ Psat / P, Rachford-Rice), recycles solved by passes, no circular reference", () => {
  const p = JSON.parse(readFileSync(new URL("../examples/flowsheet-recycle.chepta.json", import.meta.url)));
  const fs = normalizeFlowsheet(p.flowsheet), res = runFlowsheet(fs);
  const w = flowsheetSheets(fs, res, { concept: true });
  assert.equal(w.circular, false);
  const files = unzip(flowsheetXlsx(fs, res, { concept: true }));
  assert.ok(!files["xl/workbook.xml"].includes('iterate="1"'), "no iterative calculation needed");
  const sheet = name => w.sheets.find(s => s.name === name);
  const streams = sheet("Streams"), header = streams.rows[0].map(c => c?.v ?? c);
  const cell = (label, sid) => streams.rows.find(r => r?.[0] === label)[header.indexOf(sid)];
  // the drum outlets (S3 vapour, S4 liquid) are formulas on the Flash models sheet; the tear stream comes from the last pass
  assert.match(cell("Flow Ethanol", "S3").f, /^'Flash models'!N\d+$/);
  assert.match(cell("Flow Water", "S4").f, /^'Flash models'!O\d+$/);
  assert.match(cell("Temperature", "S3").f, /^'Flash models'!B\d+$/);
  const tear = res.loops[0].tears[0];
  assert.match(cell("Flow Ethanol", tear).f, /^'Recycle passes'!/);
  // Flash models: Psat as the DIPPR 101 formula, K = γ Psat / P, and γ chosen so that K is CHEPTA's y / x
  const fm = sheet("Flash models").rows;
  const eth = fm.find(r => r?.[0] === "Ethanol");
  assert.match(eth[8].f, /^EXP\(D\d+\+E\d+\/\$B\$\d+\+F\d+\*LN\(\$B\$\d+\)\+G\d+\*\$B\$\d+\^H\d+\)\/1000$/);
  assert.match(eth[10].f, /^J\d+\*I\d+\/\$B\$\d+$/);
  const [A, B, C, D, E] = eth.slice(3, 8).map(c => c.v);
  const T = res.blocks.V1.state.T_K, P = res.blocks.V1.state.P_kPa;
  const psat = Math.exp(A + B / T + C * Math.log(T) + D * T ** E) / 1000;
  const y = res.streams.S3.z[0], x = res.streams.S4.z[0];
  assert.ok(Math.abs(eth[9].v * psat / P / (y / x) - 1) < 1e-12, "γ reproduces CHEPTA's K");
  assert.equal(eth[9].s, "input");
  // the vapour fraction: bisection rows; cached value CHEPTA's
  const vfRow = fm.find(r => r?.[0] === "Vapour fraction VF");
  assert.ok(Math.abs(vfRow[1].v - res.blocks.V1.state.VF) < 1e-12);
  assert.ok(fm.filter(r => /^step \d+$/.test(r?.[0] ?? "")).length === 50);
  // recycle passes: direct substitution, then bounded Wegstein
  const passes = sheet("Recycle passes").rows;
  assert.ok(passes.some(r => r?.some(c => /^MAX\(0,[A-Z]+\d+\*[A-Z]+\d+\+\(1-[A-Z]+\d+\)\*[A-Z]+\d+\)$/.test(c?.f ?? ""))), "Wegstein step");
  assert.ok(passes.some(r => r?.some(c => /MIN\(0,MAX\(-5,/.test(c?.f ?? ""))), "q bounded to [-5, 0]");
  // the export without the concept model is unchanged: drum outlets are values, iterative calculation on
  assert.equal(flowsheetSheets(fs, res).circular, true);
  assert.ok(!flowsheetSheets(fs, res).sheets.some(s => s.name === "Flash models"));
});
