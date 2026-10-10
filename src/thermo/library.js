/**
 * The CHEPTA Library (proposal 0003): the sources behind every parameter, and the choice
 * between parameter sets when a pair has more than one.
 *
 * Data (layer 0): src/data/sources.json lists every source once, with an id; the records in
 * binaries.json (NRTL, UNIQUAC), kij.json (Peng-Robinson, SRK), henry.json and
 * components.json refer to it in `source_ids`. A pair can have several parameter sets for the
 * same model, each with a `set` name; exactly one is the `default`. In kij.json the databank
 * value a fit replaced is kept under `replaced`; here it is an ordinary non-default set.
 *
 * Selection, used by createSystem (activity models) and the equation-of-state systems:
 *   1. `sets: { "acetone+chloroform": "chemsep" }`: the named set for that pair (any order,
 *      any name, alias, formula or CAS number). A set name the pair does not have throws.
 *   2. `prefer: ["fitted", "databank"]`: per pair, the first tier in the list that has a set
 *      (the default set among several of that tier). When no set has one of these tiers the
 *      default set is used and info.pairs[].note (and the warnings) say so.
 *   3. otherwise the default set: every result is the same as before sets existed.
 *
 * `add()` puts a set given in the page (tier "user") into this page's library only. It is
 * used when chosen with `sets` or `prefer: ["user", ...]`, or when the pair has no other set.
 *
 * No thermodynamics here.
 */
import sourcesData from "../data/sources.json" with { type: "json" };
import binaryData from "../data/binaries.json" with { type: "json" };
import kijData from "../data/kij.json" with { type: "json" };
import henryData from "../data/henry.json" with { type: "json" };
import componentData from "../data/components.json" with { type: "json" };
import knownIssues from "../data/known-issues.json" with { type: "json" };
import { findComponent } from "./components.js";
import { isPolar } from "./method-advice.js";
import { fail } from "../util/errors.js";

/** Quality tiers, best first (ARCHITECTURE.md). */
export const TIERS = ["fitted", "standard", "databank", "predicted", "user"];
/** A set is used without a warning up to this far (K) outside its temperature range. */
export const RANGE_MARGIN_K = 10;

const ACTIVITY_MODELS = ["NRTL", "UNIQUAC"];
const EOS_MODELS = ["PR", "SRK"];
const PARAM_KEYS = { NRTL: ["a_ij", "a_ji", "b_ij", "b_ji", "alpha"], UNIQUAC: ["a_ij", "a_ji", "b_ij", "b_ji"], PR: ["kij"], SRK: ["kij"] };

const userSources = new Map();
const userSets = [];
let usedByCache = null;

const comp = id => componentData.components[id];
const nameOf = id => comp(id)?.name ?? id;
/** An equation-of-state k_ij of a pair with a polar component: not the recommended method for their liquid
 *  (docs/METHOD_SELECTION.md); the set is kept (it shows how far a plain cubic equation is off) and labelled. */
const eosPolar = s => EOS_MODELS.includes(s.model) && [s.i, s.j].some(id => isPolar(id, comp(id)?.formula));
const NOT_RECOMMENDED = "not recommended for the liquid: a polar pair with a plain cubic equation of state (docs/METHOD_SELECTION.md)";
const pairKey = (a, b) => [a, b].sort().join("|");

// ---------------------------------------------------------------------------------------
// parameter sets, normalized

/** Text of a k_ij record's source, as the equation-of-state systems have always shown it. */
function kijText(p) {
  const s = p.source;
  if (typeof s === "string") return s;
  return s.fit ? `${s.fit}; data: ${s.data.join(", ")}; ${s.conditions}` : `${s.file} (ChemSep, Artistic License 2.0): ${s.conditions}`;
}

