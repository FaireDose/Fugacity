# Roadmap

## Where Fugacity is going

**Today:** phase equilibria, pure-component properties, steam tables and cubic equations
of state, running in a browser page or an AI chat, every number traceable to an open
source.

**Next:** flash calculations, streams, unit operations and flowsheets with recycles,
then distillation. The core of a process simulator.

**The ambition:** an open process-design studio where AI agents do the legwork and
engineers make the decisions. You ask *"what is the best way to make this product, and
what would it cost?"*. Agents read the open literature and patents, propose a few
process routes, build and simulate a flowsheet for each, size the equipment, estimate
capital and operating cost and the cost per kilogram of product, and compare the routes
side by side. Every assumption, number and source is shown, so an engineer can check
the recommendation, change it and sign it off.

Each item below is small enough for one person (or one person with an AI assistant) to
finish, and each ends with tests. Pick an item, open an issue saying you are taking it,
and follow [CONTRIBUTING.md](CONTRIBUTING.md). The roadmap has five tracks and a release
plan:

- **Core track (A):** the design steps that fix the simulator's interfaces, layer by
  layer, from the property package to the flowsheet solver. Each step is a
  [proposal](proposals/README.md) first, then code.
- **Assistant compatibility track (C):** Fugacity working in every AI chat.
- **Data track (D):** more components and better parameters from open sources.
- **Cost engineering track (E):** equipment sizing, capital and operating cost, cost of
  product.
- **Agentic design track (G):** agents that turn literature into flowsheets and compare
  process routes.
- **Releases:** what users get, and which track items each release needs.

## Core track

The goal is an architecture for simulation tools that live inside AI chat artifacts and
web pages: one script, no server, results that can be traced, and interfaces that
contributors can build on without breaking each other's work. The steps below build it
layer by layer, following [ARCHITECTURE.md](ARCHITECTURE.md).

Each step delivers: an accepted proposal, a specification in `ARCHITECTURE.md` or `docs/`,
an implementation, and tests. A step can start when the steps it depends on are accepted.

| Step | Design question | Depends on | Status |
|---|---|---|---|
| **A1** Property package | One interface for every thermodynamic model: activity coefficients, K-values, enthalpy. See [proposal 0001](proposals/0001-property-package.md). Pure-component properties and enthalpy are in place ([proposal 0002](proposals/0002-pure-component-properties.md)); mixture enthalpy and the common interface are not. | – | Draft proposal |
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
| **C1** | Claude artifacts | Works (0.1.2, 0.2.0) |
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
| **D4** | Ideal-gas heat capacity and heat of vaporization for all components (needed by A1) | Done (0.2.0) |
| **D5** | Grow to about 50 components: common solvents, alcohols, acids, esters, hydrocarbons, with pairs | Open |
| **D6** | Liquid-liquid data for partly miscible pairs (water with benzene, toluene, chloroform, ethyl acetate) | Started: water + ethyl acetate |
| **D7** | Ternary VLE data to check ternary predictions, starting with the systems whose ternary azeotropes are tested (methanol + acetone + chloroform, ethanol + water + ethyl acetate) | Open |
| **D8** | Reaction data from open sources: heats of formation, equilibrium constants, kinetics for common reactions (esterification, hydrogenation, reforming), needed by reactors and route comparison | Open |

## Cost engineering track

Turns simulation results into money: what the plant would cost to build and to run, and
what the product would cost to make. Every cost correlation comes from an open source,
states the year of its cost basis and the index used to bring it to today, and every
estimate states its accuracy range. Cost results are estimates for comparing options,
never quotes.

