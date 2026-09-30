# 0002: First flowsheet – material balances in the chat

- **Status:** Draft
- **Author(s):** Fugacity maintainers
- **Discussion:** to be opened
- **Roadmap item:** v0.2; architecture steps A4, A5, A6, A7, A8, A11 (first versions)

## Problem

Fugacity calculates phase equilibria, but engineers design processes: feeds, mixers, flash
drums, recycles. There is no way yet to connect units, and no file an AI assistant can
write to describe a process. Energy balances need enthalpy (v0.3), but a useful first
flowsheet does not: flash drums specified by temperature and pressure need only K-values,
which Fugacity already has.

## Proposal

### What the user sees

A page with three parts:

1. **Canvas.** A palette of units (feed, mixer, splitter, flash drum, component separator).
   Drag a unit onto the canvas; drag from an outlet port to an inlet port to draw a
   stream. Click a unit to edit its specifications in a side panel. Invalid connections
   (two streams into one port, an outlet left open) are shown in red with a reason.
2. **Results.** After each change the flowsheet is solved; each stream shows its flow and
   vapour fraction on the drawing, and a stream table lists T, P, flows and compositions.
   If a recycle does not converge, the page says which tear stream and by how much.
3. **File.** The flowsheet is a JSON file shown next to the canvas. Copy it out, paste one
   in, or let the assistant edit it. The canvas and the file always match.

```js
Fugacity.mountFlowsheet("#app", flowsheetJson, { editable: true });
```

### The flowsheet file (A7, first version)

```json
{
  "fugacity_flowsheet": 1,
  "components": ["methanol", "water"],
  "thermo": { "liquid": "NRTL" },
  "units": [
    { "id": "F1", "type": "feed", "at": [40, 120],
      "spec": { "T_C": 25, "P_kPa": 101.325, "flow_kmol_h": { "methanol": 40, "water": 60 } } },
    { "id": "M1", "type": "mixer", "at": [200, 120] },
    { "id": "V1", "type": "flash", "at": [360, 120], "spec": { "T_C": 80, "P_kPa": 101.325 } },
    { "id": "S1", "type": "splitter", "at": [520, 200], "spec": { "fractions": [0.3, 0.7] } }
  ],
  "streams": [
    { "id": "S-1", "from": "F1.out",    "to": "M1.in1" },
    { "id": "S-2", "from": "M1.out",    "to": "V1.in" },
    { "id": "VAP", "from": "V1.vapour", "to": null },
    { "id": "S-3", "from": "V1.liquid", "to": "S1.in" },
    { "id": "REC", "from": "S1.out1",   "to": "M1.in2" },
    { "id": "LIQ", "from": "S1.out2",   "to": null }
  ]
}
```

`at` holds the drawing position, so a file written by an assistant can be drawn and a
drawing can be saved as a file.

### Units in this version (A6, first version)

| Unit | Ports | Specifications |
|---|---|---|
| feed | out | T, P, component flows |
| mixer | in1..inN, out | outlet P (default: lowest inlet) |
| splitter | in, out1..outN | split fractions |
| flash | in, vapour, liquid | T, P |
| component separator | in, out1, out2 | fraction of each component to out1 |

Each unit closes its material balance to 1e-9 relative and reports it.

### Solver (A8, first version)

Sequential modular: order units by the stream graph, choose tear streams to break
recycles, converge them with Wegstein acceleration (tolerance 1e-8 relative on component
flows, maximum 100 iterations), report non-convergence with the tear stream and residual.

### Flash (A4, first version)

Isothermal flash at T, P with the γ-φ model already used for bubble points
(including acetic acid dimerization): Rachford–Rice on K-values, with successive
substitution on compositions. Single-phase results are reported as such, with the reason
(below bubble point or above dew point).

## Engineering basis

- PT flash validated against the independent Python reference model
  (`validation/python/reference_model.py`, extended with a flash) for all ternaries in the
  databank, tolerance 1e-6 in phase fraction and compositions.
- Flash results checked for consistency with bubble and dew points: vapour fraction 0 at
  the bubble temperature, 1 at the dew temperature.
- Flowsheets tested for overall material balance closure and for recycle convergence on
  a set of example flowsheets included in `examples/`.

## Effect on existing work

New functions only; the existing `mount`, `system` and diagrams are unchanged. The
contribution package and AGENTS.md gain a flowsheet section.

## Alternatives considered

- Wait for enthalpy (v0.3) before any flowsheet: rejected, because a material-balance
  flowsheet is already useful for teaching and lets the canvas and file format mature early.
- Equation-oriented solver first: rejected for now; sequential modular is easier to
  explain, debug and extend unit by unit.

## Steps

1. PT flash with tests against the Python reference (A4).
2. Stream object and stream table view (A5).
3. Unit interface and the five units, with balance tests (A6).
4. Flowsheet file format with a checker, like the contribution package check (A7, A10).
5. Solver with recycles, with example flowsheets as tests (A8).
6. Canvas: drawing, connecting, specification panel, results on the drawing (A11).
7. Skill and instructions updated so assistants can write and edit flowsheet files.
