# 0002: Pure-component properties, gases and the Peng–Robinson equation of state

- **Status:** Draft
- **Author(s):** Fugacity maintainers
- **Discussion:** this pull request
- **Roadmap item:** A1 (property package), D4 (heat capacity and heat of vaporization), Later: equations of state; v0.2

## Problem

Fugacity knows only what vapour-liquid equilibrium needs: vapour pressure and activity
coefficients for ten liquids. Engineers also need pure-component properties (density,
heat capacity, enthalpy, heat of vaporization, viscosity, thermal conductivity) at
different temperatures and pressures, steam tables for water, and common gases
(oxygen, nitrogen, hydrogen, methane, ethane, ethylene). Gases and gas mixtures cannot be
described by activity models; they need an equation of state. Energy balances, and
later every unit operation with a duty, need enthalpy.

## Proposal

### 1. Components

The ten current components plus **oxygen, nitrogen, hydrogen, methane, ethane and
ethylene** (16 in total).

### 2. Properties

For every component, as far as open data allows:

| Property | Symbol | Unit (engine) | Depends on |
|---|---|---|---|
| Vapour pressure; boiling point at any pressure | Psat, Tsat | kPa, K | T or P |
| Liquid density (saturated) | rhoL | kg/m³ | T |
| Vapour density | rhoV | kg/m³ | T, P (equation of state) |
| Ideal-gas heat capacity | cpIG | J/(mol·K) | T |
| Liquid heat capacity | cpL | J/(mol·K) | T |
| Heat of vaporization | dHvap | J/mol | T |
| Enthalpy, liquid and vapour | h | J/mol, reference: ideal gas at 298.15 K | T, P |
| Liquid and vapour viscosity | muL, muV | Pa·s | T (vapour: low pressure) |
| Liquid and vapour thermal conductivity | kL, kV | W/(m·K) | T (vapour: low pressure) |
| Critical constants, acentric factor | Tc, Pc, omega | K, kPa, – | – |

**Water** is computed with the IAPWS standards instead of correlations: IAPWS-IF97 for
thermodynamic properties in all regions (liquid, steam, supercritical), and the IAPWS
releases for viscosity and thermal conductivity. Both publish verification values, which
become exact tests.

**Pressure dependence:** liquid properties are taken at saturation (pressure effect
neglected below about 10 MPa, stated in the interface); vapour density and enthalpy
include non-ideality through the Peng–Robinson equation of state; water uses IAPWS-IF97
at every T and P.

### 3. Peng–Robinson and SRK equations of state

- Peng–Robinson (1976) and Soave–Redlich–Kwong (1972) with van der Waals one-fluid mixing
  rules and binary parameters `k_ij`.
- `k_ij` from the ChemSep set (Artistic License 2.0): 21 pairs among the 16 components,
  for example methane–nitrogen, hydrogen–ethane, nitrogen–oxygen, methanol–water.
  Missing pairs use `k_ij = 0` and are labelled as such in the interface.
- Fugacity coefficients, compressibility factor, residual enthalpy; φ-φ phase equilibrium
  (bubble and dew points) for gas and hydrocarbon systems; selectable as `model: "PR"` or
  `"SRK"`.
- **Henry's law** for the six gases in water (ChemSep Henry constants), for gas solubility
  in liquids.

### 4. Where the numbers come from: the source chain

For every property of every component, the agent or contributor tries open sources in
this order and records which one was used:

1. **Official standards** with published equations (IAPWS for water).
2. **CoolProp** (open source; reference-quality equations from the cited literature):
   covers water, methanol, ethanol, acetone, benzene, toluene and the six gases.
3. **NIST Chemistry WebBook.**
4. **Open libraries** with documented sources (thermo, chemicals).
5. **NIST TRC ThermoML Archive** and **open-access articles**.
6. **Free books**: books whose full text anyone can read for free and legally, because
   they are in the public domain (for example on the Internet Archive or HathiTrust) or
   openly licensed textbooks.

If none has the property, it is marked **"no open data"** with the list of sources
searched, and the interface says so. Nothing is estimated silently. Values from old
sources are labelled with their year, so reviewers can judge them.

