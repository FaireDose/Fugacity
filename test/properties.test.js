// Pure-component temperature correlations (proposal 0002): the records in
// src/data/components.json against the source points stored in validation/data/pure/.
//
// The points were sampled from each record's source (CoolProp 8.0.0, the NIST WebBook tables,
// or the ChemSep v8.3 correlations) by validation/python/fit_properties.py, which is the
// independent calculation; this test needs neither CoolProp nor Python.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { evaluate } from "../src/thermo/correlations.js";
import { pure, listComponents, PROPERTIES, PROPERTY_NAMES } from "../src/index.js";

const components = JSON.parse(readFileSync(new URL("../src/data/components.json", import.meta.url))).components;
const POINTS_DIR = new URL("../validation/data/pure/", import.meta.url);
const points = Object.fromEntries(readdirSync(POINTS_DIR).filter(f => f.endsWith(".json"))
  .map(f => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(new URL(f, POINTS_DIR)))]));

// gases at 25 °C and 1 atm (normal boiling point below 298.15 K): their vapour-pressure records are fitted
// with the other properties; the six of v0.2 and the ten of proposal 0004, batch 1
// (carbon dioxide has no normal boiling point: Tb_K is null, it has no liquid at 1 atm)
const GASES = listComponents().map(c => c.id).filter(id => (components[id].Tb_K ?? 0) < 298.15);
const TRANSPORT = new Set(["liquidViscosity", "vapourViscosity", "liquidThermalConductivity", "vapourThermalConductivity"]);
const TIERS = new Set(["standard", "fitted", "databank", "predicted"]);

/** The record as correlations.js evaluates it (the gases' vapour pressure is stored flat). */
function recordOf(id, name) {
  const c = components[id];
  if (name !== "vapourPressure") return c.properties[name];
  const v = c.vapourPressure;
  return { equation: v.equation, units: "Pa", coefficients: { A: v.A, B: v.B, C: v.C, D: v.D, E: v.E },
    Tmin_K: v.Tmin_K, Tmax_K: v.Tmax_K, source: v.source };
}

/** Maximum deviation stated in the record, as a fraction. */
function statedMaxDeviation(rec) {
  const text = typeof rec.source === "string" ? rec.source : rec.source.fit;
  const m = /(?:max deviation|within) ([0-9.]+) %/.exec(text);
  assert.ok(m, `no maximum deviation stated in: ${text}`);
  return Number(m[1]) / 100;
}

test("every component has every property, as a record or an explicit 'no open data' marker", () => {
  assert.equal(listComponents().length, 51);
  assert.equal(GASES.length, 16);
  for (const { id, name } of listComponents()) {
    const props = components[id].properties;
    assert.ok(props, `${name}: no properties object`);
    for (const p of PROPERTY_NAMES) {
      const r = props[p];
      assert.ok(r, `${name}: ${p} is neither a record nor a "no open data" marker`);
      if (r.available === false) {
        assert.ok(Array.isArray(r.searched) && r.searched.length > 0, `${name} ${p}: list the sources searched`);
      }
    }
    for (const p of Object.keys(props)) assert.ok(PROPERTIES[p], `${name}: unknown property ${p}`);
    pure(id); // the loader also refuses wrong units
  }
});

test("records are complete: units, range, tier, source and stated fit quality", () => {
  for (const { id, name } of listComponents()) {
    for (const [p, r] of Object.entries(components[id].properties)) {
      if (r.available === false) continue;
      const where = `${name} ${p}`;
      assert.equal(r.units, PROPERTIES[p].recordUnits, `${where}: units`);
      assert.ok(r.Tmin_K > 0 && r.Tmax_K > r.Tmin_K, `${where}: range`);
      assert.ok(TIERS.has(r.tier), `${where}: tier ${r.tier}`);
      for (const k of ["name", "reference", "access", "fit"]) assert.ok(r.source?.[k], `${where}: source.${k}`);
      if (r.equation === "DIPPR106") assert.ok(r.Tc_K > r.Tmax_K - 1e-9, `${where}: Tc_K`);
      // targets of the task: 1 % for thermodynamic properties, 3 % for transport properties
      const target = TRANSPORT.has(p) ? 0.03 : 0.01;
      assert.ok(statedMaxDeviation(r) <= target, `${where}: stated deviation above the ${target * 100} % target`);
    }
  }
});

