// Engineering report (scripts/engineering-report.mjs): comparison logic and feature detection.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deviation, withinTolerance, classify, NotAvailable, runCases, compare, renderMarkdown, renderHtml,
  loadCases, loadReferences, formatDeviation, MAX_MARKDOWN,
} from "../scripts/engineering-report.mjs";
import * as CHEPTA from "../src/index.js";

const tolerances = {
  rel1: { rel: 0.01 }, abs05: { abs: 0.5, unit: "K" }, info5: { rel: 0.05, informational: true },
};

test("deviation and tolerance: relative and absolute", () => {
  assert.equal(deviation(101, 100, { rel: 0.01 }), 0.01);
  assert.equal(withinTolerance(0.01, { rel: 0.01 }), true);
  assert.equal(withinTolerance(-0.0101, { rel: 0.01 }), false);
  assert.ok(Math.abs(deviation(78.6, 78.1, { abs: 1 }) - 0.5) < 1e-12);
  assert.equal(withinTolerance(-0.6, { abs: 0.5 }), false);
  assert.equal(deviation(1, null, { rel: 0.01 }), null);
  assert.equal(withinTolerance(null, { rel: 0.01 }), null);
  assert.equal(formatDeviation(-0.0123, { rel: 0.01 }, "rho_kg_m3"), "−1.23 %");
  assert.equal(formatDeviation(0.25, { abs: 0.5 }, "T_C"), "+0.25 K");
});

test("errors are classified: missing feature or data is 'not available', the rest is an error", () => {
  assert.equal(classify(new NotAvailable("x")).status, "na");
  assert.equal(classify(new Error("Liquid density of Oxygen is not in the databank yet.")).status, "na");
  assert.equal(classify(new Error('Unknown model "PR". Use one of: NRTL, UNIQUAC, ideal.')).status, "na");
  assert.equal(classify(new RangeError("T = 700 K is outside the range")).status, "na");
  assert.equal(classify(new Error("bubble point did not converge")).status, "error");
});

// A fake bundle like v0.1: system() with activity models only; no pure(), no steam(), no "PR".
const fakeV01 = {
  version: "0.0.1",
  system({ components, model }) {
    if (model === "PR") throw new Error(`Unknown model "${model}". Use one of: NRTL, UNIQUAC, ideal.`);
    return {
      boilingPoints: () => [351.0, 373.15],
      psat: () => [7.9, 3.17],
      azeotropes: () => [{ T: 351.3, x: 0.9, type: "minimum-boiling" }],
      bubbleT: x => ({ T: 360, y: [0.6, 0.4] }),
      bubbleP: (x, T) => ({ P: 10, y: [0.7, 0.3] }),
    };
  },
};

const miniCases = {
  tolerances,
  groups: [{ id: "g", title: "Group", cases: [
    { id: "tb", type: "normalBoilingPoint", component: "ethanol", P_kPa: 101.325, quantities: [{ key: "T_C", tol: "abs05" }] },
    { id: "rho", type: "pureProperty", component: "water", property: "liquidDensity", T_K: 298.15, P_kPa: 101.325, state: "liquid", quantities: [{ key: "rho_kg_m3", tol: "rel1" }] },
    { id: "steam", type: "steamState", T_K: 573.15, P_kPa: 1000, quantities: [{ key: "h_kJ_kg", tol: "rel1" }, { key: "mu_mPa_s", tol: "rel1" }] },
    { id: "sat", type: "steamSaturation", T_K: 373.15, quantities: [{ key: "P_bar", tol: "rel1" }, { key: "dHvap_kJ_kg", tol: "rel1" }] },
    { id: "pr", type: "mixtureDensity", components: ["methane", "ethane"], z: [0.9, 0.1], model: "PR", T_K: 300, P_kPa: 5000, quantities: [{ key: "rho_kg_m3", tol: "info5" }] },
  ] }],
  curves: [],
};

test("feature detection: functions missing in a version are 'not available', not failures", () => {
  const r = runCases(fakeV01, miniCases).results;
  assert.equal(r.tb.T_C.status, "ok");
  assert.ok(Math.abs(r.tb.T_C.value - (351.0 - 273.15)) < 1e-12);
  assert.equal(r.rho.rho_kg_m3.status, "na");
  assert.match(r.rho.rho_kg_m3.reason, /CHEPTA\.pure\(\) is not available/);
  assert.equal(r.steam.h_kJ_kg.status, "na");
  assert.match(r.steam.h_kJ_kg.reason, /CHEPTA\.steam\(\) is not available/);
  assert.equal(r.sat.P_bar.status, "na");
  assert.equal(r.pr.rho_kg_m3.status, "na");
  assert.match(r.pr.rho_kg_m3.reason, /Unknown model "PR"/);
});

