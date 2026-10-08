/**
 * Flowsheet solver (layer 5; proposal 0006, step 3; roadmap A8).
 *
 *   Fugacity.solveFlowsheet(sys, {
 *     blocks:  [{ id: "F1", type: "feed", spec: { ... } }, { id: "M1", type: "mixer" }, ...],
 *     streams: [{ id: "S1", from: "F1.out", to: "M1.in" }, ..., { id: "S5", from: "SP1.out", to: "M1.in", tear: true }],
 *     solver:  { maxIterations: 50, tolerance: 1e-8 }
 *   })
 *   → { streams: { S1: stream, ... }, blocks: { M1: { duty_kW, balance, notes }, ... },
 *       order, loops: [{ blocks, tears, iterations }], balance: { material_kmol_h, energy_kW } }
 *
 * Sequential modular:
 *  1. Blocks are nodes and streams are edges. Strongly connected components (Tarjan's
 *     depth-first search) are the loops; the components are calculated in topological order.
 *  2. In a loop, the tear streams are those marked `tear: true`, else the smallest set of the
 *     loop's streams whose removal leaves no cycle (searched by increasing size), the tear
 *     selection of pyomo.network (3-clause BSD; module foqus_graph, after FOQUS).
 *  3. The loop is converged on the tear streams' component flows: two steps of direct
 *     substitution, then Wegstein per flow as implemented in pyomo.network
 *     (SequentialDecomposition.solve_tear_wegstein):
 *       s = (g(x) - g(x_prev)) / (x - x_prev),  q = s / (s - 1) bounded to [-5, 0],
 *       x_new = q x + (1 - q) g(x)
 *     The accelerated tear stream is flashed at the temperature and pressure just calculated
 *     for it (extrapolating the enthalpy flow as well can push the temperature out of range).
 *     The start of a tear stream is its `guess` ({ flow_kmol_h, T_K, P_kPa }), else no flow.
 *     Converged when every component flow and the temperature of every tear stream change by
 *     less than `tolerance` (relative to the tear stream's total flow and to its
 *     temperature).
 *  4. A loop that does not converge throws NO_CONVERGENCE naming the loop, the tear streams,
 *     the remaining change and what usually helps; no numbers are returned.
 * References: https://pyomo.readthedocs.io/en/6.9.3/_modules/pyomo/network/foqus_graph.html and
 * https://pyomo.readthedocs.io/en/6.4.0/_modules/pyomo/network/decomposition.html (open source,
 * 3-clause BSD); Tarjan, SIAM Journal on Computing 1(2), 1972 (as cited there).
 * Units: K, kPa, kmol/h, kW.
 */
import { fail } from "../util/errors.js";
import { stream } from "../stream/stream.js";
import { runUnit, unitType, specStatus } from "../units/units.js";

/** Solver settings: `method` "wegstein" (direct substitution for two steps, then bounded Wegstein)
 *  or "direct" (direct substitution only: slower, never overshoots). */
export const SOLVER_DEFAULTS = Object.freeze({ method: "wegstein", maxIterations: 50, tolerance: 1e-8, accelMin: -5, accelMax: 0 });
export const SOLVER_METHODS = ["wegstein", "direct"];

/** "B1.out" → { block: "B1", port: "out" } */
function endpoint(text, what, sid) {
  const m = /^([^.\s]+)\.([a-z0-9]+)$/i.exec(String(text ?? ""));
  if (!m) throw fail("BAD_INPUT", `Stream ${sid}: ${what} must be written "BLOCK.port", e.g. "V1.vapour" (got ${JSON.stringify(text)}).`);
  return { block: m[1], port: m[2] };
}

/**
 * The flowsheet's structure with every problem found, without stopping at the first:
 * { blocks: Map, edges, problems: [{ where, message }] }. A problem names its block or stream
 * (`where`); blocks of unknown types are left out of `blocks`.
 */
