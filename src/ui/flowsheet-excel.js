/**
 * The solved flowsheet as an Excel workbook (.xlsx) with formulas (proposal 0006, export).
 *
 * What Excel can calculate is written as formulas, from inputs in blue that the person may
 * change; what needs the thermodynamic model is written as values calculated by Fugacity, in
 * grey italics:
 *  - formulas: feed flows (from the Inputs sheet), mixer and heater outlet flows (sums of the
 *    inlets), splitter outlets (inlet × fraction; the "rest" fraction is 1 minus the others),
 *    component separator outlets (inlet of each component × its fraction), total and mass
 *    flows, mole fractions, the duty of each energy stream (enthalpy flows out minus in) and
 *    the overall material balance. A recycle through these blocks is a circular reference; the
 *    workbook turns on iterative calculation so Excel solves it.
 *  - values from Fugacity: flash drum outlets (phase equilibrium), every temperature, pressure,
 *    vapour fraction and enthalpy flow. After changing an input, run the flowsheet again in
 *    Fugacity to update these.
 * Units: kmol/h, kg/h, K, kPa, kW.
 */
import { xlsx, ref, colName } from "./xlsx.js";
import { pure } from "../thermo/pure.js";
import { unitType } from "../units/units.js";
import { findComponent } from "../thermo/components.js";

const portOf = end => { const i = end.lastIndexOf("."); return { block: end.slice(0, i), port: end.slice(i + 1) }; };
const val = v => ({ v, s: "value" });
const inp = v => ({ v, s: "input" });
const F = (f, v) => ({ f, v });

/**
 * The workbook's sheets for a flowsheet document and its solution (runFlowsheet).
 * @returns {{sheets:object[], notes:string[]}}
 */
