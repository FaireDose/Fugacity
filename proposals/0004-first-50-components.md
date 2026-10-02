# 0004: The first 50 components, chosen by process

- **Status:** Accepted (by the lead maintainer, 2026-10-02)
- **Author(s):** Fugacity maintainers (drafted with an AI assistant)
- **Discussion:** this pull request
- **Roadmap item:** data track D5 (about 50 components), with D2 (pairs fitted to open data)

## Problem

Fugacity has 16 components. That is enough to show the method, but too few for real
process work: most questions an engineer brings involve at least one chemical that is not
there.

Adding components is easy; adding **pairs** is the hard part. 50 components make 1,225
binary pairs, and most of them have no open experimental data. A list of 50 chemicals
with most pairs missing would look complete but fail on the first real mixture.

Prediction from molecular groups (UNIFAC) would fill the gaps, but it is a separate
decision (roadmap A3, including a licence check of the group parameters) and is **not
part of this proposal**. Until then, every pair is fitted to open data or taken from an
open databank, or it is reported as missing.

## Proposal

### 1. Choose the components by the processes we want to simulate

Instead of a "most common chemicals" list, pick a few **benchmark processes** and add
exactly the components and pairs they need. Each benchmark becomes a test case for the
flash (proposal 0001), and later for flowsheets, cost engineering and the comparison of
process routes (tracks E and G).

Draft list. The team changes it; names only, no data yet:

| Benchmark process | Components it needs (new ones in bold) |
|---|---|
| Ethanol dehydration (extractive and azeotropic distillation) | ethanol, water, ethylene glycol, **cyclohexane** |
| Ethyl acetate by esterification | acetic acid, ethanol, ethyl acetate, water (all present) |
| Methanol synthesis from syngas, with gas cleaning by cold methanol | hydrogen, **carbon monoxide**, **carbon dioxide**, methane, nitrogen, methanol, water, **dimethyl ether**, **hydrogen sulfide** |
| Air separation (small case for equations of state) | nitrogen, oxygen, **argon** |
| Light hydrocarbons and refrigeration | methane, ethane, ethylene, **propane**, **propylene**, **n-butane**, **isobutane**, **ammonia** |
| Aromatics (BTX) and styrene | benzene, toluene, **o-xylene**, **m-xylene**, **p-xylene**, **ethylbenzene**, **styrene** |
| Solvent recovery (pharmaceutical and coatings solvents) | acetone, methanol, ethanol, ethyl acetate, toluene, **1-propanol**, **2-propanol**, **1-butanol**, **2-butanone**, **methyl acetate**, **n-butyl acetate**, **tetrahydrofuran**, **dichloromethane**, **acetonitrile**, **diethyl ether**, **MTBE**, **n-hexane**, **n-heptane** |
| Higher boilers and glycols | **propylene glycol**, **glycerol**, **phenol**, **n-pentane**, **n-octane** |

That is 34 new components, 50 in total.

### 2. Where the numbers come from (AGENTS.md rule 1, in this order)

**Pure-component data** (constants, vapour pressure, liquid density, heat capacity, heat
of vaporization, viscosity, thermal conductivity), with the same scripts and tests as
proposal 0002:

- 21 of the 34 have a reference equation of state in **CoolProp**: carbon monoxide,
  carbon dioxide, hydrogen sulfide, argon, propane, propylene, n-butane, isobutane,
  ammonia, n-pentane, n-hexane, n-heptane, n-octane, cyclohexane, the three xylenes,
  ethylbenzene, diethyl ether, dimethyl ether and propylene glycol (checked against the
  CoolProp 8.0.0 fluid list).
- The other 13 from the **ChemSep** databank (Artistic License 2.0), checked against the
  **NIST Chemistry WebBook** where it has data.

**Pairs, in this order of preference:**

1. **Fitted to open experimental data** (NIST TRC ThermoML Archive, open-access
   articles) with the repository's fitting scripts: tier `fitted`.
2. **ChemSep** interaction parameters: tier `databank`. Where open data exist as well,
   the databank set is kept as an alternative (proposal 0003), so both can be compared.
3. **Gases in water:** Henry's law. IAPWS G7-04 covers argon, carbon monoxide, carbon
   dioxide and hydrogen sulfide (checked in the open `iapws` package that implements
   it); other gas-solvent pairs from open compilations.
4. **Equations of state:** k_ij from ChemSep or fitted to open data; pairs without a k_ij
   use 0 with a warning, as today.
5. Otherwise: **missing**. The calculation stops with an error naming the pair, unless
   the user explicitly allows ideal behaviour for it. The pair goes onto
   [DATA_WANTED.md](../docs/DATA_WANTED.md). Never estimated silently.

