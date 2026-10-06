# 0006: The first flowsheet: streams, blocks, recycles and a Flowsheet workspace

- **Status:** Accepted (by the lead maintainer, 2026-10-06)
- **Author(s):** Fugacity maintainers (drafted with an AI assistant)
- **Discussion:** this pull request
- **Roadmap item:** core track A5 (streams), A6 (unit operation interface), A7 (flowsheet file
  format), A8 (flowsheet solver), A11 (views); bridges B4 (project files); release v0.4

## Problem

Fugacity can flash one feed. A process is several units joined by streams: a feed is mixed with a
recycle, flashed, its liquid split, part of it sent back. Today an engineer has to copy the outlet
of one flash by hand into the next, cannot close a recycle, and cannot keep the result.

What is missing:

1. **Streams** (A5): an object that carries T, P, component flows, phase split and enthalpy flow
   from one unit to the next.
2. **Blocks** (A6): units with ports and specifications that turn inlet streams into outlet
   streams and report their balances.
3. **A solver** (A8): the calculation order, and convergence of recycles, with errors that say
   which loop did not converge and why.
4. **A file** (A7, B4): a flowsheet that is saved and opened again, on the computer or in the
   storage of an AI chat page.
5. **A view** (A11): a canvas where blocks are placed and connected, specifications are set in
   the Inputs panel, and the stream table is in the Results panel.

Who is affected: students doing their first mass balances with recycle, engineers who want a
quick separation sketch in a chat, and every later roadmap item (columns, reactors, cost
engineering, agent-built flowsheets in track G), which all need streams, blocks and the solver.

## Proposal

### 1. Stream (A5, `src/stream/`)

A stream is the state of one flow and is always the result of a flash with the flowsheet's
property package (the `system` of proposal 0001), so phase split and enthalpy are consistent:

```js
{
  id: "S3",
  T_K: 351.2, P_kPa: 101.325,
  flow_kmol_h: { water: 60, ethanol: 40 },     // component molar flows
  phases: [ { type: "vapour", fraction: 0.25, composition: [...] }, { type: "liquid", ... } ],
  VF: 0.25,                                     // vapour fraction (mol/mol)
  H_kW: -1234.5                                 // enthalpy flow, same reference as the flash
}
```

- `Fugacity.stream(sys, { T_K, P_kPa, flow_kmol_h })` flashes at T and P;
  `{ P_kPa, H_kW, flow_kmol_h }` flashes at P and enthalpy (P-H flash, proposal 0001).
- Internal units are SI-based and as in the engine (K, kPa, kmol/h, kW); the interface converts.
- A stream with zero flow is allowed (a closed valve, an empty purge) and carries T and P only.

### 2. Blocks (A6, `src/units/`)

Every block type is one module with the shape of `registerUnit` in ARCHITECTURE.md:
ports, specifications with checks, and `solve({ inlets, specs, sys })` returning the outlets,
the duties and a report. The first blocks:

| Block | Ports | Specifications | What it does |
|---|---|---|---|
| **Feed** | out | T and P (or VF), flows per component (kmol/h, kg/h or t/h) | creates a stream |
| **Mixer** | in (2 or more), out | outlet P (default: lowest inlet P) | adds the flows and the enthalpies; P-H flash of the outlet |
| **Splitter** | in, out (2 or more) | fraction of the inlet to each outlet (sum 1, one may be "the rest") | divides the stream; every outlet has the inlet's T, P and composition |
| **Component separator** | in, out (2 or more) | split fraction of **each component** to each outlet; outlet T and P (default: inlet) | a black-box separation: outlet flows from the split fractions, each outlet flashed at its T and P; reports the heat duty that closes the energy balance |
| **Flash drum** | in, vapour, liquid (and liquid 2 when two liquids form) | T and P, P and duty, P and VF, or T and VF (the four flash specifications of proposal 0001) | the flash, with the outlets as streams |
| **Heater / cooler** | in, out | outlet T, or duty, or VF; pressure drop | P-H or T-P flash of the outlet; reports the duty |
| **Product** | in | none | marks a stream that leaves the flowsheet |

