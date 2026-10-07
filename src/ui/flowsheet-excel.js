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
 *
 * Concept model ({ concept: true }, the "Excel concept model" button): the flash drums become
 * formulas too, as a concept-design approximation that Excel recalculates when an input changes.
 * Each drum gets a section on the "Flash models" sheet:
 *  - K_i = γ_i · Psat_i(T) / P (modified Raoult's law), with Psat from the component's vapour-
 *    pressure record written as an Excel formula, ln(P/Pa) = A + B/T + C ln T + D T^E (DIPPR 101),
 *    and γ_i held constant at the value that reproduces Fugacity's solution (K_i P / Psat_i: the
 *    activity coefficient, with the vapour non-ideality of the method folded in). A component with
 *    no vapour pressure at T (above its critical temperature or outside its record) gets a
 *    constant K_i instead.
 *  - The vapour fraction from the Rachford-Rice equation Σ z_i (K_i − 1) / (1 + VF (K_i − 1)) = 0
 *    (Rachford and Rice, J. Petrol. Technol. 4 (1952) 19; VF = 0 below the bubble point, 1 above the
 *    dew point): solved by 50 bisection rows (no macro, no circular reference).
 *  - A recycle is solved in the workbook, not by the spreadsheet's iterative calculation (a long
 *    chain inside a circular reference stops LibreOffice's iteration before it converges; checked):
 *    the "Recycle passes" sheet repeats the flowsheet's formulas 40 times, each pass starting from
 *    the tear streams of the one before, by direct substitution for two passes and then bounded
 *    Wegstein, as Fugacity's solver does; the Streams sheet takes the tear streams of the last pass.
 *    The workbook has no circular reference.
 *  - Outlet flows: vapour_i = F_i VF K_i / (1 + VF (K_i − 1)), liquid_i = F_i − vapour_i.
 * At the conditions Fugacity solved, the workbook gives Fugacity's flows; away from them it holds
 * γ constant (no composition or temperature dependence) and T and P fixed (a drum specified by its
 * vapour fraction or duty keeps the temperature Fugacity found). A drum with two liquid phases is
 * written as fixed split fractions per component. Temperatures of other streams, enthalpies and
 * duties stay values from Fugacity.
 */
import { xlsx, ref, colName } from "./xlsx.js";
import { pure } from "../thermo/pure.js";
import { unitType } from "../units/units.js";
import { findComponent } from "../thermo/components.js";
import { flowsheetSystem } from "../flowsheet/document.js";
import componentData from "../data/components.json" with { type: "json" };

const portOf = end => { const i = end.lastIndexOf("."); return { block: end.slice(0, i), port: end.slice(i + 1) }; };
const val = v => ({ v, s: "value" });
const inp = v => ({ v, s: "input" });
const F = (f, v) => ({ f, v });

/**
 * The workbook's sheets for a flowsheet document and its solution (runFlowsheet).
 * @returns {{sheets:object[], notes:string[]}}
 */
