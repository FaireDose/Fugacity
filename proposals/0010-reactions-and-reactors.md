# 0010: Reactions and reactors: one reaction description, five reactor blocks

- **Status:** Draft
- **Author(s):** CHEPTA maintainers (drafted with an AI assistant)
- **Discussion:** this pull request
- **Roadmap item:** core track A13 (reactions), data track D8 (formation data of the
  components), release v0.6
  (reactors and reactive systems in flowsheets); used by tracks E (cost) and G (agents)

## Problem

CHEPTA's flowsheets only separate and mix: every block conserves each component. A process
changes molecules: esterification, hydrogenation, dehydration, fermentation, methanol from CO₂.
Without reactions, a flowsheet can't show conversion, selectivity, recycle of unreacted feed,
or heat of reaction. Track G, where agents turn literature routes into flowsheets, has nothing
to build on.

Four things are missing:

1. **A reaction description** in which the user writes their own reactions (as in desktop
   simulators: they ship components, not reactions): stoichiometry, phase, equilibrium constant
   and rate law. Every reactor and the agents of proposal 0011 read the same format.
2. **Formation properties** of the components (ΔfH° and ΔfG°). Today every component's enthalpy
   is 0 for the ideal gas at 298.15 K (src/thermo/enthalpy.js), which is fine for separations
   but hides the heat of reaction.
3. **Reactor blocks** of increasing detail. An engineer starts with "90 % conversion" and moves
   to equilibrium or kinetics when the data exist.
4. **Rates the user writes**: a rate law from a paper, entered without code. The workbench also
   runs inside AI chat pages, where project files come from other people, so this must be safe.

## Proposal

### 1. Reaction description (A13, `src/reactions/`)

**Reactions are the user's, not CHEPTA's.** CHEPTA ships components and their data
(including the formation properties below); it ships **no reaction library**. The user defines
the reactions of their process in the project or flowsheet file, on the Reactions page or by
hand, the way desktop simulators do it. What CHEPTA adds is the checking: element balance,
K(T) from the components' formation data, units, ranges, and a clear error when something does
not fit.

One JSON object per reaction, in the project or flowsheet file:

```json
{
  "id": "esterification",
  "name": "Acetic acid + ethanol ⇌ ethyl acetate + water",
  "stoichiometry": { "acetic-acid": -1, "ethanol": -1, "ethyl-acetate": 1, "water": 1 },
  "phase": "liquid",
  "reversible": true,
  "equilibrium": { "from": "formation" },
  "rate": {
    "form": "power-law",
    "basis": "activity",
    "forward":  { "k0": 0.0, "Ea_J_mol": 0.0, "orders": { "acetic-acid": 1, "ethanol": 1 } },
    "reverse":  "from-equilibrium",
    "per": "catalyst-mass",
    "units": "mol/(kg_cat s)",
    "source": "optional: where the user took the rate law from"
  }
}
```

(The zeros are placeholders of the format, not data; the user enters the values.)

- **Stoichiometry** is checked against the element formulas of the components (from
  components.json): a reaction that doesn't balance C, H, O, N, S, … is refused with the
  imbalance named. Biological "schematic" reactions (the attached map marks them **S**) are
  not reactions in this sense; they use the yield reactor below.
- **Equilibrium:** `{ "from": "formation" }` computes K(T) from the components' formation
  properties: ln K = −ΔrG°(T)/RT, with ΔrG°(T) from ΔfG°(298.15 K) and ΔfH°(298.15 K) and the
  ideal-gas heat capacities already in the databank (Gibbs–Helmholtz integration). Or a cited
  correlation `{ "lnK": { "A": …, "B": …, "C": … }, "T_K": [lo, hi], "source": … }`. The standard
  state (ideal gas at 1 bar, or pure liquid) is stated and checked against `phase`.
- **Rate forms:** `power-law` (irreversible or reversible), `LHHW` (Langmuir–Hinshelwood–
  Hougen–Watson: kinetic, driving-force and adsorption groups) and `expression` (user-written,
  below). Basis: concentration, mole fraction, activity, or partial pressure / fugacity. The
  reverse rate may be `from-equilibrium`, so the kinetics and K stay consistent. Rates per
  reactor volume or per catalyst mass.
- **Sources:** the user's own numbers (k0, Ea, orders, a K correlation, a conversion) are the
  user's responsibility. Each reaction has an optional `source` field, which the results and
  exports show next to the numbers, so a reader can see where a rate law came from. CHEPTA's
  open-source rules (AGENTS.md rule 1) apply to what CHEPTA ships, the component data, not to
  what a user types into their own project.

