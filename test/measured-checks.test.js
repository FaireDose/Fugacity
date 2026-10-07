// Records from a databank or an equation of state against measured data (proposal 0008, Part B): the
// pure-component values of the NIST TRC ThermoML Archive in validation/data/pure/measured/thermoml_<id>.json
// (validation/python/check_measured.py). These values were not used to make the records, except for the few
// records fitted to them where the databank missed the tolerance (MEASURED_REFIT in fit_properties.py, marked in
// docs/MEASURED_CHECKS.md): for those the comparison only confirms the fit.
//
// Rules, as in check_measured.py and docs/MEASURED_CHECKS.md: liquid values at 110 kPa or less, inside the
// record's temperature range, with a stated uncertainty no larger than the tolerance of the engineering
// report (proposal 0002: vapour pressure 1 %, liquid density 1 %, heat capacity 2 %, heat of vaporization 2 %,
// viscosity 5 %, thermal conductivity 5 %). Each article counts once (the median of its deviations). Above the
// tolerance the report warns (a reviewer looks at it); above three times the tolerance, with at least three
// articles, this test fails.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { evaluate } from "../src/thermo/correlations.js";

const components = JSON.parse(readFileSync(new URL("../src/data/components.json", import.meta.url))).components;
// every component with measured data, except those built from these values themselves (measured_components.py)
const MEASURED_DIR = new URL("../validation/data/pure/measured/", import.meta.url);
const CHECKED = readdirSync(MEASURED_DIR).filter(f => /^thermoml_.*\.json$/.test(f)).map(f => f.slice(9, -5))
  .filter(id => components[id] && !/Measured data only/.test(components[id].constants_source ?? ""));
const PROPS = {
  "Vapor or sublimation pressure, kPa": ["vapourPressure", 1000, 0.01],
  "Mass density, kg/m3": ["liquidDensity", 1, 0.01],
  "Molar heat capacity at constant pressure, J/K/mol": ["liquidHeatCapacity", 1, 0.02],
  "Molar enthalpy of vaporization or sublimation, kJ/mol": ["heatOfVaporization", 1000, 0.02],
  "Viscosity, Pa*s": ["liquidViscosity", 1, 0.05],
  "Thermal conductivity, W/m/K": ["liquidThermalConductivity", 1, 0.05],
};
const median = a => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

function recordOf(id, name) {
  const c = components[id];
  if (name !== "vapourPressure") return c.properties[name]?.available === false ? null : c.properties[name];
  const v = c.vapourPressure;
  return { equation: v.equation, coefficients: { A: v.A, B: v.B, C: v.C, D: v.D, E: v.E }, Tmin_K: v.Tmin_K, Tmax_K: v.Tmax_K };
}

test("databank and equation-of-state records agree with the measured data of the ThermoML Archive", () => {
  let checked = 0;
  for (const id of CHECKED) {
    const file = new URL(`../validation/data/pure/measured/thermoml_${id}.json`, import.meta.url);
    assert.ok(existsSync(file), `${id}: no measured data file`);
    const data = JSON.parse(readFileSync(file));
    for (const [prop, [name, factor, tol]] of Object.entries(PROPS)) {
      const rec = recordOf(id, name);
      if (!rec) continue;
      const seen = new Set();
      const byArticle = new Map();
      for (const r of data.rows) {
        if (r.property !== prop || r.T_K == null || !r.phases.includes("Liquid") || r.phases.includes("Crystal")) continue;
        if (!["vapourPressure", "heatOfVaporization"].includes(name) && (r.phases.includes("Gas") || (r.P_kPa ?? 0) > 110)) continue;
        if (r.T_K < rec.Tmin_K - 1e-6 || r.T_K > rec.Tmax_K + 1e-6) continue;
        if (r.uncertainty && r.uncertainty / r.value > tol) continue;
        const key = `${r.doi}|${r.T_K}|${r.value}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const dev = evaluate(rec, r.T_K) / (r.value * factor) - 1;
        if (!byArticle.has(r.doi)) byArticle.set(r.doi, []);
        byArticle.get(r.doi).push(dev);
      }
      if ([...byArticle.values()].flat().length < 3) continue;
      const med = median([...byArticle.values()].map(d => Math.abs(median(d))));
      // with fewer than three articles the median cannot single out a discordant article: reported, not failed
      assert.ok(med <= 3 * tol || byArticle.size < 3, `${id} ${name}: median deviation of ${byArticle.size} articles ${(100 * med).toFixed(2)} % ` +
        `(tolerance ${100 * tol} %)`);
      // the record states the comparison
      const stated = name === "vapourPressure" ? components[id].vapourPressure.measuredCheck : rec.source.measuredCheck;
      assert.match(stated ?? "", /ThermoML Archive/, `${id} ${name}: measuredCheck`);
      checked++;
    }
  }
  assert.ok(checked >= 30, `only ${checked} records compared`);
});