test("stored coefficients reproduce the source points within the stated maximum deviation", () => {
  let n = 0;
  for (const { id, name } of listComponents()) {
    const file = points[id];
    assert.ok(file, `${name}: no validation/data/pure/${id}.json`);
    for (const [p, pts] of Object.entries(file.records)) {
      const rec = recordOf(id, p);
      assert.ok(rec, `${name}: points for ${p} but no record`);
      assert.equal(pts.units, rec.units, `${name} ${p}: units of the points`);
      // stored points are rounded to 8 significant digits
      const tol = statedMaxDeviation(rec) + 2e-7;
      pts.T_K.forEach((T, i) => {
        const got = evaluate(rec, T);
        const dev = Math.abs(got / pts.values[i] - 1);
        assert.ok(dev <= tol, `${name} ${p} at ${T} K: ${got} vs ${pts.values[i]} (${(dev * 100).toFixed(3)} %)`);
        n++;
      });
    }
    for (const p of PROPERTY_NAMES) {
      if (components[id].properties[p].available !== false) assert.ok(file.records[p], `${name}: no source points for ${p}`);
    }
  }
  assert.ok(n > 5000, `only ${n} points checked`);
});

test("correlations are finite and positive over their whole range", () => {
  for (const { id, name } of listComponents()) {
    const names = [...PROPERTY_NAMES, ...(GASES.includes(id) ? ["vapourPressure"] : [])];
    for (const p of names) {
      const rec = recordOf(id, p);
      if (!rec || rec.available === false) continue;
      for (let k = 0; k <= 400; k++) {
        const T = rec.Tmin_K + (rec.Tmax_K - rec.Tmin_K) * k / 400;
        const v = evaluate(rec, T);
        assert.ok(Number.isFinite(v) && v > 0, `${name} ${p} at ${T} K: ${v}`);
      }
    }
  }
});

test("the gases' vapour pressures give their normal boiling points within 0.1 K", () => {
  for (const id of GASES) {
    const p = pure(id);
    const vp = components[id].vapourPressure;
    assert.equal(vp.equation, "DIPPR101");
    assert.equal(vp.tier, "fitted");
    if (p.Tb_K == null) {
      // no liquid at 1 atm: the vapour-pressure curve starts above 101.325 kPa, and the record says why
      assert.ok(p.psat(vp.Tmin_K) > 101.325, p.name);
      assert.match(components[id].constants_source, /No normal boiling point/, p.name);
      continue;
    }
    const tb = p.tsat(101.325);
    assert.ok(Math.abs(tb - p.Tb_K) < 0.1, `${p.name}: Tb ${tb.toFixed(3)} K vs ${p.Tb_K} K`);
    assert.ok(Math.abs(tb - points[id].records.vapourPressure.Tb_K_at_101325Pa) < 0.1);
  }
});

// Enthalpy: h(liquid) = h°(T) - ΔHvap(T) in pure.js is not asserted for acetic acid. Its ideal-gas cp
// is the monomer's and its ΔHvap is to the real, largely dimerized vapour, so that h is not consistent
// (review of #12, finding 1; the fix needs the vapour association / equation of state, #13).
const ENTHALPY_NOT_CONSISTENT = new Set(["acetic-acid"]);

