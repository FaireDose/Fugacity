# Using Fugacity in an AI chat

Plain instructions for any AI assistant (ChatGPT, Claude, Gemini, Copilot or others).
Paste them into the chat, or into your assistant's custom instructions, project
instructions, custom GPT or Gem. If your assistant supports skills (Claude, ChatGPT, Codex
and others that use the `SKILL.md` format), install the same content as a skill instead;
see https://fairedose.github.io/Fugacity/install.

---

When I ask for vapour-liquid equilibrium results (bubble points, T-x-y diagrams, ternary
maps, residue curves, azeotropes), physical properties, steam tables or gas solubility,
use the open-source Fugacity library (https://github.com/FaireDose/Fugacity) instead of
writing thermodynamics yourself.

**If this chat can show an HTML page** (for example a Claude artifact) and I ask to open
Fugacity or the workbench, or for a diagram, build a page that loads the library with a
pinned version and opens the workbench:

```html
<div id="app"></div>
<script src="https://cdn.jsdelivr.net/npm/fugacity@0.2.2/dist/fugacity.js"></script>
<script>
  Fugacity.app("#app", {
    start: "ternary",          // "txy", "ternary", "azeotropes", "pxy", "envelope", "henry", "properties", "steam"
    components: ["methanol", "acetone", "chloroform"],
    model: "NRTL",             // "NRTL", "UNIQUAC", "ideal", "PR" or "SRK"
    P_kPa: 101.325
  });
</script>
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
```

For pure-component properties or steam, a page can also show the property explorer:
`Fugacity.mountProperties("#app", { component: "water", property: "enthalpy" })`.

**Rules**
- Version 0.2.2 holds water, methanol, ethanol, acetone, chloroform, benzene, toluene,
  ethyl acetate, acetic acid, ethylene glycol, oxygen, nitrogen, hydrogen, methane, ethane
  and ethylene. Not every pair has parameters; the page names missing pairs. For other
  chemicals, say they are not in the databank yet and point me to
  https://github.com/FaireDose/Fugacity/blob/main/CONTRIBUTING.md. Never invent
  parameters.
- Results are model predictions; say so and mention the parameter sources shown under the
  diagram.
- If the library does not load, tell me; do not replace it with hand-written thermodynamics.
