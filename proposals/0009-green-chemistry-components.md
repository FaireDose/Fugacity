# 0009: Components for green and bio-based chemistry

- **Status:** Draft
- **Author(s):** CHEPTA maintainers (drafted with an AI assistant)
- **Discussion:** this pull request
- **Roadmap item:** data track D5 (components), D8 (formation data of the components, for proposal 0010);
  agentic design track G (the routes agents will compare)

## Problem

CHEPTA's 90-plus components cover petrochemicals, solvents, gases and three solids. The
sustainable-chemistry map that came with this request lists twenty mature (TRL 7–9) bio-based
and circular routes and a watchlist of emerging building blocks:

- carbohydrate platforms: sugars → HMF → levulinic acid, FDCA, BHMF; sorbitol → isosorbide;
- fermentation products: lactic, succinic and itaconic acids, 1,3-PDO, 1,4-BDO;
- lipid routes: FAME and glycerol, HVO paraffins;
- furfural and its derivatives; levoglucosenone → Cyrene;
- recycled polyesters: PET → terephthalic acid + ethylene glycol;
- captured carbon: CO₂ → methanol.

CHEPTA can simulate very few of them. Most of these molecules are missing, and so are many of
the products their reactions make: esters of levulinic and lactic acid, lactones, carbonates,
ketals.

These molecules are also harder than those added so far. Many of them decompose before they
boil (sugars, polyacids), are solids at room temperature, or are absent from the two databanks
CHEPTA has used so far, ChemSep and CoolProp. Adding them needs a plan that is honest about
which open data exist.

## Proposal

Add the components in **four batches**, ordered by how complete their open data are, and treat
nonvolatile solids as a **component class of their own**. Batches 1 and 2 follow the pipeline
of proposals 0004 and 0008 unchanged: `add_components.py` → `fit_properties.py` →
`check_measured.py` → `make_sources.py`. Batches 3 and 4 use the path built for
dichloromethane and 2-methoxyethanol: constants and vapour pressure from the NIST WebBook and
the measured values of the NIST TRC ThermoML Archive. Where none of the open sources has a
number, it stays "no open data" with the sources searched (AGENTS.md rule 1).

### The source scan (2026-10-08)

`python validation/python/scan_components.py --set green --webbook --chemsep chemsep1.xml chemsep2.xml`
looks up each candidate:

- the CAS number and formula, from the open `chemicals` library;
- whether it is a CoolProp 8.0.0 fluid, matched by CAS;
- whether it is in the ChemSep databank files as redistributed with DWSIM, and which
  correlations they lack;
- for the candidates in neither, which kinds of data the NIST WebBook pages of the compound
  show.

The scan reports what each source has, not values. The values are taken in each batch, with
the batch's checks.

