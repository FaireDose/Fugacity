# Exploratory calculations for proposal 0005 (association models)

Scripts behind the numbers in [proposal 0005](../../../../proposals/0005-association-models.md),
section "Evidence so far". They are **exploratory**: they use a literature parameter set that
is not Fugacity data, they are not run by `npm test`, and nothing in `src/` depends on them.
They need numpy, scipy and, for two of them, the open-source `teqp` package (NIST,
`pip install teqp`, version 0.23.2 used).

| Script | What it shows | Runtime |
|---|---|---|
| `ext_tau.py` | NRTL / UNIQUAC with tau = a + b/T + e ln T + f T (8 parameters per pair) fitted to the ethanol + water T-x-y data and excess enthalpies together (the data files of `fit_parameters.py`) | about 1 min |
| `check_vs_teqp.py` | `mycpa.py` (an independent CPA implementation) against teqp's CPA: reduced residual Helmholtz energy, with the simplified radial distribution function g = 1/(1 - 1.9 eta) ("KG" in teqp) and the CS form | seconds |
| `cpa_ew.py` | teqp CPA (CS radial distribution function), water (4C) + ethanol (2B), one k_ij fitted to the 1-atm T-x-y, excess enthalpies predicted | minutes |
| `study_ew.py` | `mycpa.py` (KG, the simplified CPA): k_ij fitted to the T-x-y alone; then k_ij and the cross-association energy fitted to the T-x-y and the excess enthalpies together. Uses every 4th T-x-y point and every 3rd or 4th enthalpy point for speed; the reported deviations are over all points | about 30 min |

Pure-component CPA parameters (water 4C: a0 = 0.12277 Pa m6/mol2, b = 1.45e-5 m3/mol,
c1 = 0.6736, eps = 16655 J/mol, beta = 0.0692; ethanol 2B: 0.85164, 4.91e-5, 0.7502, 21500,
0.008) are those printed in the CPA example of the teqp documentation (NIST,
https://pages.nist.gov/teqp-docs/, section "Cubic Plus Association"), which does not state
their literature source. The same values are in the Clapeyron.jl database file
`database/SAFT/CPA/CPA_like.csv` (no source column filled). Proposal 0005 plans to fit
Fugacity's own parameters to open data instead.
