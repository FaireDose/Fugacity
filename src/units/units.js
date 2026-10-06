/**
 * Blocks (unit operations; layer 4; proposal 0006, step 2; roadmap A6).
 *
 * Every block type is registered with the same shape (ARCHITECTURE.md, layer 4):
 *
 *   registerUnit({
 *     type: "heater", label: "Heater / cooler",
 *     inlets:  [{ port: "in" }],                       // { port, min?, max? }: several streams on
 *     outlets: [{ port: "out" }],                      //   one port when max > 1
 *     checkSpec(spec, ctx) → spec,                     // normalized, or a BAD_INPUT error naming the problem
 *     solve({ sys, inlets, spec, outletCount }) → { outlets: { port: stream | stream[] }, duty_kW, notes }
 *   })
 *
 * and is calculated with runUnit(type, { sys, inlets, spec, outletCount }), which checks the
 * ports and the specification, runs the block, and checks its balances:
 *  - material: every component's flow in = flow out to 1e-9 relative (a failure is a bug in
 *    the block and throws);
 *  - energy: the enthalpy flows in + duty = out, reported (`balance.energy_kW` is the
 *    difference, zero to rounding for the blocks here).
 *
 * The first blocks: feed, mixer, splitter, separator (component splitter), flash (drum),
 * heater (heater / cooler), product. They are steady-state material and energy balances
 * around the flash and the stream of layers 2 and 3; nothing here is a correlation.
 * Units: K, kPa, kmol/h, kW.
 */
import { fail } from "../util/errors.js";
import { stream, componentFlows, scaleStream, phaseStream } from "../stream/stream.js";
import { findComponent } from "../thermo/components.js";

const UNITS = new Map();

/** Register a block type (see the file header). Replacing a type needs { replace: true }. */
export function registerUnit(def, { replace = false } = {}) {
  if (!def || typeof def.type !== "string" || !/^[a-z][a-z0-9-]*$/.test(def.type)) throw fail("BAD_INPUT", "registerUnit: type must be a lower-case name such as \"heater\".");
  if (UNITS.has(def.type) && !replace) throw fail("BAD_INPUT", `registerUnit: "${def.type}" is already registered.`);
  if (typeof def.solve !== "function") throw fail("BAD_INPUT", `registerUnit: "${def.type}" needs a solve function.`);
  const ports = list => (list ?? []).map(p => ({ port: p.port, min: p.min ?? 1, max: p.max ?? 1, optional: !!p.optional, label: p.label ?? p.port }));
  UNITS.set(def.type, Object.freeze({ ...def, label: def.label ?? def.type, inlets: ports(def.inlets), outlets: ports(def.outlets) }));
}

/** A registered block type, or a BAD_INPUT error listing the known ones. */
export function unitType(type) {
  const u = UNITS.get(type);
  if (!u) throw fail("BAD_INPUT", `Unknown block type "${type}". Known: ${[...UNITS.keys()].join(", ")}.`);
  return u;
}

/** The registered block types, in registration order. */
export const unitTypes = () => [...UNITS.values()];

const num = (v, what, { min = -Infinity, positive = false } = {}) => {
  const x = Number(v);
  if (!Number.isFinite(x) || (positive && !(x > 0)) || x < min) {
    throw fail("BAD_INPUT", `${what} must be ${positive ? "a positive number" : min > -Infinity ? `a number of at least ${min}` : "a number"} (got ${JSON.stringify(v)}).`);
  }
  return x;
};
const asList = v => (v == null ? [] : Array.isArray(v) ? v : [v]);

/**
 * Split fractions over n outlets: numbers between 0 and 1, at most one "rest" (what the
 * others leave), adding up to 1 within 1e-9.
 */
