// Peng-Robinson and SRK against reference data: CoolProp 8.0.0 reference equations of state
// (pure fluids) and GERG-2008 (mixtures), and experimental VLE from the NIST ThermoML
// Archive. Cubic equations of state are approximations: the tolerances below state their
// known accuracy, they are not implementation checks (those are in eos.test.js).
// Run with `node --test --test-reporter=spec test/eos-reference.test.js` to see the tables.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { system, cubicEos, pure } from "../src/index.js";

const load = f => JSON.parse(readFileSync(new URL(`../validation/data/eos/${f}`, import.meta.url)));
const coolprop = load("coolprop_reference.json");
const janisch = load("janisch2007_nitrogen_methane.json");
const pct = (a, b) => 100 * (a / b - 1);
const eosFor = (model, id) => {
  const c = pure(id);
  return cubicEos(model, [{ name: c.name, Tc_K: c.Tc_K, Pc_Pa: c.Pc_kPa * 1000, omega: c.omega }]);
};

test("vapour pressure: PR and SRK vs CoolProp (Tr = 0.6-0.9)", t => {
  const rows = [];
  let worst = { PR: 0, SRK: 0 };
  for (const r of coolprop.psat) {
    const c = pure(r.component), Tr = r.T_K / c.Tc_K;
    const d = {};
    for (const model of ["PR", "SRK"]) {
      d[model] = pct(eosFor(model, r.component).psat(0, r.T_K), r.P_kPa);
      worst[model] = Math.max(worst[model], Math.abs(d[model]));
      // known accuracy of the generalized alpha functions: a few % from Tr = 0.7 up,
      // larger at low Tr for polar and quantum fluids (water, methanol, hydrogen)
      const tol = model === "PR" ? (Tr < 0.65 ? 8 : 4) : (Tr < 0.65 ? 13 : 6);
      assert.ok(Math.abs(d[model]) < tol, `${model} ${r.component} ${r.T_K} K: ${d[model].toFixed(2)} %`);
    }
    rows.push(`${r.component.padEnd(9)} T ${r.T_K.toFixed(2)} K  CoolProp ${r.P_kPa.toPrecision(6)} kPa  PR ${d.PR.toFixed(2)} %  SRK ${d.SRK.toFixed(2)} %`);
  }
  t.diagnostic(rows.join("\n"));
  t.diagnostic(`largest |deviation|: PR ${worst.PR.toFixed(2)} %, SRK ${worst.SRK.toFixed(2)} %`);
});

test("density of the six gases at 300 K, 1-100 bar: PR and SRK vs CoolProp", t => {
  const rows = [];
  for (const r of coolprop.density) {
    const MW = pure(r.component).MW / 1000;
    const d = {};
    for (const model of ["PR", "SRK"]) {
      const s = system({ components: [r.component], model });
      d[model] = pct(s.density([1], r.T_K, r.P_kPa, r.phase), r.rho_kg_m3);
      assert.ok(rel2(s.density([1], r.T_K, r.P_kPa, r.phase), MW / s.state(r.T_K, r.P_kPa, [1], r.phase).v_m3_mol));
    }
    const dense = r.rho_kg_m3 > 200; // liquid or dense supercritical
    assert.ok(Math.abs(d.PR) < (dense ? 7.5 : 4), `PR ${r.component} ${r.P_kPa} kPa: ${d.PR.toFixed(2)} %`);
    assert.ok(Math.abs(d.SRK) < (dense ? 17 : 2), `SRK ${r.component} ${r.P_kPa} kPa: ${d.SRK.toFixed(2)} %`);
    rows.push(`${r.component.padEnd(9)} ${String(r.P_kPa / 100).padStart(4)} bar ${r.coolprop_phase.padEnd(18)} CoolProp ${r.rho_kg_m3.toFixed(3)} kg/m3  PR ${d.PR.toFixed(2)} %  SRK ${d.SRK.toFixed(2)} %`);
  }
  t.diagnostic(rows.join("\n"));
});
const rel2 = (a, b) => Math.abs(a / b - 1) < 1e-12;

test("bubble pressure of methane + ethane and nitrogen + methane vs GERG-2008 (CoolProp)", t => {
  const rows = [];
  for (const r of coolprop.mixture_bubble) {
    for (const model of ["PR", "SRK"]) {
      const s = system({ components: r.components, model });
      const b = s.bubbleP([r.x1, 1 - r.x1], r.T_K);
      const dP = pct(b.P, r.P_kPa), dy = b.y[0] - r.y1;
      // largest deviations (about -5 %) at methane-poor liquid, 200 K
      assert.ok(Math.abs(dP) < 6 && Math.abs(dy) < 0.01,`${model} ${r.components.join("+")} x1 ${r.x1}: dP ${dP.toFixed(2)} %, dy ${dy.toFixed(4)}`);
      rows.push(`${model.padEnd(3)} ${r.components.join("+")} ${r.T_K} K x1 ${r.x1}: GERG ${r.P_kPa.toFixed(1)} kPa y1 ${r.y1.toFixed(4)} | ${b.P.toFixed(1)} kPa (${dP.toFixed(2)} %) y1 ${b.y[0].toFixed(4)} (${dy >= 0 ? "+" : ""}${dy.toFixed(4)})`);
    }
  }
  t.diagnostic(rows.join("\n"));
});

test("nitrogen + methane VLE vs experimental data (Janisch et al. 2007, ThermoML)", t => {
  const rows = [];
  const stats = {};
  for (const model of ["PR", "SRK"]) {
    for (const zero of [false, true]) {
      const s = system({ components: ["nitrogen", "methane"], model, ...(zero ? { kij: [[0, 0], [0, 0]] } : {}) });
      let sp = 0, sy = 0, n = 0, failed = 0, maxY = 0;
      for (const [T, x, P, y] of janisch.rows) {
        let b;
        try { b = s.bubbleP([x, 1 - x], T); } catch (e) { failed++; continue; }
        const dP = pct(b.P, P), dy = b.y[0] - y;
        sp += Math.abs(dP); sy += Math.abs(dy); n++; maxY = Math.max(maxY, Math.abs(dy));
        if (!zero) rows.push(`${model.padEnd(3)} T ${T} K x_N2 ${x}: P exp ${P} kPa, calc ${b.P.toFixed(1)} (${dP.toFixed(2)} %); y_N2 exp ${y}, calc ${b.y[0].toFixed(4)}`);
      }
      stats[`${model}${zero ? " k_ij=0" : " ChemSep k_ij"}`] = { n, failed, aadP: sp / n, aadY: sy / n, maxY };
    }
  }
  t.diagnostic(rows.join("\n"));
  t.diagnostic(JSON.stringify(stats, (k, v) => (typeof v === "number" ? +v.toFixed(4) : v), 1));
  for (const model of ["PR", "SRK"]) {
    const s = stats[`${model} ChemSep k_ij`], z = stats[`${model} k_ij=0`];
    assert.equal(s.failed, 0, `${model}: every experimental point has a bubble point`);
    assert.ok(s.aadP < 3 && s.aadY < 0.01 && s.maxY < 0.025, `${model}: ${JSON.stringify(s)}`);
    assert.ok(s.aadP < z.aadP, `${model}: the ChemSep k_ij improves the bubble pressure`);
  }
});