| Component | CAS | Formula | 25 °C | CoolProp | ChemSep | ChemSep lacks | NIST WebBook pages show |
|---|---|---|---|---|---|---|---|
| **Batch 1: platform and solvent molecules in ChemSep or CoolProp** | | | | | | | |
| 1,4-Butanediol | 110-63-4 | C4H10O2 | liquid | — | file 1 | nothing | |
| Dihydrolevoglucosenone (Cyrene) | 53716-82-8 | C6H8O3 | liquid | — | file 2 | liquid density | |
| Dimethyl carbonate | 616-38-6 | C3H6O3 | liquid | yes | file 1 | nothing | |
| Diethyl carbonate | 105-58-8 | C5H10O3 | liquid | — | file 1 | liquid Cp, conductivities | |
| Ethylene carbonate | 96-49-1 | C3H4O3 | solid | — | file 1 | nothing | |
| Propylene carbonate | 108-32-7 | C4H6O3 | liquid | — | file 1 | nothing | |
| Acetaldehyde | 75-07-0 | C2H4O | gas | — | file 1 | nothing | |
| 1-Pentanol, 1-hexanol, 1-octanol | 71-41-0, 111-27-3, 111-87-5 | | liquid | — | files 1, 1, 2 | nothing | |
| Diethylene glycol | 111-46-6 | C4H10O3 | liquid | — | file 1 | nothing | |
| p-Cymene | 99-87-6 | C10H14 | liquid | — | file 1 | nothing | |
| Adipic acid | 124-04-9 | C6H10O4 | solid | — | file 1 | nothing | |
| Maleic anhydride | 108-31-6 | C4H2O3 | solid | — | file 1 | nothing | |
| Terephthalic acid | 100-21-0 | C8H6O4 | solid | — | file 1 | liquid Cp, viscosity, conductivity, surface tension | |
| Dimethyl terephthalate | 120-61-6 | C10H10O4 | solid | — | file 1 | nothing | |
| **Batch 2: lipids (biodiesel and hydrotreated oils)** | | | | | | | |
| Methyl laurate, methyl myristate | 111-82-0, 124-10-7 | | liquid | — | file 2 | nothing | |
| Methyl palmitate, methyl stearate | 112-39-0, 112-61-8 | | solid | yes | file 2 | nothing | |
| Methyl oleate | 112-62-9 | C19H36O2 | liquid | yes | file 2 | nothing | |
| Methyl linoleate | 112-63-0 | C19H34O2 | liquid | yes | file 2 | most correlations (CoolProp has them) | |
| Triolein | 122-32-7 | C57H104O6 | liquid | — | file 2 | liquid Cp, ΔHvap, transport | |
| Tripalmitin | 555-44-2 | C51H98O6 | solid | — | file 2 | liquid Cp, ΔHvap, transport | |
| Oleic, palmitic, stearic acid | 112-80-1, 57-10-3, 57-11-4 | | liquid, solid, solid | — | file 2 | nothing | |
| n-Hexadecane, n-octadecane | 544-76-3, 593-45-3 | | liquid, solid | — | file 1 | nothing | |
| **Batch 3: volatile platform molecules, NIST WebBook and ThermoML Archive** | | | | | | | |
| Levulinic acid | 123-76-2 | C5H8O3 | | — | — | | Antoine, Tboil, Tfus |
| Methyl levulinate, ethyl levulinate | 624-45-3, 539-88-8 | | | — | — | | Antoine, Tboil |
| Butyl levulinate | 2052-15-5 | C9H16O3 | | — | — | | Tboil |
| γ-Valerolactone (GVL) | 108-29-2 | C5H8O2 | | — | — | | Antoine, Tboil, ΔfH°gas |
| α-Angelica lactone | 591-12-8 | C5H6O2 | | — | — | | Tboil |
| 5-Hydroxymethylfurfural (HMF) | 67-47-0 | C6H6O3 | | — | — | | Tboil |
| Furfuryl alcohol | 98-00-0 | C5H6O2 | | — | — | | Tboil, ΔfH°gas |
| Tetrahydrofurfuryl alcohol | 97-99-4 | C5H10O2 | | — | — | | Tboil, Tfus, ΔfH°gas |
| Furan | 110-00-9 | C4H4O | | — | — | | Antoine, Tboil, Tc, Pc, Tfus, Cp gas, ΔfH°gas |
| 2-Methylfuran | 534-22-5 | C5H6O | | — | — | | Antoine, Tboil, Tc, Pc, Cp gas |
| 2-Methyltetrahydrofuran | 96-47-9 | C5H10O | | — | — | | Tboil, Tc, Pc, Tfus |
| γ-Butyrolactone | 96-48-0 | C4H6O2 | | — | — | | Tboil, Tc, Pc, Tfus, Cp gas, ΔfH°gas |
| 1,3-Propanediol | 504-63-2 | C3H8O2 | | — | — | | Antoine, Tboil, Tfus, ΔfH°gas |
| 2,3-Butanediol | 513-85-9 | C4H10O2 | | — | — | | Antoine, Tboil, Tfus |
| Lactic acid (L-) | 79-33-4 | C3H6O3 | | — | — | | Tboil |
| Methyl lactate | 547-64-8 | C4H8O3 | | — | — | | Tboil |
| Ethyl lactate | 97-64-3 | C5H10O3 | | — | — | | nothing |
| Solketal | 100-79-8 | C6H12O3 | | — | — | | Tboil |
| Cyclopentyl methyl ether | 5614-37-9 | C6H12O | | — | — | | nothing |
| Limonene | 138-86-3 | C10H16 | | — | — | | Tboil, Tfus |
| Isoamyl alcohol | 123-51-3 | C5H12O | | — | — | | Tboil, Tc, Pc, Cp gas, ΔfH°gas |
| Lactide | 95-96-5 | C6H8O4 | | — | — | | Tboil |
| **Batch 4: nonvolatile solids (sugars, sugar alcohols, polyacids)** | | | | | | | |
| D-Glucose, D-fructose | 50-99-7, 57-48-7 | C6H12O6 | | — | — | | Tfus (glucose); nothing (fructose) |
| D-Sorbitol, xylitol | 50-70-4, 87-99-0 | | | — | — | | Tfus |
| Isosorbide | 652-67-5 | C6H10O4 | | — | — | | not a WebBook compound |
| Levoglucosan | 498-07-7 | C6H10O5 | | — | — | | nothing |
| Succinic, itaconic, fumaric, malic, citric acid | 110-15-6, 97-65-4, 110-17-8, 6915-15-7, 77-92-9 | | | — | — | | Tfus |
| Glycolic acid | 79-14-1 | C2H4O3 | | — | — | | Cp gas |
| 2,5-Furandicarboxylic acid (FDCA), dimethyl FDCA | 3238-40-2, 4282-32-0 | | | — | — | | nothing |
| Glucaric acid | 87-73-0 | C6H10O8 | | — | — | | nothing |
| 3-Hydroxypropionic acid, BHMF, BHET, diphenolic acid | 503-66-2, 1883-75-6, 959-26-2, 126-00-1 | | | — | — | | not WebBook compounds |

