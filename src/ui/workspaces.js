/**
 * Workbench (Fugacity.app): the task-based navigation, DOM-free. Which workspaces exist,
 * which views (diagrams) each holds, which inputs each view needs (one component, two,
 * three, a list, or a gas and a solvent), and the checks that explain an incomplete or
 * incompatible selection instead of changing it.
 *
 * No thermodynamics here: this file reads only the component list (listComponents), the
 * gases with a Henry's law constant (HENRY_GASES) and the gas-solvent pairs of the Henry's
 * law table (src/data/henry.json), so that a selector offers only what the engine has.
 */
import { listComponents, findComponent, EOS_MODELS } from "../thermo/system.js";
import { HENRY_GASES } from "../thermo/henry.js";
import henryData from "../data/henry.json" with { type: "json" };

/** The workspaces, one per calculation task, in the order of the navigation (see SECTIONS). */
export const WORKSPACES = [
  { id: "equilibrium", label: "Phase equilibrium", short: "Phase eq.", icon: "ternary",
    views: ["txy", "ternary", "azeotropes", "pxy", "envelope"], view: "ternary" },
  { id: "steam", label: "Steam", short: "Steam", icon: "dome", views: ["steam"], view: "steam" },
  { id: "solubility", label: "Solubility", short: "Solubility", icon: "henry", views: ["henry", "solid", "sle"], view: "henry" },
  { id: "properties", label: "Properties", short: "Properties", icon: "curves", views: ["properties"], view: "properties" },
  { id: "flash", label: "Flash", short: "Flash", icon: "drum", views: ["flash"], view: "flash" },
  { id: "flowsheet", label: "Flowsheet", short: "Flowsheet", icon: "flowsheet", views: ["flowsheet"], view: "flowsheet" },
];

/**
 * The top navigation: sections, each holding workspaces (shown as a second row when there is
 * more than one). `locked`: models on the roadmap, shown but not available yet.
 */
export const SECTIONS = [
  { id: "thermo", label: "Properties & Equilibria", short: "Prop. & eq.", icon: "ternary", workspaces: ["equilibrium", "steam", "solubility", "properties"] },
  { id: "units", label: "Unit models", short: "Units", icon: "drum", workspaces: ["flash"],
    locked: [
      { id: "reaction", label: "Reaction", icon: "flask", note: "Reactors and reactions: roadmap A13, not available yet." },
      { id: "distillation", label: "Distillation", icon: "column", note: "Shortcut and rigorous columns: roadmap v0.5, not available yet." },
    ] },
  { id: "flowsheet", label: "Flowsheet", short: "Flowsheet", icon: "flowsheet", workspaces: ["flowsheet"] },
];

/** The section of a workspace. */
export const sectionOf = ws => SECTIONS.find(s => s.workspaces.includes(ws))?.id ?? null;

/**
 * Supporting utilities: temporary panels (a drawer over the workspace). They never change
 * the workspace, its inputs or its results, and navigating to a workspace closes them.
 */
export const UTILITIES = [
  { id: "project", label: "Project", icon: "file", title: "Project", intro: "Save your work as a file and open it again." },
  { id: "library", label: "Library", icon: "book", title: "Library", intro: "Which parameter set each binary pair uses." },
  { id: "sources", label: "Sources", icon: "search", title: "Sources", intro: "Every source behind Fugacity's data, why it is open and what uses it." },
  { id: "settings", label: "Settings", icon: "units", title: "Settings", intro: "Units, composition basis and panels. They apply to every workspace." },
];

/** The workspace of a view. */
export function workspaceOf(view) {
  const ws = WORKSPACES.find(w => w.views.includes(view));
  if (!ws) throw new Error(`Unknown view "${view}". Known: ${WORKSPACES.flatMap(w => w.views).join(", ")}.`);
  return ws.id;
}

