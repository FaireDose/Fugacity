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
// feed; every block and the whole flowsheet balance. Where thermo's three-phase flash finds two liquids
// in a drum at the reference solution, the engine must refuse instead (two liquids with an equation of
// state are not supported yet).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { system, solveFlowsheet } from "../src/index.js";

const { cases } = JSON.parse(readFileSync(new URL("../validation/fixtures/flowsheet-suite.json", import.meta.url)));
const feedTotal = c => c.flowsheet.blocks.filter(b => b.type === "feed").reduce((a, b) => a + b.spec.flow_kmol_h.reduce((s, v) => s + v, 0), 0);
const clone = v => JSON.parse(JSON.stringify(v));
const maxDev = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
// Cases whose first pass (tear streams empty) reaches a state with two liquids that the converged loop
// does not have: the engine refuses that state (two liquids with an equation of state are not supported
// yet), and says a guess for the tear streams may avoid it. These are solved with a rough guess, a fifth
// of the reference's tear flows, at the temperature and pressure of the drum they come from; the test
// below checks that the default start still stops with that explanation.
const START_GUESS = ["G15 "];
const needsGuess = c => START_GUESS.some(k => c.name.startsWith(k));
/** The drum a stream comes from, through splitters. */
function sourceDrum(c, sid) {
  const blocks = Object.fromEntries(c.flowsheet.blocks.map(b => [b.id, b]));
  let b = blocks[c.flowsheet.streams.find(s => s.id === sid).from.split(".")[0]];
  while (b.type === "splitter") b = blocks[c.flowsheet.streams.find(s => s.to.split(".")[0] === b.id).from.split(".")[0]];
  return b;
}
function flowsheetOf(c) {
  const fs = clone(c.flowsheet);
  if (needsGuess(c)) {
    for (const s of fs.streams) if (c.reference_tears.includes(s.id)) {
      const d = sourceDrum(c, s.id);
      s.tear = true;
      s.guess = { flow_kmol_h: c.streams_kmol_h[s.id].map(v => 0.2 * v), T_K: c.drums[d.id].T_K, P_kPa: d.spec.P_kPa };
    }
  }
  return fs;
}
// Drums where thermo's FlashVLN finds two liquids at the reference solution (liquids_vln, from
// reference_flowsheet_suite.py): the vapour-liquid reference is not the stable state there, and the
// engine must refuse it.
const twoLiquids = c => Object.entries(c.drums).filter(([, d]) => d.liquids_vln > 1).map(([id]) => id);
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

for (const c of cases.filter(c => twoLiquids(c).length)) {
  test(`flowsheet suite, ${c.name}: refuses the drum where the liquid splits in two`, () => {
    const ids = twoLiquids(c);
    assert.throws(() => solveFlowsheet(system({ components: c.components, model: c.model }), c.flowsheet),
      e => e.code === "PHASE_SPLIT" && ids.some(id => e.message.includes(id)) && /two liquid/.test(e.message));
  });
}

for (const c of cases.filter(c => needsGuess(c))) {
  test(`flowsheet suite, ${c.name}: without a guess, the first pass stops with the reason and the remedy`, () => {
    assert.throws(() => solveFlowsheet(system({ components: c.components, model: c.model }), c.flowsheet),
      e => e.code === "PHASE_SPLIT" && /first pass/.test(e.message) && /guess/.test(e.message));
  });
}

for (const c of cases.filter(c => !twoLiquids(c).length)) {
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

  test(`flowsheet suite, ${c.name}: same answer by direct substitution`, () => {
    const fs = { ...flowsheetOf(c), solver: { method: "direct", maxIterations: 2000 } };
    const r = solveFlowsheet(system({ components: c.components, model: c.model }), fs);
    sameStreams(r, solve(c), 1e-5 * feedTotal(c), `${c.name}, direct substitution`);
  });

  test(`flowsheet suite, ${c.name}: ten times the feed gives ten times every flow`, () => {
    const fs = flowsheetOf(c);
    for (const b of fs.blocks) if (b.type === "feed") b.spec.flow_kmol_h = b.spec.flow_kmol_h.map(v => 10 * v);
    for (const s of fs.streams) if (s.guess) s.guess.flow_kmol_h = s.guess.flow_kmol_h.map(v => 10 * v);
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
    for (const s of fs.streams) if (s.guess) s.guess.flow_kmol_h = rev(s.guess.flow_kmol_h);
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
