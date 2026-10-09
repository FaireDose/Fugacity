// Flowsheet solver (proposal 0006, step 3). References:
//  - validation/fixtures/flowsheet.json: the same recycle flowsheets solved equation-oriented
//    (scipy root on the recycle flows) with the independent flash of reference_flash.py
//    (validation/python/reference_flowsheet.py) — a different algorithm and a different flash;
//  - a recycle with fixed split fractions, whose balances are linear and have an exact answer;
//  - structure errors and a loop that cannot converge, which must throw.
// A published worked example (proposal 0006, "Engineering basis" 4): the Cavett problem with the
// published VMGSim and FLOWTRAN solutions (Rosen, CACHE News, Fall 2005, free to read), in
// test/flowsheet-suite.test.js with 16 generated recycle flowsheets (docs/FLOWSHEET_TESTS.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { system, solveFlowsheet, checkFlowsheet, FugacityError } from "../src/index.js";

const { cases } = JSON.parse(readFileSync(new URL("../validation/fixtures/flowsheet.json", import.meta.url)));
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

/** feed -> mixer -> drum -> (recycled phase) -> splitter -> back to the mixer; the other phase and the purge are products */
function recycleFlowsheet(c) {
  const drum = c.drum.T != null && c.drum.P != null ? { T_K: c.drum.T, P_kPa: c.drum.P } : { P_kPa: c.drum.P, VF: c.drum.VF };
  const rec = c.recycle_phase, other = rec === "vapour" ? "liquid" : "vapour";
  return {
    blocks: [
      { id: "F1", type: "feed", spec: { flow_kmol_h: c.feed, T_K: 300, P_kPa: c.drum.P ?? 101.325 } },
      { id: "M1", type: "mixer" },
      { id: "V1", type: "flash", spec: drum },
      { id: "SP1", type: "splitter", spec: { fractions: [c.r, "rest"] } },
      { id: "P1", type: "product" }, { id: "P2", type: "product" },
    ],
    streams: [
      { id: "S1", from: "F1.out", to: "M1.in" },
      { id: "S2", from: "M1.out", to: "V1.in" },
      { id: "S3", from: `V1.${other}`, to: "P1.in" },
      { id: "S4", from: `V1.${rec}`, to: "SP1.in" },
      { id: "S5", from: "SP1.out", to: "M1.in" },
      { id: "S6", from: "SP1.out", to: "P2.in" },
    ],
  };
}

test("recycle flowsheets match the independent equation-oriented solution", () => {
  assert.equal(cases.length, 3);
  for (const c of cases) {
    const sys = system({ components: c.components, model: c.model });
    const r = solveFlowsheet(sys, recycleFlowsheet(c));
    const Ftot = c.feed.reduce((a, v) => a + v, 0);
    // the flashes agree to about 1e-5 in composition (flash.test.js); the flows here to 2e-5 of the feed
    c.recycle_kmol_h.forEach((v, i) => close(r.streams.S5.flows[i], v, 2e-5 * Ftot, `${c.name}: recycle ${c.components[i]}`));
    c.purge_kmol_h.forEach((v, i) => close(r.streams.S6.flows[i], v, 2e-5 * Ftot, `${c.name}: purge ${c.components[i]}`));
    c.other_product_kmol_h.forEach((v, i) => close(r.streams.S3.flows[i], v, 2e-5 * Ftot, `${c.name}: product ${c.components[i]}`));
    close(r.blocks.V1.state.T_K, c.drum_T_K, 1e-3, `${c.name}: drum T`);
    close(r.blocks.V1.state.VF, c.drum_VF, 1e-5, `${c.name}: drum VF`);
    // the whole flowsheet balances: feeds = products
    for (const v of Object.values(r.balance.material_kmol_h)) close(v, 0, 1e-7 * Ftot, `${c.name}: material balance`);
    assert.equal(r.loops.length, 1);
    assert.ok(r.loops[0].iterations <= 25, `${c.name}: ${r.loops[0].iterations} iterations`);
  }
});