export function flowsheetSheets(fs, res, { version = "", names = {} } = {}) {
  const comps = fs.components, n = comps.length;
  const nameOf = id => names[id] ?? pure(id).name ?? id;
  const blocks = new Map(fs.blocks.map(b => [b.id, b]));
  const streams = fs.streams.filter(s => res.streams[s.id]);

  // ---- Inputs sheet: components with molar masses, then each block's inputs
  const I = [];
  const at = (r, c) => `Inputs!${ref(r, c)}`;
  I.push([{ v: "Inputs", s: "head" }], ["Blue: inputs you can change. Grey italics: calculated by Fugacity. Black: formulas."], []);
  I.push([{ v: "Component", s: "bold" }, { v: "Id", s: "bold" }, { v: "Molar mass, g/mol", s: "bold" }]);
  const mwRow0 = I.length;
  comps.forEach(c => I.push([nameOf(c), c, val(pure(c).MW)]));
  const mwRange = `Inputs!$C$${mwRow0 + 1}:$C$${mwRow0 + n}`;
  I.push([], [{ v: "Method", s: "bold" }, `${fs.thermo.model}${["PR", "SRK"].includes(fs.thermo.model) ? "" : `, ${fs.thermo.vapour ?? "ideal"} vapour`}`], []);
  const feedCell = {}, fracCell = {}, sepCell = {};
  for (const b of fs.blocks) {
    const spec = b.spec ?? {};
    if (b.type === "feed") {
      I.push([{ v: `Feed ${b.id}`, s: "bold" }, { v: spec.flow_kg_h ? "kg/h (converted to kmol/h in Streams)" : "kmol/h", s: "bold" }]);
      feedCell[b.id] = {};
      const mass = spec.flow_kg_h != null, flows = (mass ? spec.flow_kg_h : spec.flow_kmol_h) ?? {};
      comps.forEach((c, i) => { feedCell[b.id][c] = { r: I.length, mass, i }; I.push([nameOf(c), null, inp(Number(flows[c] ?? 0))]); });
      for (const [k, label] of [["T_K", "Temperature, K"], ["P_kPa", "Pressure, kPa"], ["VF", "Vapour fraction"]]) if (spec[k] != null) I.push([label, null, inp(spec[k])]);
      I.push([]);
    } else if (b.type === "splitter") {
      const outs = fs.streams.filter(s => s.from === `${b.id}.out`);
      I.push([{ v: `Splitter ${b.id}: fraction of the flow to each outlet`, s: "bold" }]);
      const r0 = I.length, fr = Array.isArray(spec.fractions) ? spec.fractions : [];
      fracCell[b.id] = outs.map((s, k) => ref(r0 + k, 2));
      outs.forEach((s, k) => {
        const others = outs.map((_, j) => j).filter(j => j !== k && fr[j] !== "rest").map(j => ref(r0 + j, 2));
        I.push([`to ${s.id}`, null, fr[k] === "rest" ? F(`1-${others.length ? `SUM(${others.join(",")})` : "0"}`) : inp(Number(fr[k] ?? 0))]);
      });
      I.push([]);
    } else if (b.type === "separator") {
      const outs = fs.streams.filter(s => s.from === `${b.id}.out`);
      I.push([{ v: `Component separator ${b.id}: fraction of each component to each outlet`, s: "bold" }, null, ...outs.map(s => ({ v: `to ${s.id}`, s: "bold" }))]);
      sepCell[b.id] = {};
      for (const c of comps) {
        const key = Object.keys(spec.fractions ?? {}).find(k => { try { return findComponent(k) === c; } catch { return false; } });
        const r = I.length, fr = key == null ? [] : spec.fractions[key];
        sepCell[b.id][c] = outs.map((_, k) => ref(r, 2 + k));
        I.push([nameOf(c), null, ...outs.map((_, k) => {
          if (fr[k] !== "rest") return inp(Number(fr[k] ?? 0));
          const others = outs.map((_, j) => j).filter(j => j !== k && fr[j] !== "rest").map(j => ref(r, 2 + j));
          return F(`1-${others.length ? `SUM(${others.join(",")})` : "0"}`);
        })]);
      }
      I.push([]);
    } else if (["flash", "heater", "mixer"].includes(b.type) && Object.keys(spec).length) {
      I.push([{ v: `${unitType(b.type).label} ${b.id}`, s: "bold" }, "(used by Fugacity; change it there)"]);
      for (const [k, v] of Object.entries(spec)) I.push([k, null, val(v)]);
      I.push([]);
    }
  }

  // ---- Streams sheet: one column per stream
  const col = new Map(streams.map((s, k) => [s.id, 2 + k]));
  const R = { from: 1, to: 2, T: 3, P: 4, VF: 5, flow0: 6 };
  R.total = R.flow0 + n; R.mass = R.total + 1; R.H = R.mass + 1; R.x0 = R.H + 1;
  const S = [];
  S[0] = [{ v: "Streams", s: "head" }, null, ...streams.map(s => ({ v: s.id, s: "bold" }))];
  S[R.from] = ["From", null, ...streams.map(s => s.from.replace(".", " "))];
  S[R.to] = ["To", null, ...streams.map(s => { const t = portOf(s.to); return blocks.get(t.block)?.type === "product" ? "product" : `${t.block} ${t.port}`; })];
  S[R.T] = ["Temperature", "K", ...streams.map(s => (res.streams[s.id].T_K == null ? null : val(res.streams[s.id].T_K)))];
  S[R.P] = ["Pressure", "kPa", ...streams.map(s => (res.streams[s.id].P_kPa == null ? null : val(res.streams[s.id].P_kPa)))];
  S[R.VF] = ["Vapour fraction", "mol/mol", ...streams.map(s => (res.streams[s.id].VF == null ? null : val(res.streams[s.id].VF)))];
  const flowRef = (sid, i) => `${colName(col.get(sid))}${R.flow0 + i + 1}`;
  const inletsOf = (bid, port = "in") => fs.streams.filter(s => s.to === `${bid}.${port}` && col.has(s.id)).map(s => s.id);
  const sumIn = (bid, i) => { const ins = inletsOf(bid); return ins.length > 1 ? `(${ins.map(x => flowRef(x, i)).join("+")})` : flowRef(ins[0], i); };
  comps.forEach((c, i) => {
    S[R.flow0 + i] = [`Flow ${nameOf(c)}`, "kmol/h", ...streams.map(s => {
      const v = res.streams[s.id].flows[i];
      const { block: bid, port } = portOf(s.from), b = blocks.get(bid);
      if (b.type === "feed") {
        const fc = feedCell[bid][c];
        return F(fc.mass ? `${at(fc.r, 2)}/${at(mwRow0 + i, 2)}` : at(fc.r, 2), v);
      }
      if (b.type === "mixer" || b.type === "heater") return F(inletsOf(bid).map(x => flowRef(x, i)).join("+"), v);
      if (b.type === "splitter") { const k = fs.streams.filter(x => x.from === `${bid}.out`).findIndex(x => x.id === s.id); return F(`${sumIn(bid, i)}*Inputs!${fracCell[bid][k]}`, v); }
      if (b.type === "separator") { const k = fs.streams.filter(x => x.from === `${bid}.out`).findIndex(x => x.id === s.id); return F(`${sumIn(bid, i)}*Inputs!${sepCell[bid][c][k]}`, v); }
      return val(v);   // flash drum outlets: phase equilibrium, from Fugacity
    })];
  });
  const range = cid => `${colName(cid)}${R.flow0 + 1}:${colName(cid)}${R.flow0 + n}`;
  S[R.total] = ["Molar flow", "kmol/h", ...streams.map(s => F(`SUM(${range(col.get(s.id))})`, res.streams[s.id].F_kmol_h))];
  S[R.mass] = ["Mass flow", "kg/h", ...streams.map(s => F(`SUMPRODUCT(${range(col.get(s.id))},${mwRange})`, res.streams[s.id].mass_kg_h))];
  S[R.H] = ["Enthalpy flow", "kW", ...streams.map(s => val(res.streams[s.id].H_kW ?? 0))];
  comps.forEach((c, i) => {
    S[R.x0 + i] = [`Mole fraction ${nameOf(c)}`, "mol/mol", ...streams.map(s => {
      const cl = colName(col.get(s.id)), st = res.streams[s.id];
      return F(`IF(${cl}${R.total + 1}>0,${cl}${R.flow0 + i + 1}/${cl}${R.total + 1},0)`, st.F_kmol_h > 0 ? st.z[i] : 0);
    })];
  });

  // ---- Energy and balances
  const E = [[{ v: "Energy streams and balances", s: "head" }], [], [{ v: "Energy stream", s: "bold" }, { v: "Block", s: "bold" }, { v: "Duty, kW (+ heat in)", s: "bold" }, { v: "Formula", s: "bold" }]];
  const Hcell = sid => `Streams!${colName(col.get(sid))}${R.H + 1}`;
  for (const q of Object.values(res.energy ?? {})) {
    const ins = fs.streams.filter(s => portOf(s.to).block === q.block && col.has(s.id)).map(s => s.id);
    const outs = fs.streams.filter(s => portOf(s.from).block === q.block && col.has(s.id)).map(s => s.id);
    E.push([q.id, q.block, F(`${outs.map(Hcell).join("+") || "0"}-(${ins.map(Hcell).join("+") || "0"})`, q.duty_kW), "enthalpy flows out minus in"]);
  }
  E.push([], [{ v: "Material balance: feeds minus products", s: "bold" }, { v: "kmol/h", s: "bold" }]);
  const feedsOut = streams.filter(s => blocks.get(portOf(s.from).block)?.type === "feed").map(s => s.id);
  const prodIn = streams.filter(s => blocks.get(portOf(s.to).block)?.type === "product").map(s => s.id);
  comps.forEach((c, i) => {
    const f = `${feedsOut.map(x => `Streams!${flowRef(x, i)}`).join("+") || "0"}-(${prodIn.map(x => `Streams!${flowRef(x, i)}`).join("+") || "0"})`;
    E.push([nameOf(c), null, F(f, res.balance.material_kmol_h[c] ?? 0)]);
  });

  // ---- About
  const loops = res.loops.length ? res.loops.map(l => `${l.tears.join(", ")} (${l.iterations} iterations in Fugacity)`).join("; ") : "none";
  const A = [
    [{ v: "About this workbook", s: "head" }],
    [`Exported from the Fugacity workbench ${version}`.trim()],
    [`Components: ${comps.map(nameOf).join(", ")}. Method: ${fs.thermo.model}.`],
    [`Recycles (tear streams): ${loops}.`],
    [],
    [{ v: "Colours", s: "bold" }],
    [inp("Blue"), "Inputs you can change: feed flows, split fractions, separator fractions."],
    ["Black", "Formulas: feed, mixer, heater, splitter and separator flows; totals; mass flows; mole fractions; duties; the material balance."],
    [val("Grey italics"), "Calculated by Fugacity with the thermodynamic model: flash drum outlets, temperatures, pressures, vapour fractions and enthalpy flows."],
    [],
    [{ v: "What updates in Excel", s: "bold" }],
    ["Change a blue input and the formulas update. A recycle through mixers, splitters, separators and heaters is a circular reference: iterative calculation is switched on in this workbook, so Excel solves it."],
    ["Flash drum outlets, temperatures and enthalpies cannot be Excel formulas (they need phase equilibrium): after changing inputs, run the flowsheet again in Fugacity for them."],
    ["Model predictions, not measurements; the parameter sources are listed in Fugacity."],
  ];
  return {
    sheets: [
      { name: "Streams", rows: S, cols: [26, 10, ...streams.map(() => 13)], freeze: [1, 2] },
      { name: "Inputs", rows: I, cols: [34, 14, 14, ...Array(8).fill(12)] },
      { name: "Energy and balances", rows: E, cols: [26, 10, 20, 30] },
      { name: "About", rows: A, cols: [16, 110] },
    ],
  };
}

/** The .xlsx bytes of a solved flowsheet. */
export function flowsheetXlsx(fs, res, opts) {
  return xlsx(flowsheetSheets(fs, res, opts).sheets, { iterate: true });
}
