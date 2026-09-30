# Fugacity

Chemical process simulation built for AI chat artifacts. Ask Claude (or another
assistant) for a phase diagram, and it opens a live interface that calculates right
in the chat, in your browser. Fugacity starts with vapour-liquid equilibria and is
meant to grow, one tested layer at a time, toward full flowsheets.

![Ternary map for methanol, acetone and chloroform with four azeotropes and residue curves](docs/images/ternary.png)

> **Status: early (v0.1.1).** Ten components, two activity models, two diagram types.
> Results are model predictions. Check them against data before using them for design.

## What it does today

| | |
|---|---|
| **Components** | water, methanol, ethanol, acetone, chloroform, benzene, toluene, ethyl acetate, acetic acid, ethylene glycol |
| **Binary parameters** | 27 pairs (NRTL and/or UNIQUAC), each labelled *fitted to data* or *databank* |
| **Liquid models** | NRTL, UNIQUAC, ideal |
| **Vapour model** | ideal gas; chemical theory (dimerization) for acetic acid |
| **Calculations** | bubble temperature and pressure, T-x-y, P-x-y, ternary grids, residue curves, binary and ternary azeotropes, liquid phase-split check |
| **Interface** | component picker; T-x-y diagram (2 components) or ternary map with isotherms, residue curves and azeotropes (3 components); hover readout with tie lines and activity coefficients; warning where the liquid would split into two phases |

Complete ternaries you can open today include methanol + acetone + chloroform (four
azeotropes), ethanol + water + ethylene glycol (extractive distillation), methanol +
ethanol + water, and water + acetic acid + ethylene glycol. If a pair has no
parameters yet, the interface says which one.

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
<script src="https://cdn.jsdelivr.net/npm/fugacity@0.1.1/dist/fugacity.js"></script>
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
s.bubbleT([0.5, 0.5], 101.325);   // { T: 376.36, y: [0.645, 0.355], gamma: [1.306, 1.164] }
s.bubbleP([0.5, 0.5], 373.15);    // { P, y, gamma }
s.txy(101.325);                   // [{ x, T, y }, ...]
s.azeotropes(101.325);            // [{ x, T, type }]
Fugacity.listComponents();        // what the databank holds
```

## How we know the numbers are right

Every model is checked automatically on each change (`npm test`):

| Check | Result |
|---|---|
| JavaScript engine vs. an independent Python implementation, 446 bubble points in 3 ternaries and 9 binaries | agree to 1e-7 K |
| 10 binary azeotropes at 1 atm vs. handbook values | NRTL within 0.4 K and 0.02 in x; UNIQUAC within 1 K and 0.05 |
| Methanol + acetone + chloroform ternary saddle azeotrope | NRTL 57.1 °C vs. 57.5 °C |
| Acetic acid + ethylene glycol vs. Schmid et al. (2007), P-x at 363.15 K | AAD 1.2 % (NRTL), 0.9 % (UNIQUAC) |
| Water + ethylene glycol vs. T-x-y data at 760 mmHg | AAD 3.0 K (NRTL), 2.6 K (UNIQUAC), within the data scatter |
| Pure-component boiling points at 1 atm | within 0.2 K |

Where each parameter comes from is recorded next to it in
[`src/data/binaries.json`](src/data/binaries.json) and shown under every diagram.

**Known limits:** the phase-split check finds the spinodal only, so the real two-liquid
region is wider than the shaded one; the UNIQUAC databank set is less accurate than
NRTL for some systems (acetone + chloroform + methanol); no ternary VLE data exist yet
to check water + acetic acid + ethylene glycol; acetic acid and alcohols or glycols
slowly esterify, which the model does not include.

## Project layout

```
src/data/          component and binary parameter data (JSON, with sources)
src/thermo/        vapour pressure, activity models, vapour-phase association
src/equilibrium/   bubble points, diagrams, residue curves, azeotropes, phase stability
src/ui/            the interactive interface (Fugacity.mount)
test/              automated checks
validation/        experimental data, Python reference model and parameter fitting, reference results
skill/             the Claude skill
examples/          ready-to-open pages
```

## How it is built and where it is going

- [ARCHITECTURE.md](ARCHITECTURE.md): the layers from data to flowsheet, data quality
  tiers, the flowsheet file format, and the review process.
- [ROADMAP.md](ROADMAP.md): UNIFAC, enthalpy and flash next, then streams, unit
  operations, recycles and columns.

## Contributing

Chemical engineers are the most useful contributors: data, parameters, validation
cases and checking results. Professors and students can suggest changes through the
[issue forms](https://github.com/FaireDose/Fugacity/issues/new/choose) (also linked
under every diagram); every change is checked by a second person before it is merged.
See [CONTRIBUTING.md](CONTRIBUTING.md).

## Sources

- B. Schmid, M. Döker, J. Gmehling, *Fluid Phase Equilibria* 258 (2007) 115–124.
- ChemSep NRTL and UNIQUAC parameters and UNIQUAC r, q (Kooijman and Taylor,
  Artistic License 2.0), via the open-source [thermo](https://github.com/CalebBell/thermo)
  library and the ChemSep database distributed with DWSIM.
- Pure-component correlations from [thermo](https://github.com/CalebBell/thermo) and
  [chemicals](https://github.com/CalebBell/chemicals) (MIT).
- Azeotrope data: handbook values as tabulated in Wikipedia's "Azeotrope tables"
  (Lange's Handbook, CRC Handbook).
- Acetic acid dimerization: Marek–Standart chemical theory.

## License

Code: MIT. Data: see [src/data/LICENSES.md](src/data/LICENSES.md).
