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
| 0 | Data | Pure-component constants, binary parameters, UNIFAC groups, each with source, tier and license | `src/data/` | 10 components, 54 parameter sets |
| 1 | Property package | Activity coefficients, fugacities, K-values, enthalpy, density at any T, P, composition | `src/thermo/` | NRTL, UNIQUAC, ideal; acid dimerization. **Enthalpy missing** |
| 2 | Equilibrium | Bubble and dew points, flash, azeotropes, phase stability, residue curves | `src/equilibrium/` | Bubble T/P, azeotropes, spinodal check, residue curves. **Flash and dew points missing** |
| 3 | Stream | T, P, component flows, phase split, enthalpy flow | `src/stream/` | Not started |
| 4 | Unit operations | Inlet streams + specifications → outlet streams + duties | `src/units/` | Not started |
| 5 | Flowsheet | Connects units, orders the calculation, converges recycles | `src/flowsheet/` | Not started |
| 6 | Interface | Diagrams, flowsheet drawing, stream tables, controls | `src/ui/` | T-x-y and ternary views with component picker |

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
| `databank` | Taken from a published parameter set (ChemSep, DECHEMA-based) |
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
- Phase stability: today a spinodal check; a full liquid-liquid flash comes with v0.3
- Azeotrope search (done), residue curves (done)

## Layer 3: stream

```js
{
  T_K: 351.2, P_kPa: 101.325,
  flow_kmol_h: { water: 60, ethanol: 40 },
  vapourFraction: 0.25,        // from a flash
  H_kW: -1234.5                // enthalpy flow, reference: elements or ideal gas at 298.15 K
}
```

A stream is always created by a flash, so its phase split and enthalpy are consistent
with the property package.

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
Then shortcut and rigorous distillation (v0.5).

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
- Pages load a pinned version (`fugacity@0.1.1`), so a new release never changes an
  existing artifact.
- The flowsheet file carries its format version (see above).

## Quality and review

Anyone can propose a change; nothing reaches a release without an independent check.

1. **Proposal.** Anyone, for example a professor using the tool in a course, opens an
   issue from a form: *New component*, *Data correction*, *Validation case* or *Bug*. The
   interface links to these forms ("Report a problem or suggest data").
2. **Pull request.** A contributor, or Claude when a maintainer asks it to, turns the
   issue into a pull request with the data, its source and a test.
3. **Automatic checks.** Every pull request runs the full test suite: the engine against
   the independent Python model, and all validation data.
4. **Independent review.** A reviewer who did not write the change confirms the source,
   the fit quality and the test, using the checklist in the pull request template.
   Changes to `src/data/` and `validation/` need a reviewer listed in `CODEOWNERS`.
5. **Release.** Merged changes are published as a new version.

### Letting Claude draft pull requests (optional)

The repository can use the Claude Code GitHub Action: a maintainer writes
`@claude please add this component as described` on an issue, and Claude opens a pull
request, which still goes through review. Setup needs a maintainer with admin rights,
the Claude GitHub App, and an `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` secret;
only people with write access can trigger it. See
<https://code.claude.com/docs/en/github-actions>.

## Next: v0.2 foundation

1. Property package with enthalpy (ideal-gas Cp, heat of vaporization, excess enthalpy).
2. Data registry and data packs.
3. Modified UNIFAC (Dortmund) as the `predicted` tier.
4. Dew points; P-x-y view.
5. Written specifications for the unit-operation interface and the flowsheet file,
   with tests, before the first unit is built.
