// Blocks (proposal 0006, step 2): feed, mixer, splitter, component separator, flash drum,
// heater / cooler, product. References: the independent flashes of
// validation/fixtures/flash.json (validation/python/reference_flash.py) for the flash drum and
// the heater; hand balances for the rest (they are definitions: sums and fractions).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { system, stream, runUnit, registerUnit, unitTypes, unitType, scaleStream, phaseStream, FugacityError } from "../src/index.js";

const { cases } = JSON.parse(readFileSync(new URL("../validation/fixtures/flash.json", import.meta.url)));
const F = 100;   // kmol/h
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const sysOf = c => system({ components: c.components, model: c.model, ...(c.vapour ? { vapour: c.vapour } : {}) });
const tpCases = cases.filter(c => c.spec.T != null && c.spec.P != null);

test("the first block types are registered with their ports", () => {
  assert.deepEqual(unitTypes().map(u => u.type).slice(0, 7), ["feed", "mixer", "splitter", "separator", "flash", "heater", "product"]);
  assert.deepEqual(unitType("flash").outlets.map(p => p.port), ["vapour", "liquid", "liquid2"]);
  assert.throws(() => unitType("column"), /Unknown block type "column"/);
});

test("flash drum: outlets match the independent flashes", () => {
  assert.ok(tpCases.length >= 5);
  for (const c of tpCases) {
    const sys = sysOf(c);
    const feed = runUnit("feed", { sys, spec: { flow_kmol_h: c.z.map(v => v * F), T_K: 298.15, P_kPa: c.P_kPa } }).outlets.out;
    const r = runUnit("flash", { sys, inlets: { in: feed }, spec: { T_K: c.spec.T, P_kPa: c.spec.P } });
    const tag = `${c.model} ${c.components.join("+")} ${JSON.stringify(c.spec)}`;
    const V = r.outlets.vapour, L = r.outlets.liquid;
    close(V.F_kmol_h, c.VF * F, 1e-5 * F, `${tag}: vapour flow`);
    close(V.F_kmol_h + L.F_kmol_h, F, 1e-9 * F, `${tag}: total`);
    if (c.VF > 0 && c.VF < 1) {
      c.y.forEach((y, i) => close(V.z[i], y, 1e-5, `${tag}: y${i}`));
      c.x.forEach((x, i) => close(L.z[i], x, 1e-5, `${tag}: x${i}`));
    }
    // outlet enthalpy flows = the reference enthalpy of the flashed feed (within 0.5 J/mol)
    close(V.H_kW + L.H_kW, c.H_J_mol * F / 3600, 0.5 * F / 3600, `${tag}: H out`);
    close(r.balance.energy_kW, 0, 1e-6, `${tag}: energy balance`);
    assert.ok(r.balance.material < 1e-9);
  }
});

