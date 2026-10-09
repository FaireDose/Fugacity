# Streams, blocks and the flowsheet (layers 3 to 5)

How Fugacity builds and solves a process. Each layer uses only the one below it
([ARCHITECTURE.md](../../ARCHITECTURE.md)):

- a stream is a flash result ([equilibrium.md](equilibrium.md));
- a block turns inlet streams into outlet streams;
- the flowsheet solver orders the blocks and converges the recycles.

As elsewhere, the header comment of each file is the authoritative statement.

## Streams (layer 3)

[`src/stream/stream.js`](../../src/stream/stream.js) (proposal 0006, step 1):

```js
Fugacity.stream(sys, { flow_kmol_h: { ethanol: 40, water: 60 }, T_K: 351, P_kPa: 101.325 })
Fugacity.stream(sys, { flow_kmol_h, P_kPa, H_kW })   // given enthalpy flow (P-H flash)
Fugacity.stream(sys, { flow_kmol_h, P_kPa, VF })     // given vapour fraction
```

- **Always from a flash:** every stream is the result of `sys.flash`, so its phases and enthalpy
  are consistent with the model.
- **Enthalpy reference:** each component as an ideal gas at 298.15 K.
- **Empty streams:** a stream with zero flow carries only T and P.
- **Units:** K, kPa, kmol/h, kg/h, kW.

## Blocks (layer 4)

[`src/units/units.js`](../../src/units/units.js) (proposal 0006, step 2). Every block is registered
with the same shape, `registerUnit({ type, inlets, outlets, checkSpec, solve })`, and runs through
`runUnit`. `runUnit` checks:

- the ports;
- the specification;
- the component balance, which throws if it does not close;
- the energy balance, which is reported.

| Block | What it does |
|---|---|
| `feed` | A stream given by the user |
| `mixer` | Adds streams; the outlet is flashed at the lowest inlet pressure (or a given one) |
| `splitter` | The same composition in every outlet, split by fractions |
| `separator` | Component splitter: a split fraction per component and outlet |
| `flash` | Flash drum: vapour and liquid outlets at the given conditions or duty |
| `heater` | Heater or cooler: outlet T, VF or duty |
| `product` | End of a stream |

Every block with a duty has an energy stream (kW, positive = heat in).

**Degrees of freedom:** `specStatus` and `flowsheetStatus` count what each block needs, what is
given, and what is missing or extra. A flowsheet is solved only when every block is complete.

**Shown as "coming later" in the workbench:** pump, compressor, valve, reactors, distillation and
extraction. Reactors are designed in proposal 0010 (Draft).

## Flowsheet document (layer 5)

[`src/flowsheet/document.js`](../../src/flowsheet/document.js) (proposal 0006, step 4) holds the
components, the method (`thermo`), the blocks with positions, the streams and the solver settings.

- **Where it is kept:** project files of format 2, with the schema in
  [../schema/project-2.json](../schema/project-2.json).
- **Writing and solving it:** an AI assistant can write the document, check it with
  `Fugacity.checkProject` and solve it with `Fugacity.runFlowsheet`.

## Flowsheet solver (layer 5)

[`src/flowsheet/flowsheet.js`](../../src/flowsheet/flowsheet.js) (proposal 0006, step 3). It is
sequential modular:

1. **Order:** the loops are the strongly connected components (Tarjan 1972). They are calculated in
   topological order.
2. **Tear streams:** the streams marked `tear: true`. Otherwise, the smallest set of streams whose
   removal breaks every cycle (as in pyomo.network, after FOQUS).
3. **Convergence of the tear streams' component flows**, `solver: { method, tolerance, maxIterations }`:
   - `broyden` (default): Broyden's quasi-Newton method on all tear flows together (as
     scipy.optimize.broyden1);
   - `wegstein`: Wegstein per flow with q bounded to [−5, 0] (as pyomo.network);
   - `direct`: direct substitution.
4. **Fail loudly.** A loop that does not converge throws NO_CONVERGENCE, naming the loop, its tear
   streams and what usually helps. So does:
   - a recycle that grows without bound;
   - a converged flowsheet whose overall component balance does not close.

## How the solver is checked

- **Tests:** [test/stream.test.js](../../test/stream.test.js), [test/units.test.js](../../test/units.test.js) and
  [test/flowsheet.test.js](../../test/flowsheet.test.js) check the pieces.
- **The flowsheet test suite** ([../FLOWSHEET_TESTS.md](../FLOWSHEET_TESTS.md),
  [test/flowsheet-suite.test.js](../../test/flowsheet-suite.test.js)):
  - the Cavett problem against published solutions;
  - 16 generated recycle flowsheets against an independent equation-oriented solution (scipy and
    thermo);
  - relations every correct solver must satisfy: tear choice, method, order, scaling and balances.
  - Every case uses the method chosen by [../METHOD_SELECTION.md](../METHOD_SELECTION.md). The
    suite runs in CI on every pull request; regenerate the reference only when the suite itself
    changes.
- **Excel exports:** the "Excel concept model" export is checked in LibreOffice
  ([../EXCEL_CONCEPT_CHECK.md](../EXCEL_CONCEPT_CHECK.md)).
