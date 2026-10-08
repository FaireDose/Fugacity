// Solid-liquid equilibrium (proposal 0007, step 4; src/equilibrium/sle.js): the solubility of a pure solid in a
// liquid, the liquidus and the eutectic of a binary.
//  - the equation against the worked example of Gmehling et al. (Chemical Thermodynamics for Process Simulation,
//    2012) as carried by the `chemicals` library, and against chemicals.solubility_eutectic for other inputs;
//  - solubilities and eutectics with NRTL and UNIQUAC against the independent Python reference
//    (validation/python/reference_sle.py: chemicals + reference_model.System + scipy brentq);
//  - the ideal solubility against measured solubilities of the NIST TRC ThermoML Archive where the solvent is
//    chemically close to the solid (validation/data/sle/, docs/SLE_CHECKS.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { system, pure } from "../src/index.js";
import { sleRhs } from "../src/equilibrium/sle.js";

const ref = JSON.parse(readFileSync(new URL("../validation/fixtures/sle.json", import.meta.url)));
const rel = (a, b) => Math.abs(a / b - 1);

test("SLE equation: the worked example of Gmehling et al. (2012) and chemicals.solubility_eutectic", () => {
  // T = 260 K, Tm = 278.68 K, ΔHfus = 9952 J/mol, γ = 3.0176 -> x = 0.243400713 (chemicals docstring example)
  assert.ok(rel(Math.exp(sleRhs(278.68, 9952, 260)) / 3.0176, 0.243400713) < 1e-8);
  for (const c of ref.equation) {
    const x = Math.exp(sleRhs(c.Tm_K, c.Hfus_J_mol, c.T_K, c.dCp_J_molK)) / c.gamma;
    assert.ok(rel(x, c.x) < 1e-10, `${JSON.stringify(c)}: ${x}`);
  }
  // below the melting point the solubility is below 1, and it rises with temperature
  assert.ok(sleRhs(353.39, 19030, 300) < 0 && sleRhs(353.39, 19030, 300) < sleRhs(353.39, 19030, 330));
});

