# Equilibrium algorithms (layer 2)

How Fugacity finds the phases. Every algorithm here takes a system from
[thermodynamics.md](thermodynamics.md) and gets its numbers only by asking that system:

- activity coefficients;
- K-values;
- fugacity coefficients;
- enthalpies.

The algorithms never read the parameters (NRTL a, b and α, or the k_ij) and never repeat a
model's equations. They do check which family the system belongs to, activity model or
equation of state, because the two need different steps. For example, an equation of state
uses Michelsen's stability test and has no two-liquid flash yet. So a fix to NRTL, or a new
parameter set, needs no change here, and a new activity model works with these algorithms once
it answers the same questions. Each file's header comment
states its method and open references; this page maps them. Errors carry codes
([src/util/errors.js](../../src/util/errors.js)): a solver that does not converge throws and says
why, and never returns a wrong answer silently.

## Bubble and dew points

| Models | Bubble | Dew | Method |
|---|---|---|---|
| NRTL, UNIQUAC, ideal | [bubble.js](../../src/equilibrium/bubble.js) | [dew.js](../../src/equilibrium/dew.js) | Gamma-phi. The dew point by successive substitution on the liquid; at fixed P, Brent's method on T. Several solutions are possible with partial miscibility: unstable liquids are discarded and the lowest-pressure solution is kept. |
| PR, SRK | [phi-phi.js](../../src/equilibrium/phi-phi.js) | same | Wilson K-values as the start. A Newton step on ln P or T, with successive substitution on the incipient phase. Near the critical region, a scan and Brent's method. Michelsen's test on the liquid. |
| any | [bubble-any.js](../../src/equilibrium/bubble-any.js) | | Picks the right solver, so every diagram works with every model. |

Independent checks:
- thermo's `FlashVL`, in [validation/python/reference_dew.py](../../validation/python/reference_dew.py) and
  [reference_eos.py](../../validation/python/reference_eos.py).

## Flash

[`flash.js`](../../src/equilibrium/flash.js): `sys.flash({ z, T, P })`, `{ z, P, H }`, `{ z, P, VF }` and
`{ z, T, VF }`, with the optional heat duty.

- **Rachford–Rice:** Newton steps kept inside the bracket, with bisection as a fallback.
- **K-values:**
  - activity models: K_i = γ_i P_i^sat φ_i^sat Poynting_i / (φ_i^V P);
  - equations of state: K_i = φ_i^L / φ_i^V, started from Wilson's K-values.
- **Which phases exist:**
  - activity models: the feed's bubble and dew pressures, plus tangent-plane checks;
  - equations of state: Michelsen's test on the feed.
  - Every liquid returned is tested against a second liquid.
- **Two liquids and vapour + two liquids:** activity models only.
  - Liquid-liquid by successive substitution.
  - Three phases by the phase-fraction function of Okuno, Johns and Sepehrnoori, then Newton.
  - Refused with PHASE_SPLIT: two liquids with an equation of state or with the acid chemical
    theory, and a third liquid. This follows the selection rules: a plain cubic equation is not
    used where a second liquid forms.
- **Enthalpy and vapour-fraction specifications:** Brent's method on T (or ln P), bracketed by the
  bubble and dew points.
- **Equations of state, convergence:**
  - on main today: successive substitution with GDEM acceleration (Crowe and Nishio 1975) when it
    is slow; a P-H flash that fails is retried from another start.
  - **pull request #86 (open)** replaces this:
    - Newton's method on ln K after ten substitution steps (the formulation of thermo's
      `nonlin_2P_newton`);
    - a P-H search that starts from the bubble point only when that liquid passes the stability
      test, so the retry is no longer needed;
    - enthalpy memoized within a search, so the tolerance workaround is no longer needed.
  - Its check: `validation/python/reference_flash_hard.py`
    covers hard cases near the critical region and the cricondenbar.
- **Tests:** [test/flash.test.js](../../test/flash.test.js), [test/three-phase.test.js](../../test/three-phase.test.js).

## Phase stability

- **Activity models** ([stability.js](../../src/equilibrium/stability.js)):
  - local stability: the Hessian of the Gibbs energy of mixing (the spinodal);
  - in flash.js, tangent-plane tests against a second liquid.
- **Equations of state** ([eos-stability.js](../../src/equilibrium/eos-stability.js)): Michelsen's
  tangent-plane-distance test (Fluid Phase Equilib. 9 (1982) 1), with near-pure and Wilson trial
  phases.

## Diagrams, azeotropes and residue curves

- **Diagrams** ([diagrams.js](../../src/equilibrium/diagrams.js)): T-x-y, P-x-y and the ternary
  bubble-temperature grid, for any model.
- **Azeotropes** ([azeotrope.js](../../src/equilibrium/azeotrope.js)): solves y = x by damped Newton.
- **Residue curves** ([residue.js](../../src/equilibrium/residue.js)): dx/dξ = x − y, integrated in
  both directions.

## Solids: solid-liquid equilibrium

[`sle.js`](../../src/equilibrium/sle.js) (proposal 0007):

- **Model:** a pure solid in equilibrium with the solution, using the equation of Gmehling et al.
  (2012) as implemented in `chemicals.solubility_eutectic`.
- **Results:** solubility, the liquidus and the eutectic.
- **Check reports:**
  - the ideal solution against measured data: [../SLE_CHECKS.md](../SLE_CHECKS.md);
  - NRTL fitted to solubilities: [../SLE_FITS.md](../SLE_FITS.md).

## Checks against measured and reference data

- Every test compares the engine with an independent calculation (`validation/python/`) or with open
  measured data (`validation/data/`). The tests choose their property method by
  [../METHOD_SELECTION.md](../METHOD_SELECTION.md).
- Known deviations are recorded in [src/data/known-issues.json](../../src/data/known-issues.json).