test("feature detection: new interfaces are used when present (steam tables, pure(), equation of state)", () => {
  const steam = (T, P) => ({ T_K: T, P_kPa: P, rho_kg_m3: 3.876, h_J_kg: 3051600, mu_Pa_s: 2.02e-5 });
  steam.saturation = T => ({ psat_kPa: 101.42, liquid: { rho_kg_m3: 958.35, h_kJ_kg: 419.17 }, vapour: { rho_kg_m3: 0.598, h_kJ_kg: 2675.57 } });
  const fakeV02 = {
    ...fakeV01,
    steam,
    pure: id => ({ MW: id === "methane" ? 16 : id === "ethane" ? 30 : 18,
      psat: () => 3.17, props: (T, P) => ({ phase: "liquid", rho_kg_m3: 997.0 }), has: () => true, property: () => 1 }),
    system({ components, model }) {
      if (model !== "PR") return fakeV01.system({ components, model });
      return { Z: (z, T, P) => 0.9 };
    },
  };
  const r = runCases(fakeV02, miniCases).results;
  assert.equal(r.rho.rho_kg_m3.value, 997.0);
  assert.match(r.rho.rho_kg_m3.method, /props/);
  assert.ok(Math.abs(r.steam.h_kJ_kg.value - 3051.6) < 1e-9);
  assert.ok(Math.abs(r.steam.mu_mPa_s.value - 0.0202) < 1e-12);
  assert.ok(Math.abs(r.sat.P_bar.value - 1.0142) < 1e-12);
  assert.ok(Math.abs(r.sat.dHvap_kJ_kg.value - (2675.57 - 419.17)) < 1e-9);
  // rho = P M / (Z R T) with M = 0.9*16 + 0.1*30 g/mol
  const rho = 5000e3 * 17.4e-3 / (0.9 * 8.314462618 * 300);
  assert.ok(Math.abs(r.pr.rho_kg_m3.value / rho - 1) < 1e-12);
  // An output without recognisable fields is "not available" with the fields listed.
  const odd = { ...fakeV02, steam: () => ({ enthalpy: 1 }) };
  const s = runCases(odd, miniCases).results.steam.h_kJ_kg;
  assert.equal(s.status, "na");
  assert.match(s.reason, /no recognised field.*enthalpy/);
});

test("comparison: within tolerance, out of tolerance, new, changed, lost, no reference", () => {
  const cases = { tolerances, groups: [{ id: "g", title: "G", cases: [
    { id: "a", type: "normalBoilingPoint", component: "water", P_kPa: 101.325, quantities: [{ key: "T_C", tol: "abs05" }] },
    { id: "b", type: "normalBoilingPoint", component: "ethanol", P_kPa: 101.325, quantities: [{ key: "T_C", tol: "abs05" }] },
    { id: "c", type: "pureProperty", component: "water", property: "liquidDensity", T_K: 298.15, quantities: [{ key: "rho_kg_m3", tol: "rel1" }] },
    { id: "d", type: "pureProperty", component: "methane", property: "density", T_K: 300, P_kPa: 5000, quantities: [{ key: "rho_kg_m3", tol: "info5" }] },
    { id: "e", type: "pureProperty", component: "acetone", property: "liquidViscosity", T_K: 298.15, quantities: [{ key: "mu_mPa_s", tol: "rel1" }] },
    { id: "f", type: "normalBoilingPoint", component: "toluene", P_kPa: 101.325, quantities: [{ key: "T_C", tol: "abs05" }] },
  ] }] };
  const refs = { values: {
    a: { T_C: { value: 99.97 } }, b: { T_C: { value: 78.42 } }, c: { rho_kg_m3: { value: 997.05 } },
    d: { rho_kg_m3: { value: 34.97 } }, e: { mu_mPa_s: { value: null, why: "no model" } }, f: { T_C: { value: 110.6 } },
  } };
  const ok = v => ({ status: "ok", value: v }), na = { status: "na", reason: "not in this version" };
  const base = { results: { a: { T_C: ok(99.98) }, b: { T_C: ok(78.42) }, c: { rho_kg_m3: na }, d: { rho_kg_m3: na }, e: { mu_mPa_s: na }, f: { T_C: ok(110.59) } } };
  const head = { results: { a: { T_C: ok(99.98) }, b: { T_C: ok(79.2) }, c: { rho_kg_m3: ok(997.5) }, d: { rho_kg_m3: ok(32.16) }, e: { mu_mPa_s: ok(0.31) }, f: { T_C: na } } };
  const { groups, summary } = compare(cases, refs, base, head);
  const row = id => groups[0].rows.find(r => r.id === id);
  assert.equal(row("a").status, "ok");
  assert.equal(row("a").changed, false);
  assert.equal(row("a").show, false);
  assert.equal(row("b").status, "out");
  assert.equal(row("b").changed, true);
  assert.equal(row("c").status, "ok");
  assert.equal(row("c").newer, true);
  assert.equal(row("d").status, "outInfo");
  assert.equal(row("e").status, "noRef");
  assert.equal(row("f").status, "lost");
  assert.deepEqual(
    { ok: summary.ok, out: summary.out, outInfo: summary.outInfo, newer: summary.newer, changed: summary.changed, lost: summary.lost, noRef: summary.noRef },
    { ok: 2, out: 1, outInfo: 1, newer: 3, changed: 1, lost: 1, noRef: 1 });

  const md = renderMarkdown({ groups, summary });
  const [top] = md.split("<details>");
  assert.ok(top.indexOf("✅ within tolerance") < top.indexOf("### G"), "summary comes first");
  assert.ok(!top.includes("| Water: normal boiling point"), "unchanged result within tolerance is only in the details");
  assert.ok(top.includes("| Ethanol: normal boiling point"));
  assert.ok(top.includes("⚠️ lost"));
});

