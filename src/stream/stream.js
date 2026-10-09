/**
 * Streams (layer 3; proposal 0006, step 1; roadmap A5).
 *
 * A stream is the state of one flow: temperature, pressure, component molar flows, the
 * phases it splits into and its enthalpy flow. It is always the result of a flash with a
 * property package (a `system`, proposal 0001), so the phase split and the enthalpy are
 * consistent with the model:
 *
 *   CHEPTA.stream(sys, { flow_kmol_h: { ethanol: 40, water: 60 }, T_K: 351, P_kPa: 101.325 })
 *   CHEPTA.stream(sys, { flow_kmol_h, P_kPa, H_kW })     // given enthalpy flow (P-H flash)
 *   CHEPTA.stream(sys, { flow_kmol_h, P_kPa, VF })       // given vapour fraction
 *   CHEPTA.stream(sys, { flow_kmol_h, T_K, VF })
 *
 * Flows are given per component as an object (names, ids, formulas or CAS numbers, as
 * system() takes them; components left out have zero flow) or as an array in the system's
 * order; `flow_kg_h` gives mass flows instead (converted with the molar masses of the
 * component records). A stream with zero total flow is allowed (an empty purge, a closed
 * outlet): it carries T and P but no phases, and its enthalpy flow is 0.
 *
 * Units: K, kPa, kmol/h, kg/h, kW. The enthalpy reference is that of the flash: each
 * component as an ideal gas at 298.15 K (h = 0). Conversions to °C, bar, t/h are done by the
 * interface. The stream holds no thermodynamics of its own; every number comes from
 * sys.flash (src/equilibrium/flash.js) and the component records.
 */
import { fail } from "../util/errors.js";
import { findComponent } from "../thermo/components.js";
import { pure } from "../thermo/pure.js";

/** kW per (J/mol × kmol/h): 1000 mol/kmol over 3600 s/h, over 1000 W/kW. */
const KW_PER = 1 / 3600;

const finite = (v, what) => {
  const x = Number(v);
  if (!Number.isFinite(x)) throw fail("BAD_INPUT", `stream: ${what} must be a number (got ${JSON.stringify(v)}).`);
  return x;
};

/** Molar masses of the system's components, g/mol (= kg/kmol). */
export const molarMasses = sys => sys.ids.map(id => pure(id).MW);

/**
 * Component flows of a stream specification as an array in the system's order, kmol/h.
 * @param {object} sys
 * @param {object|number[]} flows   by component (any name system() accepts) or in system order
 * @param {"kmol/h"|"kg/h"} [unit="kmol/h"]
 */
export function componentFlows(sys, flows, unit = "kmol/h") {
  const n = sys.n, out = new Array(n).fill(0);
  const what = unit === "kg/h" ? "flow_kg_h" : "flow_kmol_h";
  if (Array.isArray(flows)) {
    if (flows.length !== n) throw fail("BAD_INPUT", `stream: ${what} has ${flows.length} values; the system has ${n} components (${sys.ids.join(", ")}).`);
    flows.forEach((v, i) => { out[i] = finite(v, `${what}[${i}]`); });
  } else if (flows && typeof flows === "object") {
    for (const [key, v] of Object.entries(flows)) {
      let id;
      try { id = findComponent(key); } catch (e) { throw fail("BAD_INPUT", `stream: ${what}: ${e.message}`); }
      const i = sys.ids.indexOf(id);
      if (i < 0) throw fail("BAD_INPUT", `stream: ${what}: ${key} is not a component of this system (${sys.ids.join(", ")}).`);
      out[i] += finite(v, `${what}.${key}`);
    }
  } else {
    throw fail("BAD_INPUT", `stream: give the flows as ${what}: { component: value } or an array of ${n} values.`);
  }
  out.forEach((v, i) => { if (v < 0) throw fail("BAD_INPUT", `stream: the flow of ${sys.names[i]} is negative (${v}).`); });
  if (unit === "kg/h") { const MW = molarMasses(sys); return out.map((v, i) => v / MW[i]); }
  return out;
}

/**
 * A stream: the flash of the given flows at the given conditions.
 * @param {object} sys   a system (property package)
 * @param {object} spec  flow_kmol_h or flow_kg_h, and two of T_K, P_kPa, H_kW, VF
 *   (T_K + P_kPa, P_kPa + H_kW, P_kPa + VF or T_K + VF); `id` and `name` are kept
 * @returns {object} frozen stream (see the file header); throws a CheptaError naming the problem
 */