/**
 * The inputs each view needs.
 *  - kind "slots": exactly n components, each with a role (order matters);
 *  - kind "list": min to max components;
 *  - kind "henry": a gas and a solvent;
 *  - kind "none": nothing to choose (steam is water).
 * `solid`: the slots whose component must have a melting temperature and enthalpy of fusion;
 * `activityOnly`: the view needs an activity model (NRTL, UNIQUAC or ideal) for the liquid.
 * `liquid`: with an activity-coefficient model (NRTL, UNIQUAC, ideal), only components with
 * activity-model data (vapour pressure, UNIQUAC r and q); with an equation of state (PR, SRK)
 * every component, gases too. `minActivity`: the smallest list with an activity model, where
 * it differs from `min` (an activity-model system needs two components).
 * The phase-equilibrium diagrams work with either kind of model (the Model group of the toolbar).
 */
export const INPUTS = {
  txy: { kind: "slots", n: 2, liquid: true, what: "a T-x-y diagram", roles: ["x axis", "1 − x"] },
  ternary: { kind: "slots", n: 3, liquid: true, what: "a ternary map", roles: ["top corner", "lower left", "lower right"] },
  azeotropes: { kind: "list", min: 2, max: 4, liquid: true, what: "an azeotrope search" },
  pxy: { kind: "slots", n: 2, liquid: true, what: "a P-x-y diagram", roles: ["x axis", "1 − x"] },
  envelope: { kind: "list", min: 1, minActivity: 2, max: 6, liquid: true, what: "a phase envelope" },
  flash: { kind: "list", min: 1, minActivity: 2, max: 6, liquid: true, what: "a flash" },
  henry: { kind: "henry", what: "a gas solubility" },
  // solid-liquid equilibrium (proposal 0007, step 4): `solid` lists the slots whose component crystallizes (melting data needed)
  solid: { kind: "slots", n: 2, liquid: true, solid: [0], activityOnly: true, what: "a solid solubility", roles: ["the solid", "the solvent"] },
  sle: { kind: "slots", n: 2, liquid: true, solid: [0, 1], activityOnly: true, what: "a solid-liquid diagram", roles: ["x axis", "1 − x"] },
  properties: { kind: "slots", n: 1, liquid: false, what: "the property curves", roles: ["pure component"] },
  steam: { kind: "none", what: "the steam tables" },
  flowsheet: { kind: "none", what: "the flowsheet" },   // its own setup: components and method of the flowsheet
};

const WORDS = ["no", "one", "two", "three", "four", "five", "six"];
const word = n => WORDS[n] ?? String(n);
const cmap = () => new Map(listComponents().map(c => [c.id, c]));
const nameIn = (m, id) => m.get(id)?.name ?? id;

/** Is this component usable with activity-coefficient models (a liquid with the data they need)? */
export const isLiquid = id => !!cmap().get(id)?.activity;

/** Is the model an equation of state (PR, SRK), which describes gases and liquids alike? */
export const isEosModel = model => EOS_MODELS.includes(String(model ?? "").toUpperCase());

/**
 * What a view needs with a given model: `liquid` (only liquids with activity-model data) and
 * `min` (smallest list), from INPUTS.
 */
export function needsFor(view, model = "NRTL") {
  const spec = INPUTS[view];
  if (!spec) throw new Error(`Unknown view "${view}".`);
  const eos = isEosModel(model);
  return { ...spec, liquid: !!spec.liquid && !eos, min: !eos && spec.minActivity ? spec.minActivity : spec.min };
}

/** Gas-solvent pairs with a Henry's law constant. */
export const HENRY_PAIRS = henryData.pairs.map(p => ({ gas: p.gas, solvent: p.solvent }));
/** Solvents with a Henry's law constant for `gas` (all solvents of the table when gas is empty). */
export function solventsFor(gas) {
  return [...new Set(HENRY_PAIRS.filter(p => !gas || p.gas === gas).map(p => p.solvent))];
}

/** A component id from a name, alias, formula or CAS number; null for an empty entry (an empty slot). */
export function pickId(v) {
  if (v == null || v === "") return null;
  return findComponent(v);
}

