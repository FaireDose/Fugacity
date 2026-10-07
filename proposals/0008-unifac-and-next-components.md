# 0008: UNIFAC as the predicted tier, and the next 50 components

- **Status:** Accepted (by the lead maintainer, 2026-10-06). Part A (UNIFAC) is on hold: nothing
  of it is implemented until DDBST has answered on the use of the published parameters and the
  maintainer decides. Part B (components) goes ahead.
- **Author(s):** Fugacity maintainers (drafted with an AI assistant)
- **Discussion:** this pull request
- **Roadmap item:** core track A3 (quality tiers and prediction); data track (components);
  proposal 0004 (the first 50 components) as the model for choosing them

## Problem

1. **Missing pairs.** With 49 components there are more than a thousand pairs; open data fit
   only a few dozen, and the ChemSep databank covers part of the rest. For the others the
   workbench can only say "no parameters". A predictive method would give an estimate, clearly
   labelled as such, instead of nothing.
2. **Missing components.** Solvents for extraction (proposal 0007), amines for gas treating,
   acids and esters for reaction work, heavier hydrocarbons and a few solids are not in the
   databank yet.

## Proposal

### Part A: UNIFAC as the `predicted` tier (after DDBST answers)

- **Which UNIFAC.** UNIFAC estimates activity coefficients from the functional groups of the
  molecules. Two published parameter tables are freely readable on the website of DDBST
  (Dortmund Data Bank Software & Separation Technology), the group that develops the method:
  - original UNIFAC: https://www.ddbst.com/published-parameters-unifac.html ("This page shows
    the published parameters for original UNIFAC"; publications 1979–2003);
  - modified UNIFAC (Dortmund): https://www.ddbst.com/PublishedParametersUNIFACDO.html
    (publications 1987–2016), with temperature-dependent interaction parameters, generally
    better for excess enthalpies and temperature trends.

  Both pages say that "many new, updated and revised parameters" are available only to members
  of the UNIFAC Consortium; Fugacity would use only the published tables. Neither page states
  a licence for the published values, so the maintainer asks DDBST before anything is added
  (AGENTS.md rule 1: numbers only from sources that anyone can read **and use** freely).
  The open-source `thermo` library (MIT) ships both published tables, citing the DDBST pages;
  it serves as the independent implementation to test against, not as the source of the
  numbers.
- **How it is used.** A pair with no fitted or databank parameters can use UNIFAC, shown with
  the `predicted` tier (badge, Sources panel, and the rule in the Library: "best available",
  "only fitted or databank", "allow predicted"). It is never used silently: the default rule
  stays as today until the person allows predicted pairs. Group assignments for each component
  are part of its record, with their source.
- **Accuracy, measured, not claimed.** Before release, UNIFAC is run on every benchmark pair
  that has open data (proposal 0004 step 3) and the deviations are published in the engineering
  report next to the fitted sets: bubble temperatures, azeotropes, liquid-liquid splits and
  excess enthalpies. The Library shows that comparison.

### Part B: the next 50 components, chosen by process (as in proposal 0004)

| Process area | Candidates |
|---|---|
| Extraction and solvents (proposal 0007) | dichloromethane, 1,2-dichloroethane, methyl isobutyl ketone, cyclohexanone, N,N-dimethylformamide, dimethyl sulfoxide, N-methyl-2-pyrrolidone, sulfolane, furfural, 2-methoxyethanol, 1,4-dioxane, isobutanol, 2-butanol |
| Gas treating and CO₂ capture | monoethanolamine, diethanolamine, methyldiethanolamine, sulfur dioxide, nitrous oxide |
| Acids, esters and reaction work | formic acid, propionic acid, acrylic acid, vinyl acetate, isopropyl acetate, ethylene oxide, propylene oxide, formaldehyde, hydrogen peroxide |
| Petrochemicals and fuels | cumene, mesitylene, n-nonane, n-decane, n-dodecane, isooctane, 1-butene, isoprene, ethyl tert-butyl ether |
| Solids (proposal 0007) | naphthalene, benzoic acid, salicylic acid, urea, phthalic anhydride, caprolactam |
| Nitrogen compounds | pyridine, aniline, acrylonitrile, methylamine |

That is 46 (an earlier draft counted 45); the last four are kept free for what the first benchmarks of proposal 0007 show
is missing. Each component goes through the pipeline of proposal 0004: constants and
correlations from the sources in rule 1 (CoolProp, the NIST Chemistry WebBook, ChemSep,
open libraries with checked sources), UNIQUAC r and q, the pairs with open data fitted, the
others from the ChemSep databank, and every value labelled with its source and tier.