test("a recycle with fixed split fractions reaches the exact answer", () => {
  // feed F -> mixer -> separator (a_i of component i to the top) -> bottom -> splitter (purge p) -> back.
  // Mixer outlet: M_i = F_i + (1 - p)(1 - a_i) M_i, so M_i = F_i / (1 - (1 - p)(1 - a_i)).
  const sys = system({ components: ["methanol", "water"], model: "NRTL" });
  const Fd = [20, 80], a = [0.9, 0.15], p = 0.1;
  const fs = {
    blocks: [
      { id: "F1", type: "feed", spec: { flow_kmol_h: Fd, T_K: 320, P_kPa: 101.325 } },
      { id: "M1", type: "mixer" },
      { id: "X1", type: "separator", spec: { fractions: { methanol: [a[0], "rest"], water: [a[1], "rest"] } } },
      { id: "SP1", type: "splitter", spec: { fractions: [p, "rest"] } },
      { id: "TOP", type: "product" }, { id: "PURGE", type: "product" },
    ],
    streams: [
      { id: "S1", from: "F1.out", to: "M1.in" }, { id: "S2", from: "M1.out", to: "X1.in" },
      { id: "S3", from: "X1.out", to: "TOP.in" }, { id: "S4", from: "X1.out", to: "SP1.in" },
      { id: "S5", from: "SP1.out", to: "PURGE.in" }, { id: "S6", from: "SP1.out", to: "M1.in" },
    ],
  };
  const r = solveFlowsheet(sys, fs);
  const M = Fd.map((f, i) => f / (1 - (1 - p) * (1 - a[i])));
  M.forEach((m, i) => close(r.streams.S2.flows[i], m, 1e-9 * m, `mixer outlet ${i}`));
  M.forEach((m, i) => close(r.streams.S3.flows[i], a[i] * m, 1e-9 * m, `top ${i}`));
  M.forEach((m, i) => close(r.streams.S5.flows[i], p * (1 - a[i]) * m, 1e-9 * m, `purge ${i}`));
  // energy: feeds + duties = products, to the loop's tolerance relative to the enthalpy flows
  const Hscale = Math.max(...Object.values(r.streams).map(s => Math.abs(s.H_kW)));
  close(r.balance.energy_kW, 0, 1e-6 * Hscale, "energy balance");
});

test("tear streams: chosen by the solver, or the one marked, with a guess", () => {
  const c = cases[0], sys = system({ components: c.components, model: c.model });
  const auto = solveFlowsheet(sys, recycleFlowsheet(c));
  assert.equal(auto.loops[0].tears.length, 1);
  const fs = recycleFlowsheet(c);
  fs.streams.find(s => s.id === "S5").tear = true;
  fs.streams.find(s => s.id === "S5").guess = { flow_kmol_h: c.recycle_kmol_h.map(v => v * 0.9), T_K: c.drum_T_K, P_kPa: 101.325 };
  const marked = solveFlowsheet(sys, fs);
  assert.deepEqual(marked.loops[0].tears, ["S5"]);
  c.recycle_kmol_h.forEach((v, i) => close(marked.streams.S5.flows[i], auto.streams.S5.flows[i], 1e-6, "same answer"));
  assert.ok(marked.loops[0].iterations <= auto.loops[0].iterations + 2, "a good guess does not slow it down");
  // a marked stream outside the loop is refused
  const bad = recycleFlowsheet(c);
  bad.streams.find(s => s.id === "S1").tear = true;
  assert.throws(() => solveFlowsheet(sys, bad), /S1 is marked as a tear stream but is not part of a recycle loop/);
});

test("a loop that cannot converge throws, with the reason", () => {
  // all the liquid goes back and nothing leaves: the recycle keeps growing
  const c = { ...cases[0], r: 1 };
  const sys = system({ components: c.components, model: c.model });
  const fs = recycleFlowsheet(c);
  fs.solver = { maxIterations: 15 };
  assert.throws(() => solveFlowsheet(sys, fs), err => err instanceof FugacityError && err.code === "NO_CONVERGENCE"
    && /The loop through .* did not converge/.test(err.message) && /purge/.test(err.message), "throws NO_CONVERGENCE");
});

