// Pairs fitted to binary vapour-liquid data of the NIST TRC ThermoML Archive, a data set per pair chosen by
// validation/python/vle_batch.py (validation/data/vle/fits.json) and fitted by fit_parameters.py. Each model's
// default set that cites its data file is compared here with that file by the JavaScript engine, within the
// limits the fit had to meet to be written (fit_parameters.GATE). Like test/fitted-pairs.test.js this guards the
// fit quality against regressions; it is not independent validation. Method (docs/METHOD_SELECTION.md): these
// are liquids at or below about 1 atm, for which NRTL and UNIQUAC are the recommended models.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { system } from "../src/index.js";
import binaries from "../src/data/binaries.json" with { type: "json" };

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const { fits } = load("../validation/data/vle/fits.json");
const GATE = { T_K: 0.5, y: 0.012, P_pct: 1.5 };
const SLACK = 1.02;   // the JavaScript engine and the Python reference agree to far better than this

/** The default set of a model for the pair, if it was fitted to this file. */
const fittedSet = (model, [i, j], file) => binaries.pairs.find(p => p.model === model && p.default !== false && p.tier === "fitted"
  && ((p.i === i && p.j === j) || (p.i === j && p.j === i)) && p.source.includes(file));

test("every generated fit names its data file, and every data file has a complete source block", () => {
  assert.ok(fits.length > 0);
  for (const f of fits) {
    for (const name of [f.file, ...f.check]) {
      const d = load(`../validation/data/${name}`);
      assert.deepEqual(d.components, f.pair, name);
      assert.ok(d.source.citation && d.source.doi && d.source.open_copy.startsWith("https://trc.nist.gov/ThermoML/") && d.source.access && d.source.tables, name);
      assert.ok(["isobaric-txy", "isobaric-tx", "isothermal-px"].includes(d.kind), name);
    }
  }
});

let written = 0;
for (const f of fits) {
  for (const model of ["NRTL", "UNIQUAC"]) {
    const set = fittedSet(model, f.pair, f.file);
    if (!set) continue;   // the fit did not meet the limits for this model: not written (fit_parameters.py says why)
    written++;
    test(`${f.pair.join(" + ")}, ${model}: follows ${f.file}`, () => {
      const d = load(`../validation/data/${f.file}`);
      const col = Object.fromEntries(d.columns.map((c, k) => [c, k]));
      if (d.kind === "isothermal-px") {
        // with the pure-component pressures measured in the same set, as in the fit
        const T = d.rows[0][col.T_K];
        const pure = x => d.rows.find(r => r[col.x_1] === x)[col.P_kPa];
        const s = system({ components: f.pair, model, psat: [pure(1), pure(0)] });
        const dev = d.rows.filter(r => r[col.x_1] > 0 && r[col.x_1] < 1)
          .map(r => Math.abs(s.bubbleP([r[col.x_1], 1 - r[col.x_1]], T).P / r[col.P_kPa] - 1) * 100);
        const aad = dev.reduce((a, v) => a + v, 0) / dev.length;
        assert.ok(aad <= GATE.P_pct * SLACK, `AAD ${aad.toFixed(3)} % in P`);
      } else {
        const s = system({ components: f.pair, model });
        const pts = d.rows.filter(r => r[col.x_1] > 0 && r[col.x_1] < 1);
        const dT = [], dy = [];
        for (const r of pts) {
          const b = s.bubbleT([r[col.x_1], 1 - r[col.x_1]], d.P_kPa);
          dT.push(Math.abs(b.T - r[col.T_K]));
          if ("y_1" in col) dy.push(Math.abs(b.y[0] - r[col.y_1]));
        }
        const mean = a => a.reduce((p, v) => p + v, 0) / a.length;
        assert.ok(mean(dT) <= GATE.T_K * SLACK, `AAD ${mean(dT).toFixed(3)} K`);
        if (dy.length) assert.ok(mean(dy) <= GATE.y * SLACK, `AAD ${mean(dy).toFixed(4)} in y`);
      }
      assert.ok(set.source.startsWith(f.describe.slice(0, 60)), "the set's source is the fit's description");
    });
  }
}

test("generated fits: sets were written", () => {
  assert.ok(written > 0, `${written} sets written for ${fits.length} pairs`);
});