export function stream(sys, spec = {}) {
  if (!sys || typeof sys.flash !== "function") throw fail("BAD_INPUT", "stream: the first argument must be a system, e.g. CHEPTA.system({ components, model }).");
  if (!spec || typeof spec !== "object") throw fail("BAD_INPUT", "stream: give a specification such as { flow_kmol_h: { water: 10 }, T_K: 300, P_kPa: 101.325 }.");
  if (spec.flow_kmol_h != null && spec.flow_kg_h != null) throw fail("BAD_INPUT", "stream: give flow_kmol_h or flow_kg_h, not both.");
  const flows = spec.flow_kg_h != null ? componentFlows(sys, spec.flow_kg_h, "kg/h") : componentFlows(sys, spec.flow_kmol_h);
  const has = k => spec[k] !== undefined && spec[k] !== null;
  const keys = ["T_K", "P_kPa", "H_kW", "VF"].filter(has);
  const kind = keys.slice().sort().join("+");
  const KINDS = { "P_kPa+T_K": "TP", "H_kW+P_kPa": "PH", "P_kPa+VF": "PVF", "T_K+VF": "TVF" };
  if (!KINDS[kind]) throw fail("BAD_INPUT", `stream: give two of T_K, P_kPa, H_kW, VF as T_K + P_kPa, P_kPa + H_kW, P_kPa + VF or T_K + VF (got ${keys.join(", ") || "none"}).`);
  const F = flows.reduce((a, v) => a + v, 0);
  const MW = molarMasses(sys);
  const base = {
    id: spec.id ?? null, name: spec.name ?? null, spec: KINDS[kind],
    components: sys.ids.slice(),
    flow_kmol_h: Object.fromEntries(sys.ids.map((id, i) => [id, flows[i]])),
    flows: flows.slice(), F_kmol_h: F,
    mass_kg_h: flows.reduce((a, v, i) => a + v * MW[i], 0),
  };
  if (!(F > 0)) {
    if (!has("T_K") || !has("P_kPa")) {
      if (has("P_kPa") && has("H_kW") && finite(spec.H_kW, "H_kW") !== 0) throw fail("BAD_INPUT", `stream: a stream without flow cannot carry an enthalpy flow (H_kW = ${spec.H_kW}).`);
    }
    return Object.freeze({
      ...base, z: flows.map(() => 0), T_K: has("T_K") ? finite(spec.T_K, "T_K") : null, P_kPa: has("P_kPa") ? finite(spec.P_kPa, "P_kPa") : null,
      VF: null, phases: [], h_J_mol: null, H_kW: 0, MW: null, warnings: ["The stream has no flow."], sources: [],
    });
  }
  const z = flows.map(v => v / F);
  const fspec = { z };
  if (has("T_K")) fspec.T = finite(spec.T_K, "T_K");
  if (has("P_kPa")) fspec.P = finite(spec.P_kPa, "P_kPa");
  if (has("VF")) fspec.VF = finite(spec.VF, "VF");
  if (has("H_kW")) fspec.H = finite(spec.H_kW, "H_kW") / (F * KW_PER);
  const r = sys.flash(fspec);
  const phases = r.phases.map(p => Object.freeze({
    type: p.type, fraction: p.fraction, composition: p.composition.slice(), h_J_mol: p.h_J_mol,
    F_kmol_h: F * p.fraction,
    flow_kmol_h: Object.fromEntries(sys.ids.map((id, i) => [id, F * p.fraction * p.composition[i]])),
  }));
  return Object.freeze({
    ...base, z, T_K: r.T, P_kPa: r.P, VF: r.VF, phases,
    h_J_mol: r.H_J_mol, H_kW: r.H_J_mol == null ? null : r.H_J_mol * F * KW_PER,
    MW: z.reduce((a, v, i) => a + v * MW[i], 0),
    warnings: r.warnings ?? [], sources: r.sources ?? [],
  });
}

/** Heat duty in kW between two enthalpy flows (out minus in), e.g. of a heater. */
export const dutyKW = (H_in_kW, H_out_kW) => H_out_kW - H_in_kW;

/** A frozen stream from its parts (the shape stream() returns). */
function build(st, { flows, phases, VF, h_J_mol }) {
  const ids = st.components, F = flows.reduce((a, v) => a + v, 0);
  const MW = ids.map(id => pure(id).MW);
  const base = {
    id: null, name: null, spec: st.spec, components: ids.slice(),
    flow_kmol_h: Object.fromEntries(ids.map((id, i) => [id, flows[i]])), flows: flows.slice(), F_kmol_h: F,
    mass_kg_h: flows.reduce((a, v, i) => a + v * MW[i], 0), T_K: st.T_K, P_kPa: st.P_kPa,
  };
  if (!(F > 0)) return Object.freeze({ ...base, z: flows.map(() => 0), VF: null, phases: [], h_J_mol: null, H_kW: 0, MW: null, warnings: ["The stream has no flow."], sources: st.sources ?? [] });
  const z = flows.map(v => v / F);
  return Object.freeze({
    ...base, z, VF, phases: phases.map(p => Object.freeze({
      ...p, composition: p.composition.slice(), F_kmol_h: F * p.fraction,
      flow_kmol_h: Object.fromEntries(ids.map((id, i) => [id, F * p.fraction * p.composition[i]])),
    })),
    h_J_mol, H_kW: h_J_mol == null ? null : h_J_mol * F * KW_PER, MW: z.reduce((a, v, i) => a + v * MW[i], 0),
    warnings: st.warnings ?? [], sources: st.sources ?? [],
  });
}

/**
 * The same stream at a fraction of its flow: the same T, P, phases and compositions, every
 * flow and the enthalpy flow times `fraction` (a splitter outlet). No flash is needed: the
 * state is intensive.
 */
export function scaleStream(st, fraction) {
  const f = Number(fraction);
  if (!(f >= 0)) throw fail("BAD_INPUT", `scaleStream: the fraction must be zero or positive (got ${fraction}).`);
  return build(st, { flows: st.flows.map(v => v * f), phases: st.phases, VF: st.VF, h_J_mol: st.h_J_mol });
}

/**
 * One phase of a stream as a stream of its own (a flash drum outlet): its flows,
 * composition and enthalpy, at the stream's T and P. `type` is "vapour" or "liquid"; `k`
 * picks the k-th phase of that type (0: the first liquid, 1: the second). A phase the stream
 * does not have gives a stream without flow.
 */
export function phaseStream(st, type, k = 0) {
  const p = st.phases.filter(q => q.type === type)[k];
  if (!p || !(p.fraction > 0)) return build(st, { flows: st.components.map(() => 0), phases: [], VF: null, h_J_mol: null });
  const flows = st.components.map(id => p.flow_kmol_h[id]);
  return build(st, { flows, phases: [{ type: p.type, fraction: 1, composition: p.composition, h_J_mol: p.h_J_mol }], VF: type === "vapour" ? 1 : 0, h_J_mol: p.h_J_mol });
}
