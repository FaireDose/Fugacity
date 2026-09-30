# Roadmap

Each step should be useful on its own and fully tested before the next one builds on it.

## v0.1 – Phase-equilibrium workbench (done)

- [x] Water, acetic acid, ethylene glycol with sourced parameters
- [x] NRTL, UNIQUAC, ideal; acetic acid dimerization in the vapour
- [x] Bubble T and P, T-x-y, P-x-y, ternary grid, residue curves
- [x] Interface for 2 and 3 components, usable in AI chat artifacts
- [x] Validation against experimental data and an independent Python model

## v0.2 – More chemistry

- [ ] Grow the databank: common solvents, alcohols, acids, esters, hydrocarbons
- [ ] Modified UNIFAC (Dortmund) for pairs without fitted parameters, clearly flagged
- [ ] Dew points (T and P)
- [ ] Isothermal P-x-y view in the interface
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
