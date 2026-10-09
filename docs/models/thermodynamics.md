# Thermodynamic models (layers 0 and 1)

What Fugacity calculates for a phase: activity coefficients, fugacity coefficients, vapour
pressures, enthalpies and pure-component properties. Each section names the source file. The
file's header comment is the authoritative statement of the equations and their open
references; this page is a map of them. Algorithms that use these models (bubble and dew points,
flash, stability) are in [equilibrium.md](equilibrium.md). Which model to choose for which
mixture is in [../METHOD_SELECTION.md](../METHOD_SELECTION.md).

All engine units are SI: K, kPa, mol, J (ARCHITECTURE.md).

## The property package: `system()`

[`src/thermo/system.js`](../../src/thermo/system.js) builds a *system* from components and a
model. Every layer above uses only this object.

| `model` | Liquid | Vapour (`vapour` option) | File |
|---|---|---|---|
| `NRTL` | NRTL activity coefficients | ideal gas, or PR / SRK | [activity/nrtl.js](../../src/thermo/activity/nrtl.js) |
| `UNIQUAC` | UNIQUAC activity coefficients | ideal gas, or PR / SRK | [activity/uniquac.js](../../src/thermo/activity/uniquac.js) |
| `ideal` | ideal solution (γ = 1) | ideal gas, or PR / SRK | system.js |
| `PR` | Peng–Robinson (1976) | the same equation | [eos/cubic.js](../../src/thermo/eos/cubic.js), [eos/system.js](../../src/thermo/eos/system.js) |
| `SRK` | Soave–Redlich–Kwong (1972) | the same equation | same |

Locked in the interface as "not available yet": Wilson, UNIFAC, PC-SAFT, CPA, eNRTL, Pitzer,
Flory–Huggins and PC-SAFT for polymers ([src/ui/future-models.js](../../src/ui/future-models.js)). UNIFAC is on hold until
the parameter licence is settled (proposal 0008).