function fromBinary(p) {
  const params = { a_ij: p.a_ij, a_ji: p.a_ji, b_ij: p.b_ij, b_ji: p.b_ji };
  if (p.alpha != null) params.alpha = p.alpha;
  return {
    model: p.model, i: p.i, j: p.j, set: p.set ?? "default", default: p.default !== false, tier: p.tier || "databank",
    source_ids: p.source_ids ?? [], source: p.source, valid: p.valid ?? (p.T_range_K ? { T_K: p.T_range_K } : null),
    T_range_K: p.T_range_K ?? null, params, origin: "binaries.json", data_wanted: p.data_wanted,
  };
}

function fromKij(p, i, j, model, isReplaced) {
  const range = p.valid?.T_K ?? p.source?.T_range_K ?? null;
  return {
    model, i, j, set: p.set ?? (isReplaced ? "replaced" : "default"), default: isReplaced ? false : p.default !== false,
    tier: p.tier || "databank", source_ids: p.source_ids ?? [], source: kijText(p), valid: range ? { T_K: range } : null,
    T_range_K: p.source?.T_range_K ?? null, params: { kij: p.kij }, origin: "kij.json", reason: p.reason,
  };
}

let dataSets = null;
function allSets() {
  if (!dataSets) {
    dataSets = [];
    for (const p of binaryData.pairs) dataSets.push(fromBinary(p));
    for (const p of kijData.pairs) {
      dataSets.push(fromKij(p, p.i, p.j, p.model, false));
      if (p.replaced) dataSets.push(fromKij(p.replaced, p.i, p.j, p.model, true));
    }
  }
  return dataSets.concat(userSets);
}

/** The sets of one pair and model, default first; `flipped` when stored as (b, a). */
function candidates(model, a, b) {
  const out = allSets().filter(s => s.model === model && ((s.i === a && s.j === b) || (s.i === b && s.j === a)))
    .map(s => ({ ...s, flipped: s.i !== a }));
  return out.sort((x, y) => (y.default - x.default));
}

// ---------------------------------------------------------------------------------------
// selection

/**
 * Check and normalize the `sets` and `prefer` settings of a system.
 * @returns {{sets: Map<string,string>, prefer: string[]|null}}
 */
export function selection(cfg = {}) {
  const sets = new Map();
  if (cfg.sets != null) {
    if (typeof cfg.sets !== "object" || Array.isArray(cfg.sets)) throw fail("BAD_INPUT", 'sets must be an object such as { "acetone+chloroform": "chemsep" }.');
    for (const [key, name] of Object.entries(cfg.sets)) {
      const parts = String(key).split("+").map(s => s.trim()).filter(Boolean);
      if (parts.length !== 2) throw fail("BAD_INPUT", `sets: "${key}" is not a pair; write it as "component+component", e.g. "acetone+chloroform".`);
      const [a, b] = parts.map(findComponent);
      if (a === b) throw fail("BAD_INPUT", `sets: "${key}" names the same component twice.`);
      if (name == null || name === "") continue; // no choice: the default set
      if (typeof name !== "string") throw fail("BAD_INPUT", `sets: the set for "${key}" must be a set name (a string), got ${JSON.stringify(name)}.`);
      sets.set(pairKey(a, b), name);
    }
  }
  let prefer = cfg.prefer ?? null;
  if (prefer != null) {
    prefer = (Array.isArray(prefer) ? prefer : [prefer]).map(t => String(t).toLowerCase());
    for (const t of prefer) if (!TIERS.includes(t)) throw fail("BAD_INPUT", `prefer: unknown tier "${t}". Use tiers from: ${TIERS.join(", ")}.`);
    if (!prefer.length) prefer = null;
  }
  return { sets, prefer };
}

/**
 * The parameter set used for a pair: the set named in `sel.sets`, else the first tier of
 * `sel.prefer` that has a set, else the default set. Null when the pair has no set.
 * @returns {null|{chosen:object, flipped:boolean, by:"sets"|"prefer"|"default", note:string|null, alternatives:object[]}}
 */
