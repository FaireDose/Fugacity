# Engineering report

Every pull request gets a comment with a fixed set of engineering results, computed with
the pull request and with `main`, and compared with independent references (proposal
0002, section 8). Reviewers approve on these results; they do not need to read the code.

## What is in it

| Group | Results | Reference |
|---|---|---|
| Normal boiling points | Tb of the 16 components at 101.325 kPa | CoolProp 8.0.0 (12 components), NIST WebBook Tboil (acetic acid, ethylene glycol, chloroform, ethyl acetate) |
| Azeotropes at 101.325 kPa | T and composition of 10 binary azeotropes (NRTL and UNIQUAC) and the methanol + acetone + chloroform saddle (NRTL) | Handbook values in `validation/data/azeotropes_101kPa.json` |
| Bubble points | Water + ethylene glycol T-x-y (3 points), acetic acid + ethylene glycol P-x at 363.15 K (3 points), five more pairs without a reference | `validation/data/water_ethylene_glycol_760mmHg.json`, Schmid et al. 2007 (`validation/data/schmid2007_*.json`) |
| Dew points and excess enthalpy | Ethanol + water dew T and liquid at 3 measured vapours (NRTL, UNIQUAC); excess enthalpy of acetic acid + ethylene glycol at 323.15 K (3 points) and of water + ethanol at 423.2 K and 5000 kPa (3 points) | Kamihama et al. 2012, Schmid et al. 2007, Fang et al. 2014 (ThermoML Archive; `validation/data/`) |
| Flashes | Ethanol + water T-P and P-H (NRTL; NRTL with a PR vapour at 10 bar), methanol + acetone + chloroform P-VF (UNIQUAC), methane + ethane T-P (PR) | The thermo library's FlashVL with the same parameters; enthalpy flashes with the independent enthalpies of `validation/python/reference_enthalpy.py` (`validation/python/reference_flash.py`) |
| Pure-component properties | Vapour pressure, liquid density, liquid cp, heat of vaporization, liquid viscosity and thermal conductivity at 25 °C and at the normal boiling point; ideal-gas cp at 25 °C; gas density at 300 K and 1, 10, 50 bar | CoolProp 8.0.0 (reference equations of state and the transport models CoolProp cites); NIST WebBook liquid cp at 25 °C for the four components CoolProp does not have |
| Steam tables | Saturation at 100–300 °C (P, ρ′, ρ″, h′, h″, Δh); superheated steam 10 bar/300 °C and 100 bar/500 °C; compressed water 100 bar/100 °C (ρ, h, s, cp, μ, λ) | CoolProp 8.0.0: IAPWS-95, with the viscosity and thermal-conductivity correlations CoolProp cites for water (Huber et al., J. Phys. Chem. Ref. Data 2009 and 2012) |
| Equation of state | Peng–Robinson densities of air, natural gas and hydrogen + methane; methane + ethane bubble points | CoolProp 8.0.0 multi-fluid mixture model (GERG-2008 form) |

The cases are in `cases.json` (written by `make_cases.py`); the references are in
`reference/*.json` (written by `make_reference.py`), each value with its source and, where
there is none, the reason (`"value": null, "why": ...`). No reference value is typed by
hand except the NIST WebBook spot values, which are listed with their page and table in
`make_reference.py`.

## Tolerances

| Property | Tolerance | Basis |
|---|---|---|
| Vapour pressure | 1 % | Proposal 0002 |
| Liquid density | 1 % | Proposal 0002 |
| Heat capacity | 2 % | Proposal 0002 |
| Heat of vaporization | 2 % | Proposal 0002 |
| Viscosity | 5 % | Proposal 0002 |
| Thermal conductivity | 5 % | Proposal 0002 |
| Normal boiling point | 0.5 K | Team brief for v0.2 |
| Azeotrope temperature, composition | 1 K, 0.05 mole fraction | As in `test/azeotropes.test.js` |
| Steam tables against IAPWS-95 | 0.1 % | IAPWS-IF97 agrees with IAPWS-95 within IF97's stated uncertainty, not to 1e-8; the 1e-8 check against the IF97 verification tables belongs in the steam-table tests |
| Bubble T, y, P | 1 K, 0.02, 3 % | Chosen for this report (not in proposal 0002) |
| Water + ethylene glycol bubble T | 3.5 K | Secondary compilation with visible scatter; same bound as `test/vle.test.js` |
| Gas density, equation of state | 5 %, report only | An equation of state is compared with a reference equation of state for information; a ⚠️ here does not block |
| Dew T, liquid x | 1 K, 0.03 | Chosen for this report (not in proposal 0002) |
| Flash vapour fraction and compositions; flash temperature | 0.001; 0.01 K | Same model in independent code: differences only from solver tolerances |
| Excess enthalpy, data used in the fit (acetic acid + ethylene glycol) | 50 J/mol, report only | Consistency check: the parameters were fitted to these data |
| Excess enthalpy predicted from vapour-liquid parameters (water + ethanol at 423.2 K) | 25 %, report only | Independent check of a prediction outside the parameters' temperature range; a ⚠️ shows its size and does not block |