The splitter and the component separator are the "simple separation unit where I select the
split ratios" of the request: the person chooses the ratios; the outlet streams then work out
their own phase state with a flash. Every block:

- closes its material balance to 1e-9 relative, per component;
- reports its energy balance (duty in kW, with the enthalpy reference stated);
- checks its specifications and says what is wrong ("split fractions of ethanol add up to
  1.2; they must add up to 1");
- has a test against an independent calculation (section "Engineering basis").

### 3. Flowsheet solver (A8, `src/flowsheet/`)

Sequential modular, as in most simulators and as already planned in ARCHITECTURE.md:

1. **Graph.** Blocks are nodes and streams are edges. Strongly connected components (Tarjan,
   1972) give the loops; the blocks outside loops are calculated once, in order.
2. **Tear streams.** In each loop, the smallest set of streams that breaks every cycle is
   chosen (branch and bound over the loop's streams; the first flowsheets have few). The person
   can also choose the tear stream on the canvas.
3. **Convergence.** The tear variables are the component flows, T and P of each tear stream.
   The first iterations use direct substitution; then bounded Wegstein acceleration per
   variable. Defaults: up to 50 iterations, relative tolerance 1e-8 on every flow; the
   acceleration factor is bounded to [−5, 0], the bounds Pyomo uses by default (see
   "Engineering basis").
4. **Fail loudly.** A loop that does not converge stops the calculation with an error that
   names the loop, the tear stream, the largest remaining change and the iteration history,
   and suggests what usually helps (a better initial guess for the tear stream, a smaller
   recycle ratio, a different tear stream). The last iterate is shown, marked as not converged,
   never as a result.
5. **Report.** The overall material balance of the flowsheet (feeds = products, per
   component) and the energy balance (sum of duties and enthalpy flows) are checked and shown.

The solver runs in a background worker when the flowsheet is large (ARCHITECTURE.md, layer 6),
so the page stays responsive.

### 4. File format (A7, B4)

The flowsheet goes into the project file of the workbench (`src/ui/project.js`, format 1 in
pull request 50), which becomes format 2. Format 1 files keep opening (rule of ARCHITECTURE.md:
a newer engine reads every older format version).

```json
{
  "fugacity_project": 2,
  "saved_with": "fugacity 0.4.0",
  "title": "Methanol recovery with recycle",
  "workbench": { "view": "flowsheet", "model": "NRTL", "vapour": "ideal" },
  "flowsheet": {
    "components": ["methanol", "water"],
    "thermo": { "model": "NRTL", "vapour": "ideal" },
    "blocks": [
      { "id": "F1", "type": "feed", "x": 40, "y": 120,
        "spec": { "T_K": 298.15, "P_kPa": 101.325, "flow_kmol_h": { "methanol": 30, "water": 70 } } },
      { "id": "M1", "type": "mixer", "x": 160, "y": 120 },
      { "id": "V1", "type": "flash", "x": 280, "y": 120, "spec": { "P_kPa": 101.325, "VF": 0.4 } },
      { "id": "SP1", "type": "splitter", "x": 400, "y": 180, "spec": { "fractions": { "S5": 0.8, "S6": "rest" } } },
      { "id": "P1", "type": "product", "x": 400, "y": 60 },
      { "id": "P2", "type": "product", "x": 520, "y": 180 }
    ],
    "streams": [
      { "id": "S1", "from": "F1.out", "to": "M1.in" },
      { "id": "S2", "from": "M1.out", "to": "V1.in" },
      { "id": "S3", "from": "V1.vapour", "to": "P1.in" },
      { "id": "S4", "from": "V1.liquid", "to": "SP1.in" },
      { "id": "S5", "from": "SP1.out", "to": "M1.in", "tear": true },
      { "id": "S6", "from": "SP1.out", "to": "P2.in" }
    ],
    "solver": { "maxIterations": 50, "tolerance": 1e-8 }
  },
  "results": { "streams": { "S3": { "T_K": "...", "flow_kmol_h": { "...": "..." } } } }
}
```

(The feed flows and specifications in the example are inputs a person would type, not data.)

- Positions (`x`, `y`) are only for the drawing. Port names are fixed by the block type; a
  block with several outlets of the same kind (`out`) gets them in order.
- `results` is a record of the last converged calculation, for reading without Fugacity; it is
  never used as input, except that a converged tear stream may seed the next calculation.
- Units are stated in every key (`T_K`, `P_kPa`, `flow_kmol_h`); ARCHITECTURE.md's example
  with `T_C` is changed to `T_K` to follow the SI rule, with the interface converting.
- A JSON schema (`docs/schema/project-2.json`) lets an AI assistant check a file it writes
  (A10), and `Fugacity.checkProject(doc)` returns the problems as a list.

### 5. Where flowsheets are kept: on the computer and in the cloud

All three ways use the same file, so a flowsheet moves freely between them:

- **On the computer**: Download and Open in the Project panel (pull request 50), and Copy or
  Paste where a page cannot download.
- **In the browser**: the workbench keeps an automatic copy of the open flowsheet in the
  page's own browser storage, and offers to restore it after the page is reloaded. This is a
  convenience for the one browser, not a place to keep work.
- **In an AI chat or other host page**: `Fugacity.app(el, { storage })`, where `storage` is
  given by the page that hosts the workbench:
  `{ list(): Promise<string[]>, get(name), put(name, project), remove(name) }`. A chat page can
  connect it to the persistent storage its platform gives pages, so flowsheets are kept with
  the chat and are there on the next visit or another device. The Project panel then shows a
  list of saved flowsheets. The assistant can also read and write the same JSON directly
  (A10): "add a heater before V1 to 80 °C" becomes an edit of the file, checked with
  `checkProject` before it is opened.

Fugacity itself never sends a flowsheet anywhere; only the host page decides where `storage`
puts it.

### 6. The Flowsheet workspace (A11): set up first, then draw

As in a desktop simulator, a simulation is set up in a fixed order: first the components, then
the property method, then the flowsheet. The setup is part of the flowsheet and is fixed while
the flowsheet is drawn and solved; changing it later is a deliberate step that recalculates
everything.

A sixth tab next to Flash. Its toolbar has three groups, one per step, left to right:

```
┌ Setup ─────────────────────────┐┌ Flowsheet ──────────────────────────────────────────────┐┌ Run ────────────┐
│ [1 Components]  [2 Method]     ││ Feed  Mixer  Splitter  Separator  Flash  Heater  Product ││ [Solve] [Reset] │
│  ethanol, water, +2   NRTL     ││ Connect  Delete  Fit to view                             ││ ☐ on every change│
└────────────────────────────────┘└──────────────────────────────────────────────────────────┘└─────────────────┘
```

1. **Components.** The button opens the component list of the setup: search the databank
   (name, formula, CAS), add or remove, reorder. Before components are chosen, the rest of the
   toolbar is disabled and the canvas says "Start by choosing the components of the
   simulation".
2. **Method.** The property method for the whole flowsheet: an activity model (NRTL, UNIQUAC,
   ideal) with its vapour model, or an equation of state (Peng–Robinson, SRK). The panel shows,
   for the chosen components, which pairs have parameters, their tier and source, and which
   are missing, as the Library does today, and refuses a method that cannot calculate every
   pair (or asks the person to accept named pairs as ideal). The parameter sets per pair are
   chosen here too.
3. **Flowsheet.** Once the setup is complete, the block palette is enabled. Every block and
   stream uses the setup's components and method; a feed lists exactly those components.

The setup is shown as a summary in the toolbar (the components and the method). Changing it
after blocks exist opens a confirmation that says what will happen: a removed component
disappears from every feed; a new component starts at zero flow; a new method recalculates
every stream. The Phase equilibrium and Flash tabs keep their own quick choices, so a
diagram can be checked without touching the simulation; a button "Use the flowsheet's setup"
copies the setup into them.

The rest of the workspace:

- **Canvas** (SVG): blocks are placed by clicking the palette and then the canvas, moved by
  dragging, and connected by dragging from an outlet port to an inlet port. Streams are drawn
  as orthogonal lines with their name; a tear stream is drawn dashed. Unconverged or
  unspecified parts are marked, with the reason on hover. Keyboard: arrows move the selection,
  Delete removes it, Tab walks through blocks and streams.
- **Inputs panel**: with nothing selected, the setup summary with links to steps 1 and 2; with
  a block selected, its specifications (split fractions as a table, flash specification as in
  the Flash workspace); with a stream selected, its initial guess when it is a tear stream.
- **Results panel**: the selected block's balances and duty, or the selected stream's state;
  the full stream table (all streams as columns, as in the Flash workspace) below the canvas,
  with CSV export.
- **Status bar**: converged in N iterations, or the error of section 3.

In the file (section 4) the setup is the `components` and `thermo` of `flowsheet`:
`"thermo": { "model": "NRTL", "vapour": "ideal", "sets": { "ethanol+water": "chemsep" } }`.

Views only call the layers below (ARCHITECTURE.md); the canvas holds no thermodynamics and no
balances.

## Engineering basis

- **Flash, enthalpy, streams:** proposal 0001 and its tests; a stream is a flash result.
- **Mixer, splitter, separator, heater:** steady-state material and energy balances. These
  are definitions, not correlations, so there are no new parameters.
- **Graph algorithms:** strongly connected components by depth-first search (R. Tarjan,
  "Depth-first search and linear graph algorithms", SIAM Journal on Computing 1(2), 1972, as
  cited in the module below), and tear
  selection as in the open-source `pyomo.network` package (3-clause BSD; module
  `pyomo/network/foqus_graph.py`, derived from the open-source FOQUS toolset). That module
  cites Tarjan 1972 and 1973 and is an openly documented implementation
  (https://pyomo.readthedocs.io/en/6.9.3/_modules/pyomo/network/foqus_graph.html).
- **Wegstein acceleration:** the update as implemented in the same open module:
  slope s = (g(x) − g(x_prev)) / (x − x_prev), q = s / (s − 1), x_new = q·x_prev + (1 − q)·g(x_prev),
  with q bounded between accel_min and accel_max. The defaults [−5, 0] and the
  direct-substitution option are those of `pyomo.network.SequentialDecomposition`
  (https://pyomo.readthedocs.io/en/6.4.0/_modules/pyomo/network/decomposition.html). The
  original article (J. H. Wegstein, Commun. ACM 1(6) (1958) 9) is not openly readable as far as
  checked, so the open implementation is the reference.
- **Validation** (in `test/`, with fixtures from `validation/python/`):
  1. **Each block** against hand balances and, for the flash drum and heater, against
     `validation/python/reference_flash.py` (the independent flash of proposal 0001):
     material balance to 1e-9 relative; T, VF and duty to the tolerances of `flash.test.js`.
  2. **Recycle with a closed-form answer:** feed, mixer, component separator with fixed split
     fractions and a splitter with a purge. With fixed fractions the balances are linear and
     the recycle flow has an exact solution (a geometric series), so the solver must reach it
     to 1e-9.
  3. **An independent solution of the whole flowsheet:** a new script
     `validation/python/reference_flowsheet.py` solves the same flowsheets **equation-oriented**
     (all stream variables at once with `scipy.optimize`, using `reference_flash.py`), a
     different algorithm from the JavaScript sequential-modular solver. Streams must agree
     to 1e-6 relative.
  4. **A published example:** an open worked example of a flash with recycle (an openly
     licensed textbook or an open course) is searched for in step 1. If none is found, the
     proposal records "no open data" with the list of places searched, and tests 2 and 3 carry
     the validation.
  5. **Failure cases:** a loop that cannot converge (a recycle fraction of 1 with no purge)
     must throw the error of section 3, never return numbers.

## Effect on existing work

- Nothing existing changes behaviour. The Flash workspace stays; its block is the same flash.
- `src/ui/project.js` moves from format 1 to format 2; format 1 files keep opening (tested).
- ARCHITECTURE.md: layers 3–5 get the interfaces of sections 1–3; the file example switches
  from `T_C` to `T_K`.
- The skill and `use.md` gain a short section: build or edit a flowsheet file, check it with
  `checkProject`, open it with `Fugacity.app(el, { project })`.
- Size: the stream, blocks and solver are small (a few tens of kB unminified). The canvas is
  the largest new piece of the interface.

## Alternatives considered

- **Equation-oriented solver first.** It handles design specifications and large recycles
  better, but needs derivatives through every flash and gives errors that are harder to
  explain. Sequential modular matches how engineers think about a flowsheet ("this unit, then
  that one") and is enough for the first blocks; the equation-oriented Python script still
  serves as an independent check, and an equation-oriented mode can come later
  (ARCHITECTURE.md).
- **Broyden instead of Wegstein.** Broyden handles strongly coupled tear variables better;
  Wegstein is simpler, per variable, and the usual default. Broyden can be added as an option
  once a test flowsheet needs it.
- **A separate flowsheet file next to the project file.** One file for the whole study is
  simpler to keep and share; a flowsheet alone is a project with only the `flowsheet` key filled.
- **Free drawing (any shape, any port).** Fixed ports per block type keep files readable by
  people and assistants, and keep the solver simple.
- **Saving to a Fugacity server.** It would need accounts and hosting and would break the rule
  that Fugacity runs without a server. The host page's own storage covers the chat case.

## Steps

Each step is one pull request with its tests. The effort is given in the units of the work
so far: a "session" is about the size of one of the recent pull requests done with an AI
coding agent (for example the Flash workspace, or one benchmark of proposal 0004).

| Step | Pull request | Tests | Effort |
|---|---|---|---|
| 1 | **Streams** (`src/stream/`): `Fugacity.stream`, enthalpy flow, unit conversion at the edges; search for an open worked example | against `reference_flash.py` | 1 session |
| 2 | **Blocks**: `registerUnit`, Feed, Mixer, Splitter, Component separator, Flash drum, Heater, Product, each with spec checks and balances | per block, hand balances and the Python flash | 1–2 sessions |
| 3 | **Solver** (`src/flowsheet/`): graph, loops, tear selection, direct substitution and Wegstein, errors; `reference_flowsheet.py` (equation-oriented) | closed-form recycle, Python comparison, failure cases | 1–2 sessions |
| 4 | **File format 2**: flowsheet in the project file, schema, `checkProject`, format 1 still read | round trip, old files, schema errors | 1 session |
| 5 | **Flowsheet workspace, part 1**: canvas, palette, placing, moving and connecting blocks, selection; Inputs panel with block specifications | logic tests without DOM, browser check | 1–2 sessions |
| 6 | **Flowsheet workspace, part 2**: Solve, stream table and CSV, tear stream marking, error display, browser autosave, host `storage` | browser checks, storage adapter test with a fake store | 1 session |
| 7 | **Assistant support** (A10): skill and `use.md` sections, an example flowsheet in `examples/` | `checkProject` on the examples | less than 1 session |

In total about 7 pull requests and 7–10 sessions. Steps 1–4 (engine) can be reviewed and
merged before the canvas exists; the flowsheet is usable from code and from files after
step 4, and on the canvas after step 6.