export function choosePair(model, a, b, sel = { sets: new Map(), prefer: null }) {
  const cands = candidates(model, a, b);
  if (!cands.length) return null;
  const def = cands.find(c => c.default) ?? cands[0];
  let chosen = def, by = "default", note = null;
  const named = sel.sets.get(pairKey(a, b));
  if (named != null) {
    chosen = cands.find(c => c.set === named);
    if (!chosen) {
      throw fail("BAD_INPUT", `No ${model} parameter set "${named}" for ${nameOf(a)} + ${nameOf(b)}. Sets: ${cands.map(c => `"${c.set}" (${c.tier}${c.default ? ", default" : ""})`).join(", ")}.`);
    }
    by = "sets";
  } else if (sel.prefer) {
    const pick = sel.prefer.map(t => cands.filter(c => c.tier === t)).find(list => list.length);
    if (pick) { chosen = pick.find(c => c.default) ?? pick[0]; by = "prefer"; }
    else note = `No ${sel.prefer.join(" or ")} ${model} set for ${nameOf(a)} + ${nameOf(b)}: the default set "${def.set}" (${def.tier}) is used.`;
  }
  return { chosen, flipped: chosen.flipped, by, note, alternatives: cands.filter(c => c !== chosen) };
}

const brief = c => ({ set: c.set, tier: c.tier, default: c.default, source_ids: c.source_ids.slice() });

/**
 * The info.pairs entry of a chosen set. Keeps the fields of earlier versions (pair, source,
 * tier, T_range_K; kij for equations of state) and adds the set, its sources and the
 * alternatives.
 */
export function describePair(choice, names) {
  const c = choice.chosen;
  const out = {
    pair: names, source: c.source, tier: c.tier, T_range_K: c.T_range_K ?? null,
    set: c.set, default: c.default, chosenBy: choice.by, source_ids: c.source_ids.slice(),
    sources: c.source_ids.map(id => sourceEntry(id)).filter(Boolean),
    valid: c.valid ? JSON.parse(JSON.stringify(c.valid)) : null,
    alternatives: choice.alternatives.map(brief),
  };
  if (choice.note) out.note = choice.note;
  return out;
}

/**
 * Warnings for a calculation at T (K) and P (kPa) from the chosen sets: temperatures more than
 * RANGE_MARGIN_K outside a set's T range, pressures outside its P range, and the notes of the
 * selection. `says(p)` is the start of the message, e.g. "NRTL parameters of A + B come".
 */
export function pairWarnings(pairs, T, P, says) {
  const w = [];
  for (const p of pairs) {
    const r = p.valid?.T_K ?? p.T_range_K;
    if (r && Number.isFinite(T) && (T < r[0] - RANGE_MARGIN_K || T > r[1] + RANGE_MARGIN_K)) {
      w.push(`${says(p)} from data at ${r[0]}-${r[1]} K; ${T.toFixed(2)} K is outside that range.`);
    }
    const rp = p.valid?.P_kPa;
    if (rp && Number.isFinite(P) && (P < rp[0] * (1 - 1e-9) || P > rp[1] * (1 + 1e-9))) {
      w.push(`${says(p)} from data at ${rp[0]}-${rp[1]} kPa; ${+P.toFixed(3)} kPa is outside that range.`);
    }
    if (p.note) w.push(p.note);
  }
  return w;
}

// ---------------------------------------------------------------------------------------
// sources

/** A source by id (a copy, without usedBy), or null. */
export function sourceEntry(id) {
  const s = sourcesData.sources[id] ?? userSources.get(id);
  return s ? { id, ...JSON.parse(JSON.stringify(s)) } : null;
}

function labelProperty(key) {
  return { vapourPressure: "vapour pressure", uniquac: "UNIQUAC r and q", association: "vapour association",
    fusion: "melting temperature and enthalpy of fusion",
    constants_source: "critical constants and normal boiling point", omega_source: "acentric factor" }[key]
    ?? key.replace(/[A-Z]/g, m => " " + m.toLowerCase());
}

/**
 * The sources of a component's records: [{ key, label, source_ids }] for the critical
 * constants, acentric factor, vapour pressure, UNIQUAC r and q, association, melting data and property records.
 */