/**
 * Normalize the inputs of one view: slots padded with null (empty) or cut to n, lists cut to
 * max. Duplicates and components the view cannot use are KEPT, so that checkInputs can say
 * what is wrong; nothing is silently replaced.
 */
export function normalizeInputs(view, value) {
  const spec = INPUTS[view];
  if (!spec) throw new Error(`Unknown view "${view}".`);
  if (spec.kind === "none") return [];
  if (spec.kind === "henry") {
    const v = value ?? {};
    return { gas: pickId(v.gas), solvent: pickId(v.solvent) };
  }
  const list = (Array.isArray(value) ? value : value == null ? [] : [value]).map(pickId);
  if (spec.kind === "slots") return Array.from({ length: spec.n }, (_, i) => list[i] ?? null);
  return list.filter(id => id != null).slice(0, spec.max);
}

/**
 * Are the inputs of a view complete and compatible with the model (default: an activity model)?
 * @returns {{ok:boolean, use:string[], problems:{slot:number|null, message:string}[]}}
 *   `use`: the component ids the view calculates with (when ok); `problems`: one plain-language
 *   message per issue, with the slot it concerns (0-based; null for the whole selection).
 */
export function checkInputs(view, value, model = "NRTL") {
  const spec = needsFor(view, model);
  const m = cmap();
  const problems = [];
  if (spec.kind === "none") return { ok: true, use: view === "steam" ? ["water"] : [], problems };
  if (spec.kind === "henry") {
    const { gas, solvent } = value ?? {};
    if (!gas) problems.push({ slot: 0, message: "Choose a gas." });
    else if (!HENRY_GASES.includes(gas)) problems.push({ slot: 0, message: `${nameIn(m, gas)} has no Henry's law constant in the databank. Gases with one: ${HENRY_GASES.map(g => nameIn(m, g)).join(", ")}.` });
    if (!solvent) problems.push({ slot: 1, message: "Choose a solvent." });
    else if (gas && HENRY_GASES.includes(gas) && !HENRY_PAIRS.some(p => p.gas === gas && p.solvent === solvent)) {
      problems.push({ slot: 1, message: `No Henry's law constant for ${nameIn(m, gas)} in ${nameIn(m, solvent)}. Solvents with one for ${nameIn(m, gas)}: ${solventsFor(gas).map(s => nameIn(m, s)).join(", ")}.` });
    }
    return { ok: !problems.length, use: problems.length ? [] : [gas], problems };
  }
  const ids = spec.kind === "slots" ? value ?? [] : (value ?? []).filter(Boolean);
  const seen = new Map();
  ids.forEach((id, i) => {
    const label = spec.kind === "slots" && spec.n > 1 ? `Component ${i + 1}` : spec.kind === "slots" ? "The component" : nameIn(m, id);
    if (!id) { problems.push({ slot: i, message: `${label} is empty: choose ${spec.liquid ? "a liquid" : "a component"}.` }); return; }
    if (!m.has(id)) { problems.push({ slot: i, message: `${label}: unknown component "${id}".` }); return; }
    if (spec.liquid && !m.get(id).activity && spec.activityOnly) {
      problems.push({ slot: i, message: `${spec.kind === "slots" ? `${label}, ${nameIn(m, id)}` : nameIn(m, id)}, has no activity-model data (vapour pressure and UNIQUAC r and q), so ${spec.what} cannot use it yet.` });
    } else if (spec.liquid && !m.get(id).activity) {
      problems.push({ slot: i, message: `${spec.kind === "slots" ? `${label}, ${nameIn(m, id)}` : nameIn(m, id)}, has no activity-model data (vapour pressure and UNIQUAC r and q), so ${spec.what} with ${model === "ideal" ? "an ideal solution" : model} cannot use it. Choose a liquid, or an equation of state (Peng–Robinson or SRK) in the Model group for gases.` });
    }
    if (spec.solid?.includes(i) && !m.get(id).fusion) {
      problems.push({ slot: i, message: `${nameIn(m, id)} has no melting temperature and enthalpy of fusion in the databank (no open data), so it cannot be the solid.` });
    }
    if (seen.has(id)) problems.push({ slot: i, message: `Components ${seen.get(id) + 1} and ${i + 1} are both ${nameIn(m, id)}: choose different components.` });
    else seen.set(id, i);
  });
  if (spec.activityOnly && isEosModel(model)) {
    problems.push({ slot: null, message: `${spec.what[0].toUpperCase()}${spec.what.slice(1)} needs an activity model for the liquid: choose NRTL, UNIQUAC or Ideal in the Model group.` });
  }
  if (spec.kind === "list" && ids.length < spec.min) {
    const why = !isEosModel(model) && spec.minActivity
      ? ` with an activity model (one pure component needs an equation of state: Peng–Robinson or SRK)` : "";
    problems.push({ slot: null, message: `${spec.what[0].toUpperCase()}${spec.what.slice(1)} needs at least ${word(spec.min)} ${spec.liquid ? "liquid" : "component"}${spec.min > 1 ? "s" : ""}${why}; ${word(ids.length)} chosen.` });
  }
  return { ok: !problems.length, use: problems.length ? [] : ids.slice(), problems };
}

