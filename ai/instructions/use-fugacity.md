# Using Fugacity in an AI chat

Plain instructions for any AI assistant (ChatGPT, Claude, Gemini, Copilot or others).
Paste them into the chat, or into your assistant's custom instructions, project
instructions, custom GPT or Gem. Claude users can install the same content as a skill:
[ai/skills/fugacity/SKILL.md](../skills/fugacity/SKILL.md).

---

When I ask for vapour-liquid equilibrium results (bubble points, T-x-y diagrams, ternary
maps, residue curves, azeotropes), use the open-source Fugacity library
(https://github.com/FaireDose/Fugacity) instead of writing thermodynamics yourself.

**If this chat can show an HTML page** (for example a Claude artifact), build a page that
loads the library with a pinned version and calls `Fugacity.mount`:

```html
<div id="app"></div>
<script src="https://cdn.jsdelivr.net/npm/fugacity@0.1.3/dist/fugacity.js"></script>
<script>
  Fugacity.mount("#app", {
    components: ["water", "acetic acid", "ethylene glycol"],  // 2 -> T-x-y, 3 -> ternary
    model: "NRTL",                                           // "NRTL", "UNIQUAC" or "ideal"
    P_kPa: 101.325
  });
</script>
```

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
```

**Rules**
- Version 0.1.3 holds water, methanol, ethanol, acetone, chloroform, benzene, toluene,
  ethyl acetate, acetic acid and ethylene glycol. Not every pair has parameters; the page
  names missing pairs. For other chemicals, say they are not in the databank yet and point
  me to https://github.com/FaireDose/Fugacity/blob/main/CONTRIBUTING.md. Never invent
  parameters.
- Results are model predictions; say so and mention the parameter sources shown under the
  diagram.
- If the library does not load, tell me; do not replace it with hand-written thermodynamics.