### 2. Formation properties (D8)

New pure-component constants: `Hf_ig_J_mol` and `Gf_ig_J_mol` (ideal gas, 298.15 K, 1 bar), each
with a source and a tier, in the order of AGENTS.md rule 1:

1. **Active Thermochemical Tables** (ATcT, Argonne, https://atct.anl.gov/; free to read): the
   reference for small molecules;
2. **NIST Chemistry WebBook**, gas-phase thermochemistry (ΔfH°gas and S°gas, so ΔfG° can be
   computed from the element entropies, both stated);
3. the **ChemSep** databank (Artistic License 2.0), which carries heats and Gibbs energies of
   formation for its compounds;
4. otherwise "no open data", and reactions with that component can only use cited K
   correlations or conversion/yield reactors.

A scan, like `scan_components.py`, reports per component which source has the values; a check
compares ATcT, WebBook and ChemSep where two of them have the number (tolerance 1 kJ/mol, as an
engineering-report row).

The enthalpy reference does not change for existing results: `H_kW` keeps the ideal gas at
298.15 K = 0 for every component. Streams gain `Hf_kW`, the enthalpy flow on the formation basis
(elements at 298.15 K), and a reactor's duty is computed on that basis, so the heat of reaction
comes out of the balance and is never typed in. A flowsheet without reactors gives the same
numbers as today.

### 3. Reactor blocks (`src/units/`, through the A6 interface)

| Block | Specifications | What it does | Needs |
|---|---|---|---|
| **Conversion** | reactions, each with the conversion of a key component (0–1); parallel or in series; outlet T and P, or duty | extents from the conversions, outlet flashed | stoichiometry |
| **Yield** | product distribution per unit of a key reactant (mass or mole basis), with an element-balance check and a stated closure (e.g. "biomass" or "unidentified") | fermentation, pyrolysis, black boxes from papers | element formulas |
| **Equilibrium** | reactions, outlet T and P (or duty), optional approach to equilibrium (ΔT or fraction of the extent) | solves Σ ν ln a = ln K for the extents, with activities from the property package (fugacities for EOS, γx for activity models) | K(T) |
| **Gibbs** | species allowed, T and P (or duty) | minimizes the total Gibbs energy with element balances (no reactions listed); the method of open equilibrium codes | ΔfG° of every species |
| **CSTR / plug flow** | reactions with rates, volume or catalyst mass, T or duty (isothermal or adiabatic), P, number of phases | CSTR: algebraic balance solved by Newton; PFR: the ODEs integrated by a stiff, error-controlled method along the length | rates |

All of them:

- close the **element** balance to 1e-9 relative (the component balance no longer holds), and
  report extents, conversions, selectivities and the duty;
- **fail loudly**: an equilibrium solve that doesn't converge, a PFR integration that runs into a
  negative concentration, or a rate expression that gives NaN throws an error that names the
  reaction, the point, and what usually helps;
- warn when T is outside a rate law's or K correlation's stated range (like k_ij ranges today);
- work in flowsheets with recycles: a reactor is just another block for the solver. A reactor in
  a recycle loop with a purge is the classic case; the flowsheet suite (docs/FLOWSHEET_TESTS.md)
  gains reactive cases.

### 4. User-written rates without `eval`

`{ "form": "expression", "rate": "k1 * a['acetic-acid'] * a['ethanol'] - k1 / K * a['ethyl-acetate'] * a['water']", "k1": { "k0": …, "Ea_J_mol": … } }`

The expression is parsed by a small parser in `src/reactions/expression.js` (numbers, + − × ÷ ^,
parentheses, `exp`, `ln`, `log10`, `sqrt`, `min`, `max`, and named variables only: T, P, C[i],
x[i], p[i], f[i], a[i], K, the user's own constants). The browser's `eval` and `Function` are
never used: project files come from other people and from AI chats, and a formula must not be
able to run code. The parser reports the position of an error ("unknown name 'conc' at
character 12; known: C, x, p, f, a, T, P, K").

### 5. Views

- A **Reactions** page in the flowsheet's Setup group (after Components and Method): a reaction
  table with stoichiometry chips, balance check (✓ C H O), ΔrH°(298 K) and K(298 K) where
  formation data exist (computed from the components, so the user sees at once whether a
  reaction is exothermic and how far it can go), and the source the user gave.
- Reactor blocks in the Blocks group (the **Reactor** button is already there as "Coming
  later").
- In the stream table: extents and conversions per reactor; a Q-stream for the duty, as for
  heaters.
- Reactions can be copied between projects (export and import of the reaction list), but there
  is no shipped reaction catalogue.

## Engineering basis

- **Reaction equilibrium and K(T):** DeVoe, *Thermodynamics and Chemistry*, 2nd ed., free PDF
  from the author (https://www2.chem.umd.edu/thermobook/), chapters on reaction equilibria;
  Rawlings and Ekerdt, *Chemical Reactor Analysis and Design Fundamentals*, 2nd ed., 6th
  printing, full text free from the authors
  (https://sites.engineering.ucsb.edu/~jbraw/chemreacfun/), chapters on reaction equilibrium,
  rate laws, CSTR and plug-flow reactors (worked examples with published answers).
- **Gibbs minimization:** the element-potential method as described in the same references;
  Cantera (https://cantera.org/, open source, 3-clause BSD) as the independent implementation.
- **Validation** (each step's tests):
  - formation data: ATcT vs WebBook vs ChemSep, with the tolerance above;
  - K(T) and equilibrium compositions of ideal-gas reactions (methanol from CO₂ and H₂ with the
    reverse water-gas shift; ethanol dehydration to ethylene) against Cantera with the same
    formation data and heat capacities (tolerance 1e-6 relative in K, 1e-5 in mole fractions);
  - liquid-phase equilibrium with activities (esterification) against an independent Python
    implementation with the reference NRTL of validation/python/reference_model.py;
  - CSTR and PFR against scipy (`solve_ivp`, method Radau) and the worked examples of
    Rawlings and Ekerdt (tolerance: the printed digits);
  - element balance of every reactor test to 1e-9;
  - a reactive recycle flowsheet (reactor, flash, recycle, purge) in the flowsheet suite, against
    the equation-oriented reference extended with the reactor.

## Effect on existing work

- Streams gain `Hf_kW`; `H_kW` keeps its meaning, so existing results and tests don't change.
- `components.json` gains the formation constants. A component without them can still be used
  in conversion and yield reactors.
- The flowsheet file format (A7) gains a `reactions` list. Old files have none, so they keep
  working.
- No new data file for reactions: they live in the user's project and flowsheet files.

## Alternatives considered

- **Only conversion reactors.** Quick, but they can't answer "how far can it go", which needs
  equilibrium, or "how big is the reactor", which needs kinetics. Kept as the first step, not as
  the end.
- **A shipped reaction library.** Rejected: simulators ship components, not reactions; a
  reaction's rate law and conditions belong to a particular process and catalyst, and the user
  (or the agent of proposal 0011, from a cited paper, for the user to accept) chooses them.
- **Heat of reaction typed per reaction.** Simple, but it would disagree with the enthalpies of
  the property package at other temperatures. Formation properties keep one consistent energy
  balance.
- **JavaScript `eval` for user rates.** Rejected: unsafe for files that are shared.
- **Bundling Cantera (WebAssembly).** Large, and its species data are a separate source chain.
  Cantera stays the independent check in validation/python/, not a runtime dependency.

## Steps

1. **Formation data (D8):** scan the sources, add `Hf_ig_J_mol` and `Gf_ig_J_mol` with sources for
   the components that have open values; cross-check rows in the engineering report. Test:
   source agreement.
2. **Reaction description and checks:** `src/reactions/`, element balance, K(T) from formation
   data, the expression parser. Tests: balances, K(T) vs Cantera, parser errors.
3. **Conversion and yield reactors** in flowsheets, with `Hf_kW` and the duty. Test: element
   and energy balances against hand calculations; a reactive recycle in the flowsheet suite.
4. **Equilibrium reactor** (listed reactions), gas and liquid. Tests: Cantera (gas), Python
   reference (liquid with NRTL).
5. **CSTR and plug flow** with power-law and LHHW rates. Tests: scipy and the Rawlings and
   Ekerdt examples.
6. **Gibbs reactor.** Test: Cantera.
7. **Reactions page and reactor views**, export and import of reaction lists, Excel export of conversion reactors
   (the concept model of the Excel export: extents as formulas).
8. **Tests with reactions:** methanol from CO₂ (equilibrium), ethyl acetate esterification
   (equilibrium and kinetics from an open article), ethanol to ethylene (conversion with side
   reactions), defined in the test files with their sources and documented in docs/BENCHMARKS.md
   as worked examples a user can copy; not shipped as a library.