| Item | What | Depends on | Status |
|---|---|---|---|
| **E1** | Equipment sizing from unit results: vessels and flash drums, column diameter and height, heat-exchanger area, pump and compressor power | A6, A8 | Open |
| **E2** | Purchased and installed equipment cost from open correlations, with material and pressure factors, and a cost index to move costs between years | E1 | Open |
| **E3** | Utilities and operating cost: steam (from the IAPWS steam tables), cooling water, electricity, fuel, raw materials, labour; prices as user inputs with sourced defaults | A8 | Open |
| **E4** | Economics of a flowsheet: capital cost, operating cost, cost of production per kg of product, net present value, payback, with a sensitivity chart for the main assumptions | E2, E3 | Open |
| **E5** | Environmental indicators: CO₂ emissions from energy use and feedstocks, water use, simple safety flags (flammable or toxic inventories, high pressure) | E3 | Open |
| **E6** | Cost view: a capital and operating cost breakdown next to the flowsheet, with every number traced to its correlation and source | E4, A11 | Open |

## Agentic design track

Very ambitious on purpose: AI agents that do the work of a process-design study, from
literature to a ranked list of process routes, while an engineer checks and decides.
Agents propose; people approve. Every agent result is a set of files (route, flowsheet,
sources, assumptions) that anyone can re-run and check.

| Item | What | Depends on | Status |
|---|---|---|---|
| **G1** | Tool interface for agents: every calculation callable as JSON in, JSON out, deterministic, with error messages that tell the agent what to fix | A9, A10 | Open |
| **G2** | Literature to route: an agent reads open papers and expired patents and extracts process routes (reactions, conditions, conversions, yields, separations) into a route file, every value cited | D8 | Open |
| **G3** | Route to flowsheet: an agent builds a flowsheet for each route, simulates it with Fugacity, and closes material and energy balances | G1, G2, A8 | Open |
| **G4** | Route comparison: yield, energy use, equipment, cost of production (E4), CO₂ and safety flags side by side, with a recommendation that states its assumptions and uncertainty | G3, E4, E5 | Open |
| **G5** | Benchmarks: published open case studies with known answers (for example textbook processes and open techno-economic reports), used to measure how well agents do before anyone trusts them | G4 | Open |
| **G6** | Design-study view: routes, flowsheets, costs and sources in one page an engineer can review, change and sign off | G4, A11, E6 | Open |

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
- [x] Core (architecture) and data tracks in this roadmap
- [x] First release on npm, so artifacts can load Fugacity with one line; trusted publishing

### v0.1.3 – AI-first contributing

- [x] AGENTS.md for all assistants and coding agents; llms.txt
- [x] Contribution package format with a check (`npm run check-package`, `Fugacity.checkPackage`)
- [x] Starter prompts, instructions for any assistant, skills in `ai/`
- [x] AI-prepared contribution form; three contribution levels in CONTRIBUTING.md

### v0.2 – Thermodynamic foundation (0.2.0 released)

- [x] Pure-component properties for 16 components (D4), IAPWS-IF97 steam tables
- [x] Peng–Robinson and SRK with k_ij; dew points and P-x-y for equations of state
- [x] Henry's law for gases in water
- [x] Property explorer; engineering report on every pull request
- [x] Refits to open data for the methanol + acetone + chloroform and ethanol + water + ethyl acetate pairs (D1 in part); ternary azeotrope checks
- [x] Workbench interface with a ribbon (`Fugacity.app`)
- [ ] Property package with mixture enthalpy (A1)
- [ ] Data packs; UNIFAC (Dortmund) as the `predicted` tier (A2, A3)

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

### v0.6 – Cost engineering

Needs E1–E4, E6.

- [ ] Equipment sizing and cost for the units of v0.4 and v0.5
- [ ] Operating cost and cost of production of a flowsheet; cost view

### v0.7 – Agentic process design

Needs G1–G4, E5.

- [ ] An assistant turns a short literature list into two or three flowsheets and compares them
- [ ] First benchmark case studies (G5)

### Later

- Reactors (conversion, equilibrium, kinetic), heat exchangers, compressors
- Sensitivity studies and optimization: the agent varies the design and finds the best
  operating point, with the engineer setting the limits
- Electrolytes, solids and polymers; dynamic simulation
- Life-cycle assessment linked to the cost model
- 1.0 after A12
