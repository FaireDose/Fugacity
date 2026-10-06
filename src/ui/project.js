/**
 * Project files of the workbench: save the work as a small JSON document and open it again.
 *
 * A project holds what the person set, not what was calculated: the model, the conditions,
 * the units, the inputs of every workspace, the flash specification and feed, the parameter
 * sets chosen per pair and the view that was open. Opening it rebuilds the workbench from
 * these and calculates everything again with the library that opens it. A project may also
 * carry `results`, the stream table of the flash as it was at save time, so the mass balance
 * can be read without Fugacity (it is a record and is never read back into a calculation).
 *
 * Format 2 (the "fugacity_project" key is the format version; format 1 is the same without
 * "flowsheet"):
 *
 *   {
 *     "fugacity_project": 1,
 *     "saved_with": "fugacity 0.2.2",
 *     "saved_at": "2026-10-06T12:00:00.000Z",
 *     "title": "Ethanol, water",                 // optional
 *     "workbench": {
 *       "view": "flash", "diagram": "txy",        // open view; the diagram Phase equilibrium remembers
 *       "model": "NRTL", "eos": "PR", "vapour": "ideal",
 *       "P_kPa": 101.325, "T_K": null,
 *       "units": { "T": "C", "P": "kPa", "basis": "mass", "viscosity": "mPa s" }, "basis": "mole",
 *       "inputs": { "txy": [...], "ternary": [...], "azeotropes": [...], "pxy": [...], "envelope": [...],
 *                   "flash": [...], "henry": { "gas", "solvent" }, "properties": [...] },
 *       "z": { "pxy": null, "envelope": null },
 *       "flash": { "spec", "T_K", "P_kPa", "VF", "Q_J_mol", "feedT_K", "feedP_kPa", "duty", "z", "flow", "flowUnit" },
 *       "sets": { "ethanol+water": "chemsep" }, "prefer": null,
 *       "henryT_K", "henryP_kPa", "compareGases", "property", "steamP_kPa",
 *       "background", "residueCurves", "isotherms", "grid", "panels", "ribbon"
 *     },
 *     "flowsheet": { "components", "thermo", "blocks", "streams", "solver" },   // optional; src/flowsheet/document.js
 *     "results": { "flash": { "columns", "rows", "summary", "model", "spec", "sources" } }   // optional
 *   }
 *
 * SI units throughout (K, kPa, J/mol), as in the engine; `units` is only how the workbench
 * shows them. Reading checks the format and every value with the same checks as
 * Fugacity.app's configuration, and throws an error that names the problem.
 *
 * A view helper (layer 6): no thermodynamics here.
 */
import { initialState, applyPatch, VIEWS } from "./app-logic.js";
import { normalizeFlowsheet, flowsheetDocStatus } from "../flowsheet/document.js";

/** The format version this library writes; it reads this one and every older one. Format 2
 *  adds the flowsheet (proposal 0006, step 4); a format 1 file is a format 2 file without it. */
export const PROJECT_FORMAT = 2;

/** The keys of `workbench`, in the order they are written. */
const KEYS = ["view", "diagram", "model", "eos", "vapour", "P_kPa", "T_K", "units", "basis", "inputs", "z", "flash", "sets", "prefer",
  "henryT_K", "henryP_kPa", "compareGases", "property", "steamP_kPa", "background", "residueCurves", "isotherms", "grid", "panels", "ribbon"];

const copy = v => (v == null ? v : JSON.parse(JSON.stringify(v)));

/**
 * The project document of a workbench state.
 * @param {object} state      the workbench state (app-logic.js)
 * @param {object} [opts]
 * @param {string} [opts.version]   library version, recorded in `saved_with`
 * @param {object} [opts.results]   records to keep with the project (e.g. { flash: stream table })
 * @param {Date}   [opts.now]
 */
export function projectOf(state, { version = "", results, now = new Date() } = {}) {
  const w = {};
  for (const k of KEYS) w[k] = copy(state[k]);
  const { steam, ...inputs } = w.inputs;   // steam takes no inputs (always water)
  w.inputs = inputs;
  const doc = { fugacity_project: PROJECT_FORMAT, saved_with: `fugacity ${version}`.trim(), saved_at: now.toISOString() };
  if (state.title) doc.title = String(state.title);
  doc.workbench = w;
  const fs = state.flowsheet;
  if (fs && (fs.components?.length || fs.blocks?.length)) doc.flowsheet = normalizeFlowsheet(fs);
  if (results && Object.keys(results).length) doc.results = copy(results);
  return doc;
}

/** Text of a project file (JSON, two-space indented). */
export const projectText = doc => JSON.stringify(doc, null, 2) + "\n";

/**
 * A file name for a project, ending in ".fugacity.json": the name the person gave the project
 * (kept as typed, without characters that file systems refuse), else "fugacity-" and the
 * components.
 */
export function projectFileName(state) {
  const named = String(state.title ?? "").normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\.fugacity\.json$|\.json$/i, "").replace(/\s+/g, " ").replace(/^[\s.-]+|[\s.-]+$/g, "").slice(0, 80);
  if (named) return `${named}.fugacity.json`;
  const base = state.components?.length ? state.components.join("-") : "workbench";
  const slug = base.toLowerCase().replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "workbench";
  return `fugacity-${slug}.fugacity.json`;
}

