/**
 * The flowsheet document (proposal 0006, step 4; roadmap A7): the setup (components and
 * method) and the drawing (blocks with positions, streams), as kept in project files of
 * format 2 (src/ui/project.js) and as an AI assistant writes it:
 *
 *   {
 *     "components": ["ethanol", "water"],
 *     "thermo": { "model": "NRTL", "vapour": "ideal", "sets": { "ethanol+water": "chemsep" } },
 *     "blocks": [ { "id": "F1", "type": "feed", "x": 40, "y": 120, "spec": { ... } }, ... ],
 *     "streams": [ { "id": "S1", "from": "F1.out", "to": "M1.in" }, ... ],
 *     "solver": { "maxIterations": 50, "tolerance": 1e-8 }
 *   }
 *
 * Positions (x, y) are for the drawing only. A block with a duty may name its energy stream
 * ("energy": "Q1"; default "Q-" and the block id). Units: K, kPa, kmol/h, kW.
 */
import { fail } from "../util/errors.js";
import { system } from "../system.js";
import { findComponent } from "../thermo/components.js";
import { solveFlowsheet, flowsheetStatus } from "./flowsheet.js";

const MODELS = ["NRTL", "UNIQUAC", "ideal", "PR", "SRK"];
const BLOCK_KEYS = ["id", "type", "x", "y", "spec", "energy", "label"];
const STREAM_KEYS = ["id", "from", "to", "tear", "guess", "label"];

/** An empty flowsheet: no components, NRTL, no blocks. */
export const emptyFlowsheet = () => ({ components: [], thermo: { model: "NRTL", vapour: "ideal" }, blocks: [], streams: [] });

/**
 * Check a flowsheet document's shape and return a clean copy: component names as ids, a known
 * model, blocks and streams as lists of objects with known keys. Throws BAD_INPUT naming the
 * problem. (The connections and the specifications are checked by flowsheetStatus.)
 */
export function normalizeFlowsheet(doc) {
  if (doc == null) return emptyFlowsheet();
  if (typeof doc !== "object" || Array.isArray(doc)) throw fail("BAD_INPUT", "flowsheet must be an object with components, thermo, blocks and streams.");
  const known = ["components", "thermo", "blocks", "streams", "solver"];
  for (const k of Object.keys(doc)) if (!known.includes(k)) throw fail("BAD_INPUT", `flowsheet: unknown key "${k}". Known: ${known.join(", ")}.`);
  const components = (doc.components ?? []).map(c => {
    try { return findComponent(c); } catch (e) { throw fail("BAD_INPUT", `flowsheet.components: ${e.message}`); }
  });
  const dup = components.find((c, i) => components.indexOf(c) !== i);
  if (dup) throw fail("BAD_INPUT", `flowsheet.components: ${dup} is listed twice.`);
  const t = doc.thermo ?? {};
  if (typeof t !== "object" || Array.isArray(t)) throw fail("BAD_INPUT", "flowsheet.thermo must be an object such as { model: \"NRTL\", vapour: \"ideal\" }.");
  const model = MODELS.find(m => m.toLowerCase() === String(t.model ?? "NRTL").toLowerCase());
  if (!model) throw fail("BAD_INPUT", `flowsheet.thermo.model "${t.model}" is not one of ${MODELS.join(", ")}.`);
  const vapour = t.vapour == null ? "ideal" : ["ideal", "PR", "SRK"].find(v => v.toLowerCase() === String(t.vapour).toLowerCase());
  if (!vapour) throw fail("BAD_INPUT", `flowsheet.thermo.vapour "${t.vapour}" is not one of ideal, PR, SRK.`);
  const thermo = { model, vapour, ...(t.sets ? { sets: { ...t.sets } } : {}), ...(t.prefer ? { prefer: t.prefer } : {}) };
  const objList = (list, keys, what) => {
    if (list == null) return [];
    if (!Array.isArray(list)) throw fail("BAD_INPUT", `flowsheet.${what} must be a list.`);
    return list.map((o, i) => {
      if (!o || typeof o !== "object" || Array.isArray(o)) throw fail("BAD_INPUT", `flowsheet.${what}[${i}] must be an object.`);
      const bad = Object.keys(o).filter(k => !keys.includes(k));
      if (bad.length) throw fail("BAD_INPUT", `flowsheet.${what}[${i}]${o.id ? ` (${o.id})` : ""}: unknown key${bad.length > 1 ? "s" : ""} ${bad.map(k => `"${k}"`).join(", ")}. Known: ${keys.join(", ")}.`);
      return JSON.parse(JSON.stringify(o));
    });
  };
  const out = { components, thermo, blocks: objList(doc.blocks, BLOCK_KEYS, "blocks"), streams: objList(doc.streams, STREAM_KEYS, "streams") };
  if (doc.solver != null) out.solver = { ...doc.solver };
  return out;
}

/** The property package of a flowsheet: system() with its components and method. */
export function flowsheetSystem(doc) {
  const d = normalizeFlowsheet(doc);
  if (!d.components.length) throw fail("BAD_INPUT", "The flowsheet has no components: choose them first (Setup, step 1).");
  const t = d.thermo;
  const eos = t.model === "PR" || t.model === "SRK";
  return system({ components: d.components, model: t.model, ...(eos ? {} : { vapour: t.vapour }), ...(t.sets ? { sets: t.sets } : {}), ...(t.prefer ? { prefer: t.prefer } : {}) });
}

/** Status of a flowsheet document: setup, structure and degrees of freedom (no calculation). */
export function flowsheetDocStatus(doc) {
  const d = normalizeFlowsheet(doc);
  if (!d.components.length) return { ready: false, setup: false, needed: 0, given: 0, dof: 0, structure: [], blocks: {}, message: "Choose the components of the simulation first." };
  const sys = flowsheetSystem(d);
  return { setup: true, ...flowsheetStatus(sys, d) };
}

/**
 * Solve a flowsheet document (or a project with a `flowsheet`): build its property package
 * and run solveFlowsheet. Throws BAD_INPUT when it is not ready (with every problem listed),
 * NO_CONVERGENCE when a loop does not converge.
 */
export function runFlowsheet(input) {
  const doc = input && typeof input === "object" && "fugacity_project" in input ? input.flowsheet : input;
  const d = normalizeFlowsheet(doc);
  return solveFlowsheet(flowsheetSystem(d), d);
}
