// Every phase-equilibrium diagram with either kind of model (maintainer's decision, 0.3): the
// diagram algorithms use the system's own bubble point (src/equilibrium/bubble-any.js), so an
// equation of state draws T-x-y, P-x-y, ternary maps, residue curves and azeotropes too.
// Also the composition basis of the diagrams (mole fraction or wt %, src/ui/dom.js basisView).
import { test } from "node:test";
import assert from "node:assert/strict";
import { system, binaryAzeotropes, pure } from "../src/index.js";
import { ternaryAzeotropes } from "../src/equilibrium/azeotrope.js";
import { basisView } from "../src/ui/dom.js";

const P = 101.325;

test("equation-of-state diagrams are the equation of state's own bubble points", () => {
  for (const model of ["PR", "SRK"]) {
    const s = system({ components: ["benzene", "toluene"], model });
    const t = s.txy(P, 5);
    for (const d of t) {
      const r = s.bubbleT([d.x, 1 - d.x], P);
      assert.ok(Math.abs(r.T - d.T) < 1e-9 && Math.abs(r.y[0] - d.y) < 1e-9, `${model} T-x-y at x = ${d.x}`);
    }
    const p = s.pxy(360, 5);
    for (const d of p) assert.ok(Math.abs(s.bubbleP([d.x, 1 - d.x], 360).P - d.P) < 1e-9, `${model} P-x-y at x = ${d.x}`);
    // the pure ends of T-x-y are the equation of state's boiling points
    const tb = s.boilingPoints(P);
    assert.ok(Math.abs(t[0].T - tb[1]) < 1e-5 && Math.abs(t.at(-1).T - tb[0]) < 1e-5, `${model} ends`);
    // benzene + toluene is nearly ideal: within 2 K of the ideal-solution diagram
    const ideal = system({ components: ["benzene", "toluene"], model: "ideal" }).txy(P, 5);
    t.forEach((d, k) => assert.ok(Math.abs(d.T - ideal[k].T) < 2, `${model} near ideal at x = ${d.x}`));
  }
});

test("boiling points from the equation of state: P_sat(T_b) = P, and clear errors outside the range", () => {
  const s = system({ components: ["methanol", "water"], model: "PR" });
  const tb = s.boilingPoints(P);
  tb.forEach((T, i) => assert.ok(Math.abs(s.psatEos(T)[i] / P - 1) < 1e-6, s.names[i]));
  assert.throws(() => system({ components: ["methane", "ethane"], model: "PR" }).boilingPoints(6000), e => e.code === "OUT_OF_RANGE" && /critical pressure/.test(e.message));
});

test("ternary map and residue curves with an equation of state", () => {
  const s = system({ components: ["methanol", "acetone", "chloroform"], model: "SRK" });
  const g = s.ternaryGrid(P, 8);
  assert.equal(g.nodes.length, 45);
  for (const d of g.nodes) assert.ok(d.T > 320 && d.T < 345 && Math.abs(d.y.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  const rc = s.residueCurve([0.3, 0.3, 0.4], P);
  assert.ok(rc.length > 10);
  for (let k = 1; k < rc.length; k++) assert.ok(rc[k].T >= rc[k - 1].T - 1e-6, "rising temperature along the curve");
  assert.equal(s.isLiquidStable([0.3, 0.3, 0.4], 330, P), true);
  assert.throws(() => s.isLiquidStable([0.3, 0.3, 0.4], 330), /needs the pressure/);
});

test("equation-of-state azeotropes: located by bisection, bracket reported and checked", () => {
  const s = system({ components: ["methanol", "chloroform"], model: "PR" });
  const az = binaryAzeotropes(s, P, 200, { gaps: true });
  assert.equal(az.length, 1);
  const [a, b] = az[0].within;
  assert.ok(b - a < 0.01 && a < az[0].x && az[0].x < b);
  // y - x changes sign across the bracket: the azeotrope is inside
  const f = x => s.bubbleT([x, 1 - x], P).y[0] - x;
  assert.ok(f(a) * f(b) < 0);
  assert.equal(az[0].type, "minimum-boiling");
  // the interior search is not run for equations of state, and the result says so
  const t = system({ components: ["methanol", "acetone", "chloroform"], model: "PR" });
  const all = ternaryAzeotropes(t, P, ids => system({ components: ids, model: "PR" }), { gaps: true });
  assert.match(all.notSearched, /not searched with PR/);
  assert.ok(all.every(z => z.kind === "binary"));
  // activity models: unchanged, exact roots without a bracket
  const n = binaryAzeotropes(system({ components: ["methanol", "chloroform"], model: "NRTL" }), P);
  assert.equal(n.length, 1);
  assert.equal(n[0].within, undefined);
});

test("points without a bubble point are counted with gaps, and throw without it", () => {
  // PR with k_ij = 0 (none in the databank) predicts two liquids for most ethanol + water liquids
  const s = system({ components: ["ethanol", "water"], model: "PR" });
  assert.throws(() => binaryAzeotropes(s, P, 50), e => e.code === "PHASE_SPLIT");
  const az = binaryAzeotropes(s, P, 50, { gaps: true });
  assert.ok(az.gaps.points > 10 && /two liquid phases/.test(az.gaps.message));
});

test("composition basis: wt % and back", () => {
  const MW = ["ethanol", "water"].map(id => pure(id).MW);
  const bv = basisView("mass", MW);
  for (const x of [[0.1, 0.9], [0.5, 0.5], [0.9, 0.1]]) {
    const w = bv.conv(x);
    assert.ok(Math.abs(w[0] - x[0] * MW[0] / (x[0] * MW[0] + x[1] * MW[1])) < 1e-12);
    bv.inv(w).forEach((v, i) => assert.ok(Math.abs(v - x[i]) < 1e-12));
  }
  assert.equal(bv.tick(0.2), "20");
  assert.equal(bv.axis, "wt %");
  const mol = basisView("mole", MW);
  assert.deepEqual(mol.inv([0.3, 0.7]), [0.3, 0.7]);
  assert.equal(mol.tick(0.2), "0.2");
});