/**
 * Inputs of every view from one list of components (the `components` key of the
 * configuration, or of update()): the first two liquids for T-x-y, the first three for the
 * ternary map, up to four for azeotropes, the first two components for P-x-y, all of them
 * for the phase envelope, the first selected gas with a Henry's law constant, and the first
 * component for the properties. A slot with nothing to take stays empty. With an equation of
 * state (`model` PR or SRK), the diagrams take gases too.
 */
export function seedInputs(components = [], { gas, solvent, propComponent, model } = {}) {
  const ids = components.map(pickId).filter(Boolean);
  const liq = isEosModel(model) ? ids : ids.filter(isLiquid);
  const firstGas = ids.find(id => HENRY_GASES.includes(id));
  const g = pickId(gas) ?? firstGas ?? (HENRY_GASES.includes("oxygen") ? "oxygen" : HENRY_GASES[0]);
  return {
    txy: normalizeInputs("txy", liq.slice(0, 2)),
    ternary: normalizeInputs("ternary", liq.slice(0, 3)),
    azeotropes: normalizeInputs("azeotropes", liq.slice(0, 4)),
    pxy: normalizeInputs("pxy", ids.slice(0, 2)),
    envelope: normalizeInputs("envelope", ids.slice(0, 6)),
    flash: normalizeInputs("flash", liq.slice(0, 6)),
    henry: { gas: g, solvent: pickId(solvent) ?? solventsFor(g)[0] ?? "water" },
    // a solid in a solvent, and a binary with a eutectic: examples until the person chooses
    solid: normalizeInputs("solid", ["benzoic-acid", "ethanol"]),
    sle: normalizeInputs("sle", ["benzene", "naphthalene"]),
    properties: [pickId(propComponent) ?? ids[0] ?? "water"],
    steam: [],
    flowsheet: [],
  };
}

/** Ready-made inputs (the Examples menu of the Inputs panel) that fit a view and the model. */
export function examplesFor(view, presets, model = "NRTL") {
  const spec = INPUTS[view];
  if (!spec || (spec.kind !== "slots" && spec.kind !== "list") || view === "properties") return [];
  return presets.filter(p => {
    const fits = spec.kind === "slots" ? p.components.length === spec.n : p.components.length >= spec.min && p.components.length <= spec.max;
    return fits && checkInputs(view, normalizeInputs(view, p.components), model).ok;
  });
}

/** Move the first component to the end (turns the ternary diagram); empty slots move too. */
export const rotateInputs = ids => (ids.length > 1 ? [...ids.slice(1), ids[0]] : ids.slice());
