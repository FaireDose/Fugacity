# Architecture

This document describes how Fugacity is built and how it is meant to grow from
phase equilibria to full flowsheets. It is the reference for every contribution,
human or AI: new work should fit these layers and interfaces, or change this
document first.

## Goals

1. **Runs where people already are.** A page, an AI chat artifact, or a course website
   loads one script and calculates in the viewer's browser. No server, no install.
2. **Every number can be traced.** Each parameter carries its source, its quality tier
   and its license. Every model is checked against data or an independent calculation.
3. **Easy to extend without breaking.** Contributors add chemicals, models and unit
   operations through fixed interfaces, without touching the rest.
4. **Readable by engineers.** Flowsheets are plain JSON files that an engineer can check
   and an AI assistant can write.

## Layers

Each layer uses only the layer below it, through a documented interface. Someone
adding a heat exchanger never touches the thermodynamics; someone adding
Peng–Robinson does not break the flash drum.

| # | Layer | Job | Code | Status |
|---|---|---|---|---|
| 0 | Data | Pure-component constants, binary parameters, UNIFAC groups, each with source, tier and license | `src/data/` | 49 components with constants and property correlations (16 of v0.2, 33 of proposal 0004); 54 activity-model parameter sets; 42 k_ij (PR, SRK); Henry constants for 6 gases in water |
| 1 | Property package | Activity coefficients, fugacities, K-values, enthalpy, density at any T, P, composition | `src/thermo/` | NRTL, UNIQUAC, ideal; acid dimerization; Peng–Robinson and SRK; pure-component properties and enthalpy (`pure()`); IAPWS-IF97 and IAPWS transport for water; Henry's law; vapour model choice (ideal gas, PR, SRK) for activity models; mixture enthalpy, excess enthalpy and `phase()` for every model |
| 2 | Equilibrium | Bubble and dew points, flash, azeotropes, phase stability, residue curves | `src/equilibrium/` | Bubble and dew T/P for every model, azeotropes, spinodal check, residue curves; tangent-plane stability test for PR/SRK; flash (T-P, P-H, P-VF, T-VF) with heat duty, with two liquids and vapour + two liquids for NRTL and UNIQUAC; errors with codes. **Two liquids with PR/SRK missing** |
| 3 | Stream | T, P, component flows, phase split, enthalpy flow | `src/stream/` | `stream()`: a flash of component flows (kmol/h or kg/h) at T-P, P-H (enthalpy flow), P-VF or T-VF, with phase flows and enthalpy flow in kW (proposal 0006, step 1) |
| 4 | Unit operations | Inlet streams + specifications → outlet streams + duties | `src/units/` | Not started |
| 5 | Flowsheet | Connects units, orders the calculation, converges recycles | `src/flowsheet/` | Not started |
| 6 | Interface | Workbench, diagrams, flowsheet drawing, stream tables, controls | `src/ui/` | Workbench (`app`) with task workspaces (phase equilibrium, flash, gas solubility, properties, steam), per-workspace inputs and Library, Sources and Settings panels; one model choice for every diagram (activity model with a vapour model, or PR/SRK); T-x-y, P-x-y, ternary, azeotrope and envelope views in mole fraction or wt %; flash stream table with CSV export; property explorer; Henry and steam views |
| 7 | Design studio | Cost engineering (sizing, capital and operating cost, cost of product) and agent-run studies that compare process routes from the literature; every result reproducible and sourced | `src/design/` | Not started; roadmap tracks E and G |

Units inside the engine: temperature in K, pressure in kPa, amounts in mol or kmol,
energy in J or kW. The interface converts for display (°C, for example).

## Layer 0: data

### Records

- **Component** (`components.json`): name, formula, CAS number, aliases, molar mass,
  critical constants, normal boiling point, vapour-pressure equation with validity
  range, UNIQUAC r and q; later ideal-gas heat capacity, heat of vaporization, liquid
  density and UNIFAC groups.
- **Binary pair** (`binaries.json`): model, the two components, parameters
  (`tau_ij = a_ij + b_ij/T` for NRTL, `tau_ij = exp(a_ij + b_ij/T)` for UNIQUAC), `source`
  and `tier`.

### Quality tiers

With 100 chemicals there are 4,950 pairs, and no open databank covers them all
(ChemSep, the largest open set, has 329 NRTL pairs). So each pair is labelled, and
the interface shows the label next to every result:

| Tier | Meaning |
|---|---|
| `fitted` | Regressed for Fugacity from cited experimental data (`validation/python/fit_parameters.py`) |
| `standard` | Computed from an official standard (IAPWS for water) |
| `databank` | Taken from an openly licensed parameter set (ChemSep, Artistic License 2.0) |
| `predicted` | Group contribution (modified UNIFAC, Dortmund) where no fitted or databank pair exists. **Planned for v0.2** |
| `user` | Supplied in the page's own setup, for example from a paper being discussed |

The engine uses the best available tier for each pair and never silently falls back
to ideal behaviour.

### Licenses

Every data source is listed in [`src/data/LICENSES.md`](src/data/LICENSES.md). Some
tables in open libraries originally come from handbooks; each table is checked before
it is copied.

### Data packs (planned for v0.2)

AI chat artifacts cannot download data files, but they can load scripts. So as the
databank grows, data ships as **data packs**: small script files that register
themselves with the core.

```html
<script src="https://cdn.jsdelivr.net/npm/fugacity@0.2.0/dist/fugacity.js"></script>
<script src="https://cdn.jsdelivr.net/npm/fugacity@0.2.0/dist/data/solvents.js"></script>
```

Each pack calls `Fugacity.registerData({ components, pairs, groups })`. The core stays
small, and a page loads only the chemicals it needs. The core bundle includes a small
default set (the current ten components).