**Not every pair:** only the pairs that matter in each benchmark (components that meet in
the same unit at significant concentrations). Roughly 100 to 150 pairs instead of 1,225;
the exact list is the first step below.

### 3. When a pair is missing: how we search, and what happens if nothing is found

For each missing pair the contributor (or their assistant) searches these places in
order, and writes down every place searched, also when nothing is found:

1. the **NIST TRC ThermoML Archive**: the measured data of J. Chem. Eng. Data, Fluid
   Phase Equilib., J. Chem. Thermodyn., Thermochim. Acta and Int. J. Thermophys., about
   2003–2019, free even when the article itself is paywalled;
2. **open-access articles**, and open repositories (Zenodo, figshare, university
   repositories, open theses);
3. **free books** in the public domain or openly licensed (older data, labelled with
   their year);
4. the **ChemSep** databank parameters, as the databank fallback.

How a data set is chosen is **not by the number of citations** but by its quality and
fit to the process:

- the right kind of data: isobaric T-x-y near the pressure of the benchmark, or
  isothermal P-x(-y) from a static apparatus; azeotrope, infinite-dilution and
  liquid-liquid data as extra checks;
- a thermodynamic consistency test passed (reported with the data, or run by our
  scripts);
- where possible two independent data sets, one for the fit and one as a check;
- a person compares every transcribed number with the source (AGENTS.md rule 4).

If nothing open exists, the pair is reported as **missing** with the list of places
searched ("no open data"):

- the calculation stops with an error that names the pair, unless the user allows
  ideal behaviour for it, which then shows as a warning on every result;
- users can enter their own parameters for their own work (tier `user`,
  `Fugacity.library.add`, proposal 0003), clearly marked and never mixed into the
  shared data;
- the pair goes onto [DATA_WANTED.md](../docs/DATA_WANTED.md), so contributors with
  access to a laboratory or to new open publications can fill it;
- later, the predicted tier (UNIFAC, roadmap A3) can fill it, always labelled as a
  prediction.

Commercial databases (DDB, DIPPR, DECHEMA) are never used, as in AGENTS.md rule 1.

### 4. Known difficult cases, flagged up front

- **Ammonia + water, carbon dioxide + water, hydrogen sulfide + water** at high
  concentrations involve ions (electrolytes). Fugacity covers them only as dilute gases
  (Henry's law) or with equations of state at conditions where that is defensible; each
  gets a note in the data and a warning in results.
- **Glycerol, phenol, propylene glycol**: high boilers with few open vapour-liquid data;
  some pairs will stay `databank` or missing.
- **Light gases in activity models**: not possible (no vapour pressure above the critical
  point); use an equation of state or Henry's law, as today.

### 5. Size

The component data are about 7 KB per component today, so 34 new components add roughly
240 KB to the uncompressed bundle (about 400 KB now). That is acceptable for a chat page.
Splitting the data into packs that load separately (roadmap A2) becomes necessary
beyond about 100 components and is not part of this proposal.

## Engineering basis

No new models. The validation follows proposal 0002 for pure components (comparison
with CoolProp or the NIST WebBook over the stated temperature range, the deviation
reported per property) and the existing pair workflow for binaries:

- every fitted pair: deviation in T and y against its open data set, shown in the
  engineering report;
- every databank pair used in a benchmark: compared with at least one open data set
  where one exists; "no open data" written down where none exists;
- every benchmark: a flash case (proposal 0001) in the engineering report, so each later
  change shows its effect on the processes people care about.

## Effect on existing work

- Data files grow; the 16 existing components and their pairs are unchanged.
- `listComponents()` returns 50 entries; the workbench lists stay searchable.
- DATA_WANTED.md gets longer: an honest list of the missing pairs is part of the result.

## Alternatives considered

- **Top 50 by production volume:** easy to state, but many pairs between them never meet
  in a real process, while pairs that matter would still be missing.
- **Wait for UNIFAC and add everything at once:** delays useful work, and the licence of
  the group parameters is still open.
- **Add all 1,225 pairs from the databank:** fast, but most would be unchecked against
  data and would look more reliable than they are.

## Steps

1. **Agree the benchmark list** and, for each benchmark, the pairs it needs (one table
   in `docs/`). Team ticket; no code.
2. **Pure-component data** for the new components, in batches of about ten per pull
   request (gases first, as they feed the methanol and air-separation benchmarks), with
   the proposal 0002 tests.
3. **Pairs, benchmark by benchmark:** fitted to open data where it exists, databank
   otherwise, missing pairs listed. One pull request per benchmark.
4. **Benchmark flash cases** in the engineering report, once the flash (proposal 0001)
   is available.
