# 0007: Solubility and liquid-liquid equilibria

- **Status:** Accepted (by the lead maintainer, 2026-10-06)
- **Author(s):** Fugacity maintainers (drafted with an AI assistant)
- **Discussion:** this pull request
- **Roadmap item:** v0.3 "Liquid-liquid and vapour-liquid-liquid equilibria"; data track D6 (liquid-liquid
  data for partly miscible pairs); later reactions (solids as reactants and products)

## Problem

"How much of A dissolves in B?" is asked every day in process work, and Fugacity answers only
one version of it: gases in water, by Henry's law (IAPWS G7-04). Missing:

1. **Liquid in liquid.** Which liquids are partly miscible, how much of each dissolves in the
   other, and how that changes with temperature. This decides decanters, phase splits in
   columns and, above all, **liquid-liquid extraction**: which solvent takes a solute out of
   water, and how the solute divides between the two liquids (tie lines).
2. **Gases in other solvents** than water (methanol, toluene, acetone…), for absorbers and
   reactors.
3. **Solids in liquids:** how much of a solid dissolves in a solvent at a temperature, for
   crystallisation and for reactions with solid reactants or products.

The engine already has much of what is needed: NRTL and UNIQUAC with fitted parameters, the
tangent-plane stability test, and the flash with two liquids and with vapour + two liquids
(proposal 0001, step 5). What is missing is the data behind the liquid-liquid parameters,
the data for solids, and a workspace that asks and answers the solubility questions directly.

Who is affected: students learning extraction and crystallisation, engineers choosing a
solvent, and the reaction and extraction units of the roadmap.

## Proposal

The **Gas solubility** workspace (in Properties & Equilibria) becomes **Solubility**, with three
views, each reached from its second-row tab:

### 1. Liquid-liquid (mutual solubility and extraction)

- **Binary, against temperature:** the two branches of the miscibility gap (the solubility of A
  in B and of B in A) from the model, with the measured points of the open data drawn on top,
  and the upper or lower critical solution temperature when the gap closes in range. One click
  shows whether a pair is fully miscible in the range.
- **Ternary at one temperature (extraction):** the two-liquid region with **tie lines**, the
  plait point, and the **distribution coefficient** of the solute (its concentration in the
  extract phase over the raffinate phase) along the tie lines. Typical cases: water + acetone +
  toluene, water + acetic acid + ethyl acetate, water + ethanol + cyclohexane.
- **Solvent screening table:** for a solute in water at a temperature, each candidate solvent
  in the databank with: miscible with water or not, the solubility of the solvent in water and
  of water in the solvent, and the distribution coefficient of the solute at infinite
  dilution. Pairs without liquid-liquid data are marked with their tier, and the table says
  when a result comes from parameters fitted only to vapour-liquid data (often poor for
  liquid-liquid).
- Engine: `sys.lle(T, P)` for a binary (the two liquid compositions, or "one liquid") and
  `sys.lleTernary(T, P, { tieLines })` (binodal points, tie lines, plait point), built on the
  existing two-liquid flash and tangent-plane test. They fail loudly where the flash does not
  converge.

### 2. Gases in solvents