export function splitFractions(fr, n, what) {
  if (!Array.isArray(fr)) throw fail("BAD_INPUT", `${what}: give one fraction per outlet as a list, e.g. [0.8, "rest"].`);
  if (fr.length !== n) throw fail("BAD_INPUT", `${what}: ${fr.length} fraction${fr.length === 1 ? "" : "s"} for ${n} outlets.`);
  const rest = fr.map((v, i) => (v === "rest" ? i : -1)).filter(i => i >= 0);
  if (rest.length > 1) throw fail("BAD_INPUT", `${what}: only one outlet can take "rest".`);
  const vals = fr.map((v, i) => (v === "rest" ? 0 : num(v, `${what}, outlet ${i + 1}`, { min: 0 })));
  vals.forEach((v, i) => { if (v > 1) throw fail("BAD_INPUT", `${what}, outlet ${i + 1}: a fraction cannot be above 1 (got ${v}).`); });
  const sum = vals.reduce((a, v) => a + v, 0);
  if (rest.length) {
    if (sum > 1 + 1e-9) throw fail("BAD_INPUT", `${what}: the fractions add up to ${+sum.toPrecision(6)} before "rest"; they must leave something (at most 1).`);
    vals[rest[0]] = Math.max(0, 1 - sum);
  } else if (Math.abs(sum - 1) > 1e-9) {
    throw fail("BAD_INPUT", `${what}: the fractions add up to ${+sum.toPrecision(6)}; they must add up to 1 (or give one outlet "rest").`);
  }
  return vals;
}

/** The conditions of a flash specification: two of T_K, P_kPa, VF and (with an inlet) duty_kW. */
function flashConditions(spec, what, { duty = true } = {}) {
  const has = k => spec[k] !== undefined && spec[k] !== null;
  const keys = ["T_K", "P_kPa", "VF", ...(duty ? ["duty_kW"] : [])].filter(has);
  const kind = keys.slice().sort().join("+");
  const KINDS = ["P_kPa+T_K", "P_kPa+VF", "T_K+VF", ...(duty ? ["P_kPa+duty_kW"] : [])];
  if (!KINDS.includes(kind)) {
    throw fail("BAD_INPUT", `${what}: give ${duty ? "T_K and P_kPa, P_kPa and duty_kW, P_kPa and VF, or T_K and VF" : "T_K and P_kPa, P_kPa and VF, or T_K and VF"} (got ${keys.join(", ") || "none"}).`);
  }
  const out = {};
  if (has("T_K")) out.T_K = num(spec.T_K, `${what}: T_K`, { positive: true });
  if (has("P_kPa")) out.P_kPa = num(spec.P_kPa, `${what}: P_kPa`, { positive: true });
  if (has("VF")) { out.VF = num(spec.VF, `${what}: VF`, { min: 0 }); if (out.VF > 1) throw fail("BAD_INPUT", `${what}: VF must be between 0 and 1 (got ${spec.VF}).`); }
  if (has("duty_kW")) out.duty_kW = num(spec.duty_kW, `${what}: duty_kW`);
  return out;
}

/** The outlet stream of a block that brings `flows` with enthalpy flow H_in to the given conditions. */
function outletAt(sys, flows, H_in_kW, c, id) {
  const spec = { id, flow_kmol_h: flows };
  if (c.duty_kW != null) return stream(sys, { ...spec, P_kPa: c.P_kPa, H_kW: H_in_kW + c.duty_kW });
  return stream(sys, { ...spec, ...c });
}

const sumFlows = (sys, list) => list.reduce((acc, s) => acc.map((v, i) => v + s.flows[i]), new Array(sys.n).fill(0));
const sumH = list => list.reduce((a, s) => a + (s.H_kW ?? 0), 0);

// ---------------------------------------------------------------------------------------
// The first blocks

registerUnit({
  type: "feed", label: "Feed", inlets: [], outlets: [{ port: "out" }],
  checkSpec(spec, { sys }) {
    if (spec.flow_kmol_h == null && spec.flow_kg_h == null) throw fail("BAD_INPUT", "Feed: give the flows, flow_kmol_h or flow_kg_h, e.g. { water: 60, ethanol: 40 }.");
    if (spec.flow_kmol_h != null && spec.flow_kg_h != null) throw fail("BAD_INPUT", "Feed: give flow_kmol_h or flow_kg_h, not both.");
    const flows = spec.flow_kg_h != null ? componentFlows(sys, spec.flow_kg_h, "kg/h") : componentFlows(sys, spec.flow_kmol_h);
    return { flows, ...flashConditions(spec, "Feed", { duty: false }) };
  },
  solve({ sys, spec }) {
    const { flows, ...c } = spec;
    return { outlets: { out: stream(sys, { flow_kmol_h: flows, ...c }) }, duty_kW: 0 };
  },
});

