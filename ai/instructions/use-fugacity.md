# Using Fugacity in an AI chat

Plain instructions for any AI assistant (ChatGPT, Claude, Gemini, Copilot or others).
Paste them into the chat, or into your assistant's custom instructions, project
instructions, custom GPT or Gem. If your assistant supports skills (Claude, ChatGPT, Codex
and others that use the `SKILL.md` format), install the same content as a skill instead;
see https://fairedose.github.io/Fugacity/install.

---

When I ask for vapour-liquid equilibrium results (bubble points, T-x-y diagrams, ternary
maps, residue curves, azeotropes), physical properties, steam tables or gas solubility,
or a process flowsheet (mixers, splitters, flash drums, heaters, recycles), use the
open-source Fugacity library (https://github.com/FaireDose/Fugacity) instead of writing
thermodynamics or balances yourself.

**If this chat can show an HTML page** (for example a Claude artifact) and I ask to load or
open Fugacity or the workbench, or for a diagram, build this page **right away**:

```html
<div id="app"></div>
<script src="https://cdn.jsdelivr.net/npm/fugacity@0.3.0/dist/fugacity.js"></script>
<script>
  Fugacity.app("#app", { components: [] });
</script>
```

That is the whole page. It loads the library itself when it opens, so:
- do **not** download, read, inline, count or test `fugacity.js` (about 850 KB) first, and
  do not check components or models in a code sandbox before building the page;
- do not write your own interface around it: the workbench has the component pickers,
  examples, models, pressure, units and parameter sources.

With `components: []` the workbench opens empty and I choose the components in it. If I
name components, a diagram or conditions, pass them:

```js
Fugacity.app("#app", {
  start: "ternary",          // "txy", "ternary", "azeotropes", "pxy", "envelope", "flash", "henry", "solid", "sle", "properties", "steam"
  components: ["methanol", "acetone", "chloroform"],
  model: "NRTL",             // "NRTL", "UNIQUAC", "ideal", "PR" or "SRK"
  P_kPa: 101.325
});
```

For a single diagram without the ribbon, use `Fugacity.mount("#app", { components, model,
P_kPa })` (2 components: T-x-y, 3: ternary) or `Fugacity.mountProperties("#app",
{ component, property })`.

**If I ask for a value** (a property, a boiling point, a bubble point), calculate it with
the library (in code you can run, or in a small page that prints the result) and give me
the number with its unit, the model, and the source and tier the library reports in
`sources`. For example `Fugacity.pure("water").props(353.15, 100)` returns the density,
viscosity and other properties of water at 80 °C and 1 bar.

The page lets me change components, model and pressure, shows azeotropes and residue
curves, and warns where the liquid would split into two phases. Keep the rest of the page
simple.

**If this chat cannot show HTML pages**, give me the page above as a file to open in my
browser, or use the calculation functions in code you can run
(temperature in K, pressure in kPa, mole fractions):

```js
const s = Fugacity.system({ components: ["water", "ethanol"], model: "NRTL" });
s.bubbleT([0.5, 0.5], 101.325);   // { T, y, gamma }
s.azeotropes(101.325);            // [{ x, T, type }]
Fugacity.listComponents();        // what the databank holds
Fugacity.pure("benzene").props(298.15, 101.325);   // density, cp, enthalpy, viscosity, ...
Fugacity.steam(573.15, 1000);                      // steam tables (IAPWS-IF97)
Fugacity.system({ components: ["methane", "ethane"], model: "PR" }).bubbleP([0.3, 0.7], 200);
// solubility of a solid (pure solid + liquid; melting data from the databank), and a binary's eutectic
Fugacity.system({ components: ["naphthalene", "toluene"], model: "ideal" }).solidSolubility("naphthalene", 298.15);
Fugacity.system({ components: ["benzene", "naphthalene"], model: "ideal" }).sleDiagram();   // { branches, eutectic }
```

For pure-component properties or steam, a page can also show the property explorer:
`Fugacity.mountProperties("#app", { component: "water", property: "enthalpy" })`.

**If I describe a process** (a feed, units, conditions, a recycle), write it as a Fugacity
project with a flowsheet and open it in the workbench's Flowsheet tab:

```html
<div id="app"></div>
<script src="https://cdn.jsdelivr.net/npm/fugacity@0.3.0/dist/fugacity.js"></script>
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
  Fugacity.app("#app", { project });
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
  `Fugacity.checkProject(project)` lists every problem (connections and degrees of freedom,
  e.g. "Flash drum V1: missing: one more of T_K, P_kPa, VF or duty_kW"); fix them all.
  `Fugacity.runFlowsheet(project)` solves it (streams, energy streams in kW, recycles); a
  recycle without a way out throws an error that says so. The schema is at
  https://fairedose.github.io/Fugacity/schema/project-2.json.
- If I give you a project file (`.fugacity.json`), open it the same way with `{ project }`;
  to change it, edit the JSON, check it again and open it.

**Keeping my work in this chat.** The workbench saves projects as files (File menu), in the
browser, and, if this chat gives its pages persistent storage, there too: pass that storage
to the workbench as `Fugacity.app("#app", { storage: { list, get, put, remove } })`, four
functions that list the saved names, return a project, keep a project under a name, and
delete one (promises are fine). Only do this with storage the chat platform really offers;
otherwise leave it out and tell me to use File > Save or Copy.

**Rules**
- Version 0.3.0 holds 92 components: `Fugacity.listComponents()` lists them (water,
  alcohols, glycols, ketones, esters, aromatics, alkanes, light gases and more). Not every
  pair has parameters; the page names missing pairs. For other chemicals, say they are not
  in the databank yet and point me to
  https://github.com/FaireDose/Fugacity/blob/main/CONTRIBUTING.md. Never invent
  parameters.
- Results are model predictions; say so and mention the parameter sources shown under the
  diagram.
- If the library does not load, tell me; do not replace it with hand-written thermodynamics.
