# 0001: Property package and flash

- **Status:** Draft
- **Author(s):** Fugacity maintainers (drafted with an AI assistant)
- **Discussion:** this pull request
- **Roadmap item:** core track A1 (property package) and A4 (equilibrium solver contract);
  release v0.3 (flash)

## Problem

Fugacity can draw phase diagrams but cannot yet answer the first question of every
process calculation: *a feed of known composition is brought to these conditions; how
much vapour and liquid come out, of what composition, and with what enthalpy?* That is a
**flash**, and every unit after it (heater, valve, flash drum, column stage, reactor
outlet) is built on it.

Three things are missing:

1. **Mixture enthalpy.** Pure-component enthalpies are in place (proposal 0002), but
   there is no enthalpy of a liquid or vapour *mixture*, so no energy balance is possible.
2. **One interface for all models.** Activity-coefficient systems (NRTL, UNIQUAC) have
   bubble points, diagrams and azeotropes but no dew points; equation-of-state systems
   (Peng–Robinson, SRK) have bubble and dew points but no diagrams. A unit operation
   should not need to know which model is in use.
3. **A flash with clear failure rules.** Bubble and dew solvers exist, each with its own
   conventions for tolerances and errors.

Who is affected: students and engineers who want a flash drum or an adiabatic valve
result in a chat today, and every later step of the roadmap (streams, units,
flowsheets, cost engineering), which all need a flash with enthalpy.

## Proposal

### 1. The property package is the system

`Fugacity.system(...)` already holds the components, the model and the chosen parameter
sets with their sources. It becomes the **property package**: the same object gains
enthalpy, dew points for activity models and the flash. No second name to learn.

The user chooses the **liquid model** and, separately, the **vapour model**. Every
flash, bubble and dew point works with every combination:

```js
// activity model for the liquid, equation of state for the vapour ("gamma-phi")
const pp = Fugacity.system({
  components: ["toluene", "chloroform"],
  model: "NRTL",           // liquid: NRTL | UNIQUAC | ideal
  vapour: "PR"             // vapour: ideal (default) | PR | SRK
});

// one equation of state for both phases ("phi-phi")
const eos = Fugacity.system({ components: ["toluene", "chloroform"], model: "PR" });
// sets, prefer, allowMissingPairs, kij: as today (proposal 0003)
```

| Choice | Liquid | Vapour | Use it for |
|---|---|---|---|
| `model: "NRTL"` or `"UNIQUAC"`, `vapour: "ideal"` | activity coefficients × vapour pressure | ideal gas (chemical theory for acetic acid) | polar liquids near atmospheric pressure |
| `model: "NRTL"` or `"UNIQUAC"`, `vapour: "PR"` or `"SRK"` | activity coefficients × vapour pressure, with the fugacity coefficient of the saturated pure vapour and the Poynting correction | the cubic equation of state, with its k_ij | polar liquids at moderate pressure, where the vapour is no longer ideal |
| `model: "PR"` or `"SRK"` | the equation of state | the same equation of state | hydrocarbons and gases, higher pressure, near-critical mixtures |
| `model: "ideal"` | Raoult's law | as chosen | quick estimates, and as a reference |

For gamma-phi the phase equilibrium is

  y_i φ_i^V(T, P, y) P = x_i γ_i(T, x) P_i^sat(T) φ_i^sat(T) exp[v_i^L (P − P_i^sat) / (R T)]

which reduces to the present modified Raoult's law when `vapour: "ideal"` (all φ = 1, no
Poynting term). Results for `vapour: "ideal"` stay exactly as today. Acetic acid keeps its
chemical-theory vapour (dimerization); combining it with a cubic vapour is not offered and
gives a clear error.

The workbench lets the user switch between these choices on the same feed, so a
mixture such as toluene + chloroform can be checked with NRTL, NRTL with a Peng–Robinson
vapour, and Peng–Robinson alone, side by side, against the data.

Every calculation is a deterministic numerical method in the code (sections 5 and 6),
validated against independent software and measured data. No AI model takes part in
any calculation; parameters are fitted by least squares (scipy) to experimental data,
with the fitting scripts in `validation/python/`.

### 2. New methods on every system

```js
pp.dewT(y, P)  /  pp.dewP(y, T)        // now also for NRTL, UNIQUAC, ideal

pp.phase("liquid", T, P, x)            // one phase at T, P, composition
// -> { h_J_mol, lnFugacity: [...], gamma: [...] (activity models), Z (equations of state),
//      warnings: [...] }

pp.enthalpy("vapour", T, P, y)         // J/mol, shortcut for phase(...).h_J_mol

pp.flash({ z, T, P })                  // isothermal flash
pp.flash({ z, P, H })                  // adiabatic flash: valve, mixer, given enthalpy (J/mol)
pp.flash({ z, P, VF })                 // given vapour fraction 0..1 (bubble at 0, dew at 1)
pp.flash({ z, T, VF })
```