registerUnit({
  type: "mixer", label: "Mixer", inlets: [{ port: "in", min: 1, max: Infinity }], outlets: [{ port: "out" }],
  checkSpec(spec) {
    return spec.P_kPa == null ? {} : { P_kPa: num(spec.P_kPa, "Mixer: P_kPa", { positive: true }) };
  },
  solve({ sys, inlets, spec }) {
    const ins = inlets.in;
    const flows = sumFlows(sys, ins);
    const Ps = ins.map(s => s.P_kPa).filter(p => p != null);
    const P = spec.P_kPa ?? Math.min(...Ps);
    const notes = [];
    if (spec.P_kPa != null && Ps.some(p => p < spec.P_kPa)) notes.push(`The outlet pressure (${spec.P_kPa} kPa) is above an inlet pressure (${Math.min(...Ps)} kPa): a real mixer needs a pump or compressor on that inlet.`);
    const F = flows.reduce((a, v) => a + v, 0);
    // adiabatic: the outlet has the inlets' enthalpy flow (P-H flash); without flow, the first inlet's T
    const out = F > 0 ? stream(sys, { flow_kmol_h: flows, P_kPa: P, H_kW: sumH(ins) })
      : stream(sys, { flow_kmol_h: flows, T_K: ins.find(s => s.T_K != null)?.T_K ?? 298.15, P_kPa: P });
    return { outlets: { out }, duty_kW: 0, notes };
  },
});

registerUnit({
  type: "splitter", label: "Splitter", inlets: [{ port: "in" }], outlets: [{ port: "out", min: 2, max: Infinity }],
  checkSpec(spec, { outletCount }) {
    return { fractions: splitFractions(asList(spec.fractions), outletCount, "Splitter: fractions") };
  },
  solve({ inlets, spec }) {
    const s = inlets.in[0];
    return { outlets: { out: spec.fractions.map(f => scaleStream(s, f)) }, duty_kW: 0 };
  },
});

registerUnit({
  type: "separator", label: "Component separator", inlets: [{ port: "in" }], outlets: [{ port: "out", min: 2, max: Infinity }],
  checkSpec(spec, { sys, outletCount }) {
    const fr = spec.fractions;
    if (!fr || typeof fr !== "object" || Array.isArray(fr)) throw fail("BAD_INPUT", "Component separator: give the split fractions per component, e.g. { fractions: { ethanol: [0.95, \"rest\"], water: [0.02, \"rest\"] } }.");
    const byId = new Map();
    for (const [key, v] of Object.entries(fr)) {
      let id;
      try { id = findComponent(key); } catch (e) { throw fail("BAD_INPUT", `Component separator: ${e.message}`); }
      const i = sys.ids.indexOf(id);
      if (i < 0) throw fail("BAD_INPUT", `Component separator: ${key} is not a component of this system (${sys.ids.join(", ")}).`);
      byId.set(sys.ids[i], splitFractions(asList(v), outletCount, `Component separator: fractions of ${sys.names[i]}`));
    }
    const missing = sys.ids.filter(id => !byId.has(id));
    if (missing.length) throw fail("BAD_INPUT", `Component separator: give split fractions for every component; missing: ${missing.map(id => sys.names[sys.ids.indexOf(id)]).join(", ")}.`);
    const conds = asList(spec.outlets);
    if (conds.length && conds.length !== outletCount) throw fail("BAD_INPUT", `Component separator: ${conds.length} outlet conditions for ${outletCount} outlets.`);
    return {
      fractions: sys.ids.map(id => byId.get(id)),   // [component][outlet]
      outlets: conds.map((c, k) => (c == null ? null : flashConditions(c, `Component separator, outlet ${k + 1}`, { duty: false }))),
    };
  },
  solve({ sys, inlets, spec, outletCount }) {
    const s = inlets.in[0];
    const outs = [];
    for (let k = 0; k < outletCount; k++) {
      const flows = s.flows.map((v, i) => v * spec.fractions[i][k]);
      const c = spec.outlets[k] ?? { T_K: s.T_K, P_kPa: s.P_kPa };   // default: the inlet's T and P
      outs.push(stream(sys, { flow_kmol_h: flows, ...c }));
    }
    // the duty that closes the energy balance of the black-box separation
    return { outlets: { out: outs }, duty_kW: sumH(outs) - (s.H_kW ?? 0) };
  },
});

