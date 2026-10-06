# 0008: UNIFAC as the predicted tier, and the next 50 components

- **Status:** Draft (UNIFAC part waiting for the answer of DDBST on the use of the published
  parameters; nothing of it is implemented until then)
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

That is 45; the last five are kept free for what the first benchmarks of proposal 0007 show
is missing. Each component goes through the pipeline of proposal 0004: constants and
correlations from the sources in rule 1 (CoolProp, the NIST Chemistry WebBook, ChemSep,
open libraries with checked sources), UNIQUAC r and q, the pairs with open data fitted, the
others from the ChemSep databank, and every value labelled with its source and tier.

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
