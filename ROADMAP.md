# Roadmap

Fugacity grows in three tracks. Each item is small enough for one person (or one person
with Claude) to finish, and each ends with tests. Pick an item, open an issue saying you
are taking it, and follow [CONTRIBUTING.md](CONTRIBUTING.md).

- **Architecture track:** design steps that fix the interfaces everything else is built
  on. Each step is a [proposal](proposals/README.md) first, then code.
- **Data track:** more components and better parameters from open sources.
- **Releases:** what users get, and which track items each release needs.

## Architecture track

The goal is an architecture for simulation tools that live inside AI chat artifacts and
web pages: one script, no server, results that can be traced, and interfaces that
contributors can build on without breaking each other's work. The steps below build it
layer by layer, following [ARCHITECTURE.md](ARCHITECTURE.md).

Each step delivers: an accepted proposal, a specification in `ARCHITECTURE.md` or `docs/`,
an implementation, and tests. A step can start when the steps it depends on are accepted.

| Step | Design question | Depends on | Status |
|---|---|---|---|
| **A1** Property package | One interface for every thermodynamic model: activity coefficients, K-values, enthalpy. See [proposal 0001](proposals/0001-property-package.md). | – | Draft proposal |
| **A2** Data registry and packs | How chemicals are stored, versioned and loaded in pieces (data packs as scripts), and the size budget per pack. | A1 | Open |
| **A3** Quality tiers and prediction | When the engine may use a predicted (UNIFAC) pair, and how every result shows the tier of the data behind it. | A1, A2 | Open |
| **A4** Equilibrium solver contract | Common rules for bubble, dew and flash solvers: inputs, convergence criteria, and how failures are reported (never a silent wrong answer). | A1 | Open |
| **A5** Streams and units | The stream object, internal SI units, and conversion only at the edges (interface, files). | A1, A4 | Open |
| **A6** Unit operation interface | `registerUnit`: ports, specifications with validation, material and energy balance checks, required tests. | A5 | Open |
| **A7** Flowsheet file format | JSON schema, format versions, and how older files keep working. | A5, A6 | Open |
| **A8** Flowsheet solver | Calculation order, tear streams, recycle convergence, design specifications, error messages an engineer understands. | A6, A7 | Open |
| **A9** Artifact contract | What a page may rely on: one pinned script, the `mount` configuration, no network access, theming, size and speed budgets (ternary map under 0.5 s, 50-stage column under 5 s), background workers. | A1 | Open |
| **A10** AI authoring contract | How an assistant writes configurations and flowsheet files: the skill, a schema it can check against, and error messages that tell it what to fix. | A7, A9 | Open |
| **A11** Views | Flowsheet drawing, stream tables, column profiles, results export; views only call the layers below. | A7, A9 | Open |
| **A12** Stability policy for 1.0 | Which interfaces are frozen, deprecation rules, long-term support of old versions. | A1–A11 | Open |

## Assistant compatibility track

Fugacity pages should work in every AI chat that can show HTML. Each item: test the
one-line setup, document what works, and fix or report what doesn't.

| Item | What | Status |
|---|---|---|
| **C1** | Claude artifacts | Works (0.1.2) |
| **C2** | ChatGPT canvas | Open |
| **C3** | Gemini canvas | Open |
| **C4** | Other assistants and coding agents that preview HTML | Open |
| **C5** | A package check page: paste a contribution package, see the check and the data plotted against the current model | Open |
| **C6** | Instructions for assistants kept in sync with each release (version numbers in `ai/`) | Open |

## Data track

| Item | What | Status |
|---|---|---|
| **D1** | Replace the water + ethylene glycol data (secondary compilation) with an open primary source, e.g. Kamihama et al. (2012) via the ThermoML Archive, and refit | Open |
| **D2** | Fit the *databank only* and *missing* pairs in [DATA_WANTED.md](docs/DATA_WANTED.md) to open experimental data | Open, many items |
| **D3** | One common format for all files in `validation/data/` | Open |
| **D4** | Ideal-gas heat capacity and heat of vaporization for all components (needed by A1) | Open |
| **D5** | Grow to about 50 components: common solvents, alcohols, acids, esters, hydrocarbons, with pairs | Open |
| **D6** | Liquid-liquid data for partly miscible pairs (water with benzene, toluene, chloroform, ethyl acetate) | Open |

## Releases

### v0.1 – Phase-equilibrium workbench (done)

- [x] Water, acetic acid, ethylene glycol with sourced parameters
- [x] NRTL, UNIQUAC, ideal; acetic acid dimerization in the vapour
- [x] Bubble T and P, T-x-y, P-x-y, ternary grid, residue curves
- [x] Interface for 2 and 3 components, usable in AI chat artifacts
- [x] Validation against experimental data and an independent Python model

### v0.1.1 – More chemicals and review workflow (done)

- [x] Seven more components and ChemSep parameters; component picker
- [x] Binary and ternary azeotropes, validated against handbook values
- [x] Warning where the liquid would split into two phases (spinodal check)
- [x] Quality tier on every parameter; data licenses recorded
- [x] Reproducible parameter fitting; issue forms, review checklist, code owners
- [x] ARCHITECTURE.md

### v0.1.2 – Community foundations

- [x] Contributing guide with four ways to help; data wanted list; contributor skill for Claude
- [x] Governance, security policy, code of conduct, proposal process
- [x] Architecture and data tracks in this roadmap
- [x] First release on npm, so artifacts can load Fugacity with one line; trusted publishing

### v0.1.3 – AI-first contributing

- [x] AGENTS.md for all assistants and coding agents; llms.txt
- [x] Contribution package format with a check (`npm run check-package`, `Fugacity.checkPackage`)
- [x] Starter prompts, instructions for any assistant, skills in `ai/`
- [x] AI-prepared contribution form; three contribution levels in CONTRIBUTING.md

### v0.2 – Thermodynamic foundation

Needs A1, A2, A3, A9 and D1, D4.

- [ ] Property package with enthalpy
- [ ] Data packs; UNIFAC (Dortmund) as the `predicted` tier
- [ ] Dew points; P-x-y view

### v0.3 – Flash and streams

Needs A4, A5 and D6.

- [ ] PT, PH and PQ flash; stream object
- [ ] Liquid-liquid and vapour-liquid-liquid equilibria

### v0.4 – Flowsheets

Needs A6, A7, A8, A10, A11.

- [ ] Mixer, splitter, heater/cooler, pump, valve, flash drum
- [ ] Flowsheet solver with recycles; flowsheet drawing and stream tables
- [ ] Assistants can write and edit flowsheet files

### v0.5 – Distillation

- [ ] Shortcut column (Fenske–Underwood–Gilliland); McCabe–Thiele view
- [ ] Rigorous equilibrium-stage column (MESH equations)

### Later

- Reactors (conversion, equilibrium, kinetic), heat exchangers, compressors
- Equations of state (Peng–Robinson, SRK) for gases and high pressure
- Sensitivity studies and simple optimization
- 1.0 after A12
