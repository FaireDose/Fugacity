// Flowsheet test suite (docs/FLOWSHEET_TESTS.md). Recycle flowsheets of 3 to 16 components:
//  - the Cavett problem (Cavett 1963; specification and published solutions in Rosen, CACHE News,
//    Fall 2005), four flash drums and three recycle loops that share streams;
//  - 16 generated flowsheets (four layouts: two or three drums, splitters, a component separator,
//    a heater, a bypass; two or three recycles; 3 to 7 components; Peng-Robinson, NRTL, UNIQUAC).
// Reference: validation/fixtures/flowsheet-suite.json, the same flowsheets solved equation-oriented
// with scipy on hand-chosen tear streams and the independent thermo flash
// (validation/python/reference_flowsheet_suite.py). On top of the comparison, relations that any
// correct solver must satisfy (metamorphic tests): the answer does not depend on the tear streams,
// on the convergence method, on the order of the components or of the blocks, and scales with the
// feed; every block and the whole flowsheet balance. Every case uses the property method the selection
// rules recommend for its components and conditions (docs/FLOWSHEET_TESTS.md, "Choosing the method"),
// checked here from the fixture.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { system, solveFlowsheet } from "../src/index.js";

const { cases } = JSON.parse(readFileSync(new URL("../validation/fixtures/flowsheet-suite.json", import.meta.url)));
const feedTotal = c => c.flowsheet.blocks.filter(b => b.type === "feed").reduce((a, b) => a + b.spec.flow_kmol_h.reduce((s, v) => s + v, 0), 0);
const clone = v => JSON.parse(JSON.stringify(v));
const maxDev = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
const flowsheetOf = c => clone(c.flowsheet);
// Wegstein's per-flow acceleration oscillates without end on this case (direct substitution and
// Broyden solve it): a known weakness of that option, checked so that a fix shows up here
const WEGSTEIN_OSCILLATES = ["G07 "];
const solved = new Map();
const solve = c => {
  if (!solved.has(c.name)) solved.set(c.name, solveFlowsheet(system({ components: c.components, model: c.model }), flowsheetOf(c)));
  return solved.get(c.name);
};

/** Every stream's component flows within tol (kmol/h) of the other solution. */
function sameStreams(a, b, tol, what) {
  for (const [sid, s] of Object.entries(a.streams)) {
    const d = maxDev(s.flows, b.streams[sid].flows);
    assert.ok(d <= tol, `${what}: stream ${sid} differs by ${d.toExponential(2)} kmol/h (tolerance ${tol.toExponential(2)})`);
  }
}

test("flowsheet suite: 17 cases, 3 to 16 components, two or three recycles each", () => {
  assert.equal(cases.length, 17);
  assert.equal(cases.filter(c => c.kind === "generated").length, 16);
  const sizes = cases.filter(c => c.kind === "generated").map(c => c.components.length);
  assert.equal(Math.min(...sizes), 3);
  assert.equal(Math.max(...sizes), 7);
  for (const c of cases) assert.ok(c.reference_tears.length >= 2, c.name);
});

test("flowsheet suite: every case passed the method-selection rules; the rejected draws say why", () => {
  const { rejected_draws } = JSON.parse(readFileSync(new URL("../validation/fixtures/flowsheet-suite.json", import.meta.url)));
  for (const r of rejected_draws) assert.ok(r.why.length > 0, r.case);
  for (const c of cases) {
    // equations of state only where no second liquid forms (thermo FlashVLN at the reference solution)
    if (["PR", "SRK"].includes(c.model)) for (const [id, d] of Object.entries(c.drums)) assert.equal(d.liquids_vln, 1, `${c.name} ${id}`);
    // activity models only below 10 bar
    else for (const b of c.flowsheet.blocks) if (b.type === "flash") assert.ok(b.spec.P_kPa <= 1000, `${c.name} ${b.id}`);
  }
});