registerUnit({
  type: "flash", label: "Flash drum", inlets: [{ port: "in", min: 1, max: Infinity }],
  outlets: [{ port: "vapour" }, { port: "liquid" }, { port: "liquid2", optional: true, label: "second liquid" }],
  checkSpec(spec) { return flashConditions(spec, "Flash drum"); },
  solve({ sys, inlets, spec, outletCount }) {
    const ins = inlets.in;
    const all = outletAt(sys, sumFlows(sys, ins), sumH(ins), spec);
    const notes = [];
    const liquids = all.phases.filter(p => p.type === "liquid").length;
    if (liquids > 1 && outletCount < 3) notes.push("The drum holds two liquids; connect the liquid2 outlet to take the second one apart (now both leave by liquid).");
    const outlets = { vapour: phaseStream(all, "vapour") };
    if (liquids > 1 && outletCount < 3) {
      const l1 = phaseStream(all, "liquid", 0), l2 = phaseStream(all, "liquid", 1);
      outlets.liquid = stream(sys, { flow_kmol_h: l1.flows.map((v, i) => v + l2.flows[i]), T_K: all.T_K, P_kPa: all.P_kPa });
    } else {
      outlets.liquid = phaseStream(all, "liquid", 0);
      if (outletCount >= 3) outlets.liquid2 = phaseStream(all, "liquid", 1);
    }
    const out = Object.values(outlets);
    return { outlets, duty_kW: sumH(out) - sumH(ins), notes, state: { T_K: all.T_K, P_kPa: all.P_kPa, VF: all.VF } };
  },
});

registerUnit({
  type: "heater", label: "Heater / cooler", inlets: [{ port: "in" }], outlets: [{ port: "out" }],
  checkSpec(spec) {
    // the outlet: T_K, duty_kW or VF, at P_kPa or the inlet pressure minus dP_kPa; or T_K and VF
    const has = k => spec[k] !== undefined && spec[k] !== null;
    const given = ["T_K", "duty_kW", "VF"].filter(has);
    const TVF = given.length === 2 && has("T_K") && has("VF");
    if (!(given.length === 1 || TVF)) throw fail("BAD_INPUT", `Heater: give the outlet temperature T_K, the duty duty_kW or the vapour fraction VF (or T_K and VF together) (got ${given.join(", ") || "none"}).`);
    if (has("P_kPa") && has("dP_kPa")) throw fail("BAD_INPUT", "Heater: give the outlet pressure P_kPa or the pressure drop dP_kPa, not both.");
    if (TVF && (has("P_kPa") || has("dP_kPa"))) throw fail("BAD_INPUT", "Heater: T_K and VF fix the outlet pressure; leave out P_kPa and dP_kPa.");
    const c = {};
    if (has("T_K")) c.T_K = num(spec.T_K, "Heater: T_K", { positive: true });
    if (has("duty_kW")) c.duty_kW = num(spec.duty_kW, "Heater: duty_kW");
    if (has("VF")) { c.VF = num(spec.VF, "Heater: VF", { min: 0 }); if (c.VF > 1) throw fail("BAD_INPUT", `Heater: VF must be between 0 and 1 (got ${spec.VF}).`); }
    if (has("P_kPa")) c.P_kPa = num(spec.P_kPa, "Heater: P_kPa", { positive: true });
    return { ...c, dP_kPa: has("dP_kPa") ? num(spec.dP_kPa, "Heater: dP_kPa", { min: 0 }) : 0 };
  },
  solve({ sys, inlets, spec }) {
    const s = inlets.in[0];
    const { dP_kPa, ...c } = spec;
    if (c.P_kPa == null && !(c.T_K != null && c.VF != null)) c.P_kPa = s.P_kPa - dP_kPa;   // T and VF fix P themselves
    if (c.P_kPa != null && !(c.P_kPa > 0)) throw fail("BAD_INPUT", `Heater: the pressure drop (${dP_kPa} kPa) is larger than the inlet pressure (${s.P_kPa} kPa).`);
    const out = outletAt(sys, s.flows, s.H_kW ?? 0, c);
    return { outlets: { out }, duty_kW: (out.H_kW ?? 0) - (s.H_kW ?? 0) };
  },
});