test("solubility with NRTL, UNIQUAC and ideal liquids agrees with the independent Python reference", () => {
  for (const c of ref.solubility) {
    const r = system({ components: c.components, model: c.model }).solidSolubility(c.solute, c.T_K);
    assert.ok(rel(r.xSolute, c.x) < 1e-7, `${c.model} ${c.components.join(" + ")} ${c.T_K} K: ${r.xSolute} vs ${c.x}`);
    assert.ok(Math.abs(r.x.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  }
});

test("eutectics of binaries agree with the independent Python reference", () => {
  for (const c of ref.eutectic) {
    const d = system({ components: c.components, model: c.model }).sleDiagram();
    assert.ok(Math.abs(d.eutectic.T_K - c.T_K) < 1e-6, `${c.model} ${c.components.join(" + ")}: ${d.eutectic.T_K} vs ${c.T_K} K`);
    assert.ok(Math.abs(d.eutectic.x1 - c.x1) < 1e-7 * Math.max(1, 1 / c.x1) * c.x1 + 1e-9, `${d.eutectic.x1} vs ${c.x1}`);
    // each liquidus ends at the pure solid's melting temperature and meets the other at the eutectic
    const [b1, b2] = d.branches;
    assert.ok(Math.abs(b1.points.at(-1).T_K - pure(c.components[0]).fusion.Tm_K) < 1e-9);
    assert.ok(Math.abs(b2.points[0].T_K - pure(c.components[1]).fusion.Tm_K) < 1e-9);
    assert.ok(Math.abs(b1.points[0].T_K - b2.points.at(-1).T_K) < 1e-6);
  }
});

test("ideal solubility against measured data where the solvent is chemically close to the solid", () => {
  // the data imply γ ≈ 1 here (docs/SLE_CHECKS.md); these check the melting data and the equation together, within
  // 10 % (median over the articles). In water or alkanes the same solids are far from ideal: an activity model with
  // parameters fitted to solid-liquid data is needed there (none yet).
  const close = [["naphthalene", "toluene"], ["benzoic-acid", "ethanol"], ["benzoic-acid", "1-butanol"],
    ["benzoic-acid", "2-propanol"], ["benzoic-acid", "acetone"]];
  const median = a => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
  for (const [solid, solvent] of close) {
    const data = JSON.parse(readFileSync(new URL(`../validation/data/sle/${solid}.json`, import.meta.url)));
    const s = system({ components: [solid, solvent], model: "ideal" });
    const byArticle = new Map();
    for (const set of data.sets.filter(x => x.solvent === solvent)) {
      for (const r of set.rows) {
        if (r.T_K >= s.fusion[0].Tm_K) continue;
        const x = s.solidSolubility(solid, r.T_K).xSolute;
        if (!byArticle.has(set.doi)) byArticle.set(set.doi, []);
        byArticle.get(set.doi).push(x / r.x_solute);
      }
    }
    assert.ok(byArticle.size >= 1, `${solid} + ${solvent}: no measured data`);
    const med = median([...byArticle.values()].map(median));
    assert.ok(Math.abs(med - 1) < 0.10, `${solid} in ${solvent}: ideal / measured ${med.toFixed(3)} (${byArticle.size} articles)`);
    // the same number as the report
    assert.ok(Math.abs(med - ref.measured_summary[solid][solvent].ratio) < 1e-6);
  }
});

test("solid solubility fails loudly: above the melting point, without melting data, with an equation of state", () => {
  const s = system({ components: ["naphthalene", "toluene"], model: "ideal" });
  assert.throws(() => s.solidSolubility("naphthalene", 360), /melts at 353\.39 K/);
  assert.throws(() => s.solidSolubility("toluene", 300), /Toluene melts at 177\.97 K/);
  assert.throws(() => s.solidSolubility("acetone", 300), /not a component/);
  assert.throws(() => system({ components: ["2-methoxyethanol", "water"], model: "ideal" }).solidSolubility("2-methoxyethanol", 200),
    /no melting temperature and enthalpy of fusion/);
  assert.throws(() => system({ components: ["naphthalene", "toluene"], model: "PR" }).solidSolubility("naphthalene", 300),
    /activity model/);
  // three components need the solvent composition
  const t = system({ components: ["naphthalene", "toluene", "benzene"], model: "ideal" });
  assert.throws(() => t.solidSolubility("naphthalene", 300), /solvent composition/);
  const r = t.solidSolubility("naphthalene", 300, { solvent: [0.5, 0.5] });
  assert.ok(Math.abs(r.x[1] - r.x[2]) < 1e-12 && rel(r.xSolute, r.xIdeal) < 1e-9);
});

test("every component's melting data have a source, or say there are no open data", () => {
  const comps = JSON.parse(readFileSync(new URL("../src/data/components.json", import.meta.url))).components;
  let withData = 0;
  for (const [id, c] of Object.entries(comps)) {
    assert.ok(c.fusion, `${id}: no fusion record`);
    if (c.fusion.available === false) { assert.ok(c.fusion.searched.length >= 2, id); continue; }
    assert.ok(c.fusion.Tm_K > 0 && c.fusion.Hfus_J_mol > 0, id);
    assert.ok(c.fusion.Tm_K < c.Tc_K, id);
    assert.ok(/NIST Chemistry WebBook|ChemSep/.test(c.fusion.source.name), id);
    assert.ok(c.fusion.source_ids?.length, `${id}: source_ids`);
    withData++;
  }
  assert.ok(withData >= 90, `${withData} components with melting data`);
});

test("NRTL sets fitted to measured solubilities reproduce the data as their records state, inside their valid range", () => {
  // validation/python/fit_sle.py, docs/SLE_FITS.md: each record states the median of the articles' median
  // deviations |x / x_measured − 1| and its valid temperature range; the engine must give the same numbers
  const binaries = JSON.parse(readFileSync(new URL("../src/data/binaries.json", import.meta.url))).pairs;
  const sets = binaries.filter(p => p.set === "fitted-sle-thermoml");
  assert.ok(sets.length >= 20, `${sets.length} fitted solid-liquid sets`);
  const median = a => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
  for (const p of sets) {
    assert.equal(p.tier, "fitted");
    assert.match(p.source, /not checked against vapour-liquid data/);
    const stated = Number(p.source.match(/median of the articles ([\d.]+) %/)[1]) / 100;
    assert.ok(stated <= 0.15, `${p.i} + ${p.j}: ${stated}`);
    const data = JSON.parse(readFileSync(new URL(`../validation/data/sle/${p.i}.json`, import.meta.url)));
    const s = system({ components: [p.i, p.j], model: "NRTL" });
    const byArticle = new Map();
    for (const set of data.sets.filter(x => x.solvent === p.j)) {
      for (const r of set.rows) {
        if (r.T_K > p.valid.T_K[1] + 1e-9 || r.T_K >= s.fusion[0].Tm_K) continue;
        const x = s.solidSolubility(p.i, r.T_K).xSolute;
        if (!byArticle.has(set.doi)) byArticle.set(set.doi, []);
        byArticle.get(set.doi).push(Math.abs(x / r.x_solute - 1));
      }
    }
    const med = median([...byArticle.values()].map(median));
    assert.ok(Math.abs(med - stated) < 0.0006, `${p.i} + ${p.j}: engine ${(100 * med).toFixed(2)} %, record ${(100 * stated).toFixed(1)} %`);
  }
  // the fitted sets are the defaults: the solid views use them instead of the ideal solution
  const bw = system({ components: ["benzoic-acid", "water"], model: "NRTL" }).solidSolubility("benzoic-acid", 298.15);
  assert.ok(bw.gamma > 50, "benzoic acid in water is far from ideal");
});