"25 °C" is from ChemSep's melting and boiling points where ChemSep has the compound. "NIST
WebBook pages show" lists the kinds of data found on the compound's phase-change and gas-phase
thermochemistry pages, not their quality. Each batch opens the pages and the ThermoML Archive
again and records what it uses.

Not recognized by the `chemicals` library by name in this scan, to be identified by CAS from an
open source in their batch: xylose, erythritol, cis,cis-muconic acid, levoglucosenone, glycerol
carbonate, 5-ethoxymethylfurfural.

Already in CHEPTA, and part of these routes: water, methanol, ethanol, acetone, acetic and
formic acid, ethylene glycol, 1,2-propanediol, glycerol, furfural, tetrahydrofuran, diethyl
ether, ethylene, hydrogen, CO, CO₂, the n-alkanes to dodecane, phenol.

### Why these components: the intermediates and products of each route

A simulator ships chemicals, not reactions: the user writes the reactions of their own process
(proposal 0010). But a user can only write a reaction if every molecule in it is a component. So
the candidates were chosen route by route: not only the building blocks of the map, but also the
intermediates and products their usual transformations lead to. The table records that reasoning;
it is **not** a list of reactions CHEPTA will provide.

| Transformation in the route (for choosing components only) | New components it brings in | Batch |
|---|---|---|
| Hexose → HMF → levulinic acid + formic acid | HMF, levulinic acid, glucose, fructose | 3, 4 |
| Levulinic acid + alcohol ⇌ levulinate ester + water | methyl, ethyl, butyl levulinate | 3 |
| Levulinic acid + H₂ → GVL + water (via angelica lactone) | GVL, α-angelica lactone | 3 |
| Glucose + H₂ → sorbitol → isosorbide + 2 water | sorbitol, isosorbide | 4 |
| Xylose → furfural → furfuryl alcohol → tetrahydrofurfuryl alcohol; → 2-methylfuran, 2-MeTHF | furfuryl alcohol, THFA, 2-methylfuran, 2-MeTHF, furan | 3 |
| Levoglucosenone + H₂ → Cyrene | Cyrene (levoglucosenone: no open data found yet) | 1 |
| Lactic acid → lactide; lactic acid + ethanol ⇌ ethyl lactate + water | lactic acid, lactide, ethyl and methyl lactate | 3 |
| Succinic acid + H₂ → GBL → 1,4-BDO → THF | succinic acid, GBL, 1,4-BDO | 1, 3, 4 |
| Triglyceride + 3 methanol ⇌ 3 FAME + glycerol | triolein, tripalmitin, FAMEs, fatty acids | 2 |
| Fatty acid + H₂ → n-paraffin + water (HVO) | fatty acids, n-hexadecane, n-octadecane | 2 |
| PET + water → terephthalic acid + ethylene glycol (via BHET) | terephthalic acid, BHET, DMT | 1, 4 |
| Methanol + CO₂ → dimethyl carbonate + water; ethylene oxide + CO₂ → ethylene carbonate | DMC, DEC, ethylene and propylene carbonate | 1 |
| Glycerol + acetone ⇌ solketal + water | solketal | 3 |
| Ethanol → ethylene (+ diethyl ether, acetaldehyde) | acetaldehyde | 1 |
| FDCA + ethylene glycol → PEF; HMF + O₂ → FDCA | FDCA, dimethyl FDCA | 4 |