test("a recycle with no way out fails loudly with every convergence method", () => {
  // Broyden extrapolates: without the growth limit it reached flows of 1e13 kmol/h whose relative change
  // looked converged (found by the flowsheet suite); every method must stop instead of answering
  const c = { ...cases[0], r: 1 };
  const sys = system({ components: c.components, model: c.model });
  for (const method of ["broyden", "wegstein", "direct"]) {
    const fs = recycleFlowsheet(c);
    fs.solver = { method, maxIterations: 200 };
    assert.throws(() => solveFlowsheet(sys, fs), err => err.code === "NO_CONVERGENCE" && /purge/.test(err.message), method);
  }
});

test("a flowsheet without recycle is calculated in order", () => {
  const sys = system({ components: ["ethanol", "water"], model: "NRTL" });
  const r = solveFlowsheet(sys, {
    blocks: [
      { id: "P1", type: "product" }, { id: "E1", type: "heater", spec: { T_K: 355 } },
      { id: "F1", type: "feed", spec: { flow_kmol_h: { ethanol: 40, water: 60 }, T_K: 300, P_kPa: 101.325 } },
      { id: "V1", type: "flash", spec: { P_kPa: 101.325, duty_kW: 0 } }, { id: "P2", type: "product" },
    ],
    streams: [
      { id: "S1", from: "F1.out", to: "E1.in" }, { id: "S2", from: "E1.out", to: "V1.in" },
      { id: "S3", from: "V1.vapour", to: "P1.in" }, { id: "S4", from: "V1.liquid", to: "P2.in" },
    ],
  });
  assert.deepEqual(r.loops, []);
  assert.deepEqual(r.order.slice(0, 3), ["F1", "E1", "V1"]);
  close(r.blocks.V1.state.T_K, 355, 1e-6, "adiabatic drum after the heater keeps T");
  close(r.balance.energy_kW, 0, 1e-6, "energy");
  assert.ok(r.blocks.E1.duty_kW > 0);
});

test("structure errors name the block or stream", () => {
  const base = () => recycleFlowsheet(cases[0]);
  const mod = f => { const fs = base(); f(fs); return fs; };
  for (const [fs, re] of [
    [mod(fs => { fs.blocks.push({ id: "M1", type: "mixer" }); }), /Two blocks are called M1/],
    [mod(fs => { fs.blocks[1].type = "column"; }), /Unknown block type "column"/],
    [mod(fs => { fs.streams[0].to = "X9.in"; }), /goes to X9, which is not a block/],
    [mod(fs => { fs.streams[2].from = "V1.top"; }), /has no outlet "top"/],
    [mod(fs => { fs.streams[2].from = "V1-vapour"; }), /"BLOCK.port"/],
    [mod(fs => { fs.streams.splice(2, 1); fs.blocks.splice(4, 1); }), /Flash drum V1: connect a stream to its vapour outlet/],
    [mod(fs => { fs.streams.push({ id: "S1", from: "V1.liquid2", to: "P2.in" }); }), /Two streams are called S1/],
    [{ blocks: [], streams: [] }, /no blocks/],
  ]) assert.throws(() => checkFlowsheet(fs), err => err instanceof FugacityError && re.test(err.message), re.source);
});

test("solver methods: direct substitution reaches the same answer as Wegstein and Broyden, in more iterations", () => {
  const c = cases[0], sys = system({ components: c.components, model: c.model });
  const with_ = method => { const fs = recycleFlowsheet(c); fs.solver = { method, maxIterations: 300, tolerance: 1e-9 }; return solveFlowsheet(sys, fs); };
  const w = with_("wegstein"), b = with_("broyden"), d = with_("direct");
  assert.equal(solveFlowsheet(sys, recycleFlowsheet(c)).loops[0].iterations, solveFlowsheet(sys, { ...recycleFlowsheet(c), solver: { method: "broyden" } }).loops[0].iterations, "Broyden is the default");
  for (const [name, r] of [["Wegstein", w], ["Broyden", b]]) {
    c.recycle_kmol_h.forEach((v, i) => close(d.streams.S5.flows[i], r.streams.S5.flows[i], 1e-6 * 100, `${name}: recycle ${i}`));
    assert.ok(d.loops[0].iterations >= r.loops[0].iterations, `direct ${d.loops[0].iterations}, ${name} ${r.loops[0].iterations}`);
  }
  assert.throws(() => solveFlowsheet(sys, { ...recycleFlowsheet(c), solver: { method: "newton" } }), /solver.method "newton"/);
});
