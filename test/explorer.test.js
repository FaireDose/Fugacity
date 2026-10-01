// Property explorer: unit conversions and curve sampling (the DOM-free part of the view).
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../src/thermo/correlations.js";
import { pure, listComponents, PROPERTY_NAMES, mountProperties } from "../src/index.js";
import {
  normalizeUnits, toDisplay, unitLabel, tToDisplay, tFromDisplay, pToDisplay, pFromDisplay, parsePressures,
  explorerProperties, findExplorerProperty, STATE_PROPERTIES, sampleTemperatureProperty, sampleStateProperty,
  stateDomain, statePoint, saturationTable, singleState, niceValues, logTicks, fmtNum, fmtShort, linspace,
} from "../src/ui/properties-logic.js";

const SI = normalizeUnits({ T: "K", P: "kPa", energy: "J/mol", viscosity: "Pa s" });
const DEF = normalizeUnits();
const inside = (r, T) => T >= r.Tmin_K - 1e-9 && T <= r.Tmax_K + 1e-9;
const close = (a, b, rel = 1e-12) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

test("unit conversions are exact definitions and convert back", () => {
  // 0 °C = 273.15 K and 1 bar = 100 kPa (SI Brochure, 9th ed.)
  assert.equal(tToDisplay(373.15, DEF), 100);
  assert.equal(tToDisplay(373.15, SI), 373.15);
  assert.ok(close(tFromDisplay(tToDisplay(351.4, DEF), DEF), 351.4));
  assert.equal(pToDisplay(101.325, DEF), 1.01325);
  assert.equal(pFromDisplay(10, DEF), 1000);
  assert.equal(pToDisplay(101.325, SI), 101.325);
  // molar -> mass basis: (J/mol)/(g/mol) = kJ/kg
  const MW = 18.01528;
  assert.ok(close(toDisplay("energy", 40650, DEF, MW), 40650 / MW));
  assert.equal(toDisplay("energy", 40650, SI, MW), 40650);
  assert.ok(close(toDisplay("heatCapacity", 75.3, DEF, MW), 75.3 / MW));
  assert.ok(close(toDisplay("viscosity", 2.82e-4, DEF), 0.282));
  assert.equal(toDisplay("viscosity", 2.82e-4, SI), 2.82e-4);
  assert.ok(close(toDisplay("surfaceTension", 0.0589, DEF), 58.9));
  assert.equal(toDisplay("density", 958.4, DEF), 958.4);
  assert.equal(toDisplay("energy", null, DEF, MW), null);
  assert.throws(() => toDisplay("energy", 1, DEF), /molar mass/);
  assert.equal(unitLabel("energy", DEF), "kJ/kg");
  assert.equal(unitLabel("energy", SI), "J/mol");
  assert.equal(unitLabel("viscosity", DEF), "mPa·s");
});

test("unit names are normalized, and a typo is refused", () => {
  assert.deepEqual(normalizeUnits({ T: "°C", P: "kPa", energy: "kJ/kg", viscosity: "cP" }), { T: "C", P: "kPa", basis: "mass", viscosity: "mPa s" });
  assert.deepEqual(normalizeUnits({ viscosity: "Pa·s" }, SI), { ...SI });
  assert.throws(() => normalizeUnits({ P: "psi" }), /Unknown P unit "psi"/);
});

test("pressure lists are parsed in the display unit and returned in kPa", () => {
  assert.deepEqual(parsePressures("1, 5, 10", DEF), [100, 500, 1000]);
  assert.deepEqual(parsePressures("10;1 5 5 x -2", DEF), [100, 500, 1000]);
  assert.deepEqual(parsePressures("101.325", SI), [101.325]);
  assert.equal(parsePressures("1 2 3 4 5 6 7 8", DEF).length, 6);
  assert.deepEqual(parsePressures("abc", DEF), []);
});

test("the property list covers vapour pressure, every PROPERTIES entry and the props() fields", () => {
  const keys = explorerProperties().map(p => p.key);
  for (const n of ["vapourPressure", ...PROPERTY_NAMES, ...Object.keys(STATE_PROPERTIES)]) assert.ok(keys.includes(n), n);
  assert.equal(findExplorerProperty("PSAT").key, "vapourPressure");
  assert.equal(findExplorerProperty("Enthalpy").kind, "state");
  assert.throws(() => findExplorerProperty("entropy"), /Unknown property "entropy"/);
});