/**
 * Parse a project: a document, or its JSON text (a byte-order mark is allowed). Throws an
 * error naming the problem when it is not a Fugacity project or a value is wrong.
 * @returns {object} the document, checked
 */
export function readProject(input) {
  let doc = input;
  if (typeof input === "string") {
    try { doc = JSON.parse(input.replace(/^﻿/, "")); } catch (e) { throw new Error(`This is not a Fugacity project: the file is not valid JSON (${e.message}).`); }
  }
  if (doc == null || typeof doc !== "object" || Array.isArray(doc)) throw new Error("This is not a Fugacity project: expected a JSON object.");
  if (!("fugacity_project" in doc)) {
    if ("fugacity_package" in doc) throw new Error("This is a contribution package (data for the project), not a workbench project; check it with Fugacity.checkPackage().");
    throw new Error('This is not a Fugacity project: the "fugacity_project" key is missing.');
  }
  const f = doc.fugacity_project;
  if (!Number.isInteger(f) || f < 1) throw new Error(`fugacity_project must be a format number such as ${PROJECT_FORMAT} (got ${JSON.stringify(f)}).`);
  if (f > PROJECT_FORMAT) throw new Error(`This project uses format ${f}, saved with ${doc.saved_with || "a newer Fugacity"}; this library reads formats 1 to ${PROJECT_FORMAT}. Open it with a newer version of Fugacity.`);
  const w = doc.workbench;
  if (w == null || typeof w !== "object" || Array.isArray(w)) throw new Error('The project has no "workbench" object.');
  const unknown = Object.keys(w).filter(k => !KEYS.includes(k));
  if (unknown.length) throw new Error(`workbench: unknown key${unknown.length > 1 ? "s" : ""} ${unknown.map(k => `"${k}"`).join(", ")}. Known: ${KEYS.join(", ")}.`);
  if (doc.results != null && (typeof doc.results !== "object" || Array.isArray(doc.results))) throw new Error("results must be an object.");
  return doc;
}

/**
 * The workbench state of a project, built with the same checks as Fugacity.app's
 * configuration: an unknown model, unit, view or component throws, naming it (a project
 * saved with a newer databank may name components this version does not hold).
 */
export function stateFromProject(input) {
  const doc = readProject(input);
  const w = doc.workbench;
  const cfg = { components: [] };
  for (const k of ["model", "eos", "vapour", "P_kPa", "T_K", "units", "basis", "background", "panels", "ribbon", "residueCurves",
    "isotherms", "grid", "property", "henryP_kPa", "henryT_K", "compareGases", "steamP_kPa", "sets", "prefer"]) {
    if (w[k] !== undefined && w[k] !== null) cfg[k] = w[k];
  }
  if (w.T_K === null) delete cfg.T_K;
  if (w.flash != null) {
    if (typeof w.flash !== "object" || Array.isArray(w.flash)) throw new Error("workbench.flash must be an object.");
    const { z, ...rest } = w.flash;
    cfg.flash = rest;
  }
  if (doc.title) cfg.title = String(doc.title);
  if (doc.flowsheet != null) cfg.flowsheet = doc.flowsheet;
  let s = initialState(cfg);
  if (w.inputs != null) {
    if (typeof w.inputs !== "object" || Array.isArray(w.inputs)) throw new Error("workbench.inputs must be an object such as { txy: [\"ethanol\", \"water\"] }.");
    const { steam, ...inputs } = w.inputs;
    s = applyPatch(s, { inputs });
  }
  // compositions after the inputs (new inputs reset them)
  if (w.flash?.z != null) s = applyPatch(s, { flash: { z: w.flash.z } });
  for (const v of ["pxy", "envelope"]) {
    const z = w.z?.[v];
    if (z != null) s = applyPatch(s, { view: v, z });
  }
  const check = (v, key) => {
    if (v != null && !VIEWS[v]) throw new Error(`workbench.${key}: unknown view "${v}". Known: ${Object.keys(VIEWS).join(", ")}.`);
  };
  check(w.diagram, "diagram"); check(w.view, "view");
  if (w.diagram && VIEWS[w.diagram].workspace === "equilibrium") s = applyPatch(s, { view: w.diagram });
  s = applyPatch(s, { view: w.view ?? s.view, utility: null });
  return s;
}

/**
 * Check a project without opening it: every problem found, as text, and the flowsheet's
 * status (structure and degrees of freedom). Never throws; for files written by hand or by
 * an AI assistant before they are opened.
 * @returns {{ok:boolean, problems:string[], flowsheet:object|null}}
 */
export function checkProject(input) {
  const problems = [];
  let doc = null, flowsheet = null;
  try { doc = readProject(input); } catch (e) { return { ok: false, problems: [e.message], flowsheet: null }; }
  try { stateFromProject(doc); } catch (e) { problems.push(e.message); }
  if (doc.flowsheet != null) {
    try {
      flowsheet = flowsheetDocStatus(doc.flowsheet);
      if (flowsheet.setup === false) problems.push(`flowsheet: ${flowsheet.message}`);
      problems.push(...flowsheet.structure.map(p => `flowsheet: ${p.message}`));
      problems.push(...Object.values(flowsheet.blocks).filter(b => !b.ok).map(b => `flowsheet: ${b.message}`));
    } catch (e) { problems.push(`flowsheet: ${e.message}`); }
  }
  return { ok: !problems.length, problems, flowsheet };
}