export function flowsheetSheets(fs, res, { version = "", names = {}, concept = false } = {}) {
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
      I.push([{ v: `${unitType(b.type).label} ${b.id}`, s: "bold" }, concept && b.type === "flash"
        ? "(as specified in Fugacity; in this workbook change T and P on the Flash models sheet)" : "(used by Fugacity; change it there)"]);
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
  const flowRef = (sid, i) => `${colName(col.get(sid))}${R.flow0 + i + 1}`;
  // concept model: the drums as formulas on the "Flash models" sheet
  const flash = concept ? conceptFlashes(fs, res, { comps, nameOf, flowRef, inlets: bid => fs.streams.filter(s => s.to === `${bid}.in` && col.has(s.id)).map(s => s.id) }) : null;
  const fromFlash = s => (flash ? flash.cond[portOf(s.from).block] : null);
  const cond = (s, k, key) => (res.streams[s.id][k] == null ? null
    : fromFlash(s) ? F(fromFlash(s)[key], res.streams[s.id][k]) : val(res.streams[s.id][k]));
  S[R.T] = ["Temperature", "K", ...streams.map(s => cond(s, "T_K", "T"))];
  S[R.P] = ["Pressure", "kPa", ...streams.map(s => cond(s, "P_kPa", "P"))];
  S[R.VF] = ["Vapour fraction", "mol/mol", ...streams.map(s => (res.streams[s.id].VF == null ? null : val(res.streams[s.id].VF)))];
  const inletsOf = (bid, port = "in") => fs.streams.filter(s => s.to === `${bid}.${port}` && col.has(s.id)).map(s => s.id);
  /** The formula of component i's flow in stream s, with refOf(sid, i) giving the cells of the other streams and
   *  drum(s, i) the formula of a flash drum outlet (null: a value from Fugacity). */
  const flowFormula = (s, i, refOf, drum) => {
    const c = comps[i];
    const { block: bid } = portOf(s.from), b = blocks.get(bid);
    const ins = inletsOf(bid), sumIn = ins.length > 1 ? `(${ins.map(x => refOf(x, i)).join("+")})` : refOf(ins[0], i);
    if (b.type === "feed") { const fc = feedCell[bid][c]; return fc.mass ? `${at(fc.r, 2)}/${at(mwRow0 + i, 2)}` : at(fc.r, 2); }
    if (b.type === "mixer" || b.type === "heater") return ins.map(x => refOf(x, i)).join("+");
    if (b.type === "splitter") { const k = fs.streams.filter(x => x.from === `${bid}.out`).findIndex(x => x.id === s.id); return `${sumIn}*Inputs!${fracCell[bid][k]}`; }
    if (b.type === "separator") { const k = fs.streams.filter(x => x.from === `${bid}.out`).findIndex(x => x.id === s.id); return `${sumIn}*Inputs!${sepCell[bid][c][k]}`; }
    return drum(s, i);   // flash drum outlets: the concept model, or null (phase equilibrium, from Fugacity)
  };
  // concept model with recycles: the tear streams are solved by explicit passes (no circular reference)
  const passes = flash && res.loops.length ? recyclePasses({ fs, res, comps, nameOf, streams, flowFormula, flash, inletsOf }) : null;
  comps.forEach((c, i) => {
    S[R.flow0 + i] = [`Flow ${nameOf(c)}`, "kmol/h", ...streams.map(s => {
      const v = res.streams[s.id].flows[i];
      if (passes?.final[s.id]) return F(passes.final[s.id][i], v);   // a tear stream: the last recycle pass
      const f = flowFormula(s, i, flowRef, (st, k) => flash?.cell[st.id]?.[k] ?? null);
      return f == null ? val(v) : F(f, v);
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
    ...(concept ? [
      [inp("Blue"), "Inputs you can change: feed flows, split fractions, separator fractions; each drum's temperature, pressure and activity coefficients (Flash models)."],
      ["Black", "Formulas: every flow, including the flash drum outlets (concept model); totals; mass flows; mole fractions; duties; the material balance."],
      [val("Grey italics"), "Calculated by Fugacity: vapour-pressure coefficients (from its databank), the temperatures of streams that do not leave a drum, vapour fractions of the streams, enthalpy flows and duties."],
      [],
      [{ v: "Concept model of the flash drums", s: "bold" }],
      ["Each drum on the Flash models sheet: K = γ · Psat(T) / P with the vapour pressure as a formula (DIPPR 101) and γ held at the value that reproduces Fugacity's solution; the vapour fraction from the Rachford-Rice equation, solved by the bisection rows under each drum; vapour flow = F · VF · K / (1 + VF (K − 1)), liquid = F − vapour."],
      ["At the conditions Fugacity solved, this gives Fugacity's flows. Away from them it is an approximation, as in a concept design: γ does not change with composition or temperature, and T and P stay as entered (a drum specified by vapour fraction or duty keeps the temperature Fugacity found). A component above its critical temperature has a constant K. A drum with two liquids is fixed split fractions."],
      ["For final numbers (and for enthalpies and duties after a change), run the flowsheet in Fugacity again."],
      [],
      [{ v: "What updates in Excel", s: "bold" }],
      ["Change a blue input and the formulas update. A recycle is a circular reference: iterative calculation is switched on in this workbook, so Excel solves it."],
    ] : [
      [inp("Blue"), "Inputs you can change: feed flows, split fractions, separator fractions."],
      ["Black", "Formulas: feed, mixer, heater, splitter and separator flows; totals; mass flows; mole fractions; duties; the material balance."],
      [val("Grey italics"), "Calculated by Fugacity with the thermodynamic model: flash drum outlets, temperatures, pressures, vapour fractions and enthalpy flows."],
      [],
      [{ v: "What updates in Excel", s: "bold" }],
      ["Change a blue input and the formulas update. A recycle through mixers, splitters, separators and heaters is a circular reference: iterative calculation is switched on in this workbook, so Excel solves it."],
      ["Flash drum outlets, temperatures and enthalpies cannot be Excel formulas (they need phase equilibrium): after changing inputs, run the flowsheet again in Fugacity for them, or use the concept-model export."],
    ]),
    ["Model predictions, not measurements; the parameter sources are listed in Fugacity."],
    ["This workbook is yours: Fugacity claims no rights in the files and results you create with it."],
  ];
  return {
    // the concept model has no circular reference (recycles are solved by the passes); the other export needs iteration
    circular: !concept,
    sheets: [
      { name: "Streams", rows: S, cols: [26, 10, ...streams.map(() => 13)], freeze: [1, 2] },
      { name: "Inputs", rows: I, cols: [34, 14, 14, ...Array(8).fill(12)] },
      ...(flash?.rows.length ? [{ name: "Flash models", rows: flash.rows, cols: [26, 13, 11, 13, 13, 13, 13, 9, 11, 11, 12, 11, 11, 13, 13] }] : []),
      ...(passes ? [{ name: "Recycle passes", rows: passes.rows, cols: [26, 10, ...Array(40).fill(13)] }] : []),
      { name: "Energy and balances", rows: E, cols: [26, 10, 20, 30] },
      { name: "About", rows: A, cols: [16, 110] },
    ],
  };
}

/**
 * The "Flash models" sheet of the concept model: one section per flash drum (see the header).
 * @returns {{rows:Array, cell:Object<string,string[]>, cond:Object<string,{T:string,P:string}>}}
 *   cell[streamId][i]: the formula reference of component i's flow in that drum outlet;
 *   cond[blockId]: references of the drum's temperature and pressure
 */
function conceptFlashes(fs, res, { comps, nameOf, flowRef, inlets }) {
  const n = comps.length, rows = [], cell = {}, cond = {};
  const drum = {};   // per drum: K cells (or fraction cells for two liquids) and the outlet streams, for the recycle passes
  const X = (r, c) => `'Flash models'!${ref(r, c)}`;
  const abs = (r, c) => `$${colName(c)}$${r + 1}`;
  const drums = fs.blocks.filter(b => b.type === "flash" && res.blocks[b.id]?.state);
  const XA = (r, c) => `'Flash models'!${abs(r, c)}`;
  if (!drums.length) return { rows, cell, cond, drum };
  let sys = null;
  try { sys = flowsheetSystem(fs); } catch { /* γ falls back to 1 below */ }
  const eos = ["PR", "SRK"].includes(fs.thermo.model);

  rows.push([{ v: "Flash models (concept design)", s: "head" }],
    ["K = γ · Psat(T) / P; Psat in kPa from ln(P/Pa) = A + B/T + C ln T + D T^E; γ held at the value that reproduces Fugacity's solution. VF from Rachford-Rice, Σ z (K − 1) / (1 + VF (K − 1)) = 0, solved by the bisection rows. See the About sheet."], []);
  for (const b of drums) {
    const st = res.blocks[b.id].state, outs = fs.streams.filter(s => s.from.startsWith(`${b.id}.`) && res.streams[s.id]);
    const port = p => outs.find(s => s.from === `${b.id}.${p}`);
    const V = port("vapour"), L = port("liquid"), L2 = port("liquid2");
    const ins = inlets(b.id);
    const spec = b.spec ?? {}, tp = spec.T_K != null && spec.P_kPa != null;
    rows.push([{ v: `Flash drum ${b.id}`, s: "bold" }, tp ? "specified by temperature and pressure"
      : `specified by ${Object.keys(spec).join(" and ")} in Fugacity: the temperature it found is held here`]);
    const rT = rows.length;
    rows.push(["Temperature, K", inp(st.T_K)]);
    rows.push(["Pressure, kPa", inp(st.P_kPa)]);
    const T = abs(rT, 1), P = abs(rT + 1, 1);
    cond[b.id] = { T: X(rT, 1), P: X(rT + 1, 1) };
    const inFlow = i => (ins.length ? ins.map(x => `Streams!${flowRef(x, i)}`).join("+") : "0");
    const liq2 = L2 && res.streams[L2.id].F_kmol_h > 1e-12;
    if (liq2) {
      // two liquids: fixed split fractions per component, from Fugacity's solution
      rows.push(["Two liquid phases: written as fixed split fractions (inputs) from Fugacity's solution."]);
      rows.push([{ v: "Component", s: "bold" }, { v: "Inlet, kmol/h", s: "bold" }, ...[V, L, L2].map(s => ({ v: s ? `to ${s.id}` : "", s: "bold" })),
        ...[V, L, L2].map(s => ({ v: s ? `${s.id}, kmol/h` : "", s: "bold" }))]);
      comps.forEach((c, i) => {
        const r = rows.length, tot = [V, L, L2].reduce((a, s) => a + (s ? res.streams[s.id].flows[i] : 0), 0);
        rows.push([nameOf(c), F(inFlow(i), tot), ...[V, L, L2].map(s => (s ? inp(tot > 0 ? res.streams[s.id].flows[i] / tot : 0) : null)),
          ...[V, L, L2].map((s, k) => (s ? F(`${ref(r, 1)}*${ref(r, 2 + k)}`, res.streams[s.id].flows[i]) : null))]);
        [V, L, L2].forEach((s, k) => { if (s) { (cell[s.id] ??= [])[i] = X(r, 5 + k); ((drum[b.id] ??= { split: {} }).split[s.id] ??= [])[i] = XA(r, 2 + k); } });
      });
      rows.push([]);
      continue;
    }
    // K-values: modified Raoult with γ that reproduces the solution, or a constant K
    const two = V && L && res.streams[V.id].F_kmol_h > 1e-12 && res.streams[L.id].F_kmol_h > 1e-12;
    const zIn = comps.map((_, i) => { const f = [V, L].reduce((a, s) => a + (s ? res.streams[s.id].flows[i] : 0), 0); return f; });
    const Ftot = zIn.reduce((a, b2) => a + b2, 0) || 1;
    const z = zIn.map(f => f / Ftot);
    let gz = null;
    if (!two && sys?.gammas) { try { gz = sys.gammas(z, st.T_K); } catch { gz = null; } }
    rows.push([{ v: "Component", s: "bold" }, { v: "Inlet, kmol/h", s: "bold" }, { v: "z", s: "bold" }, ...["A", "B", "C", "D", "E"].map(v => ({ v, s: "bold" })),
      { v: "Psat, kPa", s: "bold" }, { v: "γ", s: "bold" }, { v: "K", s: "bold" }, { v: "x (liquid)", s: "bold" }, { v: "y (vapour)", s: "bold" },
      { v: V ? `${V.id}, kmol/h` : "vapour, kmol/h", s: "bold" }, { v: L ? `${L.id}, kmol/h` : "liquid, kmol/h", s: "bold" }]);
    const r0 = rows.length, rVF = r0 + n + 1;
    const VF = abs(rVF, 1);
    const zR = `${abs(r0, 2)}:${abs(r0 + n - 1, 2)}`, KR = `${abs(r0, 10)}:${abs(r0 + n - 1, 10)}`;
    comps.forEach((c, i) => {
      // the vapour-pressure record the activity-model flash uses (DIPPR 101 for every component, water included)
      const r = r0 + i, p = pure(c), rec = componentData.components[c].vapourPressure, co = rec;
      const usePsat = rec?.equation === "DIPPR101" && st.T_K < p.Tc_K && st.T_K >= (rec.Tmin_K ?? 0) - 1e-9 && st.T_K <= (rec.Tmax_K ?? Infinity) + 1e-9;
      const xS = two ? res.streams[L.id].z[i] : null, yS = two ? res.streams[V.id].z[i] : null;
      let Ksol = two && xS > 1e-14 ? yS / xS : null;
      const psat = usePsat ? Math.exp(co.A + co.B / st.T_K + co.C * Math.log(st.T_K) + co.D * st.T_K ** co.E) / 1000 : null;
      if (Ksol == null) {
        if (usePsat) Ksol = (gz ? gz[i] : 1) * psat / st.P_kPa;
        else Ksol = (p.Pc_kPa / st.P_kPa) * Math.exp(5.373 * (1 + p.omega) * (1 - p.Tc_K / st.T_K));   // Wilson's estimate
      }
      const g = usePsat ? Ksol * st.P_kPa / psat : null;
      const K = Ksol;
      const xv = z[i] / (1 + st.VF * (K - 1));
      rows.push([
        nameOf(c), F(inFlow(i), zIn[i]), F(`IF(SUM($B$${r0 + 1}:$B$${r0 + n})>0,B${r + 1}/SUM($B$${r0 + 1}:$B$${r0 + n}),0)`, z[i]),
        ...(usePsat ? ["A", "B", "C", "D", "E"].map(k => val(co[k])) : [null, null, null, null, null]),
        usePsat ? F(`EXP(D${r + 1}+E${r + 1}/${T}+F${r + 1}*LN(${T})+G${r + 1}*${T}^H${r + 1})/1000`, psat) : "no Psat at T",
        usePsat ? inp(g) : null,
        usePsat ? F(`J${r + 1}*I${r + 1}/${P}`, K) : inp(K),
        F(`C${r + 1}/(1+${VF}*(K${r + 1}-1))`, xv),
        F(`K${r + 1}*L${r + 1}`, K * xv),
        F(`B${r + 1}*${VF}*K${r + 1}/(1+${VF}*(K${r + 1}-1))`, V ? res.streams[V.id].flows[i] : zIn[i] * st.VF),
        F(`B${r + 1}-N${r + 1}`, L ? res.streams[L.id].flows[i] : zIn[i] * (1 - st.VF)),
      ]);
      if (V) (cell[V.id] ??= [])[i] = X(r, 13);
      (drum[b.id] ??= { V: V?.id, L: L?.id, K: [], KR: `'Flash models'!${KR}` }).K[i] = XA(r, 10);
      if (L) (cell[L.id] ??= [])[i] = X(r, 14);
    });
    rows.push(["Total", F(`SUM(B${r0 + 1}:B${r0 + n})`, Ftot), null, null, null, null, null, null, null, null, null, null, null,
      F(`SUM(N${r0 + 1}:N${r0 + n})`, Ftot * st.VF), F(`SUM(O${r0 + 1}:O${r0 + n})`, Ftot * (1 - st.VF))]);
    // Rachford-Rice: g(VF) = Σ z (K − 1) / (1 + VF (K − 1)), decreasing in VF
    const g = v => `SUMPRODUCT(${zR},(${KR}-1)/(1+${v}*(${KR}-1)))`;
    const g0 = abs(rVF + 1, 1), g1 = abs(rVF + 1, 3);
    const eosNote = eos ? "(an equation-of-state method: γ here also carries the liquid fugacity)" : "";
    const rB = rVF + 3, N = 50;
    rows.push(["Vapour fraction VF", F(`IF(${g0}<=0,0,IF(${g1}>=0,1,${abs(rB + N - 1, 3)}))`, st.VF), eosNote]);
    rows.push(["g(0) = Σ z (K − 1)", F(`SUMPRODUCT(${zR},${KR}-1)`, null), "g(1) = Σ z (K − 1) / K", F(`SUMPRODUCT(${zR},(${KR}-1)/${KR})`, null),
      "VF = 0 if g(0) ≤ 0 (below the bubble point), 1 if g(1) ≥ 0 (above the dew point)"]);
    rows.push([{ v: "Bisection", s: "bold" }, { v: "low", s: "bold" }, { v: "high", s: "bold" }, { v: "middle", s: "bold" }, { v: "g(middle)", s: "bold" }]);
    for (let k = 0; k < N; k++) {
      const r = rB + k;
      const lo = k === 0 ? 0 : F(`IF(E${r}>0,D${r},B${r})`), hi = k === 0 ? 1 : F(`IF(E${r}>0,C${r},D${r})`);
      rows.push([`step ${k + 1}`, lo, hi, F(`(B${r + 1}+C${r + 1})/2`), F(g(`D${r + 1}`))]);
    }
    rows.push([]);
  }
  return { rows, cell, cond, drum };
}

/**
 * The "Recycle passes" sheet of the concept model: the flowsheet's flow formulas repeated PASSES times. In each pass the
 * tear streams are inputs (pass 1: Fugacity's solution; passes 2-3: the tear streams computed in the pass before,
 * direct substitution; then bounded Wegstein, q = s / (s − 1) in [−5, 0], s from the last two passes, as Fugacity's
 * solver), every other stream is computed from them, and each drum's vapour fraction is solved by bisection rows.
 * @returns {{rows:Array, final:Object<string,string[]>}} final[tearId][i]: the tear stream as computed in the last pass
 */
const PASSES = 40;
function recyclePasses({ fs, res, comps, nameOf, streams, flowFormula, flash, inletsOf }) {
  const n = comps.length, rows = [];
  const tears = [...new Set(res.loops.flatMap(l => l.tears))].filter(t => streams.some(s => s.id === t));
  const drums = Object.keys(flash.drum);
  const ids = streams.map(s => s.id);
  // columns: A label, B unit, then the streams, then per tear: computed and q, then per drum: its inlet
  const cS = new Map(ids.map((id, k) => [id, 2 + k]));
  const cG = new Map(tears.map((t, k) => [t, 2 + ids.length + 2 * k]));
  const cQ = new Map(tears.map((t, k) => [t, 3 + ids.length + 2 * k]));
  const cIn = new Map(drums.map((d, k) => [d, 2 + ids.length + 2 * tears.length + k]));
  const N = 50;
  const blockRows = n + 2 + drums.reduce((a, d) => a + (flash.drum[d].K ? 3 + N : 0), 0) + 1;
  const top = 5;
  const P = p => top + p * blockRows;                 // first row of pass p (0-based)
  const cellOf = (p, c, i) => ref(P(p) + 1 + i, c);    // component i in column c of pass p
  const fmt = (p, i) => (sid, k) => cellOf(p, cS.get(sid), k);
  const last = PASSES - 1;
  rows.push([{ v: "Recycle passes (concept model)", s: "head" }],
    [`The recycle is solved here by ${PASSES} passes through the flowsheet: tear stream${tears.length > 1 ? "s" : ""} ${tears.join(", ")}. Pass 1 starts from Fugacity's solution; passes 2 and 3 take the tear streams computed in the pass before; later passes use bounded Wegstein (q = s / (s − 1), between −5 and 0), as Fugacity's solver. The Streams sheet takes the last pass.`],
    ["Largest relative change of the tear streams in the last pass", F(`MAX(${tears.map(t => cellOf(last, cQ.get(t), n)).join(",")})`, 0),
      "converged when this is about 1E-9 or less; if not, the recycle needs more passes than this workbook has (run it in Fugacity)"], [], []);
  for (let p = 0; p < PASSES; p++) {
    const R0 = P(p);
    rows[R0] = [{ v: `Pass ${p + 1}`, s: "bold" }, "kmol/h", ...ids.map(id => ({ v: tears.includes(id) ? `${id} (tear, in)` : id, s: "bold" })),
      ...tears.flatMap(t => [{ v: `${t} computed`, s: "bold" }, { v: `q ${t}`, s: "bold" }]), ...drums.map(d => ({ v: `${d} inlet`, s: "bold" }))];
    // the drums' vapour fractions in this pass (bisection), placed below the flows
    const vf = {};
    let r = R0 + n + 2;
    for (const d of drums) {
      const D = flash.drum[d];
      if (!D.K) continue;
      const Fin = `${ref(R0 + 1, cIn.get(d))}:${ref(R0 + n, cIn.get(d))}`.replace(/([A-Z]+)(\d+)/g, "$$$1$$$2");
      const g = v => `SUMPRODUCT(${Fin},(${D.KR}-1)/(1+${v}*(${D.KR}-1)))`;   // proportional to Rachford-Rice
      const rVF = r, rB = r + 2;
      vf[d] = ref(rVF, 1);
      rows[rVF] = [`${d}: vapour fraction`, F(`IF(${ref(rVF + 1, 1)}<=0,0,IF(${ref(rVF + 1, 3)}>=0,1,${ref(rB + N - 1, 3)}))`)];
      rows[rVF + 1] = ["g(0)", F(`SUMPRODUCT(${Fin},${D.KR}-1)`), "g(1)", F(`SUMPRODUCT(${Fin},(${D.KR}-1)/${D.KR})`)];
      for (let k = 0; k < N; k++) {
        const rr = rB + k;
        rows[rr] = [`bisection ${k + 1}`, k === 0 ? 0 : F(`IF(E${rr}>0,D${rr},B${rr})`), k === 0 ? 1 : F(`IF(E${rr}>0,C${rr},D${rr})`),
          F(`(B${rr + 1}+C${rr + 1})/2`), F(g(`D${rr + 1}`))];
      }
      r = rB + N;
    }
    const drumOut = (s, i) => {
      const d = portOf(s.from).block, D = flash.drum[d];
      if (!D) return null;
      const Fi = cellOf(p, cIn.get(d), i);
      if (!D.K) return `${Fi}*${D.split[s.id][i]}`;
      const V = vf[d], K = D.K[i];
      return s.id === D.V ? `${Fi}*${V}*${K}/(1+${V}*(${K}-1))` : `${Fi}*(1-${V})/(1+${V}*(${K}-1))`;
    };
    comps.forEach((c, i) => {
      const row = [nameOf(c), null];
      for (const s of streams) {
        let cellv;
        if (tears.includes(s.id)) {
          const v0 = res.streams[s.id].flows[i];
          if (p === 0) cellv = val(v0);
          else if (p <= 2) cellv = F(cellOf(p - 1, cG.get(s.id), i), v0);
          else {
            const q = cellOf(p - 1, cQ.get(s.id), i), x = cellOf(p - 1, cS.get(s.id), i), g = cellOf(p - 1, cG.get(s.id), i);
            cellv = F(`MAX(0,${q}*${x}+(1-${q})*${g})`, v0);
          }
        } else {
          const f = flowFormula(s, i, fmt(p, i), drumOut);
          cellv = f == null ? val(res.streams[s.id].flows[i]) : F(f, res.streams[s.id].flows[i]);
        }
        row[cS.get(s.id)] = cellv;
      }
      for (const t of tears) {
        const s = streams.find(x => x.id === t);
        row[cG.get(t)] = F(flowFormula(s, i, fmt(p, i), drumOut) ?? "0", res.streams[t].flows[i]);
        if (p >= 1) {
          // q for the next pass, from this pass and the one before (s = Δg / Δx)
          const x1 = cellOf(p, cS.get(t), i), x0 = cellOf(p - 1, cS.get(t), i), g1 = cellOf(p, cG.get(t), i), g0 = cellOf(p - 1, cG.get(t), i);
          const sl = `((${g1}-${g0})/(${x1}-${x0}))`;
          row[cQ.get(t)] = F(`IF(ABS(${x1}-${x0})<1E-12,0,IF(ABS(${sl}-1)<1E-12,-5,MIN(0,MAX(-5,${sl}/(${sl}-1)))))`, 0);
        }
      }
      for (const d of drums) {
        const ins = inletsOf(d);
        row[cIn.get(d)] = F(ins.length ? ins.map(x => cellOf(p, cS.get(x), i)).join("+") : "0");
      }
      rows[R0 + 1 + i] = row;
    });
    // the relative change of each tear stream in this pass: max |computed − in| / total computed flow
    const rc = [ "relative change", null];
    for (const t of tears) {
      const gR = `${ref(R0 + 1, cG.get(t))}:${ref(R0 + n, cG.get(t))}`, xR = `${ref(R0 + 1, cS.get(t))}:${ref(R0 + n, cS.get(t))}`;
      rc[cQ.get(t)] = F(`IF(SUM(${gR})>0,SUMPRODUCT(MAX(ABS(${gR}-${xR})))/SUM(${gR}),0)`, 0);
    }
    rows[R0 + 1 + n] = rc;
  }
  const final = Object.fromEntries(tears.map(t => [t, comps.map((_, i) => `'Recycle passes'!${cellOf(last, cG.get(t), i)}`)]));
  return { rows: Array.from({ length: rows.length }, (_, k) => rows[k] ?? []), final };
}

/** The .xlsx bytes of a solved flowsheet. */
export function flowsheetXlsx(fs, res, opts) {
  const w = flowsheetSheets(fs, res, opts);
  return xlsx(w.sheets, { iterate: w.circular });
}
