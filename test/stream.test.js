// Streams (proposal 0006, step 1): a stream is a flash of component flows. Reference: the
// independent flashes of validation/fixtures/flash.json (validation/python/reference_flash.py:
// thermo's FlashVL and independent enthalpies), scaled to a flow; plus the balances and the
// unit conversions, checked by hand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { system, stream, componentFlows, pure, FugacityError } from "../src/index.js";

const { cases } = JSON.parse(readFileSync(new URL("../validation/fixtures/flash.json", import.meta.url)));
const F = 50;   // kmol/h

test("streams match the independent flashes, scaled to the flow", () => {
  assert.ok(cases.length >= 18);
  for (const c of cases) {
    const s = system({ components: c.components, model: c.model, ...(c.vapour ? { vapour: c.vapour } : {}) });
    const spec = { flow_kmol_h: c.z.map(v => v * F) };
    if (c.spec.T != null) spec.T_K = c.spec.T;
    if (c.spec.P != null) spec.P_kPa = c.spec.P;
    if (c.spec.VF != null) spec.VF = c.spec.VF;
    if (c.spec.H != null) spec.H_kW = c.spec.H * F / 3600;
    const st = stream(s, spec);
    const tag = `${c.model}${c.vapour ? "/" + c.vapour : ""} ${c.components.join("+")} ${JSON.stringify(c.spec)}`;
    assert.ok(Math.abs(st.T_K - c.T_K) < 1e-3, `${tag}: T ${st.T_K} vs ${c.T_K}`);
    assert.ok(Math.abs(st.VF - c.VF) < 1e-5, `${tag}: VF`);
    // the reference enthalpy within 0.5 J/mol (flash.test.js), as an enthalpy flow
    assert.ok(Math.abs(st.H_kW - c.H_J_mol * F / 3600) < 0.5 * F / 3600, `${tag}: H_kW ${st.H_kW} vs ${c.H_J_mol * F / 3600}`);
    assert.ok(Math.abs(st.F_kmol_h - F) < 1e-9);
  }
});

test("phase flows add up to the stream's component flows", () => {
  const s = system({ components: ["methanol", "acetone", "chloroform"], model: "UNIQUAC" });
  // halfway between the bubble and dew points, so the stream splits
  const Tmid = (s.bubbleT([0.3, 0.3, 0.4], 101.325).T + s.dewT([0.3, 0.3, 0.4], 101.325).T) / 2;
  const st = stream(s, { flow_kmol_h: { methanol: 30, acetone: 30, chloroform: 40 }, T_K: Tmid, P_kPa: 101.325 });
  assert.equal(st.phases.length, 2);
  for (const id of s.ids) {
    const sum = st.phases.reduce((a, p) => a + p.flow_kmol_h[id], 0);
    assert.ok(Math.abs(sum - st.flow_kmol_h[id]) < 1e-9 * st.F_kmol_h, `${id}: ${sum} vs ${st.flow_kmol_h[id]}`);
  }
  assert.ok(Math.abs(st.phases.reduce((a, p) => a + p.F_kmol_h, 0) - 100) < 1e-9);
  // enthalpy flow = sum of the phases' enthalpy flows
  const Hp = st.phases.reduce((a, p) => a + p.F_kmol_h * p.h_J_mol / 3600, 0);
  assert.ok(Math.abs(Hp - st.H_kW) < 1e-9 * Math.max(1, Math.abs(st.H_kW)));
  assert.ok(Object.isFrozen(st));
});

test("round trips: T-P to P-H and P-VF give back the temperature", () => {
  const s = system({ components: ["ethanol", "water"], model: "NRTL" });
  const flow_kmol_h = { ethanol: 12, water: 28 };
  for (const T of [340, 355, 360, 380]) {
    const a = stream(s, { flow_kmol_h, T_K: T, P_kPa: 101.325 });
    const b = stream(s, { flow_kmol_h, P_kPa: 101.325, H_kW: a.H_kW });
    assert.ok(Math.abs(b.T_K - T) < 1e-6, `H round trip at ${T}: ${b.T_K}`);
    if (a.VF > 0 && a.VF < 1) assert.ok(Math.abs(stream(s, { flow_kmol_h, P_kPa: 101.325, VF: a.VF }).T_K - T) < 1e-6);
  }
});

