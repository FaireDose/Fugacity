---
name: chepta
description: Build live chemical-engineering tools in an artifact with the open-source CHEPTA library - process flowsheets with recycles (feeds, mixers, splitters, separators, flash drums, heaters), phase diagrams (T-x-y, ternary maps, residue curves, azeotropes), bubble and dew points (activity models or Peng-Robinson/SRK), pure-component properties, steam tables and gas solubility in water. Use when the user asks for VLE, phase diagrams, physical properties of the supported components, steam properties or Henry's law.
---

# CHEPTA: phase equilibria and properties in an artifact

CHEPTA is an open-source JavaScript library (https://github.com/FaireDose/CHEPTA)
that calculates vapour-liquid equilibria in the viewer's browser. Use it instead of
writing thermodynamics by hand: the models and parameters are validated, and the page
only needs a few lines.

## Build the artifact

Build the page right away. To load the whole workbench (ribbon with components, phase
equilibrium, flash, gases and equations of state, properties, steam, units), this is the
whole page:

```html
<div id="app"></div>
<script src="https://cdn.jsdelivr.net/npm/chepta@0.3.0/dist/chepta.js"></script>
<script>
  CHEPTA.app("#app", { components: [] });
</script>
```

The page loads the library from jsdelivr (pinned version) when it opens. Do not download,
read, inline, count or test `chepta.js` (about 850 KB) first, and do not check components
or models in a code sandbox before building the page: the workbench has the component
pickers, examples, models, pressure, units and parameter sources. With `components: []`
it opens empty and the user chooses; if the user names components, a diagram or
conditions, pass them:

```js
CHEPTA.app("#app", {
  start: "ternary",   // "txy", "ternary", "azeotropes", "pxy", "envelope", "flash", "henry", "solid", "sle", "properties", "steam"
  components: ["methanol", "acetone", "chloroform"],
  model: "NRTL",      // "NRTL", "UNIQUAC", "ideal", "PR", "SRK"
  P_kPa: 101.325
});
```

For one diagram without the ribbon, call `CHEPTA.mount`:

```html
<div id="app"></div>
<script src="https://cdn.jsdelivr.net/npm/chepta@0.3.0/dist/chepta.js"></script>
<script>
  CHEPTA.mount("#app", {
    components: ["water", "acetic acid", "ethylene glycol"],
    model: "NRTL",        // "NRTL", "UNIQUAC" or "ideal"
    P_kPa: 101.325
  });
</script>
```

- Two components give a T-x-y diagram with hover tie lines, activity coefficients and
  azeotropes. Three components give a ternary bubble-temperature map with isotherms,
  residue curves and azeotropes. The viewer can switch components, model and pressure.
- Regions where the liquid would split into two phases are shaded, with a warning.
- Optional settings: `title`, `picker` (true), `residueCurves` (true), `isotherms` (true),
  `grid` (40), `allowMissingPairs` (false).
- The interface has its own model switch and pressure input, and follows the page's
  light or dark theme. Keep the rest of the page simple: a heading, a sentence on what
  the diagram shows, and the widget.

## Flowsheets

When the user describes a process (a feed, units, conditions, a recycle), write it as a CHEPTA
project with a flowsheet and open it in the workbench's Flowsheet tab:

```html
<div id="app"></div>
<script src="https://cdn.jsdelivr.net/npm/chepta@0.3.0/dist/chepta.js"></script>
<script>
  const project = {
    fugacity_project: 2,
    workbench: { view: "flowsheet" },
    flowsheet: {
      components: ["ethanol", "water"],
      thermo: { model: "NRTL", vapour: "ideal" },          // or { model: "PR" } / "SRK"
      blocks: [
        { id: "F1", type: "feed", x: 0, y: 160, spec: { flow_kmol_h: { ethanol: 30, water: 70 }, T_K: 298.15, P_kPa: 101.325 } },
        { id: "M1", type: "mixer", x: 140, y: 160 },
        { id: "V1", type: "flash", x: 300, y: 160, spec: { T_K: 360, P_kPa: 101.325 } },
        { id: "SP1", type: "splitter", x: 460, y: 220, spec: { fractions: [0.7, "rest"] } },
        { id: "P1", type: "product", x: 460, y: 80 }, { id: "P2", type: "product", x: 600, y: 260 }
      ],
      streams: [
        { id: "S1", from: "F1.out", to: "M1.in" }, { id: "S2", from: "M1.out", to: "V1.in" },
        { id: "S3", from: "V1.vapour", to: "P1.in" }, { id: "S4", from: "V1.liquid", to: "SP1.in" },
        { id: "S5", from: "SP1.out", to: "M1.in" }, { id: "S6", from: "SP1.out", to: "P2.in" }
      ]
    }
  };
  CHEPTA.app("#app", { project });
</script>
```

- Blocks and their specifications (SI units: K, kPa, kmol/h or kg/h, kW):
  `feed` (flow_kmol_h or flow_kg_h, and two of T_K, P_kPa, VF), `mixer` (P_kPa optional),
  `splitter` (fractions, one per outlet, one may be "rest"), `separator` (fractions per
  component, e.g. `{ ethanol: [0.95, "rest"], water: [0.1, "rest"] }`), `flash` (two of T_K,
  P_kPa, VF, duty_kW), `heater` (one of T_K, duty_kW, VF; P_kPa or dP_kPa optional),
  `product` (the end of a stream). Every outlet must go to a block or a product. Streams
  are written "BLOCK.port": feed out; mixer in, out; splitter and separator in, out (one
  stream per outlet); flash in, vapour, liquid, liquid2 (optional); heater in, out; product in.
  Splitters, separators and heaters may take several inlets (mixed first).
- Before giving me the page, check the project in code you can run:
  `CHEPTA.checkProject(project)` lists every problem (connections and degrees of freedom,
  e.g. "Flash drum V1: missing: one more of T_K, P_kPa, VF or duty_kW"); fix them all.
  `CHEPTA.runFlowsheet(project)` solves it (streams, energy streams in kW, recycles; a
  recycle without a way out throws an error that says so), but the workbench does that
  itself when it opens: see "Let the workbench do the work" below. The schema is at
  https://fairedose.github.io/CHEPTA/schema/project-2.json.
- If the user gives a project file (`.chepta.json`), open it the same way with `{ project }`;
  to change it, edit the JSON, check it again and open it.

**Keeping work in the chat.** The workbench saves projects as files (File menu), in the
browser, and, if this chat gives its pages persistent storage, there too: pass that storage
to the workbench as `CHEPTA.app("#app", { storage: { list, get, put, remove } })`, four
functions that list the saved names, return a project, keep a project under a name, and
delete one (promises are fine). Only do this with storage the chat platform really offers;
otherwise leave it out and tell the user to use File > Save or Copy.

**Let the workbench do the work.** Whatever the workbench shows, it can also export, and
it does so on the user's computer at no cost to the chat. So:
- When the user asks for an Excel file, a CSV or a table of something the workbench can show,
  open the workbench with it (the project, components or diagram) and tell the user which button
  to click. Do not make the file yourself (no openpyxl, pandas or hand-written formulas),
  and do not compute again in code what the workbench calculates. The buttons:
  - flowsheet: Flowsheet tab, under the stream table: **Download Excel** (the balances as
    formulas, the flash drum outlets as values from CHEPTA), **Excel concept model** (the
    flash drums as formulas too, an approximation for concept design), **Download CSV**,
    **Copy CSV**;
  - diagrams and property curves: the **Excel** button above the diagram (every point
    drawn, in the units shown, with an About sheet of the settings and sources);
  - flash: **Download CSV** and **Copy CSV** under the stream table;
  - the whole work: **File > Save** (a `.chepta.json` project that opens again).
- After `CHEPTA.checkProject(project)` finds no problems, give the user the page: the workbench
  solves the flowsheet when it opens. Run `CHEPTA.runFlowsheet` in code only when the user asks
  for numbers in the chat.
- If the workbench cannot do what the user asks (an export, a block or a unit it does not have),
  or the page cannot download files here, say so in one sentence and ask the user before you
  build it yourself. Missing features can be asked for with the workbench's Feedback button.

## Calculate numbers directly

When the user wants values rather than a diagram, use the calculation functions
(temperature in K, pressure in kPa, mole fractions):

```js
const s = CHEPTA.system({ components: ["water", "acetic acid"], model: "UNIQUAC" });
s.bubbleT([0.5, 0.5], 101.325);   // { T, y, gamma }
s.bubbleP([0.5, 0.5], 373.15);    // { P, y, gamma }
s.txy(101.325, 51);               // [{ x, T, y }, ...]
s.azeotropes(101.325);            // binary: [{ x, T, type }]
s.residueCurve([0.3, 0.3, 0.4], 101.325);
CHEPTA.listComponents();        // what the databank holds
// solid-liquid equilibrium (a pure solid; model "ideal", "NRTL" or "UNIQUAC"): solubility at T, curve, eutectic
const sl = CHEPTA.system({ components: ["benzoic acid", "ethanol"], model: "ideal" });
sl.solidSolubility("benzoic acid", 298.15);   // { xSolute, x, gamma, xIdeal, Tm_K, Hfus_J_mol, splits, notes }
sl.solubilityCurve("benzoic acid", { T_from: 280, T_to: 340, n: 31 });
CHEPTA.system({ components: ["benzene", "naphthalene"], model: "ideal" }).sleDiagram();   // liquidus and eutectic
```

The ideal solubility (model "ideal") is close to measured data only where the solvent is chemically
similar to the solid (naphthalene in toluene, benzoic acid in alcohols and ketones; docs/SLE_CHECKS.md).
In water or alkanes it can be 10-300 times too high, and there are no fitted solid-liquid parameters
yet: say so to the user.

## Properties, steam and gases

```js
const w = CHEPTA.pure("water");
w.tsat(101.325);                  // K
w.props(423.15, 101.325);         // { phase, rho_kg_m3, cp_J_molK, h_J_mol, mu_Pa_s, k_W_mK, sources, notes }
CHEPTA.steam(573.15, 1000);     // IAPWS-IF97, steam-table units (kJ/kg, m3/kg)
CHEPTA.steamSat({ P_kPa: 1000 });

const g = CHEPTA.system({ components: ["methane", "ethane"], model: "PR" });   // or "SRK"
g.bubbleP([0.3, 0.7], 200);       // { P, y, stability, warnings }
g.dewT([0.5, 0.5], 2000);         // { T, x, ... }
CHEPTA.gasSolubility("oxygen", 298.15, 21.2);   // mole fraction in water
```

For a property explorer (curves at several pressures, saturation table, units switch):
`CHEPTA.mountProperties("#app", { component: "water", property: "enthalpy" })`.
Properties: "density", "enthalpy", "cp", "viscosity", "conductivity", "vapourPressure", or a
name in `CHEPTA.PROPERTY_NAMES`. Missing data comes back as null with a note: report it,
don't fill it in.

## Rules

- Only use components that `CHEPTA.listComponents()` returns. Version 0.3.0 holds 94
  components (water, alcohols, glycols, ketones, esters, aromatics, alkanes, light gases
  and more). Not every pair has parameters: the widget names missing pairs, and equation-of-state results carry
  `warnings` for pairs without k_ij. If the user asks for other chemicals or pairs, say
  they are not in the databank yet and point to
  https://github.com/FaireDose/CHEPTA/blob/main/CONTRIBUTING.md; do not invent parameters.
- Missing binary parameters raise an error that names the pair. Do not switch on
  `allowMissingPairs` without telling the user that those pairs will be treated as ideal.
- Results are model predictions. Say so, and point to the parameter sources the widget
  lists under the diagram.
- If the library fails to load, tell the user; do not replace it with hand-written
  thermodynamics.