registerUnit({
  type: "product", label: "Product", inlets: [{ port: "in" }], outlets: [],
  checkSpec() { return {}; },
  solve() { return { outlets: {}, duty_kW: 0 }; },
});

// ---------------------------------------------------------------------------------------

/**
 * Calculate one block.
 * @param {string} type     a registered block type
 * @param {object} args
 * @param {object} args.sys          the property package (system)
 * @param {object} [args.inlets]     { port: stream | stream[] }
 * @param {object} [args.spec]       the block's specification
 * @param {number} [args.outletCount]  streams on the block's multi-stream outlet port (splitter,
 *   separator: default 2), or the number of outlet ports used (flash: 2, or 3 with liquid2)
 * @returns {{type:string, outlets:object, duty_kW:number, balance:{material:number, energy_kW:number},
 *   notes:string[], state?:object}}
 */
export function runUnit(type, { sys, inlets = {}, spec = {}, outletCount } = {}) {
  const u = unitType(type);
  if (!sys || typeof sys.flash !== "function") throw fail("BAD_INPUT", `${u.label}: a system (property package) is needed.`);
  if (spec == null || typeof spec !== "object" || Array.isArray(spec)) throw fail("BAD_INPUT", `${u.label}: the specification must be an object.`);
  const multiOut = u.outlets.find(p => p.max > 1);
  const n = outletCount ?? (multiOut ? multiOut.min : u.outlets.filter(p => !p.optional).length);
  if (multiOut && n < multiOut.min) throw fail("BAD_INPUT", `${u.label}: at least ${multiOut.min} outlets (got ${n}).`);
  // inlets: each port as a list of streams of this system
  for (const k of Object.keys(inlets)) if (!u.inlets.some(p => p.port === k)) throw fail("BAD_INPUT", `${u.label}: no inlet port "${k}". Ports: ${u.inlets.map(p => p.port).join(", ") || "none"}.`);
  const ins = {};
  for (const p of u.inlets) {
    const list = asList(inlets[p.port]);
    if (list.length < p.min) throw fail("BAD_INPUT", `${u.label}: the ${p.label} port needs ${p.min === 1 ? "a stream" : `at least ${p.min} streams`} (got ${list.length}).`);
    if (list.length > p.max) throw fail("BAD_INPUT", `${u.label}: the ${p.label} port takes ${p.max === 1 ? "one stream" : `at most ${p.max} streams`} (got ${list.length}).`);
    for (const s of list) {
      if (!s || !Array.isArray(s.flows) || s.flows.length !== sys.n || s.components.some((id, i) => id !== sys.ids[i])) {
        throw fail("BAD_INPUT", `${u.label}: an inlet stream${s?.id ? ` (${s.id})` : ""} does not belong to this system (${sys.ids.join(", ")}).`);
      }
    }
    ins[p.port] = list;
  }
  const s = u.checkSpec ? u.checkSpec(spec, { sys, outletCount: n }) : spec;
  const r = u.solve({ sys, inlets: ins, spec: s, outletCount: n });
  const outs = Object.values(r.outlets).flatMap(asList);
  const inList = Object.values(ins).flat();
  // material balance per component (a feed creates its flow; a product takes it out of the flowsheet)
  let material = 0;
  if (type !== "feed" && type !== "product") {
    const fin = sumFlows(sys, inList), fout = sumFlows(sys, outs);
    const scale = Math.max(1e-30, fin.reduce((a, v) => a + v, 0));
    material = Math.max(0, ...fin.map((v, i) => Math.abs(v - fout[i]) / scale));
    if (material > 1e-9) throw new Error(`Internal: ${u.label} does not close its material balance (relative error ${material.toExponential(2)}). Please report this.`);
  }
  const energy_kW = type === "feed" || type === "product" ? 0 : sumH(inList) + r.duty_kW - sumH(outs);
  return { type, outlets: r.outlets, duty_kW: r.duty_kW, balance: { material, energy_kW }, notes: r.notes ?? [], ...(r.state ? { state: r.state } : {}) };
}
