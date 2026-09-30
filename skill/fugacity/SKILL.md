---
name: fugacity
description: Build live phase-equilibrium tools (T-x-y diagrams, ternary maps, residue curves, bubble points) in an artifact with the open-source Fugacity library. Use when the user asks for VLE, bubble/dew points, residue curves or distillation-related phase diagrams.
---

# Fugacity: phase equilibria in an artifact

Fugacity is an open-source JavaScript library (https://github.com/FaireDose/Fugacity)
that calculates vapour-liquid equilibria in the viewer's browser. Use it instead of
writing thermodynamics by hand: the models and parameters are validated, and the page
only needs a few lines.

## Build the artifact

Load the library from jsdelivr with a pinned version, then call `Fugacity.mount`:

```html
<div id="app"></div>
<script src="https://cdn.jsdelivr.net/npm/fugacity@0.1.0/dist/fugacity.js"></script>
<script>
  Fugacity.mount("#app", {
    components: ["water", "acetic acid", "ethylene glycol"],
    model: "NRTL",        // "NRTL", "UNIQUAC" or "ideal"
    P_kPa: 101.325
  });
</script>
```

- Two components give a T-x-y diagram with hover tie lines, activity coefficients and
  azeotrope detection. Three components give a ternary bubble-temperature map with
  isotherms and residue curves.
- Optional settings: `title`, `residueCurves` (true), `isotherms` (true), `grid` (40),
  `allowMissingPairs` (false).
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
s.residueCurve([0.3, 0.3, 0.4], 101.325);
Fugacity.listComponents();        // what the databank holds
```

## Rules

- Only use components that `Fugacity.listComponents()` returns. Version 0.1.0 holds
  water, acetic acid and ethylene glycol. If the user asks for others, say they are not
  in the databank yet; do not invent parameters.
- Missing binary parameters raise an error that names the pair. Do not switch on
  `allowMissingPairs` without telling the user that those pairs will be treated as ideal.
- Results are model predictions. Say so, and point to the parameter sources the widget
  lists under the diagram.
- If the library fails to load, tell the user; do not replace it with hand-written
  thermodynamics.