Polymers (PLA, PEF, PHBH, PET itself, lignin) are **not** components in this proposal. They need
the polymer models now shown as "not available yet" (Flory–Huggins, PC-SAFT for polymers) and a
description by repeat unit and molar-mass distribution: a later proposal.

### A component class for nonvolatile solids

Sugars, sugar alcohols and most polyacids decompose before they boil. They have no meaningful
critical point, vapour pressure curve or ΔHvap, and ChemSep and CoolProp don't list them. In
processes they are dissolved in water or crystallized. The proposal adds
`"class": "nonvolatile"` to components.json:

- **Required:** MW, formula, CAS, and the fusion data that solid-liquid equilibrium needs
  (melting temperature and enthalpy of fusion, the format of proposal 0007, step 4), from
  open sources.
- **Vapour pressure:** none. In activity-model systems the component never enters the vapour
  phase: K = 0 in flashes, a stated assumption shown in the results. In equation-of-state
  systems it is refused, with the reason.
- **Liquid-state properties** (density, Cp, viscosity of solutions) are recorded where measured,
  with sources. Otherwise "no open data".
- **Pair parameters** with water come from fitted solubility data (the method of
  `fit_sle.py`) or VLE of aqueous solutions (water activity) from the ThermoML Archive.

This is the same thing the solids of proposal 0007 needed, made general and explicit. Acids are
treated as molecules; their dissociation in water needs the electrolyte models (eNRTL, Pitzer)
that are still "not available yet".

### Checks every batch must pass

As for proposal 0008:

- each record has a source and a tier, and its licence is in LICENSES.md;
- `check_measured.py` compares vapour pressure, density, Cp and viscosity with the ThermoML
  Archive, and deviations beyond tolerance either refit the record (the rule of proposal 0008)
  or appear as a known issue;
- `npm run wanted` lists the new pairs as wanted, so the data track can fill them.

Pairs come after components, fitted to open VLE, LLE and SLE data. The map lists open
starting points for several systems (levulinic acid and its esters with water and alcohols,
GVL and water, furfural and water LLE, isosorbide, FDCA crystallisation). Each pair still needs
its source opened and checked.

## Engineering basis

- Sources in the order of AGENTS.md rule 1: CoolProp 8.0.0 (MIT) → NIST Chemistry WebBook → the
  ChemSep databank as redistributed with DWSIM (Artistic License 2.0) → NIST TRC ThermoML
  Archive and open-access articles → free books.
- Fitted correlations and checks: `validation/python/fit_properties.py`, `check_measured.py`
  (unchanged rules). Nonvolatile class: fusion data as in `fusion_data.py`.
- Batch 3 components without critical constants in any open source can still be used with
  activity models, which need only the vapour pressure. They can't be used with
  Peng–Robinson or SRK, and the engine says so instead of estimating Tc and Pc.

## Effect on existing work

- components.json grows by up to about 70 components; the pickers are already searchable and
  sorted.
- The new `class` field defaults to the current behaviour; existing components don't change.
- Tests: the component-count assertions change with each batch, and every new record goes
  through the existing record tests.

## Alternatives considered

- **Group-contribution estimates (Joback, UNIFAC) for the missing constants.** Fast, but they
  are estimates, and UNIFAC is on hold until its licence question is settled (proposal 0008,
  Part A). A later "predicted" tier could add them, clearly labelled.
- **Pseudo-components** ("biodiesel", "sugars"). Rejected for the platform molecules: the map
  itself warns that a single biodiesel pseudo-component misses phase splits. They may be useful
  later for oils and lignin, with their own proposal.
- **One big batch.** Rejected: each batch is reviewed against its sources, and smaller batches
  keep that review possible.

## Steps

1. This proposal, with the scan (`scan_components.py --set green --webbook`).
2. **Batch 1:** 16 components from ChemSep and CoolProp, with ThermoML checks.
3. **Batch 2:** 13 lipids, with ThermoML checks; FAME + glycerol + methanol pairs to
   DATA_WANTED.
4. **Batch 3:** 23 volatile platform molecules from the WebBook and the ThermoML Archive,
   one PR per five to eight, like dichloromethane.
5. **Nonvolatile class** in the engine (K = 0, refusal in EOS systems, fusion data required),
   with tests.
6. **Batch 4:** the solids with fusion data; aqueous solubilities fitted (fit_sle.py) where
   the ThermoML Archive has them.
