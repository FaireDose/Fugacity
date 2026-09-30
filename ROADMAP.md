# Roadmap

## The goal: a flowsheet simulator inside your AI chat

The end point is a process simulator that lives in the chat page. You build a flowsheet in
two ways, and both change the same flowsheet file:

- **By hand:** drag units (feed, mixer, heater, flash drum, column, ...) onto the page,
  draw streams between their ports, type specifications, and see the solved stream table
  update.
- **By talking:** tell your assistant "add a flash drum after the heater at 1 atm and
  recycle 30 % of the liquid", and it edits the flowsheet file; the page redraws and
  solves it.

Everything below serves that goal. Thermodynamic data matters because every unit
operation stands on it, but the flowsheet is the main line of work.

## How the work is organized

Each item is small enough for one person, usually with an AI assistant, and ends with
tests. Pick an item, open an issue saying you are taking it, and follow
[CONTRIBUTING.md](CONTRIBUTING.md).

- **Flowsheet track (main):** the releases below, from a first material-balance
  flowsheet to energy balances and distillation.
- **Architecture track:** the design steps each release needs. Each step is a
  [proposal](proposals/README.md) first, then code.
- **Data track:** more components and better parameters from open sources, in parallel.
- **Assistant compatibility track:** making pages work in every AI chat.

## Flowsheet track

### Done

- **v0.1** Phase-equilibrium workbench: NRTL, UNIQUAC, bubble points, T-x-y, ternary maps,
  residue curves, validation against data and an independent Python model.
- **v0.1.1** Ten components, component picker, azeotropes, phase-split warning, review
  workflow, ARCHITECTURE.md.
- **v0.1.2** Community foundations: governance, security, proposals; first npm release.
- **v0.1.3** AI-first contributing: AGENTS.md, contribution packages and their check,
  starter prompts, skills for any assistant.

### v0.2 – First flowsheet: material balances

The first version where you draw a flowsheet in the chat. It needs no energy balances:
flash drums are specified by temperature and pressure, using the K-values Fugacity
already calculates. See [proposal 0002](proposals/0002-first-flowsheet.md).

Needs A4, A5, A6, A7, A8, A11 (first versions).

- [ ] PT flash (Rachford–Rice with activity coefficients), validated against the Python
      reference model
- [ ] Stream object and stream table
- [ ] Units: feed, mixer, splitter, flash drum (T, P), component separator
- [ ] Flowsheet file format and solver with recycles (tear streams, Wegstein)
- [ ] Flowsheet canvas: drag units, draw streams between ports, edit specifications,
      solved results on the drawing
- [ ] Assistants can write and edit flowsheet files (skill and instructions updated)

### v0.3 – Energy balances

Needs A1 (enthalpy), D4.

- [ ] Property package with enthalpy: ideal-gas heat capacity, heat of vaporization,
      excess enthalpy
- [ ] Heater and cooler with duties, adiabatic and PQ flash, pump, valve
- [ ] Energy balance checks on every unit; duties in the stream table

### v0.4 – Distillation

- [ ] Shortcut column (Fenske–Underwood–Gilliland) and McCabe–Thiele view
- [ ] Rigorous equilibrium-stage column (MESH equations), column profiles
- [ ] Design specifications ("adjust reflux until distillate is 99 %")

### v0.5 – Wider thermodynamics

Needs A2, A3, D6.

- [ ] Data packs; modified UNIFAC (Dortmund) as the `predicted` tier
- [ ] Dew points; P-x-y view
- [ ] Liquid-liquid and vapour-liquid-liquid equilibria; decanter

### Later

- Reactors (conversion, equilibrium, kinetic), heat exchangers, compressors
- Equations of state (Peng–Robinson, SRK) for gases and high pressure
- Sensitivity studies and simple optimization
- 1.0 after A12

## Architecture track

Design steps that fix the interfaces everything else is built on, following
[ARCHITECTURE.md](ARCHITECTURE.md). Each step delivers an accepted proposal, a
specification, an implementation and tests.

| Step | Design question | Needed for | Status |
|---|---|---|---|
| **A1** Property package | One interface for every thermodynamic model. K-values exist today (`createSystem`); enthalpy is added for v0.3. See [proposal 0001](proposals/0001-property-package.md). | v0.3 | Draft proposal |
| **A2** Data registry and packs | How chemicals are stored, versioned and loaded in pieces (data packs as scripts), and the size budget per pack. | v0.5 | Open |
| **A3** Quality tiers and prediction | When the engine may use a predicted (UNIFAC) pair, and how every result shows the tier behind it. | v0.5 | Open |
| **A4** Equilibrium solver contract | Common rules for bubble, dew and flash solvers: inputs, convergence, and failure reporting (never a silent wrong answer). | v0.2 | Open |
| **A5** Streams and units | The stream object, internal SI units, conversion only at the edges. | v0.2 | Open |
| **A6** Unit operation interface | `registerUnit`: ports, specifications with validation, balance checks, required tests. | v0.2 | Open |
| **A7** Flowsheet file format | JSON schema, format versions, and how older files keep working. | v0.2 | In [proposal 0002](proposals/0002-first-flowsheet.md) |
| **A8** Flowsheet solver | Calculation order, tear streams, recycle convergence, design specifications, clear error messages. | v0.2 | In [proposal 0002](proposals/0002-first-flowsheet.md) |
| **A9** Artifact contract | What a page may rely on: one pinned script, the `mount` configuration, no network access, theming, size and speed budgets, background workers. | v0.2 | Open |
| **A10** AI authoring contract | How an assistant writes flowsheet files: the skill, a schema it can check against, and error messages that tell it what to fix. | v0.2 | Open |
| **A11** Views | Flowsheet canvas, stream tables, column profiles, results export; views only call the layers below. | v0.2 | In [proposal 0002](proposals/0002-first-flowsheet.md) |
| **A12** Stability policy for 1.0 | Which interfaces are frozen, deprecation rules, support of old versions. | 1.0 | Open |

## Data track

| Item | What | Status |
|---|---|---|
| **D1** | Replace the water + ethylene glycol data (secondary compilation) with an open primary source, e.g. Kamihama et al. (2012) via the ThermoML Archive, and refit | Open |
| **D2** | Fit the *databank only* and *missing* pairs in [DATA_WANTED.md](docs/DATA_WANTED.md) to open experimental data | Open, many items |
| **D3** | One common format for all files in `validation/data/` | Open |
| **D4** | Ideal-gas heat capacity and heat of vaporization for all components (needed for v0.3) | Open |
| **D5** | Grow to about 50 components: common solvents, alcohols, acids, esters, hydrocarbons, with pairs | Open |
| **D6** | Liquid-liquid data for partly miscible pairs (water with benzene, toluene, chloroform, ethyl acetate) | Open |

## Assistant compatibility track

| Item | What | Status |
|---|---|---|
| **C1** | Claude artifacts | Works (0.1.2) |
| **C2** | ChatGPT canvas | Open |
| **C3** | Gemini canvas | Open |
| **C4** | Other assistants and coding agents that preview HTML | Open |
| **C5** | A package check page: paste a contribution package, see the check and the data plotted against the current model | Open |
| **C6** | Skills attached to every release; instructions for assistants kept in sync with the version (checked by a test) | Done |