export function componentSources(id) {
  const c = comp(findComponent(id));
  const out = [];
  const rec = (key, ids) => { if (ids?.length) out.push({ key, label: labelProperty(key), source_ids: ids.slice() }); };
  rec("constants_source", c.constants_source_ids);
  rec("omega_source", c.omega_source_ids);
  for (const key of ["vapourPressure", "uniquac", "association", "fusion"]) if (c[key]) rec(key, c[key].source_ids);
  for (const [key, r] of Object.entries(c.properties ?? {})) rec(key, r.source_ids);
  return out;
}

function computeUsedBy() {
  const u = new Map();
  const add = (id, what) => { if (!u.has(id)) u.set(id, []); u.get(id).push(what); };
  for (const s of allSets()) {
    const pair = [nameOf(s.i), nameOf(s.j)];
    const type = EOS_MODELS.includes(s.model) ? "kij" : "pair-set";
    for (const id of s.source_ids) {
      add(id, { type, model: s.model, pair, set: s.set, default: s.default, tier: s.tier,
        label: `${s.model} ${type === "kij" ? "k_ij " : ""}${pair.join(" + ")}, set "${s.set}"${s.default ? " (default)" : ""}${eosPolar(s) ? `; ${NOT_RECOMMENDED}` : ""}` });
    }
  }
  for (const p of henryData.pairs) for (const id of p.source_ids ?? []) add(id, { type: "henry", gas: p.gas, label: `Henry's law constant of ${nameOf(p.gas)} in water` });
  for (const id of henryData.solvents.water.vapourPressure.source_ids ?? []) add(id, { type: "henry", gas: null, label: "Water vapour pressure in the Henry's law equations" });
  for (const [cid, c] of Object.entries(componentData.components)) {
    const rec = (key, ids) => { for (const id of ids ?? []) add(id, { type: "component", component: cid, property: key, label: `${c.name}: ${labelProperty(key)}` }); };
    for (const key of ["vapourPressure", "uniquac", "association", "fusion"]) if (c[key]) rec(key, c[key].source_ids);
    for (const [key, r] of Object.entries(c.properties ?? {})) rec(key, r.source_ids);
    rec("constants_source", c.constants_source_ids);
    rec("omega_source", c.omega_source_ids);
  }
  for (const k of knownIssues.issues) {
    for (const id of k.source_ids ?? []) add(id, { type: "known-issue", model: k.model, label: `Known-deviation note, ${k.model}, ${k.components.map(nameOf).join(" + ")}` });
  }
  for (const [id, s] of Object.entries(sourcesData.sources)) for (const f of s.files ?? []) add(id, { type: "file", file: f, label: f });
  return u;
}

/** What uses a source: parameter sets, Henry's law constants, pure-component records, files. */
function usedBy(id) {
  if (!sourcesData.sources[id] && !userSources.has(id)) throw fail("BAD_INPUT", `Unknown source "${id}". See CHEPTA.library.sources().`);
  if (!usedByCache) usedByCache = computeUsedBy();
  return (usedByCache.get(id) ?? []).map(x => ({ ...x }));
}

/** All sources (those of this page's added sets last), each with what uses it. */
function sources() {
  return [...Object.keys(sourcesData.sources), ...userSources.keys()].map(id => ({ ...sourceEntry(id), usedBy: usedBy(id) }));
}

/** One source by id, with what uses it. */
function source(id) {
  const s = sourceEntry(String(id));
  if (!s) throw fail("BAD_INPUT", `Unknown source "${id}". See CHEPTA.library.sources() for the ${Object.keys(sourcesData.sources).length} sources.`);
  return { ...s, usedBy: usedBy(s.id) };
}

function publicSet(c) {
  return {
    model: c.model, i: c.i, j: c.j, pair: [nameOf(c.i), nameOf(c.j)], set: c.set, default: c.default, tier: c.tier,
    source_ids: c.source_ids.slice(), sources: c.source_ids.map(sourceEntry).filter(Boolean), source: c.source,
    valid: c.valid ? JSON.parse(JSON.stringify(c.valid)) : null, params: { ...c.params },
    ...(c.reason ? { reason: c.reason } : {}),
    ...(eosPolar(c) ? { recommended: false, advice: NOT_RECOMMENDED } : {}),
  };
}