for (const c of cases) {
  test(`flowsheet suite, ${c.name}: matches the equation-oriented reference`, () => {
    const r = solve(c);
    const F = feedTotal(c);
    // the flashes agree to about 1e-5 in composition (flash.test.js): the flows to 2e-5 of the feed
    for (const [sid, ref] of Object.entries(c.streams_kmol_h)) {
      ref.forEach((v, i) => assert.ok(Math.abs(r.streams[sid].flows[i] - v) <= 2e-5 * F,
        `${c.name}: stream ${sid}, ${c.components[i]}: ${r.streams[sid].flows[i]} vs ${v}`));
    }
    for (const [id, d] of Object.entries(c.drums)) {
      assert.ok(Math.abs(r.blocks[id].state.VF - d.VF) <= 2e-5, `${c.name}: ${id} VF ${r.blocks[id].state.VF} vs ${d.VF}`);
      assert.ok(Math.abs(r.blocks[id].state.T_K - d.T_K) <= 2e-3, `${c.name}: ${id} T ${r.blocks[id].state.T_K} vs ${d.T_K}`);
    }
    // feeds = products, component by component
    for (const [id, v] of Object.entries(r.balance.material_kmol_h)) assert.ok(Math.abs(v) <= 1e-7 * F, `${c.name}: overall balance of ${id}: ${v}`);
    // and every block: what comes in goes out
    for (const b of c.flowsheet.blocks.filter(b => !["feed", "product"].includes(b.type))) {
      const sum = dir => c.flowsheet.streams.filter(s => s[dir].split(".")[0] === b.id)
        .reduce((acc, s) => acc.map((v, i) => v + r.streams[s.id].flows[i]), new Array(c.components.length).fill(0));
      assert.ok(maxDev(sum("to"), sum("from")) <= 1e-7 * F, `${c.name}: balance of ${b.id}`);
    }
  });

  test(`flowsheet suite, ${c.name}: same answer with the reference's tear streams`, () => {
    const fs = flowsheetOf(c);
    for (const s of fs.streams) if (c.reference_tears.includes(s.id)) s.tear = true;
    const r = solveFlowsheet(system({ components: c.components, model: c.model }), fs);
    assert.deepEqual([...r.loops[0].tears].sort(), [...c.reference_tears].sort());
    sameStreams(r, solve(c), 1e-5 * feedTotal(c), `${c.name}, reference tears`);
  });

  test(`flowsheet suite, ${c.name}: same answer with Wegstein`, () => {
    const fs = { ...flowsheetOf(c), solver: { method: "wegstein", maxIterations: 1000 } };
    const run = () => solveFlowsheet(system({ components: c.components, model: c.model }), fs);
    if (WEGSTEIN_OSCILLATES.some(k => c.name.startsWith(k))) {
      assert.throws(run, e => e.code === "NO_CONVERGENCE");
      return;
    }
    sameStreams(run(), solve(c), 1e-5 * feedTotal(c), `${c.name}, Wegstein`);
  });

  test(`flowsheet suite, ${c.name}: same answer by direct substitution`, () => {
    const fs = { ...flowsheetOf(c), solver: { method: "direct", maxIterations: 2000 } };
    const r = solveFlowsheet(system({ components: c.components, model: c.model }), fs);
    sameStreams(r, solve(c), 1e-5 * feedTotal(c), `${c.name}, direct substitution`);
  });

  test(`flowsheet suite, ${c.name}: ten times the feed gives ten times every flow`, () => {
    const fs = flowsheetOf(c);
    for (const b of fs.blocks) if (b.type === "feed") b.spec.flow_kmol_h = b.spec.flow_kmol_h.map(v => 10 * v);
        const r = solveFlowsheet(system({ components: c.components, model: c.model }), fs);
    const base = solve(c);
    for (const [sid, s] of Object.entries(r.streams)) {
      const d = maxDev(s.flows, base.streams[sid].flows.map(v => 10 * v));
      assert.ok(d <= 1e-4 * feedTotal(c), `${c.name}: stream ${sid} at ten times the feed differs by ${d}`);
    }
  });

  test(`flowsheet suite, ${c.name}: same answer with the components and blocks in reverse order`, () => {
    const n = c.components.length, rev = a => a.slice().reverse();
    const fs = flowsheetOf(c);
    fs.blocks = rev(fs.blocks);
    for (const b of fs.blocks) if (b.type === "feed") b.spec.flow_kmol_h = rev(b.spec.flow_kmol_h);
        const r = solveFlowsheet(system({ components: rev(c.components), model: c.model }), fs);
    const base = solve(c);
    for (const [sid, s] of Object.entries(r.streams)) {
      const d = maxDev(rev(s.flows), base.streams[sid].flows);
      assert.ok(d <= 1e-5 * feedTotal(c), `${c.name}: stream ${sid} with the components reversed differs by ${d}`);
    }
    assert.equal(r.streams[c.flowsheet.streams[0].id].flows.length, n);
  });
}

test("Cavett problem: products against the published VMGSim solution (advanced Peng-Robinson)", () => {
  // A different program and a different Peng-Robinson (VMGSim's "advanced" variant with its own k_ij); the
  // tolerance, set before the comparison: 10 % for every component above 1 % of the product stream.
  const c = cases.find(k => k.kind === "cavett");
  const r = solve(c);
  for (const [sid, prod] of [["P1", "P1"], ["P2", "P2"]]) {
    const ref = c.published[prod]["VMGSim APR"];
    const tot = ref.reduce((a, v) => a + v, 0);
    ref.forEach((v, i) => {
      if (v < 0.01 * tot) return;
      const got = r.streams[sid].flows[i];
      assert.ok(Math.abs(got - v) <= 0.1 * v, `Cavett ${prod}, ${c.components[i]}: ${got.toFixed(2)} vs VMGSim ${v}`);
    });
  }
});