test("axis and table helpers", () => {
  assert.deepEqual(linspace(1, 2, 3), [1, 1.5, 2]);
  assert.deepEqual(niceValues(0.01, 250, 10), [25, 50, 75, 100, 125, 150, 175, 200, 225, 250]);
  assert.deepEqual(logTicks(0.05, 2000), [0.1, 1, 10, 100, 1000]);
  assert.deepEqual(logTicks(0.9, 60), [1, 3, 10, 30]);
  assert.deepEqual(logTicks(0.9, 8), [1, 2, 5]);
  assert.equal(fmtNum(958.43), "958.4");
  assert.equal(fmtNum(2.82e-4), "2.820e-4");
  assert.equal(fmtNum(null), "–");
  assert.equal(fmtShort(1.0), "1");
  assert.equal(fmtShort(99.6145, 4), "99.61");
});

// ---------------------------------------------------------------------------------------
// A stand-in for pure("water") with test records, so the range rules can be checked on any
// branch. Its vapour pressure is the real one; its props() deliberately EXTRAPOLATES the
// liquid density and the ideal-gas heat capacity, so the sampler's own range check is tested.
const W = pure("water");
const REC = {
  vapourPressure: W.record("vapourPressure"),
  liquidDensity: { equation: "DIPPR100", coefficients: { A: 1100, B: -0.4 }, units: "kg/m3", Tmin_K: 300, Tmax_K: 420, tier: "fitted", source: "test record" },
  idealGasHeatCapacity: { equation: "DIPPR100", coefficients: { A: 33.6 }, units: "J/mol/K", Tmin_K: 350, Tmax_K: 600, tier: "fitted", source: "test record" },
};
const fake = {
  id: "water", name: "Water", MW: W.MW, Tc_K: W.Tc_K, Tb_K: W.Tb_K,
  record: n => REC[n] ?? null,
  has: n => n in REC,
  psat: T => W.psat(T),
  property(n, T) {
    if (!REC[n]) throw new Error(`No open data for ${n} of Water (searched: CoolProp, NIST WebBook).`);
    const v = evaluate(REC[n], T);
    return n === "vapourPressure" ? v / 1000 : v;
  },
  props(T, P) {
    const out = { T_K: T, P_kPa: P, notes: [], sources: {} };
    let ps = null;
    try { ps = W.psat(T); } catch (e) { out.notes.push(e.message); }
    out.phase = T >= W.Tc_K ? "supercritical" : ps === null ? null : P >= ps ? "liquid" : "vapour";
    if (!out.phase) return out;
    if (out.phase === "liquid") {
      out.rho_kg_m3 = evaluate(REC.liquidDensity, T, { extrapolate: true });
      out.sources.rho_kg_m3 = { tier: "fitted", source: "test record" };
      out.cp_J_molK = null;
    } else {
      out.rho_kg_m3 = P * W.MW / (8.314462618 * T);
      out.sources.rho_kg_m3 = { tier: "standard", source: "Ideal-gas law" };
      out.cp_J_molK = evaluate(REC.idealGasHeatCapacity, T, { extrapolate: true });
      out.sources.cp_J_molK = { tier: "fitted", source: "test record" };
    }
    return out;
  },
};

test("temperature-only curves never leave the record's range", () => {
  const all = sampleTemperatureProperty(fake, "liquidDensity");
  assert.equal(all.points[0].T, 300);
  assert.equal(all.points.at(-1).T, 420);
  const narrow = sampleTemperatureProperty(fake, "liquidDensity", { Tmin: 250, Tmax: 350 });
  assert.equal(narrow.points[0].T, 300);
  assert.equal(narrow.points.at(-1).T, 350);
  assert.ok(narrow.points.every(p => inside(REC.liquidDensity, p.T)));
  assert.equal(sampleTemperatureProperty(fake, "liquidDensity", { Tmin: 500, Tmax: 600 }).points.length, 0);
  const miss = sampleTemperatureProperty(fake, "liquidViscosity");
  assert.equal(miss.available, false);
  assert.match(miss.message, /searched: CoolProp/);
});