Correlation coefficients are **fitted by Fugacity** to the chosen source over a stated
temperature range, using the DIPPR equation forms (100, 101, 102, 105, 106, 107). Each
record states the source, the fit range, and the maximum deviation from the source.

### 5. Data format

Each component in `src/data/components.json` gains a `properties` object; each property
is one record:

```json
"liquidDensity": {
  "equation": "DIPPR105",
  "coefficients": { "A": 0.0, "B": 0.0, "C": 0.0, "D": 0.0 },
  "units": "kg/m3",
  "Tmin_K": 250, "Tmax_K": 500,
  "tier": "fitted",
  "source": {
    "name": "CoolProp 8.0.0 (equation of state of ...)",
    "reference": "Authors, journal volume (year) pages",
    "access": "open source, MIT; equations from the cited literature",
    "fit": "120 points, max deviation 0.08 %"
  }
}
```

A property with no open data:

```json
"liquidViscosity": { "available": false, "searched": ["CoolProp", "NIST WebBook", "ThermoML Archive"] }
```

Tiers: `standard` (official standard such as IAPWS), `fitted` (fitted to a cited open
source), `databank` (taken from an openly licensed databank), `predicted` (estimation
method, labelled as such in the interface).

### 6. Programming interface

```js
const w = Fugacity.pure("water");
w.psat(373.15)              // kPa
w.tsat(101.325)             // K
w.props(373.15, 101.325)    // { phase, rho, h, cp, mu, k, ... } with units and sources
Fugacity.steam(T_K, P_kPa)  // IAPWS-IF97 directly
Fugacity.system({ components: ["methane", "nitrogen"], model: "PR" })
```

### 7. Property explorer

`Fugacity.mountProperties("#app", { component: "water" })`: choose a component and a
property; curve against temperature, for several pressures where the property depends on
pressure; a steam-table style table; units switch (°C/K, bar/kPa, kg/m³, ...); the source
and tier of every curve shown under it.

### 8. Engineering report on every pull request

A workflow computes a fixed set of engineering results (boiling points, densities, heat
capacities, viscosities at standard points; azeotropes; selected T-x-y diagrams; steam
table points) for the pull request and for `main`, compares both with the reference
values, and posts a comment:

- a table of what changed, in engineering units, with the deviation from the reference
  and ✅ / ⚠️ against a tolerance per property;
- a link to the full report with plots.

Reviewers approve on the engineering results; they do not need to read code.

### 9. Rule change: free books

The open-sources rule in `CONTRIBUTING.md` and `AGENTS.md` is extended to free books as
described in section 4.

## Engineering basis

- IAPWS-IF97 and the IAPWS transport releases, with their verification tables.
- Peng & Robinson, Ind. Eng. Chem. Fundam. 15 (1976) 59; Soave, Chem. Eng. Sci. 27 (1972)
  1197; mixing rules as in standard textbooks; independent comparison with CoolProp's
  cubic equations and the thermo library.
- Correlation fits: every record states its maximum deviation from its source; tests check
  the stored coefficients reproduce the source within that deviation at random points.
- Tolerances for the engineering report: vapour pressure 1 %, liquid density 1 %, heat
  capacity 2 %, heat of vaporization 2 %, viscosity 5 %, thermal conductivity 5 %;
  IAPWS-IF97 to its verification values within 1e-8 relative.

## Effect on existing work

- Existing components keep their current vapour-pressure records; the new `properties`
  object is added beside them. Existing pages and tests are unchanged.
- The bundle grows; data for all 16 components is expected to stay under about 100 KB.
- `createSystem` and `mount` keep working; `model: "PR"` and `"SRK"` are new options.

## Alternatives considered

- Copying DIPPR coefficients: rejected, not openly licensed.
- Using CoolProp directly in the page: rejected, too large for an artifact (several MB of
  WebAssembly); we fit compact correlations instead and use CoolProp only as a reference.

## Steps (parallel work, one pull request each)

1. Steam tables: IAPWS-IF97, viscosity and thermal conductivity, with verification tests.
2. Pure-component data for 16 components, following the source chain; gap list.
3. Peng–Robinson and SRK with `k_ij`; Henry's law; φ-φ bubble and dew points.
4. Property explorer view.
5. Engineering report workflow and independent validation of steps 1–3.
6. Rule change for free books; documentation and skills updated; release v0.2.0.