## Layer 1: property package

One interface for every model, so layers above never know which model is in use:

```js
const pkg = Fugacity.propertyPackage({ components: [...], liquid: "NRTL", vapour: "ideal" });
pkg.gammas(x, T)            // activity coefficients
pkg.kValues(T, P, x, y)     // y_i / x_i
pkg.enthalpy("liquid", T, P, x)   // J/mol, planned for v0.2
pkg.enthalpy("vapour", T, P, y)
```

Today this role is played by `createSystem` in `src/thermo/system.js`. v0.2 renames and
extends it; `createSystem` stays as an alias.

## Layer 2: equilibrium

Algorithms take a property package and never look inside it:

- Bubble T and P (done), dew T and P (v0.2)
- PT flash with Rachford–Rice, then PH and PQ flash (v0.3)
- Phase stability: tangent-plane tests for activity models and PR/SRK; the flash finds two liquids for NRTL and UNIQUAC (v0.3), for PR/SRK later
- Azeotrope search (done), residue curves (done)

## Layer 3: stream

```js
const sys = Fugacity.system({ components: ["water", "ethanol"], model: "NRTL" });
const s = Fugacity.stream(sys, { flow_kmol_h: { water: 60, ethanol: 40 }, T_K: 355, P_kPa: 101.325 });
// { T_K, P_kPa, flow_kmol_h: { water, ethanol }, F_kmol_h, mass_kg_h, z, VF,
//   phases: [{ type, fraction, composition, F_kmol_h, flow_kmol_h, h_J_mol }],
//   h_J_mol, H_kW, MW, warnings, sources }
Fugacity.stream(sys, { flow_kmol_h, P_kPa: 101.325, H_kW: s.H_kW });   // P-H: gives back T
```

A stream is always created by a flash, so its phase split and enthalpy are consistent
with the property package. The enthalpy flow has the flash's reference (each component as
an ideal gas at 298.15 K). A stream without flow carries T and P only (`src/stream/stream.js`,
proposal 0006).

## Layer 4: unit operations

Every unit is one module with the same shape, so contributors can add units
independently:

```js
Fugacity.registerUnit({
  type: "flash",
  inlets: ["feed"],
  outlets: ["vapour", "liquid"],
  specs: {
    P_kPa: { required: true },
    Q_kW:  { default: 0 }
  },
  solve({ inlets, specs, pkg }) {
    // material and energy balances + equilibrium
    return { outlets: { vapour, liquid }, duties: { Q_kW }, report: { ... } };
  }
});
```

Rules for a unit: it closes its material balance to 1e-9 relative, reports its energy
balance, validates its specs with clear messages, and ships with a test against a
published example or an independent calculation.

First units (v0.4): mixer, splitter, heater/cooler, pump, valve, flash drum.
Then shortcut and rigorous distillation (v0.5), then reactors (conversion, equilibrium,
CSTR, plug flow) with a common description of reactions, heat exchangers and compressors
(v0.6), growing towards models of all the common unit operations.

## Layer 5: flowsheet

### File format

A flowsheet is a JSON file. An engineer can read it, GitHub shows exactly what changed,
and an AI assistant can write it:

```json
{
  "fugacity": "0.4",
  "components": ["water", "acetic acid", "ethylene glycol"],
  "thermo": { "liquid": "NRTL", "fallback": "UNIFAC-Dortmund" },
  "streams": {
    "FEED": { "T_C": 25, "P_kPa": 101.3,
              "flow_kmol_h": { "water": 60, "acetic acid": 30, "ethylene glycol": 10 } }
  },
  "units": [
    { "id": "E1", "type": "heater", "in": ["FEED"], "out": ["S1"], "spec": { "T_C": 105 } },
    { "id": "V1", "type": "flash",  "in": ["S1"],   "out": ["VAP", "LIQ"], "spec": { "P_kPa": 101.3, "Q_kW": 0 } }
  ]
}
```

The `fugacity` field states the format version. Older files keep working: a newer
engine reads every older format version.

### Solver

Sequential modular, as in most commercial simulators: order the units, choose tear
streams to break recycles, and converge them with Wegstein acceleration. Design
specifications ("adjust the reflux until the distillate purity is 99 %") are an outer
loop. An equation-oriented mode can come later.

## Layer 6: interface

- `Fugacity.mount(element, config)` puts a view into a page. Views so far: T-x-y and
  ternary. Planned: P-x-y, McCabe–Thiele, flowsheet drawing, stream tables.
- Views only call the layers below; they never contain thermodynamics.
- Heavy calculations (large ternary grids, columns) move to a background worker so
  the page stays responsive. Artifacts allow workers created from the page's own code.

## Versions and compatibility

- Semantic versioning: `0.x` releases may change interfaces; from `1.0` on, breaking
  changes need a major version.
- Pages load an exact version from the CDN, so a new release never changes an existing
  artifact.
- The flowsheet file carries its format version (see above).

## Quality and review

Anyone can propose a change; nothing reaches a release without an independent check.
Contributions arrive through a form or a pull request ([CONTRIBUTING.md](CONTRIBUTING.md));
every pull request runs the full test suite (the engine against the independent Python
model and all validation data); a reviewer who did not write the change checks the
sources, the fit quality and the tests, and changes to `src/data/` and `validation/` need
a data reviewer. Roles and decisions: [GOVERNANCE.md](GOVERNANCE.md); protections:
[SECURITY.md](SECURITY.md).

## Next steps

The design work ahead is laid out as the **core track** in
[ROADMAP.md](ROADMAP.md) (steps A1–A12). Each step is settled by a proposal before it is
built; the first, the property package interface, is
[proposal 0001](proposals/0001-property-package.md).