- Water: Henry's law as today (IAPWS G7-04, the standard).
- Other solvents: the vapour-liquid equilibrium of the gas + solvent pair with Peng–Robinson or
  SRK (the engine's bubble and dew points), with k_ij fitted to open solubility data where it
  exists (ThermoML Archive), and the tier shown. Without data the result is labelled
  "k_ij = 0, not checked against data".

### 3. Solids in liquids

- The solubility of a solid in a liquid from the standard solid-liquid equilibrium condition
  (the pure solid in equilibrium with the solution, no solid solution):

  ln(x γ) = −(ΔH_fus / R T)(1 − T / T_m) + (ΔC_p / R T)(T_m − T) − (ΔC_p / R) ln(T_m / T)

  (Corrected in step 4: the first draft copied the signs of the `chemicals` docstring, which
  are all reversed; its code, its worked example and Gmehling et al. use the form above, which
  gives x < 1 below the melting point.)

  with the melting temperature T_m and enthalpy of fusion ΔH_fus of the solid, the activity
  coefficient γ of the solute in the liquid from NRTL or UNIQUAC (or 1: the ideal solubility),
  and ΔC_p optional (0 by default).
- Views: solubility against temperature in one or more solvents; the solid-liquid phase
  diagram of a binary with the eutectic.
- New component data: T_m and ΔH_fus for each solid, with sources. New components: a few
  solids chosen by process (proposal 0008 lists candidates: naphthalene, benzoic acid,
  salicylic acid, urea, …).

### Data (AGENTS.md rules 1–7)

- Liquid-liquid: mutual solubility and ternary tie-line data from the NIST TRC ThermoML Archive
  and open-access articles, in `validation/data/` (the existing water + cyclohexane, water +
  ethyl acetate and ethylene glycol + cyclohexane files are the start). NRTL parameters for a
  partly miscible pair are fitted to the liquid-liquid **and** vapour-liquid data together
  (the fitting script already supports both, `single_liquid` and `phase_splits` in
  `fit_parameters.py`), so one set serves the flash and the solubility views.
- Solids: T_m and ΔH_fus from the NIST Chemistry WebBook (phase change data), with the source
  per value; solubility data of solids in solvents from the ThermoML Archive for the checks.
- Gases in solvents: solubility data from the ThermoML Archive.
- Where no open data exist, the view says "no open data" with the places searched (rule 1).

## Engineering basis

- **Liquid-liquid equilibrium:** equal activities of every component in both liquids
  (isoactivity), solved by the existing two-liquid flash (proposal 0001, step 5; successive
  substitution on K_i = γ_i(x¹)/γ_i(x²)) with the tangent-plane test to confirm a split. The
  binodal is traced by stepping the overall composition; the plait point by the vanishing tie
  line.
- **Solid-liquid equilibrium:** the equation above, as written and implemented in the open-source
  `chemicals` library (MIT license; `chemicals.solubility.solubility_eutectic`, which cites
  J. Gmehling et al., *Chemical Thermodynamics for Process Simulation*, Wiley-VCH 2012, and
  carries a worked example used as a test).
- **Gas solubility in solvents:** vapour-liquid equilibrium with an equation of state, as for
  the existing P-x-y and flash.
- **Validation:**
  1. Liquid-liquid: the engine against an independent Python calculation (`thermo`'s flash with
     two liquids and the same parameters, as `reference_flash.py` does for the vapour), and
     against the measured mutual solubilities and tie lines, with the deviation reported per
     data set (in mole fraction, and as the distribution coefficient for extraction systems).
  2. Solids: the equation against `chemicals.solubility_eutectic` for the same inputs, and the
     predicted solubility against measured solubility data, ideal and with γ.
  3. Gases: against the ThermoML solubility data with the fitted k_ij.

## Effect on existing work

- The Gas solubility workspace keeps its Henry's-law view (as the "Gases" view, water) and its
  configuration keys; `start: "henry"` still opens it.
- The flash keeps working as now; the liquid-liquid parameters improve it for partly miscible
  pairs.
- New data files and fitted parameter sets go through the usual data review; pairs whose
  vapour-liquid fit changes are reported in the engineering report.

## Alternatives considered

- **Separate liquid-liquid parameter sets** (one for vapour-liquid, one for liquid-liquid, as
  some simulators do): better fits each, but the flash would then need to choose one, and
  results would disagree between workspaces. A joint fit first; separate sets only where a
  joint fit fails, labelled as such.
- **UNIFAC-LLE for pairs without data:** a predictive table exists for liquid-liquid, but its
  parameters need the same licence check as UNIFAC (proposal 0008); later, as the `predicted`
  tier.
- **Solid solubility from correlations** (fitted log x vs 1/T lines per solute and solvent):
  simple, but not predictive for a new solvent; the equilibrium equation with γ is.

## Steps

| Step | Pull request | Tests |
|---|---|---|
| 1 | Liquid-liquid data for the extraction pairs and triples (ThermoML, open articles), joint NRTL fits | fits against the data; existing benchmarks unchanged or improved |
| 2 | `sys.lle` and `sys.lleTernary` in the engine | against `thermo`'s two-liquid flash and the data |
| 3 | Liquid-liquid views: binary vs T, ternary with tie lines and distribution coefficient, solvent screening table | interface checks; numbers from step 2 |
| 4 | Solids: T_m and ΔH_fus (NIST WebBook) for the first solids, `sys.solidSolubility`, the solid views | against `chemicals.solubility_eutectic` and measured solubilities |
| 5 | Gases in other solvents with an equation of state and fitted k_ij | against ThermoML solubility data |

**Step 4, first part, done:** the engine (`src/equilibrium/sle.js`: `sys.solidSolubility`,
`sys.solubilityCurve`, `sys.liquidusT`, `sys.sleDiagram`) and the melting data: the melting
(triple-point) temperature and enthalpy of fusion of 90 of the 92 components, from the NIST
WebBook phase-change data (median of the measured values) or, where the WebBook has none,
ChemSep v8.3 (`validation/python/fusion_data.py`). Checked against `chemicals.solubility_eutectic`
and the independent Python NRTL/UNIQUAC (`validation/python/reference_sle.py`), and against 91
measured solubility sets of naphthalene, benzoic acid and salicylic acid in 26 solvents from the
ThermoML Archive (`validation/python/fetch_sle.py`, report in
[docs/SLE_CHECKS.md](../docs/SLE_CHECKS.md)): the ideal solubility is within 10 % where the
solvent is chemically close to the solid, and 10–300 times too high in water and alkanes, where
solid-liquid parameters (not yet fitted) are needed. The workbench views come next.