### Part B, scan of the sources (2026-10-06)

Before anything is added, `validation/python/scan_components.py` looked up every candidate in
the open sources of rule 1 that the pipeline of proposal 0004 uses: CoolProp 8.0.0, matched by
CAS, and the two ChemSep pure-component files that DWSIM redistributes under the Artistic
License 2.0 (`chemsep1.xml`, v8.3, already used; `chemsep2.xml`, "ChemSep v8.31 pure component
data 2", new), at DWSIM commit `1abf72d1b6b41d3e9a8cc770d3cc4e8fc76e5766`. CAS numbers and
formulas come from the `chemicals` library. The phase at 25 °C follows ChemSep's melting and
normal boiling points. "Missing in ChemSep" lists the constants and temperature correlations
that `add_components.py` and `fit_properties.py` need and the record lacks.

| Component | CAS | Formula | At 25 °C | CoolProp 8.0.0 | ChemSep | Missing in ChemSep |
|---|---|---|---|---|---|---|
| dichloromethane | 75-09-2 | CH2Cl2 | ? | — | **not found** | — |
| 1,2-dichloroethane | 107-06-2 | C2H4Cl2 | liquid | Dichloroethane | chemsep1.xml | nothing |
| methyl isobutyl ketone | 108-10-1 | C6H12O | liquid | — | chemsep1.xml | nothing |
| cyclohexanone | 108-94-1 | C6H10O | liquid | — | chemsep1.xml | nothing |
| N,N-dimethylformamide | 68-12-2 | C3H7NO | liquid | — | chemsep1.xml | nothing |
| dimethyl sulfoxide | 67-68-5 | C2H6OS | liquid | — | chemsep1.xml | nothing |
| N-methyl-2-pyrrolidone | 872-50-4 | C5H9NO | liquid | — | chemsep2.xml | nothing |
| sulfolane | 126-33-0 | C4H8O2S | solid | — | chemsep1.xml | nothing |
| furfural | 98-01-1 | C5H4O2 | liquid | — | chemsep1.xml | nothing |
| 2-methoxyethanol | 109-86-4 | C3H8O2 | ? | — | **not found** | — |
| 1,4-dioxane | 123-91-1 | C4H8O2 | liquid | — | chemsep1.xml | nothing |
| isobutanol | 78-83-1 | C4H10O | liquid | — | chemsep1.xml | nothing |
| 2-butanol | 78-92-2 | C4H10O | liquid | — | chemsep1.xml | nothing |
| monoethanolamine | 141-43-5 | C2H7NO | liquid | — | chemsep1.xml | nothing |
| diethanolamine | 111-42-2 | C4H11NO2 | solid | — | chemsep1.xml | nothing |
| methyldiethanolamine | 105-59-9 | C5H13NO2 | liquid | — | chemsep1.xml | nothing |
| sulfur dioxide | 7446-09-5 | O2S | gas | SulfurDioxide | chemsep1.xml | nothing |
| nitrous oxide | 10024-97-2 | N2O | gas | NitrousOxide | chemsep1.xml | nothing |
| formic acid | 64-18-6 | CH2O2 | liquid | — | chemsep2.xml | nothing |
| propionic acid | 79-09-4 | C3H6O2 | liquid | — | chemsep1.xml | nothing |
| acrylic acid | 79-10-7 | C3H4O2 | liquid | — | chemsep1.xml | nothing |
| vinyl acetate | 108-05-4 | C4H6O2 | liquid | — | chemsep1.xml | nothing |
| isopropyl acetate | 108-21-4 | C5H10O2 | liquid | — | chemsep1.xml | nothing |
| ethylene oxide | 75-21-8 | C2H4O | gas | EthyleneOxide | chemsep1.xml | nothing |
| propylene oxide | 75-56-9 | C3H6O | liquid | — | chemsep1.xml | nothing |
| formaldehyde | 50-00-0 | CH2O | gas | — | chemsep1.xml | nothing |
| hydrogen peroxide | 7722-84-1 | H2O2 | liquid | — | chemsep2.xml | nothing |
| cumene | 98-82-8 | C9H12 | liquid | — | chemsep1.xml | nothing |
| mesitylene | 108-67-8 | C9H12 | liquid | — | chemsep1.xml | nothing |
| n-nonane | 111-84-2 | C9H20 | liquid | n-Nonane | chemsep1.xml | nothing |
| n-decane | 124-18-5 | C10H22 | liquid | n-Decane | chemsep1.xml | nothing |
| n-dodecane | 112-40-3 | C12H26 | liquid | n-Dodecane | chemsep1.xml | nothing |
| isooctane | 540-84-1 | C8H18 | liquid | — | chemsep1.xml | nothing |
| 1-butene | 106-98-9 | C4H8 | gas | 1-Butene | chemsep1.xml | nothing |
| isoprene | 78-79-5 | C5H8 | liquid | — | chemsep1.xml | nothing |
| ethyl tert-butyl ether | 637-92-3 | C6H14O | liquid | — | chemsep1.xml | nothing |
| naphthalene | 91-20-3 | C10H8 | solid | — | chemsep1.xml | nothing |
| benzoic acid | 65-85-0 | C7H6O2 | solid | — | chemsep1.xml | nothing |
| salicylic acid | 69-72-7 | C7H6O3 | solid | — | chemsep1.xml | nothing |
| urea | 57-13-6 | CH4N2O | ? | — | **not found** | — |
| phthalic anhydride | 85-44-9 | C8H4O3 | ? | — | **not found** | — |
| caprolactam | 105-60-2 | C6H11NO | ? | — | **not found** | — |
| pyridine | 110-86-1 | C5H5N | liquid | — | chemsep1.xml | nothing |
| aniline | 62-53-3 | C6H7N | liquid | — | chemsep1.xml | nothing |
| acrylonitrile | 107-13-1 | C3H3N | liquid | — | chemsep1.xml | nothing |
| methylamine | 74-89-5 | CH5N | gas | — | chemsep1.xml | nothing |

Result: **41 of 46** have every record the pipeline needs (8 of them also have a CoolProp
reference equation of state, which comes first in the source chain). Notes:

- **Not found in either source:** dichloromethane, 2-methoxyethanol, urea, phthalic anhydride
  and caprolactam. Searched next, in the order of rule 1 (2026-10-06): the NIST Chemistry WebBook
  pages of each and the NIST TRC ThermoML Archive (full-text search, every record opened; pure
  data sets and the pure end points of binary sets):
  - **dichloromethane** and **2-methoxyethanol**: added, every record fitted to the measured
    values (`validation/python/measured_components.py`, report in
    [docs/PURE_DATA_MEASURED.md](../docs/PURE_DATA_MEASURED.md)). The open data are thinner
    than ChemSep's correlations. Each record covers only the measured temperatures. Properties
    without open measurements at the target accuracy are marked "no open data": for
    dichloromethane, liquid heat capacity (values near 298 K only), the transport properties and
    the surface tension; for 2-methoxyethanol, the ideal-gas heat capacity (so no enthalpy), the
    thermal conductivities, the vapour viscosity and the surface tension (measured, but with
    stated uncertainties above 1 %). Neither has UNIQUAC r and q (Part A).
  - **caprolactam**: a measured critical point (Nikitin et al., Fluid Phase Equilib. 2018,
    801 ± 8 K and 4.66 ± 0.14 MPa), liquid vapour pressures 343–372 K, liquid heat capacities
    323–368 K, the triple point and the enthalpy of fusion (ThermoML), and enthalpies of
    vaporization 360–560 K (Steele et al. 2002, WebBook). No liquid densities. It can follow
    as a component once the solid-liquid work of proposal 0007 needs it.
  - **urea** and **phthalic anhydride**: melting temperatures and enthalpies of fusion (WebBook,
    ThermoML), sublimation pressures (urea) and one vapour-pressure equation (phthalic
    anhydride, Stull 1947). No measured critical point, so not a vapour-liquid component
    (urea decomposes before it boils). Their melting data are what proposal 0007 (step 4,
    solid solubility) needs.
- **New source:** `chemsep2.xml` is a second file of the same databank, with the same licence. It
  is used for N-methyl-2-pyrrolidone, formic acid and hydrogen peroxide. It needs its own entry in
  `src/data/sources.json` and `src/data/LICENSES.md` when the first of these is added.
- **Solids at 25 °C:** sulfolane, diethanolamine, naphthalene, benzoic acid and salicylic acid.
  They are useful as liquids above their melting point and for solid-liquid solubility
  (proposal 0007).
- **Gases at 25 °C:** sulfur dioxide, nitrous oxide, ethylene oxide, formaldehyde, 1-butene and
  methylamine. They work with the equations of state, with Henry's law where open data exist, and
  with activity models only below their critical temperature.
- **Difficult cases, flagged now:** formic acid (it associates in the vapour like acetic acid),
  formaldehyde and hydrogen peroxide (they react in water), and the amines with CO₂
  (electrolytes; only the molecular solvent properties are in scope).

**Batch 1 (extraction solvents), done:** 1,2-dichloroethane (CoolProp), methyl isobutyl ketone,
cyclohexanone, N,N-dimethylformamide, dimethyl sulfoxide, N-methyl-2-pyrrolidone (`chemsep2.xml`),
sulfolane, furfural, 1,4-dioxane, isobutanol and 2-butanol (ChemSep). Every record of the batch was
then compared with the measured values of the ThermoML Archive (11,133 values from 783 articles,
`validation/python/check_measured.py`, report in
[docs/MEASURED_CHECKS.md](../docs/MEASURED_CHECKS.md), checked by `test/measured-checks.test.js`).
Four databank records missed the tolerances of the engineering report and were refitted to the
measured values: the viscosity of N-methyl-2-pyrrolidone (ChemSep 9 % off), the thermal
conductivities of dimethyl sulfoxide and sulfolane (16 and 19 % off) and the vapour pressure of
2-butanol. The others above the tolerance (vapour pressures of 1,2-dichloroethane, cyclohexanone,
N,N-dimethylformamide, N-methyl-2-pyrrolidone, furfural and 1,4-dioxane; heat capacities of
N,N-dimethylformamide and N-methyl-2-pyrrolidone, 1-5 %) stay as they are and say so in the
record: the measured values within the target do not cover 25 °C to 100 °C, so a refit would
shorten the range, or the measured sets disagree among themselves.

**The older components, checked the same way:** the 24 components of proposal 0004 and v0.1 whose
records come from ChemSep (all of them, or the transport properties CoolProp does not model) were
compared with 25,540 measured values from 2,046 articles. Most records are within the
tolerances. Refitted to the measured values: the vapour pressure of glycerol (ChemSep 7 % off;
one of the two articles, with 2 points, still disagrees with the other's 88), phenol (ChemSep up
to 32 % off below 400 K, also against the 1949 Antoine equation on the WebBook), 1-butanol and
acetonitrile, and the viscosity of glycerol (ChemSep 38 % off). Propylene glycol's viscosities,
thermal conductivities, surface tension and UNIQUAC r and q now come from `chemsep2.xml`. Since
then the engineering report of every pull request lists these comparisons ("Records against
measured data"), for `main` and for the pull request.

Batches, in the order of the process areas: 1. extraction solvents (11 found), 2. gas treating
and acids/esters (14), 3. petrochemicals and nitrogen compounds (13), 4. solids (3). The five not
found follow when a source is found.

## Engineering basis

- UNIFAC: the combinatorial and residual parts as in the original papers, implemented and
  tested against `thermo.unifac` (MIT) with the same parameters, to 1e-10 in ln γ.
- Components: as proposal 0004 (property correlations fitted or taken from open sources,
  checked against the NIST WebBook and CoolProp where they have the component).
- Validation of the predicted tier: the benchmark comparison above; no tolerance is promised
  in advance, the deviations are reported as they are.

## Effect on existing work

- Nothing changes for pairs that have parameters today. The `predicted` tier exists in the
  code (`TIER_SHORT`) but is unused; Part A gives it data.
- Component records gain UNIFAC group assignments (optional field).
- 50 more components enlarge the data file; the size budget of proposal 0004 applies (data
  packs, roadmap A2, if it grows past it).

## Alternatives considered

- **COSMO-SAC** (predictive from quantum-chemical surface charges): its open profile databases
  are "for academic and non-commercial use" only (noted in proposal 0005, pull request #48, deferred); not compatible with rule 1 today.
- **UNIFAC from `thermo` without asking DDBST:** the library is MIT, but rule 1 asks where each
  table comes from; the tables are DDBST's published parameters without a stated licence, so
  we ask first.
- **No predictive method:** keeps every number traceable to data or a databank, but leaves most
  pairs empty. The `predicted` tier, off by default and always labelled, keeps the rule intact.

## Steps

| Step | Pull request | Tests |
|---|---|---|
| 0 | The maintainer writes to DDBST about using the published original and modified (Dortmund) UNIFAC tables in an open-source (MIT) project, with attribution | — |
| 1 | (After a yes) UNIFAC model and the published tables with their sources; group assignments for the 49 components | against `thermo.unifac`; tables against the DDBST pages |
| 2 | The `predicted` tier in the Library rule and the interface; benchmark comparison in the engineering report | the report; no change without the rule |
| 3–6 | The next 50 components in four batches by process area (as proposal 0004 step 2) | as proposal 0004 |
| 7 | Fits of the new benchmark pairs to open data (as proposal 0004 step 3) | against the data |