test("state curves: phase change at the boiling point, nothing outside the records' ranges", () => {
  for (const P of [100, 500, 1000]) {
    const r = sampleStateProperty(fake, "density", P, { Tmin: 280, Tmax: 600 });
    const Tb = W.tsat(P);
    assert.equal(r.transitions.length, 1, `${P} kPa`);
    assert.ok(Math.abs(r.transitions[0].T - Tb) < 1e-4, `${r.transitions[0].T} vs ${Tb}`);
    assert.equal(r.transitions[0].kind, "boiling");
    const liq = r.segments.filter(s => s.cls === "liquid").flatMap(s => s.points);
    const gas = r.segments.filter(s => s.cls === "gas").flatMap(s => s.points);
    // the fake props() extrapolates below 300 K: those points must be dropped
    assert.ok(liq.length > 0 && liq.every(p => inside(REC.liquidDensity, p.T) && p.T < Tb));
    if (Tb <= REC.liquidDensity.Tmax_K) {
      assert.ok(Math.abs(liq.at(-1).T - Tb) < 1e-3, "liquid curve runs up to the boiling point");
      assert.ok(Math.abs(r.transitions[0].vFrom - evaluate(REC.liquidDensity, Tb)) < 1e-3);
    } else {
      assert.ok(liq.at(-1).T <= REC.liquidDensity.Tmax_K, "liquid curve stops at the end of its data");
      assert.equal(r.transitions[0].vFrom, null, "no liquid value at Tb beyond the data");
    }
    assert.ok(gas.every(p => p.T > Tb && close(p.v, P * W.MW / (8.314462618 * p.T))), "ideal gas above Tb");
    assert.ok(r.gaps.some(g => g.reason === "data" && g.cls === "liquid" && g.T1 < 300));
  }
  const cp = sampleStateProperty(fake, "cp", 100, { Tmin: 280, Tmax: 700 });
  const gas = cp.segments.flatMap(s => s.points);
  assert.ok(gas.length > 0 && gas.every(p => inside(REC.idealGasHeatCapacity, p.T)), "cp° range respected");
  assert.equal(statePoint(fake, "cp", 650, 100).v, null);
});

test("saturation table and single state follow the same rules", () => {
  const tab = saturationTable(fake, DEF);
  assert.ok(tab.rows.length >= 8);
  for (const r of tab.rows) {
    assert.ok(Number.isInteger(+tToDisplay(r.T, DEF).toFixed(9)), "round °C values");
    assert.ok(inside(REC.vapourPressure, r.T) && r.T < W.Tc_K);
    assert.ok(close(r.psat, W.psat(r.T)));
    if (r.rhoL != null) assert.ok(inside(REC.liquidDensity, r.T));
    assert.ok(r.rhoV > 0);
  }
  assert.ok(tab.columns.includes("rhoL") && tab.columns.includes("rhoV"));
  const s = singleState(fake, 290, 101.325);
  assert.equal(s.phase, "liquid");
  assert.equal(s.rho_kg_m3, null);
  assert.deepEqual(s.outOfRange, ["rho_kg_m3"]);
});

// The real engine, on whatever data this branch has: every sampled point respects the
// ranges of the records it depends on (or comes from an official standard).
test("real components: no sampled point outside a record's range", () => {
  for (const c of listComponents()) {
    const p = pure(c.id);
    for (const name of ["vapourPressure", ...PROPERTY_NAMES]) {
      const r = sampleTemperatureProperty(p, name, { n: 40 });
      if (!r.available) { assert.ok(r.message.length > 0); continue; }
      assert.ok(r.points.every(q => inside(r.record, q.T)), `${c.name} ${name}`);
    }
    for (const key of Object.keys(STATE_PROPERTIES)) {
      const dom = stateDomain(p, key);
      if (!dom) continue;
      for (const P of [100, 1000]) {
        const r = sampleStateProperty(p, key, P, { Tmin: dom[0], Tmax: dom[1], n: 40 });
        for (const seg of r.segments) for (const q of seg.points) {
          const st = p.props(q.T, P);
          if (st.sources?.[STATE_PROPERTIES[key].field]?.tier === "standard") continue;
          for (const dep of STATE_PROPERTIES[key].depends[seg.cls]) {
            const rec = p.record(dep);
            if (rec) assert.ok(inside(rec, q.T), `${c.name} ${key} ${P} kPa: ${q.T} K outside ${dep}`);
          }
        }
      }
    }
  }
});

test("mountProperties is exported", () => {
  assert.equal(typeof mountProperties, "function");
});