A flash with a heat duty (a heater or a cooled drum) is the `P, H` flash with
H = H_feed + Q / F; the heater unit (roadmap A6) will do that sum.

### 3. The flash result

```js
pp.flash({ z: [0.3, 0.5, 0.2], T: 345, P: 101.325 })
// {                                                         (shape only; no real numbers)
//   T: 345, P: 101.325, VF: ..., H_J_mol: ...,             // VF: vapour mole fraction of the feed
//   phases: [
//     { type: "vapour",  fraction: ..., composition: [...], h_J_mol: ... },
//     { type: "liquid",  fraction: ..., composition: [...], h_J_mol: ... }
//   ],
//   spec: "TP", iterations: ...,
//   warnings: [ ... ],                                     // e.g. a parameter set used outside its data range
//   sources: [ ... ]                                        // every parameter set used
// }
```

- `phases` lists only the phases present: one, two, or three (vapour + two liquids).
- A single phase is reported as `"liquid"` or `"vapour"`; above the critical point of an
  equation-of-state mixture as `"supercritical"`.
- The mass balance closes to 1e-10 in every result; the test suite checks it.

### 4. Enthalpy

Reference state for every component: **ideal gas at 298.15 K**, h = 0, as in proposal
0002. For chemical reactions (roadmap A13) the heats
of formation will be added to this reference; differences between states do not change.

- **Vapour, activity models:** the vapour model chosen for the phase equilibrium. Ideal
  gas: h_V = Σ y_i h_IG,i(T). PR or SRK: h_V = Σ y_i h_IG,i(T) + h_R(T, P, y).
- **Liquid, activity models:** h_L = Σ x_i [h_IG,i(T) + h_R,i^sat(T) − ΔH_vap,i(T)] + h^E(T, x),
  with h_R,i^sat the residual enthalpy of the saturated pure vapour from the chosen vapour
  model (zero for the ideal gas), and the excess enthalpy from the activity model,
  h^E = −R T² Σ x_i (∂ ln γ_i / ∂T)_x. Then a pure component boils with exactly its heat
  of vaporization, whichever vapour model is chosen. (With a PR vapour this is the liquid
  enthalpy of `pure()` today.) The pressure effect on the liquid is neglected; the tests
  state its size.
- **Equations of state, both phases:** h = Σ z_i h_IG,i(T) + h_R(T, P, z), the residual
  enthalpy from the cubic equation (already used for pure components).
- **Water** takes its ideal-gas enthalpy and heat of vaporization from IAPWS-IF97.
- **Acetic acid** (vapour dimerization): isothermal and vapour-fraction flashes work;
  any enthalpy result throws a clear error until the association enthalpy is modelled
  (as `pure()` does today).

Excess enthalpy from NRTL or UNIQUAC parameters fitted only to vapour-liquid data can be
poor. Where open excess-enthalpy data exist for a pair, the engineering report shows the
deviation, so nobody mistakes it for a validated number.

### 5. Solver rules (roadmap A4)

The same rules for bubble, dew and every flash:

- **Converge or throw.** A solver that does not converge throws a `FugacityError` with a
  `code` (`NO_CONVERGENCE`, `OUT_OF_RANGE`, `MISSING_DATA`, `BAD_INPUT`), a message an
  engineer understands (for example "PH flash: the enthalpy given needs a temperature
  above the range of the heat-capacity data of ethyl acetate"), and the last iterate.
- **Warnings, not errors,** for results that are computed correctly but rest on weaker
  ground: parameters used outside their data range, a predicted liquid split, a missing
  pair treated as ideal.
- **Tolerances:** phase equilibrium |ln f_i^α − ln f_i^β| < 1e-9; mass balance 1e-10;
  temperature in an enthalpy flash 1e-6 K. Inputs are checked first (compositions sum
  to 1 within 1e-9, positive T and P, the spec pair is one of those above).
- **Speed budget:** under 5 ms for a two-phase flash of up to 5 components in a browser,
  so that flowsheets with recycles stay interactive.

### 6. How the flash works

Standard, openly documented methods:

1. **Stability test first.** Is the feed stable as one phase at T, P? Tangent-plane
   distance (Michelsen), already implemented for equations of state; added for activity
   models with liquid and vapour trial phases.
2. **Two-phase split.** Successive substitution on the K-values with the Rachford–Rice
   equation (Leibovici–Neoschil bracketing), switching to a Newton step on the Gibbs
   energy when substitution is slow, near critical points.
3. **Third phase.** If a phase of the two-phase result is itself unstable, a
   three-phase split (vapour + two liquids): the water + ethyl acetate and
   ethanol + water + ethyl acetate systems need this.
4. **Enthalpy and vapour-fraction specs:** an outer loop on temperature (or pressure),
   bracketed by the bubble and dew points, with safeguarded Newton steps.

## Engineering basis

References (all open):

- Rachford–Rice and Leibovici–Neoschil: the open-source `chemicals` library,
  module `chemicals.rachford_rice`, documentation and code (MIT).
- Stability and flash algorithms: Michelsen (1982), as already cited in
  `src/equilibrium/eos-stability.js`, with its open descriptions (Penn State PNG 520
  course notes, CC BY-NC-SA 4.0; `thermo` documentation, MIT).
- Excess enthalpy from the activity model (Gibbs–Helmholtz):
  `thermo` documentation, `GibbsExcess.HE` (MIT).
- Residual enthalpy of cubic equations of state: as cited in `src/thermo/eos/cubic.js`.

Validation (the tests compare against independent calculations and data, never against
Fugacity's own earlier output):

| Check | Reference | Tolerance |
|---|---|---|
| TP, PH and VF flashes, NRTL and UNIQUAC, 2 and 3 components | `thermo` `FlashVL` with the same parameters (Python script in `validation/python/`) | T 0.01 K, phase fractions 1e-4, compositions 1e-5, h 1 J/mol |
| The same with a Peng–Robinson and an SRK vapour (φ, φ^sat, Poynting) | `thermo` `FlashVL` with a cubic gas phase and the same corrections | as above |
| TP and PH flashes, Peng–Robinson and SRK, gas mixtures | `thermo` and CoolProp with the same k_ij | as above |
| Flash at the bubble and dew points | Fugacity's bubble and dew solvers, which are already validated against data | VF = 0 and 1 within 1e-8 |
| Round trip: TP flash → H → PH flash | itself | T within 1e-6 K |
| Pure water PH flash at 1 atm and 10 bar | IAPWS-IF97 (`validation/data/iapws`) | T 0.01 K; with an ideal-gas vapour the enthalpy deviation must equal the residual enthalpy of saturated steam (from IF97) within 1 J/mol; with PR or SRK it is reported |
| Liquid-liquid split, water + ethyl acetate | the three open LLE data sets already in `validation/data/` | report the deviation; no tolerance tuned to pass |
| Excess enthalpy | open h^E data where they exist (ThermoML Archive); "no open data" listed otherwise | report the deviation |

The engineering report gains flash cases, so every pull request shows whether a flash
result moved.

## Effect on existing work

- Nothing is removed. `createSystem`, `system`, `bubbleT`, `bubbleP`, the diagrams,
  `mount`, `mountProperties` and `app` keep their behaviour and results.
- New methods and one new option: `vapour` for activity models (default `"ideal"`, as
  today), `dewT` and `dewP` for activity models, `phase`, `enthalpy`, `flash`.
- Solver errors become `FugacityError` objects. They are still `Error`s with the same
  messages, so existing pages that show `e.message` keep working.
- The workbench gains a **Flash** workspace (feed, specification, model, result table
  with phases and sources) in a later step.
- Bundle size grows by the flash code only, a few kilobytes.

## Alternatives considered

- **A separate `Fugacity.propertyPackage()` object** (the first draft of this proposal):
  rejected, because `system()` already holds components, model and parameter sources;
  two names for the same thing would confuse users and AI assistants.
- **Flash only for equations of state** (simpler, one model for both phases): rejected;
  most of the systems people ask for (alcohols, water, esters) need activity models.
- **Ideal-gas vapour only for activity models** (the first version of this proposal):
  rejected by the maintainer; the vapour model must be a choice, so that moderate
  pressures and non-ideal vapours are covered and models can be compared.
- **Gibbs-energy minimization for every flash:** more general, but slower and harder to
  check by hand. Kept for later, for reactive and multiphase cases.

## Steps

Each step is one pull request with its tests and an updated engineering report.

1. **Solver rules and dew points:** `FugacityError`, input checks, `dewT`/`dewP` for
   activity models, validated against `thermo`.
2. **Vapour model choice for activity models:** `vapour: "PR" | "SRK"` with φ, φ^sat and
   the Poynting correction in bubble, dew and the diagrams; validated against `thermo`.
3. **Mixture enthalpy:** `phase()` and `enthalpy()` for all models; h^E from NRTL and
   UNIQUAC; tests against `thermo` and open h^E data.
4. **Two-phase flash:** TP, PH, P-VF and T-VF, for all models; stability test for
   activity models; tests from the table above.
5. **Three-phase flash** (vapour + two liquids) and liquid-liquid tests against the open
   LLE data.
6. **Flash workspace** in the workbench, with CSV export of the result (roadmap B1).

Later: with streams (A5), flowrates, the stream object, and the P-S flash with entropy for
compressors and turbines; equations of state with activity-model mixing rules (for
example Wong–Sandler with NRTL) for polar mixtures at high pressure.