**Method advice** (pull request #85, open): `info.advice` and the warnings say when a model is
used outside the domain of the selection rules. For example, an equation of state with polar
components, or an activity model above 1000 kPa
(`src/thermo/method-advice.js` in that pull request).

## Activity models

- **NRTL**: τ_ij = a_ij + b_ij / T, G_ij = exp(−α_ij τ_ij).
- **UNIQUAC**: τ_ij = exp(a_ij + b_ij / T), coordination number z = 10. An optional q′
  replaces q in the residual term (Anderson–Prausnitz modification).
- **Gamma-phi equilibrium** ([gamma-phi-vapour.js](../../src/thermo/gamma-phi-vapour.js)):
  y_i φ_i^V P = x_i γ_i P_i^sat φ_i^sat exp[v_i^L (P − P_i^sat) / RT]. φ^V and φ^sat come from the
  cubic equation; v^L comes from the liquid-density record (Poynting factor). With an ideal-gas
  vapour, all three corrections are 1 (modified Raoult's law).
  - φ^sat is taken at the databank vapour pressure, so a pure component boils exactly at its
    record. The header compares this with thermo's convention.
  - Reference: thermo `GibbsExcessLiquid`, equilibrium basis "Poynting&PhiSat".
- **Dimerizing acids** ([vapour.js](../../src/thermo/vapour.js)): the chemical theory. Monomers and
  dimers are in equilibrium in the vapour, p_A2 = K p_A². Cross-dimers are not modelled.
- **Parameters**: [src/data/binaries.json](../../src/data/binaries.json), each pair with a tier
  (fitted, databank, user) and its sources. Pairs that are still missing are listed in
  [../DATA_WANTED.md](../DATA_WANTED.md).

## Cubic equations of state

[`eos/cubic.js`](../../src/thermo/eos/cubic.js), in the generic two-parameter form of the thermo
library documentation:

- P = RT / (v − b) − a(T) / ((v + d₁b)(v + d₂b)), with PR: d₁,₂ = 1 ± √2 and SRK: d₁ = 1, d₂ = 0.
- α(T) = [1 + m(1 − √(T/Tc))]², with m(ω) from Peng & Robinson (1976) or Soave (1972). The DOIs
  are in the header.
- Van der Waals one-fluid mixing rule with binary k_ij:
  a = ΣΣ x_i x_j (1 − k_ij) √(a_i a_j), b = Σ x_i b_i.
- The header gives ln φ_i, H^R, S^R and Cp^R. Root selection: the smallest root is the liquid and
  the largest the vapour. A single root is labelled liquid-like or vapour-like.
- k_ij: [src/data/kij.json](../../src/data/kij.json). They come from ChemSep (Artistic License 2.0)
  or are fitted to open data. A pair without one uses 0 and is reported in `info.missingPairs`.
  - The fits for polar pairs (proposal 0004) are labelled "not recommended" once pull request
    #85 is merged.
- Checked against an independent Python implementation and thermo PRMIX / SRKMIX
  ([validation/python/reference_eos.py](../../validation/python/reference_eos.py),
  [test/eos.test.js](../../test/eos.test.js)).

## Pure-component properties: `pure()`

- **Correlations** ([correlations.js](../../src/thermo/correlations.js)): the DIPPR equation
  forms 100–107. The forms are as documented by ChemSep and implemented in the `chemicals`
  library; the coefficients are in each component's record.
- **Vapour pressure** ([psat.js](../../src/thermo/psat.js)): DIPPR 101,
  ln(P/Pa) = A + B/T + C ln T + D T^E.
- **Properties and units** ([pure.js](../../src/thermo/pure.js)): every record states its units
  and source, and "no open data" is written where nothing was found.
  - Enthalpy reference: the ideal gas at 298.15 K.
  - Vapour and supercritical states use Peng–Robinson.
- **Data**:
  - [src/data/components.json](../../src/data/components.json);
  - fit quality: [../PURE_DATA.md](../PURE_DATA.md);
  - comparison with measured values: [../MEASURED_CHECKS.md](../MEASURED_CHECKS.md);
  - components fitted only to measured data: [../PURE_DATA_MEASURED.md](../PURE_DATA_MEASURED.md).

## Mixture enthalpy

[`enthalpy.js`](../../src/thermo/enthalpy.js). Reference: each component as an ideal gas at
298.15 K, with h = 0.

- **Activity models:**
  - vapour: Σ y_i h_IG,i + h_R;
  - liquid: Σ x_i h_L,i + h^E, with the pure liquid on the liquid heat-capacity basis (the
    decision in pull request #34) and h^E from Gibbs–Helmholtz.
- **Equations of state:** Σ z_i h_IG,i + h_R(T, P, z), for either phase.
- **Limits:** the header states them, including dimerizing acids and the end of the cp_L records.

## Water and steam

- **IAPWS-IF97** ([iapws/if97.js](../../src/thermo/iapws/if97.js)): IAPWS R7-97(2012), regions 1–5.
  Region 3 is solved on its basic equation.
- **Transport** ([iapws/transport.js](../../src/thermo/iapws/transport.js)): viscosity by IAPWS
  R12-08 and thermal conductivity by R15-11, in their industrial forms.
- **Steam tables** ([iapws/steam.js](../../src/thermo/iapws/steam.js)): steam-table units.
- **Verification:** every table of the releases is reproduced in
  [test/steam.test.js](../../test/steam.test.js).

## Gases in water: Henry's law

[`henry.js`](../../src/thermo/henry.js) uses IAPWS G7-04 for hydrogen, nitrogen, oxygen, methane and
ethane, and the Sander compilation (CC BY 4.0) for ethylene. Outside an entry's temperature range
it throws.

## The Library: where every parameter comes from

[`library.js`](../../src/thermo/library.js) (proposal 0003):

- **Sources:** every source is listed once in [src/data/sources.json](../../src/data/sources.json),
  and the licences are in [src/data/LICENSES.md](../../src/data/LICENSES.md).
- **Several parameter sets per pair:** a pair can carry more than one set. The user chooses one
  with `sets` or `prefer`; otherwise the default set is used.
- **No thermodynamics:** the file only records sources and selects sets.