export function inspectFlowsheet(fs) {
  const problems = [];
  const add = (where, message) => problems.push({ where, message });
  const byId = new Map(), edges = [];
  if (!fs || typeof fs !== "object") { add(null, "The flowsheet must be an object with blocks and streams."); return { blocks: byId, edges, problems }; }
  const blocks = Array.isArray(fs.blocks) ? fs.blocks : [];
  const streams = Array.isArray(fs.streams) ? fs.streams : [];
  if (!blocks.length) add(null, "The flowsheet has no blocks.");
  const known = new Set();
  for (const b of blocks) {
    if (!b || typeof b.id !== "string" || !b.id) { add(null, "Every block needs an id such as \"V1\"."); continue; }
    if (known.has(b.id)) { add(b.id, `Two blocks are called ${b.id}.`); continue; }
    known.add(b.id);
    let u;
    try { u = unitType(b.type); } catch (e) { add(b.id, `${b.id}: ${e.message}`); continue; }
    byId.set(b.id, { id: b.id, type: b.type, unit: u, spec: b.spec ?? {}, energy: b.energy ?? null, ins: {}, outs: {} });
  }
  const sids = new Set();
  for (const s of streams) {
    if (!s || typeof s.id !== "string" || !s.id) { add(null, "Every stream needs an id such as \"S1\"."); continue; }
    if (sids.has(s.id)) { add(s.id, `Two streams are called ${s.id}.`); continue; }
    sids.add(s.id);
    let from, to;
    try { from = endpoint(s.from, "from", s.id); to = endpoint(s.to, "to", s.id); } catch (e) { add(s.id, e.message); continue; }
    const a = byId.get(from.block), b = byId.get(to.block);
    if (!a && !known.has(from.block)) { add(s.id, `Stream ${s.id} comes from ${from.block}, which is not a block of the flowsheet.`); continue; }
    if (!b && !known.has(to.block)) { add(s.id, `Stream ${s.id} goes to ${to.block}, which is not a block of the flowsheet.`); continue; }
    if (!a || !b) continue;   // a block of unknown type: already reported
    if (!a.unit.outlets.some(p => p.port === from.port)) { add(s.id, `Stream ${s.id}: ${a.unit.label} ${a.id} has no outlet "${from.port}"; its outlets: ${a.unit.outlets.map(p => p.port).join(", ") || "none"}.`); continue; }
    if (!b.unit.inlets.some(p => p.port === to.port)) { add(s.id, `Stream ${s.id}: ${b.unit.label} ${b.id} has no inlet "${to.port}"; its inlets: ${b.unit.inlets.map(p => p.port).join(", ") || "none"}.`); continue; }
    (a.outs[from.port] ??= []).push(s.id);
    (b.ins[to.port] ??= []).push(s.id);
    edges.push({ id: s.id, from: a.id, fromPort: from.port, to: b.id, toPort: to.port, tear: !!s.tear, guess: s.guess ?? null });
  }
  const energyIds = new Set();
  for (const b of byId.values()) {
    for (const p of b.unit.inlets) {
      const n = (b.ins[p.port] ?? []).length;
      if (n < p.min) add(b.id, `${b.unit.label} ${b.id}: connect ${p.min === 1 ? "a stream" : `at least ${p.min} streams`} to its ${p.label} inlet.`);
      if (n > p.max) add(b.id, `${b.unit.label} ${b.id}: its ${p.label} inlet takes ${p.max === 1 ? "one stream" : `at most ${p.max}`} (${n} connected).`);
    }
    for (const p of b.unit.outlets) {
      const n = (b.outs[p.port] ?? []).length;
      if (!p.optional && n < p.min) add(b.id, `${b.unit.label} ${b.id}: connect ${p.min === 1 ? "a stream" : `at least ${p.min} streams`} to its ${p.label} outlet${p.min === 1 ? " (end it with a Product block if it leaves the flowsheet)" : ""}.`);
      if (n > p.max) add(b.id, `${b.unit.label} ${b.id}: its ${p.label} outlet takes one stream (${n} connected); use a Splitter to divide it.`);
    }
    if (b.unit.duty) {
      const q = energyName(b);
      if (sids.has(q) || energyIds.has(q)) add(b.id, `${b.unit.label} ${b.id}: its energy stream ${q} has the name of another stream.`);
      energyIds.add(q);
    } else if (b.energy) add(b.id, `${b.unit.label} ${b.id} has no duty, so it cannot have an energy stream (${b.energy}).`);
  }
  return { blocks: byId, edges, problems };
}

