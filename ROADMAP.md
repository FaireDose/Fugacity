# Roadmap

Each step should be useful on its own and fully tested before the next one builds on it.

## v0.1 – Phase-equilibrium workbench (done)

- [x] Water, acetic acid, ethylene glycol with sourced parameters
- [x] NRTL, UNIQUAC, ideal; acetic acid dimerization in the vapour
- [x] Bubble T and P, T-x-y, P-x-y, ternary grid, residue curves
- [x] Interface for 2 and 3 components, usable in AI chat artifacts
- [x] Validation against experimental data and an independent Python model

## v0.1.1 – More chemicals and review workflow (done)

- [x] Seven more components (methanol, ethanol, acetone, chloroform, benzene, toluene, ethyl acetate) and ChemSep parameters
- [x] Component picker in the interface
- [x] Binary and ternary azeotropes, validated against handbook values
- [x] Warning where the liquid would split into two phases (spinodal check)
- [x] Quality tier on every parameter; data licenses recorded
- [x] Reproducible parameter fitting (`validation/python/fit_parameters.py`)
- [x] Issue forms, pull request checklist and code owners for independent review
- [x] ARCHITECTURE.md

## v0.2 – Foundation for flowsheets

- [ ] Property package interface with enthalpy (ideal-gas Cp, heat of vaporization, excess enthalpy)
- [ ] Data registry and data packs (script files that add components)
- [ ] Modified UNIFAC (Dortmund) for pairs without fitted parameters, labelled `predicted`
- [ ] Dew points (T and P); isothermal P-x-y view
- [ ] Written specifications for the unit-operation interface and the flowsheet file
- [ ] Grow the databank: common solvents, alcohols, acids, esters, hydrocarbons
- [ ] Parameter regression from user data inside the page

## v0.3 – Flash and streams

- [ ] PT flash (Rachford–Rice), then PH and PQ flash
- [ ] Enthalpy model (ideal-gas Cp, heat of vaporization, excess enthalpy)
- [ ] Stream object: T, P, component flows, phase split, enthalpy
- [ ] Liquid-liquid and vapour-liquid-liquid equilibria

## v0.4 – Unit operations and flowsheets

- [ ] Unit operation interface (inputs, outputs, specifications) so contributors can add units
- [ ] Mixer, splitter, heater/cooler, pump, valve, flash drum
- [ ] Flowsheet graph and sequential-modular solver
- [ ] Recycle convergence (tear streams, Wegstein acceleration)
- [ ] Flowsheet file format (JSON) and a drawing interface

## v0.5 – Distillation

- [ ] Shortcut column (Fenske–Underwood–Gilliland)
- [ ] McCabe–Thiele view for binaries
- [ ] Rigorous equilibrium-stage column (MESH equations)

## Later

- Reactors (conversion, equilibrium, kinetic), heat exchangers, compressors
- Equations of state (Peng–Robinson, SRK) for gases and high pressure
- Sensitivity studies and simple optimization
