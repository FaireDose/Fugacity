// Proposal 0004, step 3: the methanol synthesis benchmark (docs/BENCHMARKS.md). The pairs
// with a ChemSep k_ij or an IAPWS G7-04 Henry constant are covered by eos.test.js and
// henry.test.js; this file checks the pair fitted to open data here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { system } from "../src/index.js";

const load = p => JSON.parse(readFileSync(new URL(`../validation/data/${p}`, import.meta.url)));
const mean = v => v.reduce((a, b) => a + b, 0) / v.length;

test("dimethyl ether + methanol: fitted k_ij against the total pressures of Park et al. (2007) at 323.15 K", () => {
  // AAD in P reported by validation/python/eos_fit_kij.py (independent Python implementation).
  // Method on purpose outside docs/METHOD_SELECTION.md: polar liquids at 323 K and up to 1143 kPa; the
  // recommended methods (PSRK, MHV2 mixing rules) are not in Fugacity yet; labelled "not recommended".
  const d = load("dimethyl-ether_methanol_px_park2007.json");
  const c = Object.fromEntries(d.columns.map((k, i) => [k, i]));
  const pts = d.rows.filter(r => r[c.x_1] > 0 && r[c.x_1] < 1);
  for (const [model, aad] of [["PR", 3.44], ["SRK", 3.04]]) {
    const s = system({ components: d.components, model });
    assert.equal(s.info.pairs[0].tier, "fitted");
    const dev = pts.map(r => Math.abs(s.bubbleP([r[c.x_1], 1 - r[c.x_1]], r[c.T_K]).P / r[c.P_kPa] - 1) * 100);
    assert.ok(Math.abs(mean(dev) - aad) < 0.05, `${model}: AAD ${mean(dev).toFixed(3)} %, fit reported ${aad} %`);
  }
});