/**
 * The parameter sets of a pair, default first. Parameters are given for the pair as stored
 * (i, j of each set). Without a model: the sets of every model.
 */
function sets(a, b, model) {
  const i = findComponent(a), j = findComponent(b);
  if (i === j) throw fail("BAD_INPUT", "Give two different components.");
  const models = model == null ? [...ACTIVITY_MODELS, ...EOS_MODELS] : [checkModel(model)];
  return models.flatMap(m => candidates(m, i, j).map(publicSet));
}

function checkModel(model) {
  const m = String(model ?? "").toUpperCase();
  if (![...ACTIVITY_MODELS, ...EOS_MODELS].includes(m)) {
    throw fail("BAD_INPUT", `Unknown model "${model}". Parameter sets exist for ${[...ACTIVITY_MODELS, ...EOS_MODELS].join(", ")}.`);
  }
  return m;
}

const finite = (v, what) => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw fail("BAD_INPUT", `library.add: ${what} must be a finite number (got ${JSON.stringify(v)}).`);
  return v;
};

function range(v, what) {
  if (!Array.isArray(v) || v.length !== 2) throw fail("BAD_INPUT", `library.add: valid.${what} must be [low, high].`);
  const [lo, hi] = v.map(x => finite(x, `valid.${what}`));
  if (!(lo > 0 && hi >= lo)) throw fail("BAD_INPUT", `library.add: valid.${what} must be positive with low <= high (got [${lo}, ${hi}]).`);
  return [lo, hi];
}

/**
 * Add a parameter set given in the page (tier "user"). Session only: it is not saved and no
 * reviewer has checked it.
 *
 * @param {object} spec
 * @param {"NRTL"|"UNIQUAC"|"PR"|"SRK"} spec.model
 * @param {string} spec.i, spec.j    the two components (the parameters are for i, j in this order)
 * @param {string} spec.set          a name, unique for the pair and model
 * @param {object} spec.params       NRTL: b_ij, b_ji (K), optional a_ij, a_ji (default 0), alpha (default 0.3);
 *                                   UNIQUAC: b_ij, b_ji (K), optional a_ij, a_ji; PR, SRK: kij
 * @param {object} [spec.source]     { title, url or doi, authors, year, access }, or
 * @param {string[]} [spec.source_ids]  ids of sources already in the library
 * @param {{T_K?:number[], P_kPa?:number[]}} [spec.valid]  range of the data; outside it results warn
 * @returns {object} the set, as library.sets() lists it
 *
 * @example
 * CHEPTA.library.add({ model: "NRTL", i: "water", j: "ethanol", set: "my-paper",
 *   params: { b_ij: 670, b_ji: -40, alpha: 0.3 }, source: { title: "My measurements", url: "https://..." } });
 */
