// Writes the concept-model workbooks of the cases in check_concept.py and, for each edit, Fugacity's own result
// for the edited flowsheet (the reference). Usage: node make_cases.mjs <out dir>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { runFlowsheet, normalizeFlowsheet } from "../../src/index.js";
import { flowsheetXlsx, flowsheetSheets } from "../../src/ui/flowsheet-excel.js";
import { ref } from "../../src/ui/xlsx.js";

const out = process.argv[2];
mkdirSync(out, { recursive: true });
const drum = (components, model, feed, T, P) => ({
  components, thermo: { model },
  blocks: [{ id: "F1", type: "feed", spec: { flow_kmol_h: feed, T_K: 298.15, P_kPa: P } }, { id: "V1", type: "flash", spec: { T_K: T, P_kPa: P } },
    { id: "P1", type: "product" }, { id: "P2", type: "product" }, { id: "P3", type: "product" }],
  streams: [{ id: "S1", from: "F1.out", to: "V1.in" }, { id: "S2", from: "V1.vapour", to: "P1.in" }, { id: "S3", from: "V1.liquid", to: "P2.in" },
    { id: "S4", from: "V1.liquid2", to: "P3.in" }],
});
// each edit: [what, kind ("feed" component | "T" | "P"), new value]
const CASES = {
  "recycle (NRTL, ethanol + water, example)": [JSON.parse(readFileSync(new URL("../../examples/flowsheet-recycle.fugacity.json", import.meta.url))).flowsheet,
    [["feed ethanol 30 -> 45 kmol/h", "feed", "ethanol", 45], ["drum 360 -> 358 K", "T", null, 358], ["drum 360 -> 363 K", "T", null, 363]]],
  "drum (UNIQUAC, methanol + acetone + chloroform)": [drum(["methanol", "acetone", "chloroform"], "UNIQUAC", { methanol: 30, acetone: 30, chloroform: 40 }, 331, 101.325),
    [["feed chloroform 40 -> 45 kmol/h", "feed", "chloroform", 45], ["drum 331 -> 330.5 K", "T", null, 330.5]]],
  "drum (Peng-Robinson, methane + ethane + propane, 1500 kPa)": [drum(["methane", "ethane", "propane"], "PR", { methane: 20, ethane: 40, propane: 40 }, 250, 1500),
    [["feed ethane 40 -> 50 kmol/h", "feed", "ethane", 50], ["drum 1500 -> 1600 kPa", "P", null, 1600]]],
  "drum with two liquids (NRTL, water + ethyl acetate)": [drum(["water", "ethyl-acetate"], "NRTL", { water: 50, "ethyl-acetate": 50 }, 343, 101.325),
    [["feed water 50 -> 60 kmol/h", "feed", "water", 60]]],
};
const index = {};
let k = 0;
for (const [name, [doc, edits]] of Object.entries(CASES)) {
  const fs = normalizeFlowsheet(doc), res = runFlowsheet(fs);
  const file = `case${++k}`;
  writeFileSync(`${out}/${file}.xlsx`, flowsheetXlsx(fs, res, { concept: true }));
  const { sheets } = flowsheetSheets(fs, res, { concept: true });
  const sheetNo = nm => sheets.findIndex(s => s.name === nm) + 1;
  const flows = r => Object.fromEntries(Object.entries(r.streams).map(([id, s]) => [id, s.flows]));
  const e = [];
  for (const [label, kind, comp, v] of edits) {
    const fs2 = JSON.parse(JSON.stringify(fs));
    let sheet, cell, old;
    if (kind === "feed") {
      const f = fs2.blocks.find(b => b.type === "feed"); old = f.spec.flow_kmol_h[comp]; f.spec.flow_kmol_h[comp] = v;
      const I = sheets.find(s => s.name === "Inputs").rows, name = sheets.find(s => s.name === "Inputs").rows.find(r => r?.[1] === comp)[0];
      const r0 = I.findIndex(r => /^Feed /.test(r?.[0]?.v ?? ""));
      const r = I.findIndex((row, j) => j > r0 && row?.[0] === name);
      sheet = sheetNo("Inputs"); cell = ref(r, 2);
    } else {
      const d = fs2.blocks.find(b => b.type === "flash"), key = kind === "T" ? "T_K" : "P_kPa"; old = res.blocks[d.id].state[key]; d.spec[key] = v;
      const R = sheets.find(s => s.name === "Flash models").rows;
      const r = R.findIndex(row => row?.[0] === (kind === "T" ? "Temperature, K" : "Pressure, kPa"));
      sheet = sheetNo("Flash models"); cell = ref(r, 1);
    }
    e.push({ label, sheet, cell, old, new: v, reference: flows(runFlowsheet(fs2)) });
  }
  index[file] = { name, reference: flows(res), edits: e };
}
writeFileSync(`${out}/index.json`, JSON.stringify(index, null, 1));
