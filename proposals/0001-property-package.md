# 0001: Property package interface

- **Status:** Draft
- **Author(s):** Fugacity maintainers
- **Discussion:** to be opened
- **Roadmap item:** Architecture track, step A1

## Problem

Layers above the thermodynamics (flash, streams, unit operations) need activity
coefficients, K-values and enthalpies without knowing which model is in use. Today
`createSystem` provides activity coefficients and vapour pressures but no enthalpy, and
its shape grew by accident. Energy balances, and therefore every unit with a duty, are
impossible without enthalpy.

## Proposal

```js
const pkg = Fugacity.propertyPackage({
  components: ["water", "ethanol"],
  liquid: "NRTL",            // NRTL | UNIQUAC | UNIFAC-Dortmund | ideal
  vapour: "ideal",           // ideal | chemical-theory; later PR, SRK
  fallback: "UNIFAC-Dortmund"
});

pkg.components               // [{ id, name, MW, ... }]
pkg.gammas(x, T)             // activity coefficients
pkg.psat(T)                  // kPa
pkg.kValues(T, P, x, y)      // y_i / x_i at equilibrium
pkg.enthalpy("liquid", T, P, x)   // J/mol, reference: ideal gas at 298.15 K
pkg.enthalpy("vapour", T, P, y)
pkg.pairInfo()               // [{ pair, tier, source }]
```

Liquid enthalpy: ideal-gas enthalpy minus heat of vaporization (Watson correlation from
the normal boiling point) plus excess enthalpy from the activity model.
Vapour enthalpy: ideal-gas heat capacity integral; association enthalpy for dimerizing acids.

## Engineering basis

To be completed: data sources for ideal-gas Cp and heat of vaporization (open), validation
against NIST WebBook enthalpies of vaporization and against the Schmid (2007) excess
enthalpies already in `validation/data/`.

## Effect on existing work

`createSystem` stays as an alias. Existing pages and tests keep working.

## Alternatives considered

Keeping separate functions per model (rejected: every unit operation would need to know
the model).

## Steps

1. Pure-component data: ideal-gas Cp and heat of vaporization for the ten components, with tests.
2. `propertyPackage` with `gammas`, `psat`, `kValues`, `pairInfo`; `createSystem` as alias.
3. Enthalpy, with tests against open data.