function add(spec) {
  if (!spec || typeof spec !== "object") throw fail("BAD_INPUT", "library.add needs an object: { model, i, j, set, params, source }.");
  const model = checkModel(spec.model);
  const i = findComponent(spec.i ?? ""), j = findComponent(spec.j ?? "");
  if (i === j) throw fail("BAD_INPUT", "library.add: i and j must be two different components.");
  const set = typeof spec.set === "string" ? spec.set.trim() : "";
  if (!set) throw fail("BAD_INPUT", 'library.add: give the set a name, e.g. set: "my-paper".');
  const taken = candidates(model, i, j).map(c => c.set);
  if (taken.includes(set)) throw fail("BAD_INPUT", `library.add: ${model} ${nameOf(i)} + ${nameOf(j)} already has a set "${set}". Sets: ${taken.join(", ")}.`);

  const given = spec.params;
  if (!given || typeof given !== "object") throw fail("BAD_INPUT", `library.add: params is required (${model}: ${PARAM_KEYS[model].join(", ")}).`);
  for (const k of Object.keys(given)) if (!PARAM_KEYS[model].includes(k)) throw fail("BAD_INPUT", `library.add: unknown ${model} parameter "${k}". Use: ${PARAM_KEYS[model].join(", ")}.`);
  let params;
  if (EOS_MODELS.includes(model)) {
    const k = finite(given.kij, "params.kij");
    if (Math.abs(k) >= 1) throw fail("BAD_INPUT", `library.add: k_ij = ${k} is outside -1 < k_ij < 1.`);
    params = { kij: k };
  } else {
    if (given.b_ij == null || given.b_ji == null) throw fail("BAD_INPUT", "library.add: params needs b_ij and b_ji (K); a_ij and a_ji are optional (default 0).");
    params = { a_ij: finite(given.a_ij ?? 0, "params.a_ij"), a_ji: finite(given.a_ji ?? 0, "params.a_ji"), b_ij: finite(given.b_ij, "params.b_ij"), b_ji: finite(given.b_ji, "params.b_ji") };
    if (model === "NRTL") {
      params.alpha = finite(given.alpha ?? 0.3, "params.alpha");
      if (!(params.alpha > 0 && params.alpha < 1)) throw fail("BAD_INPUT", `library.add: NRTL alpha must be between 0 and 1 (got ${params.alpha}).`);
    }
  }

  let valid = null;
  if (spec.valid != null) {
    if (typeof spec.valid !== "object") throw fail("BAD_INPUT", "library.add: valid must be { T_K: [low, high], P_kPa: [low, high] }.");
    valid = {};
    if (spec.valid.T_K != null) valid.T_K = range(spec.valid.T_K, "T_K");
    if (spec.valid.P_kPa != null) valid.P_kPa = range(spec.valid.P_kPa, "P_kPa");
  }

  // the source last: nothing is registered when the input is wrong
  let ids;
  if (spec.source_ids != null) {
    if (!Array.isArray(spec.source_ids) || !spec.source_ids.length) throw fail("BAD_INPUT", "library.add: source_ids must be a non-empty list of source ids.");
    for (const id of spec.source_ids) if (!sourceEntry(id)) throw fail("BAD_INPUT", `library.add: unknown source "${id}". Give source: { title, url } instead.`);
    ids = spec.source_ids.slice();
  } else if (spec.source && typeof spec.source === "object") {
    const s = spec.source;
    if (!s.title || typeof s.title !== "string") throw fail("BAD_INPUT", "library.add: source needs a title.");
    if (s.url != null && !/^https?:\/\//.test(String(s.url))) throw fail("BAD_INPUT", `library.add: source.url must start with http:// or https:// (got ${JSON.stringify(s.url)}).`);
    if (!s.url && !s.doi) throw fail("BAD_INPUT", "library.add: source needs a url or a doi, so that others can check it.");
    let id = "user-" + (s.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "source");
    for (let n = 2; userSources.has(id) || sourcesData.sources[id]; n++) id = id.replace(/-\d+$/, "") + "-" + n;
    const entry = { title: s.title, kind: "user", access: s.access ? String(s.access) : "Supplied in this page; not checked by CHEPTA's reviewers" };
    for (const k of ["authors", "year", "doi", "url", "published"]) if (s[k] != null) entry[k] = s[k];
    userSources.set(id, entry);
    ids = [id];
  } else {
    throw fail("BAD_INPUT", "library.add: give source: { title, url } (or source_ids of sources in the library), so that the set can be traced.");
  }

  const title = ids.map(id => sourceEntry(id).title).join("; ");
  const rec = {
    model, i, j, set, default: false, tier: "user", source_ids: ids, source: `Given in this page: ${title}`,
    valid, T_range_K: null, params, origin: "page",
  };
  userSets.push(rec);
  usedByCache = null;
  return publicSet(rec);
}

/**
 * CHEPTA.library: browse the sources and parameter sets, and add sets for this page.
 */
export const library = { sources, source, sets, usedBy, add, tiers: TIERS.slice() };