/** The name of a block's energy stream: given as `energy`, else "Q-" and the block id. */
const energyName = b => b.energy || `Q-${b.id}`;

/**
 * Check the flowsheet's structure and return it with its connections resolved: every block
 * of a known type with a unique id, every stream from an existing outlet port to an
 * existing inlet port, every required port connected. Throws the first problem
 * (inspectFlowsheet lists them all).
 */
export function checkFlowsheet(fs) {
  const r = inspectFlowsheet(fs);
  if (r.problems.length) throw fail("BAD_INPUT", r.problems[0].message, { problems: r.problems });
  return { blocks: r.blocks, edges: r.edges };
}

/**
 * Is the flowsheet ready to solve? Its structure, and the degrees of freedom of every block
 * (units.js specStatus): what each needs, what is given, what is missing or too much.
 * @returns {{ready:boolean, needed:number, given:number, structure:object[], blocks:Object<string,object>, message:string}}
 */
export function flowsheetStatus(sys, fs) {
  const { blocks, problems } = inspectFlowsheet(fs);
  const out = {};
  let needed = 0, given = 0;
  for (const b of blocks.values()) {
    const multi = b.unit.outlets.find(p => p.max > 1);
    const outletCount = multi ? Math.max((b.outs[multi.port] ?? []).length, multi.min) : undefined;
    const st = specStatus(b.type, b.spec, { sys, outletCount });
    // name the block in the message: "Flash drum V1: ..."
    out[b.id] = st.message ? { ...st, message: st.message.startsWith(`${b.unit.label}:`) ? `${b.unit.label} ${b.id}:${st.message.slice(b.unit.label.length + 1)}` : `${b.unit.label} ${b.id}: ${st.message}` } : st;
    needed += st.needed ?? 0; given += st.given ?? 0;
  }
  const bad = Object.entries(out).filter(([, st]) => !st.ok);
  const ready = !problems.length && !bad.length;
  const missing = Object.values(out).reduce((a, st) => a + (st.status === "missing" ? Math.max(1, (st.needed ?? 0) - (st.given ?? 0)) : 0), 0);
  const extra = Object.values(out).reduce((a, st) => a + (st.status === "extra" ? Math.max(1, (st.given ?? 0) - (st.needed ?? 0)) : 0), 0);
  const message = ready
    ? `Degrees of freedom: 0 (${given} specification${given === 1 ? "" : "s"} for ${needed} needed). Ready to solve.`
    : [problems.length ? `${problems.length} connection problem${problems.length === 1 ? "" : "s"}` : "",
      missing ? `${missing} specification${missing === 1 ? "" : "s"} missing` : "",
      extra ? `${extra} too many` : "",
      bad.some(([, st]) => st.status === "invalid") ? "a value to correct" : ""].filter(Boolean).join(", ") + ".";
  return { ready, needed, given, dof: needed - given, structure: problems, blocks: out, message: message[0].toUpperCase() + message.slice(1) };
}