test("flows: names, CAS numbers, arrays and mass flows", () => {
  const s = system({ components: ["ethanol", "water"], model: "NRTL" });
  const a = stream(s, { flow_kmol_h: { Ethanol: 1, "7732-18-5": 3 }, T_K: 300, P_kPa: 101.325 });
  assert.deepEqual(a.flows, [1, 3]);
  assert.deepEqual(a.flow_kmol_h, { ethanol: 1, water: 3 });
  assert.deepEqual(a.z, [0.25, 0.75]);
  assert.deepEqual(stream(s, { flow_kmol_h: { water: 2 }, T_K: 300, P_kPa: 101.325 }).flows, [0, 2], "missing components have zero flow");
  assert.deepEqual(stream(s, { flow_kmol_h: [1, 3], T_K: 300, P_kPa: 101.325 }).flows, [1, 3]);
  // mass flows: kmol/h = (kg/h) / (kg/kmol), with the molar masses of the component records
  const MW = [pure("ethanol").MW, pure("water").MW];
  const m = stream(s, { flow_kg_h: { ethanol: 460, water: 900 }, T_K: 300, P_kPa: 101.325 });
  assert.ok(Math.abs(m.flows[0] - 460 / MW[0]) < 1e-12 && Math.abs(m.flows[1] - 900 / MW[1]) < 1e-12);
  assert.ok(Math.abs(m.mass_kg_h - 1360) < 1e-9);
  assert.ok(Math.abs(m.MW - 1360 / m.F_kmol_h) < 1e-9);
  assert.deepEqual(componentFlows(s, { water: 5 }), [0, 5]);
});

test("a stream without flow carries T and P only", () => {
  const s = system({ components: ["ethanol", "water"], model: "NRTL" });
  const e = stream(s, { id: "PURGE", flow_kmol_h: { water: 0 }, T_K: 350, P_kPa: 101.325 });
  assert.equal(e.F_kmol_h, 0);
  assert.equal(e.H_kW, 0);
  assert.deepEqual(e.phases, []);
  assert.equal(e.T_K, 350);
  assert.equal(e.id, "PURGE");
  assert.throws(() => stream(s, { flow_kmol_h: [0, 0], P_kPa: 100, H_kW: 5 }), /without flow/);
});

test("wrong specifications are refused with the reason", () => {
  const s = system({ components: ["ethanol", "water"], model: "NRTL" });
  const ok = { flow_kmol_h: { ethanol: 1, water: 1 }, T_K: 350, P_kPa: 101.325 };
  for (const [spec, re] of [
    [{ ...ok, flow_kmol_h: { benzene: 1 } }, /not a component of this system/],
    [{ ...ok, flow_kmol_h: { unobtainium: 1 } }, /Unknown component/],
    [{ ...ok, flow_kmol_h: { water: -1 } }, /negative/],
    [{ ...ok, flow_kmol_h: [1, 2, 3] }, /3 values; the system has 2/],
    [{ ...ok, flow_kmol_h: { water: "a lot" } }, /must be a number/],
    [{ ...ok, flow_kg_h: { water: 1 } }, /not both/],
    [{ flow_kmol_h: { water: 1 }, T_K: 350 }, /give two of/],
    [{ flow_kmol_h: { water: 1 }, T_K: 350, P_kPa: 100, VF: 0.5 }, /give two of/],
    [{ T_K: 350, P_kPa: 100 }, /give the flows/],
    [{ ...ok, P_kPa: -5 }, /./],
  ]) assert.throws(() => stream(s, spec), err => err instanceof FugacityError && re.test(err.message), JSON.stringify(spec));
  assert.throws(() => stream({}, ok), /must be a system/);
});
