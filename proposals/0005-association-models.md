# 0005: Association models for strongly associating mixtures

- **Status:** Draft
- **Author(s):** Fugacity maintainers (drafted with an AI assistant)
- **Discussion:** this pull request
- **Roadmap item:** core track, thermodynamic models (after proposal 0004 step 3)

## Problem

Water, alcohols, glycols and carboxylic acids form hydrogen bonds with themselves and with
each other. Fugacity describes them today with NRTL or UNIQUAC (tau = a + b/T) in the liquid
and, for acetic acid, a chemical-theory dimer in the vapour. For phase equilibrium at one
pressure this works well (ethanol + water at 1 atm: 0.1 K in T after a fit to open data). It
fails as soon as one set has to serve more than one property or temperature range:

1. **Phase equilibrium and enthalpy together.** The excess enthalpy of ethanol + water
   changes sign between 25 degC (-770 J/mol) and 150 degC (+910 J/mol) (open data in
   `validation/data/`, Nagamachi and Francesconi 2006, Fang et al. 2014). The default set,
   fitted to the 1-atm T-x-y, gives the wrong sign at 25 degC. A joint fit is possible only at
   the cost of the boiling points (0.8-0.9 K instead of 0.1 K; pull request #43). Adding
   temperature terms (tau = a + b/T + e ln T + f T, 8 parameters per pair) still leaves
   0.6-0.75 K in T with 39-57 J/mol in excess enthalpy, with parameters of the order of
   10^4 that are unsafe outside the data (`validation/python/exploratory/association/ext_tau.py`).
   Energy balances of distillation columns and heat exchangers need both.
2. **Equations of state for polar pairs.** Peng-Robinson and SRK with one k_ij miss water +
   ethylene glycol by 1.9-2.0 K on average and 8.8 K at worst (pull request #43), and they
   have no vapour dimerization for acetic acid (pull request #44), so high-pressure work with
   water, methanol or glycols (gas drying, methanol synthesis, hydrate inhibition) has no
   suitable model.
3. **Liquid-liquid equilibria of water with hydrocarbons** come out of NRTL/UNIQUAC fits
   only within the temperature range of the data, and the databank sets imported in pull
   request #46 predict two liquids for several pairs that are expected to be miscible
   (tetrahydrofuran + water, 1-propanol + water with UNIQUAC), which a physically based model
   should reproduce or refute.

Affected: anyone doing energy balances or high-pressure calculations with water, alcohols,
glycols or acids; four of the eight benchmarks of proposal 0004 contain such pairs.

## Proposal

Add an **association equation of state** built on Wertheim's first-order thermodynamic
perturbation theory (TPT1), the theory that both the CPA and the SAFT families use for
hydrogen bonding, and decide between the two families, and between their combining rules,
with a measured study **before** writing engine code. Concretely:

1. **Study first (no engine change).** A Python study with the open-source teqp library
   (NIST) and an independent implementation, on open data already in the repository and new
   open data where needed, comparing:
   - CPA (SRK + association; simplified radial distribution function), with the CR-1 and
     Elliott combining rules, and with a fitted cross-association energy or volume
     (solvation) where the theory allows it;
   - PC-SAFT with the same association term (teqp implements it);
   - as the baseline, today's NRTL/UNIQUAC sets.

   Pure-component parameters are fitted **in Fugacity** to open pure data: vapour pressure,
   saturated liquid density **and enthalpy of vaporization** from CoolProp (reference
   equations of state for water, methanol, ethanol, and others; proposal 0002's sources).
   The enthalpy of vaporization is included because an equation of state's excess enthalpy is
   the difference of residual enthalpies (mixture minus pure liquids): pure parameters fitted
   to vapour pressure and density alone do not constrain it (see "Evidence so far").

2. **Decision criteria, fixed now** (the study reports each, and the model family is chosen
   only if it meets them; otherwise the proposal stops at the study and the result is
   documented):
   - ethanol + water: T-x-y at 1 atm, AAD <= 0.5 K, and excess enthalpy at 298-423 K, AAD
     <= 100 J/mol, with **one** parameter set;
   - water + ethylene glycol and methanol + water: T-x-y at 1 atm, AAD <= 0.5 K;
   - water + cyclohexane: mutual solubilities 295-446 K within a factor 1.5 (today's NRTL
     fit: 14-20 % AARD, but only inside its data range);
   - acetic acid + water: T-x-y at 1 atm, AAD <= 0.5 K, with the association term describing
     the vapour dimer (no separate chemical-theory vapour);
   - pure components: vapour pressure 1 %, saturated liquid density 2 %, enthalpy of
     vaporization 2 % against CoolProp over 0.5-0.9 Tc (proposal 0002 tolerances).

3. **Engine (if the study selects a model).** `src/thermo/eos/cpa.js` (or `pcsaft.js`)
   beside the cubic equations, with the same interface as `system({ components, model: "CPA" })`
   so that every diagram, the flash and the workbench work unchanged; association site
   fractions solved by successive substitution with a Newton finish (Michelsen's
   formulation), analytic derivatives for pressure, fugacity coefficients and residual
   enthalpy. A new data file `src/data/association.json`: per component the association
   scheme (1A, 2B, 3B, 4C in the notation of Huang and Radosz), energy, volume and the
   physical parameters, each with `source` and `tier`; per pair k_ij and, where fitted, the
   cross-association parameters.

Worked example of the intended use (unchanged interface):

```js
const s = system({ components: ["water", "ethanol"], model: "CPA" });
s.bubbleT([0.5, 0.5], 101.325);          // phase equilibrium
s.enthalpy("liquid", 298.15, 101.325, [0.5, 0.5]);   // including the excess enthalpy
s.flash({ z: [0.5, 0.5], P: 101.325, H: h });        // energy balance with the same set
```

## Engineering basis

**Equations.** CPA (Kontogeorgis and co-workers; the ten-year review is ref. 5 of the thesis
cited below): pressure as SRK plus Wertheim's association term in the form of Michelsen and
Hendriks (2001),

    P = RT/(V - b) - a(T)/(V(V + b)) - (1/2)(RT/V)(1 + V d ln g/dV) sum_i x_i sum_A (1 - X_Ai)

with a(T) = a0 (1 + c1 (1 - sqrt(T/Tc)))^2, the site fractions

    X_Ai = 1 / (1 + rho sum_j x_j sum_Bj X_Bj Delta_AiBj),
    Delta_AiBj = g(rho) (exp(eps_AiBj / RT) - 1) b_ij beta_AiBj,

and the simplified radial distribution function g = 1/(1 - 1.9 eta), eta = b rho / 4
(Kontogeorgis et al., Fluid Phase Equilib. 158-160, 201; Elliott, Suresh, Donohue, Ind. Eng.
Chem. Res. 29 (1990) 1476). Combining rules for cross association:
CR-1 (eps arithmetic mean, beta geometric mean) and Elliott's rule (Delta geometric mean);
for solvating pairs (one self-associating component, one that only accepts) the modified
CR-1 with a fitted cross volume. Association schemes after Huang and Radosz (1990).
All of these as stated, with their primary references, in the open master's thesis of
P. V. Ferreira, *Development of a more predictive Cubic Plus Association equation of state*,
University of Porto (2020, work done at DTU with G. M. Kontogeorgis and X. Liang),
https://repositorio-aberto.up.pt/bitstream/10216/132759/2/411405.pdf, eqs. 3.10-3.24 and
its references 4, 5, 33-39; and in the documentation of teqp (NIST, public domain),
https://pages.nist.gov/teqp-docs/, sections "Cubic Plus Association" and "Association".
PC-SAFT with association: implemented in teqp and in Clapeyron.jl (Walker, Yew, Riedemann,
Ind. Eng. Chem. Res. 61 (2022) 7130; open preprint arXiv:2201.08927), whose papers and
documentation state the equations and references.

**Independent check.** teqp 0.23.2 (C++ with automatic differentiation; `pip install teqp`)
evaluates the residual Helmholtz energy and its derivatives for CPA and PC-SAFT. The JS
engine will be compared with it to 1e-8 relative (pressure, ln phi, residual enthalpy), as
the cubic equations are compared with the thermo library today
(`validation/python/reference_eos.py`). An independent Python CPA written for this proposal
already agrees with teqp to 1e-11 in the residual Helmholtz energy and to all printed digits
in ln phi (`validation/python/exploratory/association/check_vs_teqp.py`).

**Data** (all open, most already in `validation/data/`): ethanol + water T-x-y (Kamihama et
al. 2012) and excess enthalpies (Nagamachi and Francesconi 2006; Fang et al. 2014); water +
ethylene glycol and ethanol + ethylene glycol (Kamihama et al. 2012); water + cyclohexane
solubilities (Marche et al. 2003, 2006; Danon et al. 2018); acetic acid + water (Chang et al.
2005; Calvar et al. 2005); methanol + water and more from the NIST TRC ThermoML Archive.
Pure-component reference values from CoolProp.

**Evidence so far** (exploratory, `validation/python/exploratory/association/`, with the
CPA parameter set printed in the teqp documentation's example, whose literature source the
documentation does not state; water 4C, ethanol 2B):

| Model | Parameters fitted | T-x-y 1 atm, AAD | hE 298 K | hE 323 K | hE 423 K |
|---|---|---|---|---|---|
| NRTL (default today) | 2, to T-x-y | 0.12 K | 856 J/mol (wrong sign) | 537 J/mol | 130 J/mol |
| NRTL, tau with ln T and T terms | 8, to T-x-y + hE | 0.58 K | 57 J/mol over all three temperatures | | |
| CPA, CR-1 (teqp, CS g) | k_ij = 0 | 0.54 K | 929 J/mol (positive, about +200 to +620, against -150 to -770 measured) | 615 J/mol | 99 J/mol |
| CPA, CR-1 (simplified g) | k_ij = -0.05 | 0.73 K | 671 J/mol | 387 J/mol | 192 J/mol |
| CPA, fitted cross-association energy | k_ij, eps_cross to T-x-y + hE | 1.81 K | 373 J/mol | 159 J/mol | 405 J/mol |

Reading: Wertheim-based CPA describes the 1-atm phase equilibrium almost without a fitted
binary parameter, and the high-temperature excess enthalpy well, which no activity-model set
here does; with literature pure parameters it does **not** give the negative excess enthalpy
at 25-50 degC, and fitting the cross-association energy alone trades it against the phase
equilibrium. This is why the study fits pure parameters including the enthalpy of
vaporization, compares combining rules and the PC-SAFT family, and states its acceptance
criteria in advance, instead of assuming that an association model solves the problem.

## Effect on existing work

None until step 3: the study adds scripts and data files only. The engine step adds a model
beside NRTL, UNIQUAC, PR and SRK; existing sets, results and tests are unchanged. The
workbench gains one model button. The flash and enthalpy code already accept an equation of
state (proposal 0001); association changes only the residual terms.

## Alternatives considered

- **Activity models with more temperature terms** (NRTL/UNIQUAC with ln T and T terms):
  tested above; the trade-off between phase equilibrium and enthalpy remains and the
  parameters become unsafe to extrapolate. Kept as today: a phase-equilibrium set and an
  enthalpy set per pair where open data exist (pull request #43).
- **COSMO-SAC** (predictive, quantum-chemistry based; open implementation by Bell et al.,
  J. Chem. Theory Comput. 16 (2020) 2635, open copy https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7675222/):
  its database of 2261 compounds is available "for academic and non-commercial use" only
  (stated in that paper), which conflicts with the project's rule that data must be
  redistributable; generating sigma profiles requires quantum-chemistry software. Useful as an
  independent check later, not as the model.
- **Chemical theory in the liquid** (association as reactions with equilibrium constants;
  APACT and lattice models such as NRHB, as reviewed in the Porto thesis, section 3.3.1):
  fewer tools to check against independently, and the equilibrium constants are fitted per
  system; Wertheim's theory has the same physical picture with transferable site parameters
  and two open independent implementations (teqp, Clapeyron.jl).
- **PC-SAFT instead of CPA from the start**: more physically based physical term, but
  non-cubic, more expensive in a browser, and needs more pure parameters; the study decides
  between the two on the same data.

## Steps

1. **Study** (`validation/python/association_study.py`): pure parameters for water,
   methanol, ethanol, ethylene glycol and acetic acid fitted to CoolProp vapour pressure,
   liquid density and enthalpy of vaporization; binary fits for the pairs above with CPA (CR-1,
   Elliott, solvation) and PC-SAFT via teqp; a report against the criteria of the proposal.
   Pull request with the script, the open data it adds and the report; the maintainers decide
   the model family on it.
2. **Engine**: the selected model in `src/thermo/eos/`, compared with teqp to 1e-8 on a
   fixture of states (pressure, ln phi, residual enthalpy, association fractions), with clear
   errors where the site-fraction iteration does not converge.
3. **Data**: `src/data/association.json` with the parameters of step 1, sources and tiers;
   tests against the open data of the criteria.
4. **Workbench and flash**: the model in the model selector; liquid-liquid and three-phase
   flashes with it (water + hydrocarbons); the engineering report gains the criteria cases.
5. **Benchmarks**: the association model as the second model of the water, alcohol, glycol
   and acid pairs of proposal 0004 (the activity models stay the primary ones where they meet
   the data better).