/** Strongly connected components of a directed graph (Tarjan), in reverse topological order. */
function tarjan(nodes, next) {
  let index = 0;
  const idx = new Map(), low = new Map(), on = new Set(), st = [], out = [];
  const visit = v => {
    idx.set(v, index); low.set(v, index); index++; st.push(v); on.add(v);
    for (const w of next(v)) {
      if (!idx.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) {
      const comp = [];
      let w;
      do { w = st.pop(); on.delete(w); comp.push(w); } while (w !== v);
      out.push(comp);
    }
  };
  for (const v of nodes) if (!idx.has(v)) visit(v);
  return out;
}

/** Is the graph of these nodes and edges free of cycles? (Kahn's algorithm) */
function acyclic(nodes, edges) {
  const indeg = new Map(nodes.map(n => [n, 0]));
  for (const e of edges) indeg.set(e.to, indeg.get(e.to) + 1);
  const q = nodes.filter(n => indeg.get(n) === 0);
  let seen = 0;
  while (q.length) {
    const n = q.shift(); seen++;
    for (const e of edges) if (e.from === n) { indeg.set(e.to, indeg.get(e.to) - 1); if (indeg.get(e.to) === 0) q.push(e.to); }
  }
  return seen === nodes.length;
}

/** Topological order of the nodes after removing the edges in `cut`. */
function order(nodes, edges) {
  const indeg = new Map(nodes.map(n => [n, 0]));
  for (const e of edges) indeg.set(e.to, indeg.get(e.to) + 1);
  const q = nodes.filter(n => indeg.get(n) === 0), out = [];
  while (q.length) {
    const n = q.shift(); out.push(n);
    for (const e of edges) if (e.from === n) { indeg.set(e.to, indeg.get(e.to) - 1); if (indeg.get(e.to) === 0) q.push(e.to); }
  }
  return out;
}

/** The smallest set of edges whose removal breaks every cycle of the loop. */
function chooseTears(nodes, edges) {
  const marked = edges.filter(e => e.tear);
  if (marked.length) {
    const rest = edges.filter(e => !e.tear);
    if (!acyclic(nodes, rest)) throw fail("BAD_INPUT", `The streams marked as tear streams (${marked.map(e => e.id).join(", ")}) do not break every cycle of the loop ${nodes.join(", ")}; mark another stream or none (the solver then chooses).`);
    return marked;
  }
  const m = edges.length;
  const pick = (start, k, chosen) => {
    if (chosen.length === k) {
      const cut = new Set(chosen);
      return acyclic(nodes, edges.filter((_, i) => !cut.has(i))) ? chosen.slice() : null;
    }
    for (let i = start; i < m; i++) { chosen.push(i); const r = pick(i + 1, k, chosen); chosen.pop(); if (r) return r; }
    return null;
  };
  for (let k = 1; k <= Math.min(m, 4); k++) {
    const r = pick(0, k, []);
    if (r) return r.map(i => edges[i]);
  }
  throw fail("BAD_INPUT", `The loop ${nodes.join(", ")} needs more than four tear streams; mark the tear streams yourself.`);
}

/**
 * Solve a flowsheet with a property package.
 * @param {object} sys  the system (components and method) every stream uses
 * @param {object} fs   { blocks, streams, solver }
 */
export function solveFlowsheet(sys, fs) {
  if (!sys || typeof sys.flash !== "function") throw fail("BAD_INPUT", "solveFlowsheet: the first argument must be a system, e.g. Fugacity.system({ components, model }).");
  const opt = { ...SOLVER_DEFAULTS, ...(fs?.solver ?? {}) };
  if (!(Number.isInteger(opt.maxIterations) && opt.maxIterations >= 1)) throw fail("BAD_INPUT", `solver.maxIterations must be a positive whole number (got ${opt.maxIterations}).`);
  if (!(opt.tolerance > 0 && opt.tolerance < 0.1)) throw fail("BAD_INPUT", `solver.tolerance must be between 0 and 0.1 (got ${opt.tolerance}).`);
  if (!SOLVER_METHODS.includes(opt.method)) throw fail("BAD_INPUT", `solver.method "${opt.method}" is not one of ${SOLVER_METHODS.join(", ")}.`);
  const status = flowsheetStatus(sys, fs);
  if (!status.ready) {
    const lines = [...status.structure.map(p => p.message), ...Object.values(status.blocks).filter(b => !b.ok).map(b => b.message)];
    throw fail("BAD_INPUT", `The flowsheet is not ready to solve: ${status.message} ${lines.join(" ")}`, { status });
  }
  const { blocks, edges } = checkFlowsheet(fs);
  const nodes = [...blocks.keys()];
  const values = new Map();   // stream id → stream
  const results = {};
  const outEdges = id => edges.filter(e => e.from === id);

  /** Calculate one block from the streams known now, and store its outlet streams. */
  const calc = id => {
    const b = blocks.get(id);
    const inlets = {};
    for (const [port, sids] of Object.entries(b.ins)) inlets[port] = sids.map(s => values.get(s));
    const multi = b.unit.outlets.find(p => p.max > 1);
    const outletCount = multi ? (b.outs[multi.port] ?? []).length : b.unit.outlets.filter(p => !p.optional || (b.outs[p.port] ?? []).length).length;
    let r;
    try { r = runUnit(b.type, { sys, inlets, spec: b.spec, outletCount }); } catch (e) {
      e.message = `${b.unit.label} ${b.id}: ${e.message.replace(new RegExp(`^${b.unit.label}: `), "")}`;
      throw e;
    }
    for (const [port, sids] of Object.entries(b.outs)) {
      const got = r.outlets[port];
      const list = Array.isArray(got) ? got : [got];
      sids.forEach((sid, k) => values.set(sid, Object.freeze({ ...list[k], id: sid })));
    }
    results[id] = { type: b.type, duty_kW: r.duty_kW, balance: r.balance, notes: r.notes, ...(r.state ? { state: r.state } : {}) };
  };

  const comps = tarjan(nodes, id => outEdges(id).map(e => e.to)).reverse();   // topological order
  const inLoop = new Set(comps.flatMap(c => { const set = new Set(c); return edges.filter(e => set.has(e.from) && set.has(e.to)).map(e => e.id); }));
  const stray = edges.filter(e => e.tear && !inLoop.has(e.id));
  if (stray.length) throw fail("BAD_INPUT", `${stray.map(e => e.id).join(", ")} ${stray.length > 1 ? "are" : "is"} marked as a tear stream but ${stray.length > 1 ? "are" : "is"} not part of a recycle loop.`);
  const loops = [];
  for (const comp of comps) {
    const set = new Set(comp);
    const inner = edges.filter(e => set.has(e.from) && set.has(e.to));
    if (!inner.length) { calc(comp[0]); continue; }
    const tears = chooseTears(comp, inner);
    const tearIds = new Set(tears.map(e => e.id));
    const seq = order(comp, inner.filter(e => !tearIds.has(e.id)));
    // start: the guess, else no flow (at the guess's or 298.15 K and the lowest known pressure)
    for (const e of tears) {
      const g = e.guess ?? {};
      values.set(e.id, Object.freeze({ ...stream(sys, { flow_kmol_h: g.flow_kmol_h ?? new Array(sys.n).fill(0), T_K: g.T_K ?? 298.15, P_kPa: g.P_kPa ?? 101.325 }), id: e.id }));
    }
    const vec = s => s.flows.slice();
    let x = tears.map(e => vec(values.get(e.id)));
    let xPrev = null, gPrev = null, it = 0, err = Infinity;
    const history = [];
    const stop = (why, extra = {}) => fail("NO_CONVERGENCE",
      `The loop through ${seq.join(", ")} did not converge${why}. What usually helps: a purge or a smaller recycle fraction (a recycle with no way out keeps growing), a guess for the tear stream${tears.length > 1 ? "s" : ""} (${tears.map(e => e.id).join(", ")}) close to the answer, another tear stream, or more iterations.`,
      { loop: comp, tears: tears.map(e => e.id), history, ...extra });
    for (; it < opt.maxIterations; it++) {
      const before = tears.map(e => values.get(e.id));
      try { for (const id of seq) calc(id); } catch (e) {
        if (it === 0) {
          // the first pass is a plain calculation: its error is the block's own, but its inlets are those of
          // the start values of the tear streams (no flow, unless guessed), not of the converged loop
          if (!tears.every(t => t.guess)) {
            e.message += ` (This happened in the first pass through the loop ${seq.join(", ")}, with the tear stream${tears.length > 1 ? "s" : ""} ${tears.map(t => t.id).join(", ")} at ${tears.length > 1 ? "their" : "its"} start value${tears.length > 1 ? "s" : ""}: no flow unless a guess is given. A guess close to the answer may avoid this state.)`;
          }
          throw e;
        }
        // a state the property method cannot handle (two liquids with an equation of state) is not a
        // convergence problem: keep its code, with the loop as context
        if (e && e.code === "PHASE_SPLIT") {
          e.message = `In the loop through ${seq.join(", ")}, at iteration ${it + 1}: ${e.message}`;
          throw e;
        }
        throw stop(`: at iteration ${it + 1}, ${e.message}`, { cause: e.message });
      }
      const after = tears.map(e => values.get(e.id));
      const g = after.map(vec);
      // the change of the tear streams: flows relative to the total flow, T relative to T
      err = Math.max(...after.map((s, k) => {
        const Fs = Math.max(s.F_kmol_h, before[k].F_kmol_h);
        const dF = Fs > 0 ? Math.max(...s.flows.map((v, i) => Math.abs(v - before[k].flows[i]))) / Fs : 0;
        const dT = s.T_K != null && before[k].T_K != null && Fs > 0 ? Math.abs(s.T_K - before[k].T_K) / s.T_K : 0;
        return Math.max(dF, dT);
      }));
      history.push(err);
      if (err < opt.tolerance) { it++; break; }
      // next tear values: direct substitution for two steps, then bounded Wegstein per variable
      let xNew = g;
      if (opt.method === "wegstein" && it >= 2 && xPrev) {
        xNew = g.map((gk, k) => gk.map((gi, i) => {
          const dx = x[k][i] - xPrev[k][i];
          const s = dx !== 0 ? (gi - gPrev[k][i]) / dx : 0;
          let q = s !== 1 ? s / (s - 1) : opt.accelMin;
          q = Math.min(opt.accelMax, Math.max(opt.accelMin, q));
          return q * x[k][i] + (1 - q) * gi;
        }));
      }
      xPrev = x; gPrev = g; x = xNew;
      tears.forEach((e, k) => {
        const s = after[k];
        const flows = xNew[k].slice(0, sys.n).map(v => Math.max(0, v));
        const F = flows.reduce((a, v) => a + v, 0);
        const next = xNew === g || !(F > 0) ? s
          : stream(sys, { flow_kmol_h: flows, T_K: s.T_K, P_kPa: s.P_kPa });
        values.set(e.id, Object.freeze({ ...next, id: e.id }));
      });
    }
    if (!(err < opt.tolerance)) {
      throw stop(` in ${opt.maxIterations} iterations: the tear stream${tears.length > 1 ? "s" : ""} still change${tears.length > 1 ? "" : "s"} by ${err.toExponential(2)} (relative) per iteration; the tolerance is ${opt.tolerance}`);
    }
    loops.push({ blocks: seq, tears: tears.map(e => e.id), iterations: it });
  }

  // overall balances: feeds in, products out
  const feeds = nodes.filter(id => blocks.get(id).type === "feed").flatMap(id => outEdges(id).map(e => values.get(e.id)));
  const products = nodes.filter(id => blocks.get(id).type === "product").flatMap(id => (blocks.get(id).ins.in ?? []).map(s => values.get(s)));
  const sum = list => list.reduce((acc, s) => acc.map((v, i) => v + s.flows[i]), new Array(sys.n).fill(0));
  const fin = sum(feeds), fout = sum(products);
  const duties = Object.values(results).reduce((a, r) => a + (r.duty_kW ?? 0), 0);
  const H = list => list.reduce((a, s) => a + (s.H_kW ?? 0), 0);
  // energy streams: one per block with a duty (heater, drum, separator), in kW (+ heat in, - heat out)
  const energy = Object.fromEntries([...blocks.values()].filter(b => b.unit.duty)
    .map(b => [energyName(b), { id: energyName(b), block: b.id, duty_kW: results[b.id]?.duty_kW ?? 0 }]));
  return {
    components: sys.ids.slice(),
    streams: Object.fromEntries(edges.map(e => [e.id, values.get(e.id)])),
    energy,
    blocks: results,
    order: comps.map(c => (c.length === 1 && !edges.some(e => e.from === c[0] && e.to === c[0]) ? c[0] : c)),
    loops,
    balance: {
      material_kmol_h: Object.fromEntries(sys.ids.map((id, i) => [id, fin[i] - fout[i]])),
      energy_kW: H(feeds) + duties - H(products),
    },
  };
}