## How to read the comment

- The **summary** counts: ✅ within tolerance, ⚠️ out of tolerance, 🆕 new (not available
  on main), ✏️ changed from main, ⚠️ lost (computed on main but not in the pull request),
  ❌ errors, no reference, not available.
- The **tables** list only what changed or is out of tolerance: property, conditions, main,
  this PR, reference, deviation (this PR minus reference; relative for properties, absolute
  for temperatures and compositions), status. "⚠️ as on main" marks a result that was
  already out of tolerance on main and did not change.
- **"not available"** means the version under test has no function or no data for that
  result (for example steam tables before they exist). It is not a failure.
- The **HTML report** (artifact `engineering-report` of the workflow run, linked from the
  comment) has the same tables, every result with its source on hover, and plots of each
  property against temperature (or composition) for main, the pull request and the reference.

## How a reviewer checks a pull request with it

A reviewer can be a person or an AI assistant that did not write the change.

1. **Read the summary.** Lost results and errors need an explanation in the pull request.
2. **For every ✏️ changed or 🆕 new result**, ask whether the change is intended by the pull
   request (a new property, a better fit) and whether it moves towards the reference. Open
   the plot: a change at one point should not break the curve elsewhere.
3. **For every ⚠️**, check whether the pull request explains it (for example an ideal-gas
   density at 50 bar before the equation of state exists), and whether the tolerance is the
   right one for the quality of the reference.
4. **Check the references, not only the marks.** A ✅ is only as good as the reference. For
   CoolProp values you can recompute any number with
   `python -c "import CoolProp.CoolProp as CP; print(CP.PropsSI('Dmass','T',298.15,'P',101325,'Water'))"`;
   for NIST WebBook values open the page listed in `make_reference.py`.
5. **If the pull request changes the report itself** (this folder, the script, the
   workflows), the comment says so at the top. The report is produced by the pull request's
   own copy of the script, so such a pull request must be reviewed as code: a changed
   tolerance, case or reference value needs a reason and a source.
6. **Results without a reference** can only show changes. A pull request that brings an
   open reference for one of them (with its source) is welcome.

An AI reviewer should state which results it checked against which source, and should not
call a result validated beyond what the comparison shows.

## Running it locally

```
npm run build
npm run report                                   # this checkout against itself
npm run report -- --base-bundle ../main/dist/fugacity.mjs   # against another build
```

The output is in `dist/report/` (`report.md`, `report.html`, and the raw results).
To regenerate the references (Python with CoolProp 8.0.0):

```
python validation/report/make_cases.py
python validation/report/make_reference.py
```

## When a new interface lands

Steam tables and the equation of state did not exist when the report was written. The
script reaches them through `ADAPTERS` in `scripts/engineering-report.mjs`:

- `Fugacity.steam(T_K, P_kPa)`: fields `rho_kg_m3`, `h_kJ_kg` (or `h_J_kg`, `h_J_mol`),
  `s_kJ_kgK`, `cp_kJ_kgK`, `mu_Pa_s`, `k_W_mK`; saturation from `Fugacity.steam.saturation(T_K)`
  (or `sat`, or `steam.psat`), with `psat_kPa` and `liquid`/`vapour` objects.
- `Fugacity.system({ components, model: "PR" })`: `density(z, T_K, P_kPa)` or `Z(z, T_K, P_kPa)`,
  and the existing `bubbleP(x, T_K)`.

If such a pull request names things differently, its cases stay "not available" (the
reason lists the fields found); update the adapter in the same or a follow-up pull request.
Steam enthalpy and entropy are compared in the IAPWS convention (u = s = 0 for the saturated
liquid at the triple point).

## Security of the two workflows

- `engineering-report.yml` (on `pull_request`) builds and runs the pull request's code. It
  has a read-only token, no secrets, and its checkouts keep no credentials; it only uploads
  an artifact.
- `engineering-report-comment.yml` (on `workflow_run`, so it runs from the default branch)
  can write pull-request comments. It never checks out or runs code from the pull request;
  it reads the artifact as untrusted text in JavaScript (no shell), accepts only an integer
  pull-request number whose current head commit is the commit the report was made for, and
  neutralises @mentions. It only starts working once it is on the default branch.
- Every action is pinned to a full commit SHA.
