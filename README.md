# Fugacity

Chemical process simulation built for AI chat artifacts. Ask Claude (or another
assistant) for a phase diagram, and it opens a live interface that calculates right
in the chat, in your browser. Fugacity starts with vapour-liquid equilibria and is
meant to grow, one tested layer at a time, toward full flowsheets.

![Ternary bubble-temperature map with residue curves for water, acetic acid and ethylene glycol](docs/images/ternary.png)

> **Status: early (v0.1).** Three components, two activity models, two diagram types.
> Results are model predictions. Check them against data before using them for design.

## What it does today

| | |
|---|---|
| **Components** | water, acetic acid, ethylene glycol |
| **Liquid models** | NRTL, UNIQUAC, ideal |
| **Vapour model** | ideal gas; chemical theory (dimerization) for acetic acid |
| **Calculations** | bubble temperature, bubble pressure, T-x-y, P-x-y, ternary grids, residue curves |
| **Interface** | T-x-y diagram (2 components), ternary map with isotherms and residue curves (3 components), hover readout with tie lines, activity coefficients and azeotrope detection |

Everything runs in the browser. A full ternary map (861 bubble points plus ten residue
curves) takes well under a second.

## Use it in Claude

Add the skill in [`skill/fugacity/SKILL.md`](skill/fugacity/SKILL.md) to Claude, then ask
something like *"Show me the residue curves for water, acetic acid and ethylene glycol
at 1 atm."* Claude writes a few lines that load Fugacity, and the diagram opens as an
artifact.

## Use it in any web page

```html
<div id="app"></div>
<script src="https://cdn.jsdelivr.net/npm/fugacity@0.1.0/dist/fugacity.js"></script>
<script>
  Fugacity.mount("#app", {
    components: ["water", "acetic acid", "ethylene glycol"],
    model: "NRTL",
    P_kPa: 101.325
  });
</script>
```

Two components give a T-x-y diagram, three give a ternary map. See [`examples/`](examples).

## Use it from code

Units: temperature in K, pressure in kPa, mole fractions.

```js
const s = Fugacity.system({ components: ["water", "acetic acid"], model: "UNIQUAC" });
s.bubbleT([0.5, 0.5], 101.325);   // { T: 377.17, y: [0.644, 0.356], gamma: [1.266, 1.147] }
s.bubbleP([0.5, 0.5], 373.15);    // { P, y, gamma }
s.txy(101.325);                   // [{ x, T, y }, ...]
s.residueCurve([0.3, 0.3, 0.4], 101.325);
```

## How we know the numbers are right

Every model is checked automatically on each change (`npm test`):

| Check | Result |
|---|---|
| JavaScript engine vs. an independent Python implementation, 198 bubble points | agree to 1e-7 K |
| Acetic acid + ethylene glycol vs. Schmid et al. (2007), P-x at 363.15 K | AAD 1.2 % (NRTL), 0.9 % (UNIQUAC) |
| Water + ethylene glycol vs. T-x-y data at 760 mmHg | AAD 3.0 K (NRTL), 2.6 K (UNIQUAC), within the data scatter |
| Pure-component boiling points at 1 atm | within 0.1 K |

Where each parameter comes from is recorded next to it in
[`src/data/binaries.json`](src/data/binaries.json) and shown under every diagram.

**Known limits:** no ternary VLE data exist to check the three-component prediction;
the water + ethylene glycol data set is old and scattered; acetic acid and ethylene
glycol slowly esterify, which the model does not include.

## Project layout

```
src/data/          component and binary parameter data (JSON, with sources)
src/thermo/        vapour pressure, activity models, vapour-phase association
src/equilibrium/   bubble points, diagrams, residue curves
src/ui/            the interactive interface (Fugacity.mount)
test/              automated checks
validation/        experimental data, Python reference model, reference results
skill/             the Claude skill
examples/          ready-to-open pages
```

## Where it is going

See [ROADMAP.md](ROADMAP.md): more components, UNIFAC, flash, then streams, unit
operations, recycles and columns.

## Contributing

Chemical engineers are the most useful contributors: data, parameters, validation
cases and checking results. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Sources

- B. Schmid, M. Döker, J. Gmehling, *Fluid Phase Equilibria* 258 (2007) 115–124.
- ChemSep UNIQUAC parameters and pure-component correlations via the open-source
  [thermo](https://github.com/CalebBell/thermo) and [chemicals](https://github.com/CalebBell/chemicals) libraries (MIT).
- Acetic acid dimerization: Marek–Standart chemical theory.

## License

MIT