test("props() returns liquid and vapour properties for every component at a typical state", () => {
  // styrene at 25 °C: below its measured vapour pressure, so the liquid enthalpy is refused with a reason
  assert.match(pure("styrene").props(298.15, 101.325).notes.join(" "), /outside the range/);
  for (const { id, name } of listComponents()) {
    const p = pure(id);
    const isGas = GASES.includes(id);
    // liquid: 25 °C for the liquids (acetic acid: 30 °C, above its melting point), below Tb for the gases
    // without a normal boiling point (carbon dioxide): midway along the vapour-pressure curve, at twice the
    // vapour pressure for the liquid and a hundredth of it for the vapour
    const vp = components[id].vapourPressure;
    const Tmid = p.Tb_K == null ? 0.5 * (vp.Tmin_K + vp.Tmax_K) : null;
    // for a gas, Tb - 5 K, but at least 1 K above the triple point (argon: Tb is only 3.5 K above it); for a
    // liquid, 25 °C, or the lowest temperature of its vapour-pressure and liquid-density records when they start
    // above it: styrene (303.07 K: below it there is no open measured vapour pressure, and props() says so) and
    // phenol (a solid at 25 °C; its liquid records start at the triple point, 314.06 K)
    const rhoL = components[id].properties.liquidDensity;
    const TL = Tmid ?? (isGas ? Math.max(p.Tb_K - 5, vp.Tmin_K + 1) : id === "acetic-acid" ? 303.15
      : Math.max(298.15, vp.Tmin_K, rhoL.Tmin_K ?? 0));
    const L = p.props(TL, Tmid ? 2 * p.psat(Tmid) : 101.325);
    assert.equal(L.phase, "liquid", name);
    const hKeys = ENTHALPY_NOT_CONSISTENT.has(id) ? [] : ["h_J_mol"];
    // a property with an explicit "no open data" marker (propylene glycol: transport properties) is null, with
    // a note that says so; every other one has a value
    const none = new Set(Object.entries(components[id].properties).filter(([, r]) => r.available === false).map(([k]) => k));
    // the enthalpy needs the ideal-gas heat capacity: without it (2-methoxyethanol, no open data) h is null too
    const recordOf_ = { rho_kg_m3: "liquidDensity", cp_J_molK: "liquidHeatCapacity", dHvap_J_mol: "heatOfVaporization",
      mu_Pa_s: "liquidViscosity", k_W_mK: "liquidThermalConductivity", h_J_mol: "idealGasHeatCapacity" };
    for (const k of ["rho_kg_m3", "cp_J_molK", "dHvap_J_mol", "mu_Pa_s", "k_W_mK", ...hKeys]) {
      if (none.has(recordOf_[k])) { assert.equal(L[k], null, `${name} liquid ${k}`); assert.match(L.notes.join(" "), /No open data/); continue; }
      assert.ok(Number.isFinite(L[k]), `${name} liquid ${k}: ${L.notes.join(" ")}`);
    }
    // vapour: 10 K above the normal boiling point at 1 kPa
    const V = Tmid ? p.props(Tmid, p.psat(Tmid) / 100) : p.props(p.Tb_K + 10, 1);
    assert.equal(V.phase, "vapour", name);
    const recordOfV = { cp_J_molK: "idealGasHeatCapacity", mu_Pa_s: "vapourViscosity", k_W_mK: "vapourThermalConductivity",
      h_J_mol: "idealGasHeatCapacity" };
    for (const k of ["cp_J_molK", "mu_Pa_s", "k_W_mK", ...hKeys]) {
      if (none.has(recordOfV[k])) { assert.equal(V[k], null, `${name} vapour ${k}`); continue; }
      assert.ok(Number.isFinite(V[k]), `${name} vapour ${k}: ${V.notes.join(" ")}`);
    }
  }
});

test("the acetic-acid records carry the enthalpy-consistency warning", () => {
  const props = components["acetic-acid"].properties;
  assert.match(props.idealGasHeatCapacity.source.notes, /[Mm]onomer/);
  assert.match(props.heatOfVaporization.source.notes, /dimerized/);
});

// Measured data, independent of the sources the records were fitted to: NIST WebBook liquid heat
// capacities at 25 °C and heats of vaporization at the normal boiling point
// (validation/data/pure/measured/webbook.json, with the rules and references). Tolerance 2 %, the
// heat-capacity and heat-of-vaporization tolerances of the engineering report in proposal 0002.
test("records agree with measured data from the NIST WebBook within 2 %", () => {
  const M = JSON.parse(readFileSync(new URL("measured/webbook.json", POINTS_DIR)));
  let n = 0;
  for (const [id, e] of Object.entries(M.liquidHeatCapacity)) {
    const used = e.values.filter(v => v.year >= 1970 && Math.abs(v.T_K - 298.15) <= 0.5);
    assert.ok(used.length > 0, id);
    const mean = used.reduce((s, v) => s + v.cp_J_molK, 0) / used.length;
    const got = pure(id).property("liquidHeatCapacity", 298.15);
    const dev = got / mean - 1;
    assert.ok(Math.abs(dev) <= M.tolerance.liquidHeatCapacity,
      `${id} cpL(298.15 K) ${got.toFixed(2)} vs measured mean ${mean.toFixed(2)} J/(mol K): ${(dev * 100).toFixed(2)} %`);
    n++;
  }
  for (const [id, e] of Object.entries(M.heatOfVaporization)) {
    const got = pure(id).property("heatOfVaporization", e.T_K) / 1000;
    const dev = got / e.dHvap_kJ_mol - 1;
    assert.ok(Math.abs(dev) <= M.tolerance.heatOfVaporization,
      `${id} ΔHvap(${e.T_K} K) ${got.toFixed(3)} vs ${e.dHvap_kJ_mol} kJ/mol: ${(dev * 100).toFixed(2)} %`);
    n++;
  }
  assert.ok(n >= 12, `only ${n} comparisons`);
});
