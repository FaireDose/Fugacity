---
name: fugacity
description: Build live chemical-engineering tools in an artifact with the open-source Fugacity library - phase diagrams (T-x-y, ternary maps, residue curves, azeotropes), bubble and dew points (activity models or Peng-Robinson/SRK), pure-component properties, steam tables and gas solubility in water. Use when the user asks for VLE, phase diagrams, physical properties of the supported components, steam properties or Henry's law.
---

# Fugacity: phase equilibria and properties in an artifact

Fugacity is an open-source JavaScript library (https://github.com/FaireDose/Fugacity)
that calculates vapour-liquid equilibria in the viewer's browser. Use it instead of
writing thermodynamics by hand: the models and parameters are validated, and the page
only needs a few lines.

## Build the artifact

Load the library from jsdelivr with a pinned version. To open the whole workbench (ribbon
with components, phase equilibrium, gases and equations of state, properties, steam,
units):

```html
<div id="app"></div>
<script src="https://cdn.jsdelivr.net/npm/fugacity@0.2.2/dist/fugacity.js"></script>
<script>
  Fugacity.app("#app", {
    start: "ternary",   // "txy", "ternary", "azeotropes", "pxy", "envelope", "flash", "henry", "properties", "steam"
    components: ["methanol", "acetone", "chloroform"],
    model: "NRTL",      // "NRTL", "UNIQUAC", "ideal", "PR", "SRK"
    P_kPa: 101.325
  });
</script>
```

For one diagram without the ribbon, call `Fugacity.mount`:

```html
<div id="app"></div>
<script src="https://cdn.jsdelivr.net/npm/fugacity@0.2.2/dist/fugacity.js"></script>
<script>
  Fugacity.mount("#app", {
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

## Calculate numbers directly

When the user wants values rather than a diagram, use the calculation functions
(temperature in K, pressure in kPa, mole fractions):

```js
const s = Fugacity.system({ components: ["water", "acetic acid"], model: "UNIQUAC" });
s.bubbleT([0.5, 0.5], 101.325);   // { T, y, gamma }
s.bubbleP([0.5, 0.5], 373.15);    // { P, y, gamma }
s.txy(101.325, 51);               // [{ x, T, y }, ...]
s.azeotropes(101.325);            // binary: [{ x, T, type }]
s.residueCurve([0.3, 0.3, 0.4], 101.325);
Fugacity.listComponents();        // what the databank holds
```

## Properties, steam and gases

```js
const w = Fugacity.pure("water");
w.tsat(101.325);                  // K
w.props(423.15, 101.325);         // { phase, rho_kg_m3, cp_J_molK, h_J_mol, mu_Pa_s, k_W_mK, sources, notes }
Fugacity.steam(573.15, 1000);     // IAPWS-IF97, steam-table units (kJ/kg, m3/kg)
Fugacity.steamSat({ P_kPa: 1000 });

const g = Fugacity.system({ components: ["methane", "ethane"], model: "PR" });   // or "SRK"
g.bubbleP([0.3, 0.7], 200);       // { P, y, stability, warnings }
g.dewT([0.5, 0.5], 2000);         // { T, x, ... }
Fugacity.gasSolubility("oxygen", 298.15, 21.2);   // mole fraction in water
```

For a property explorer (curves at several pressures, saturation table, units switch):
`Fugacity.mountProperties("#app", { component: "water", property: "enthalpy" })`.
Properties: "density", "enthalpy", "cp", "viscosity", "conductivity", "vapourPressure", or a
name in `Fugacity.PROPERTY_NAMES`. Missing data comes back as null with a note: report it,
don't fill it in.

## Rules

- Only use components that `Fugacity.listComponents()` returns. Version 0.2.2 holds
  water, methanol, ethanol, acetone, chloroform, benzene, toluene, ethyl acetate, acetic
  acid, ethylene glycol (activity models and properties) and oxygen, nitrogen, hydrogen,
  methane, ethane, ethylene (equations of state, properties, Henry's law). Not every pair
  has parameters: the widget names missing pairs, and equation-of-state results carry
  `warnings` for pairs without k_ij. If the user asks for other chemicals or pairs, say
  they are not in the databank yet and point to
  https://github.com/FaireDose/Fugacity/blob/main/CONTRIBUTING.md; do not invent parameters.
- Missing binary parameters raise an error that names the pair. Do not switch on
  `allowMissingPairs` without telling the user that those pairs will be treated as ideal.
- Results are model predictions. Say so, and point to the parameter sources the widget
  lists under the diagram.
- If the library fails to load, tell the user; do not replace it with hand-written
  thermodynamics.