test("a known issue is marked, listed with its reason, and only while it is out of tolerance", () => {
  const cases = { tolerances, groups: [{ id: "g", title: "G", cases: [
    { id: "k", type: "normalBoilingPoint", component: "water", P_kPa: 101.325, quantities: [{ key: "T_C", tol: "abs05" }], known: "a stated reason" },
    { id: "m", type: "normalBoilingPoint", component: "ethanol", P_kPa: 101.325, quantities: [{ key: "T_C", tol: "abs05" }], known: "fixed since" },
  ] }] };
  const refs = { values: { k: { T_C: { value: 99.97 } }, m: { T_C: { value: 78.42 } } } };
  const ok = v => ({ status: "ok", value: v });
  const res = { results: { k: { T_C: ok(101) }, m: { T_C: ok(78.4) } } };
  const { groups, summary } = compare(cases, refs, res, res);
  const row = id => groups[0].rows.find(r => r.id === id);
  assert.equal(row("k").status, "out");
  assert.equal(row("k").known, "a stated reason");
  assert.equal(row("m").known, null, "within tolerance: no longer a known issue");
  const md = renderMarkdown({ groups, summary });
  assert.match(md, /### Known issues/);
  assert.match(md, /a stated reason/);
  assert.doesNotMatch(md, /fixed since/);
  assert.match(md, /⚠️ as on main \(known issue\)/);
});

test("the Markdown report stays under the comment size limit", () => {
  const rows = Array.from({ length: 3000 }, (_, i) => ({ id: "x" + i, key: "rho_kg_m3", property: "A long property name " + i,
    conditions: "25 °C, 1.01325 bar, saturated liquid", unit: "kg/m³", base: { status: "ok", value: 1 }, head: { status: "ok", value: 2 },
    ref: { value: 1 }, dev: 1, tol: { rel: 0.01 }, status: "out", changed: true, show: i < 100 }));
  const md = renderMarkdown({ groups: [{ id: "g", title: "G", rows }], summary: { total: 3000, ok: 0, out: 3000, outInfo: 0, noRef: 0, na: 0, error: 0, newer: 0, changed: 3000, lost: 0 } });
  assert.ok(md.length <= MAX_MARKDOWN, `${md.length} characters`);
});

test("the cases run on the current source without errors, and the HTML report is self-contained", () => {
  const cases = loadCases();
  const res = runCases(CHEPTA, cases, { curves: false });
  const errors = Object.entries(res.results).flatMap(([id, q]) =>
    Object.entries(q).filter(([, r]) => r.status === "error").map(([k, r]) => `${id} ${k}: ${r.reason}`));
  assert.deepEqual(errors, []);
  // every case has a reference entry (a value or the reason there is none)
  const refs = loadReferences(new URL("../validation/report/reference", import.meta.url).pathname);
  for (const g of cases.groups) for (const c of g.cases) for (const q of c.quantities) {
    const r = refs.values[c.id]?.[q.key];
    assert.ok(r && (typeof r.value === "number" || (r.value === null && r.why)), `reference for ${c.id} ${q.key}`);
  }
  const cmp = compare(cases, refs, res, res);
  assert.equal(cmp.summary.changed, 0);
  const html = renderHtml(cmp, refs, cases, res, res, {});
  assert.ok(!/<script/i.test(html), "no scripts");
  assert.ok(!/(src|href)="https?:/i.test(html.replace(/<li>.*?<\/li>/gs, "")), "no external resources outside the source list");
});