test("heater: the duty is the difference of the independent enthalpies", () => {
  // pairs of reference flashes with the same feed and pressure at two temperatures
  const groups = new Map();
  for (const c of tpCases) {
    const key = JSON.stringify([c.model, c.vapour ?? null, c.components, c.z, c.spec.P]);
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  let n = 0;
  for (const g of groups.values()) {
    for (let k = 1; k < g.length; k++) {
      const [a, b] = [g[0], g[k]], sys = sysOf(a);
      const s = stream(sys, { flow_kmol_h: a.z.map(v => v * F), T_K: a.spec.T, P_kPa: a.spec.P });
      const r = runUnit("heater", { sys, inlets: { in: s }, spec: { T_K: b.spec.T } });
      close(r.duty_kW, (b.H_J_mol - a.H_J_mol) * F / 3600, 1.0 * F / 3600, `${a.components.join("+")} ${a.spec.T} → ${b.spec.T} K`);
      close(r.outlets.out.VF, b.VF, 1e-5, "outlet VF");
      n++;
    }
  }
  assert.ok(n >= 1, "at least one pair of reference flashes at the same pressure");
});

test("heater: duty, vapour fraction and pressure drop give consistent outlets", () => {
  const sys = system({ components: ["ethanol", "water"], model: "NRTL" });
  const s = stream(sys, { flow_kmol_h: { ethanol: 40, water: 60 }, T_K: 300, P_kPa: 200 });
  const toVF = runUnit("heater", { sys, inlets: { in: s }, spec: { VF: 0.5, dP_kPa: 20 } });
  close(toVF.outlets.out.P_kPa, 180, 1e-12, "pressure drop");
  close(toVF.outlets.out.VF, 0.5, 1e-9, "VF");
  // the same duty back as a duty specification gives the same outlet temperature
  const byDuty = runUnit("heater", { sys, inlets: { in: s }, spec: { duty_kW: toVF.duty_kW, P_kPa: 180 } });
  close(byDuty.outlets.out.T_K, toVF.outlets.out.T_K, 1e-6, "T from the duty");
  // a cooler: negative duty
  const cool = runUnit("heater", { sys, inlets: { in: s }, spec: { T_K: 280 } });
  assert.ok(cool.duty_kW < 0);
  assert.throws(() => runUnit("heater", { sys, inlets: { in: s }, spec: { dP_kPa: 300, T_K: 300 } }), /larger than the inlet pressure/);
  assert.throws(() => runUnit("heater", { sys, inlets: { in: s }, spec: { T_K: 300, duty_kW: 5 } }), /give the outlet temperature/);
});

test("mixer: flows add up, enthalpy is conserved, the lowest pressure by default", () => {
  const sys = system({ components: ["methanol", "water"], model: "NRTL" });
  const a = stream(sys, { flow_kmol_h: { methanol: 10, water: 5 }, T_K: 300, P_kPa: 150 });
  const b = stream(sys, { flow_kmol_h: { methanol: 2, water: 30 }, T_K: 340, P_kPa: 120 });
  const r = runUnit("mixer", { sys, inlets: { in: [a, b] } });
  const o = r.outlets.out;
  assert.deepEqual(o.flows.map(v => +v.toFixed(12)), [12, 35]);
  close(o.P_kPa, 120, 1e-12, "lowest inlet pressure");
  close(o.H_kW, a.H_kW + b.H_kW, 1e-6, "adiabatic");
  assert.ok(o.T_K > 300 && o.T_K < 340, `outlet T between the inlets: ${o.T_K}`);
  // mixing a stream with itself changes nothing but the flow
  const same = runUnit("mixer", { sys, inlets: { in: [a, a] } }).outlets.out;
  close(same.T_K, a.T_K, 1e-6, "same T"); close(same.F_kmol_h, 2 * a.F_kmol_h, 1e-9, "double flow");
  assert.match(runUnit("mixer", { sys, inlets: { in: [a, b] }, spec: { P_kPa: 140 } }).notes[0], /pump or compressor/);
});

test("splitter and component separator: the fractions, by hand", () => {
  const sys = system({ components: ["ethanol", "water"], model: "NRTL" });
  const s = stream(sys, { flow_kmol_h: { ethanol: 40, water: 60 }, T_K: 355, P_kPa: 101.325 });
  const sp = runUnit("splitter", { sys, inlets: { in: s }, spec: { fractions: [0.2, 0.3, "rest"] }, outletCount: 3 });
  const outs = sp.outlets.out;
  [0.2, 0.3, 0.5].forEach((f, k) => {
    close(outs[k].F_kmol_h, 100 * f, 1e-9, `outlet ${k}`);
    close(outs[k].T_K, s.T_K, 0, "same T"); close(outs[k].VF, s.VF, 0, "same VF");
    close(outs[k].H_kW, s.H_kW * f, 1e-9, "enthalpy flow");
  });
  const se = runUnit("separator", { sys, inlets: { in: s }, spec: { fractions: { ethanol: [0.95, "rest"], Water: ["rest", 0.9] }, outlets: [{ T_K: 351, P_kPa: 101.325 }, null] } });
  const [top, bottom] = se.outlets.out;
  close(top.flow_kmol_h.ethanol, 38, 1e-9, "ethanol to the top"); close(top.flow_kmol_h.water, 6, 1e-9, "water to the top");
  close(bottom.flow_kmol_h.ethanol, 2, 1e-9, "ethanol to the bottom"); close(bottom.flow_kmol_h.water, 54, 1e-9, "water to the bottom");
  close(top.T_K, 351, 1e-9, "top at its T"); close(bottom.T_K, s.T_K, 1e-9, "bottom at the inlet T");
  close(se.duty_kW, top.H_kW + bottom.H_kW - s.H_kW, 1e-9, "duty closes the energy balance");
  close(se.balance.energy_kW, 0, 1e-9, "energy");
  for (const [spec, re] of [
    [{ fractions: [0.5, 0.6] }, /add up to 1.1/],
    [{ fractions: [0.5] }, /1 fraction for 2 outlets/],
    [{ fractions: ["rest", "rest"] }, /only one outlet/],
    [{ fractions: [1.2, "rest"] }, /cannot be above 1/],
  ]) assert.throws(() => runUnit("splitter", { sys, inlets: { in: s }, spec }), err => err instanceof FugacityError && re.test(err.message));
  assert.throws(() => runUnit("separator", { sys, inlets: { in: s }, spec: { fractions: { ethanol: [1, 0] } } }), /missing: Water/);
  assert.throws(() => runUnit("separator", { sys, inlets: { in: s }, spec: { fractions: { benzene: [1, 0], ethanol: [1, 0], water: [0, 1] } } }), /not a component of this system/);
});

test("scaled and single-phase streams keep the state exactly", () => {
  const sys = system({ components: ["ethanol", "water"], model: "NRTL" });
  const s = stream(sys, { flow_kmol_h: { ethanol: 40, water: 60 }, P_kPa: 101.325, VF: 0.3 });
  const half = scaleStream(s, 0.5);
  close(half.F_kmol_h, 50, 1e-12, "half"); close(half.H_kW, s.H_kW / 2, 1e-9, "half H");
  const V = phaseStream(s, "vapour"), L = phaseStream(s, "liquid");
  close(V.F_kmol_h, 30, 1e-6, "vapour"); assert.equal(V.VF, 1); assert.equal(L.VF, 0);
  close(V.H_kW + L.H_kW, s.H_kW, 1e-9, "the phases carry the enthalpy");
  assert.equal(phaseStream(s, "liquid", 1).F_kmol_h, 0, "no second liquid: no flow");
});

test("ports and specifications are checked", () => {
  const sys = system({ components: ["ethanol", "water"], model: "NRTL" });
  const s = stream(sys, { flow_kmol_h: { ethanol: 1, water: 1 }, T_K: 300, P_kPa: 101.325 });
  const other = stream(system({ components: ["methanol", "water"], model: "NRTL" }), { flow_kmol_h: { methanol: 1 }, T_K: 300, P_kPa: 101.325 });
  for (const [type, args, re] of [
    ["flash", { inlets: {}, spec: { T_K: 350, P_kPa: 101.325 } }, /needs a stream/],
    ["heater", { inlets: { in: [s, s] }, spec: { T_K: 350 } }, /takes one stream/],
    ["flash", { inlets: { in: other }, spec: { T_K: 350, P_kPa: 101.325 } }, /does not belong to this system/],
    ["flash", { inlets: { feed: s }, spec: { T_K: 350, P_kPa: 101.325 } }, /no inlet port "feed"/],
    ["flash", { inlets: { in: s }, spec: { T_K: 350 } }, /give T_K and P_kPa/],
    ["flash", { inlets: { in: s }, spec: { P_kPa: 101.325, VF: 1.5 } }, /between 0 and 1/],
    ["feed", { spec: { T_K: 300, P_kPa: 100 } }, /give the flows/],
    ["splitter", { inlets: { in: s }, spec: { fractions: [1, 0] }, outletCount: 1 }, /at least 2 outlets/],
  ]) assert.throws(() => runUnit(type, { sys, ...args }), err => err instanceof FugacityError && re.test(err.message), `${type} ${JSON.stringify(args.spec)}`);
});

test("a new block type can be registered (a valve: isenthalpic pressure drop)", () => {
  registerUnit({
    type: "test-valve", label: "Valve", inlets: [{ port: "in" }], outlets: [{ port: "out" }],
    checkSpec: spec => ({ P_kPa: Number(spec.P_kPa) }),
    solve: ({ sys, inlets, spec }) => {
      const s = inlets.in[0];
      return { outlets: { out: stream(sys, { flow_kmol_h: s.flows, P_kPa: spec.P_kPa, H_kW: s.H_kW }) }, duty_kW: 0 };
    },
  });
  const sys = system({ components: ["ethanol", "water"], model: "NRTL" });
  const s = stream(sys, { flow_kmol_h: { ethanol: 40, water: 60 }, T_K: 370, P_kPa: 300 });
  const r = runUnit("test-valve", { sys, inlets: { in: s }, spec: { P_kPa: 101.325 } });
  assert.ok(r.outlets.out.VF > 0, "flashes on the pressure drop");
  close(r.outlets.out.H_kW, s.H_kW, 1e-6, "isenthalpic");
  assert.throws(() => registerUnit({ type: "test-valve", solve() {} }), /already registered/);
});

test("degrees of freedom: what each block needs, has, misses or has too much", async () => {
  const { specStatus } = await import("../src/index.js");
  const sys = system({ components: ["ethanol", "water"], model: "NRTL" });
  const cases = [
    // type, spec, outlets, needed, given, status
    ["feed", { flow_kmol_h: { water: 1 }, T_K: 300, P_kPa: 100 }, 1, 4, 4, "ok"],
    ["feed", { flow_kmol_h: { water: 1 }, T_K: 300 }, 1, 4, 3, "missing"],
    ["feed", { T_K: 300, P_kPa: 100 }, 1, 4, 2, "missing"],
    ["mixer", {}, 1, 0, 0, "ok"],
    ["splitter", { fractions: [0.3, "rest"] }, 2, 1, 1, "ok"],
    ["splitter", { fractions: [0.2, 0.3, "rest"] }, 3, 2, 2, "ok"],
    ["splitter", { fractions: [0.3] }, 2, 1, 1, "missing"],
    ["splitter", { fractions: [0.3, 0.3] }, 2, 1, 1, "invalid"],
    ["separator", { fractions: { ethanol: [0.9, "rest"], water: [0.1, "rest"] } }, 2, 2, 2, "ok"],
    ["separator", { fractions: { ethanol: [0.9, "rest"] } }, 2, 2, 1, "missing"],
    ["flash", { T_K: 350, P_kPa: 101.325 }, 2, 2, 2, "ok"],
    ["flash", { P_kPa: 101.325, duty_kW: 0 }, 2, 2, 2, "ok"],
    ["flash", { P_kPa: 101.325 }, 2, 2, 1, "missing"],
    ["flash", { P_kPa: 101.325, T_K: 350, VF: 0.5 }, 2, 2, 3, "extra"],
    ["heater", { T_K: 350 }, 1, 1, 1, "ok"],
    ["heater", { duty_kW: 100, dP_kPa: 5 }, 1, 1, 1, "ok"],
    ["heater", {}, 1, 1, 0, "missing"],
    ["heater", { T_K: 350, duty_kW: 5 }, 1, 1, 2, "extra"],
    ["product", {}, 0, 0, 0, "ok"],
  ];
  for (const [type, spec, n, needed, given, status] of cases) {
    const st = specStatus(type, spec, { sys, outletCount: n });
    const tag = `${type} ${JSON.stringify(spec)}`;
    assert.equal(st.status, status, `${tag}: ${st.message}`);
    assert.equal(st.needed, needed, `${tag}: needed`);
    assert.equal(st.given, given, `${tag}: given`);
    if (status !== "ok") assert.ok(st.message.length > 10, `${tag}: says why`);
  }
});
