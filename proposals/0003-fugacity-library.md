# 0003: The Fugacity Library: sources you can see and choose

- **Status:** Draft
- **Author(s):** Fugacity maintainers
- **Discussion:** this pull request
- **Roadmap item:** A2 (data registry), A3 (quality tiers); B4 (project files)

## Problem

Every parameter in Fugacity has a source, but the source is a line of free text inside
each record. That has three drawbacks:

1. **You can't choose.** When a pair has two good parameter sets, for example the ChemSep
   databank set and a set fitted to newer open data, the engine silently uses one. Since
   the refits for methanol + acetone + chloroform and ethanol + water + ethyl acetate, the
   older ChemSep sets survive only in a `replaced` field nobody can use. An engineer
   working at 5 bar, far from the 1-atm data of the refit, may prefer the older set, and
   should be able to compare the two.
2. **You can't browse.** There is no list of all the sources the project relies on, what
   each one is used for, and why it is open. Reviewers and new contributors have to read
   JSON files.
3. **The same source is written many times,** in slightly different words, so citations
   drift and licenses are tracked by hand in `src/data/LICENSES.md`.

## Proposal

### 1. One source library: `src/data/sources.json`

Every source appears once, with an id:

```json
{
  "sources": {
    "chemsep-8.3": {
      "title": "ChemSep pure-component and interaction parameter databank, version 8.3",
      "authors": "H. Kooijman, R. Taylor",
      "kind": "databank",
      "url": "http://www.chemsep.org/",
      "access": "Open: Artistic License 2.0",
      "via": "the open-source thermo library and DWSIM"
    },
    "li2018-acetone-methanol": {
      "title": "Isobaric vapour-liquid equilibrium for acetone + methanol ... at 101.3 kPa",
      "authors": "Li, Du, Chen, Li, Guo, Zhang",
      "year": 2018,
      "kind": "thermoml",
      "doi": "10.1016/j.fluid.2017.11.035",
      "url": "https://trc.nist.gov/ThermoML/10.1016/j.fluid.2017.11.035.html",
      "access": "Data public in the NIST TRC ThermoML Archive"
    }
  }
}
```

`kind` is one of `standard`, `open-source library`, `databank`, `thermoml`,
`open-access article`, `free book`, `handbook via open compilation`. The license table in
`src/data/LICENSES.md` is generated from this file.

### 2. Parameter sets that point to sources, several per pair

Each record keeps its text `source` (backward compatible) and gains `source_ids` and a
`set` name. A pair may have several sets for the same model; exactly one is the default:

```json
{ "model": "UNIQUAC", "i": "acetone", "j": "chloroform", "set": "fitted-gao2018",
  "default": true, "tier": "fitted", "source_ids": ["gao2018-acetone-chloroform"],
  "valid": { "P_kPa": [101.3, 101.3], "T_K": [329, 338] }, "b_ij": ..., "b_ji": ... }
{ "model": "UNIQUAC", "i": "acetone", "j": "chloroform", "set": "chemsep",
  "tier": "databank", "source_ids": ["chemsep-8.3"], "b_ij": -788.05, "b_ji": 393.31 }
```

The `replaced` entries of today become ordinary non-default sets. The same scheme applies
to k_ij, Henry constants and, later, pure-component property records.

### 3. Choosing in code: `Fugacity.library`

```js
Fugacity.library.sources()                       // all sources, with what uses each one
Fugacity.library.source("chemsep-8.3")           // one source
Fugacity.library.sets("acetone", "chloroform", "UNIQUAC")
// -> [{ set: "fitted-gao2018", default: true, tier: "fitted", sources: [...], valid },
//     { set: "chemsep", tier: "databank", sources: [...] }]
Fugacity.library.add({ model: "NRTL", i: "water", j: "ethanol", set: "my-paper",
  params: { a_ij, a_ji, b_ij, b_ji, alpha }, source: { title, doi, url } })   // tier "user", this page only

const s = Fugacity.system({
  components: ["methanol", "acetone", "chloroform"], model: "UNIQUAC",
  sets: { "acetone+chloroform": "chemsep" },      // per pair, optional
  prefer: ["fitted", "databank"]                   // or a global rule, e.g. ["databank"]
});
s.info.pairs   // which set each pair uses, its sources, and the alternatives
```

Without `sets` or `prefer`, every result is exactly what it is today.

### 4. Choosing in the interface

- A **Library** tab in the workbench ribbon: a global rule ("Best available", "Fitted to
  data first", "Databank only (ChemSep)"), and a searchable browser of all sources: what
  each one is, why it is open, a link to it, and which components and pairs use it.
- In the left panel, each pair shows a small selector with its available sets; switching
  recalculates the diagram immediately, so the two sets can be compared.
- The inspector lists the sources behind every number shown, from the library.
- The choices are part of the workbench state, so they travel with share-by-link (B2)
  and project files (B4) later.

## Engineering basis

No new thermodynamics. The tests check that:

- the default selection reproduces today's results exactly (all existing tests and the
  engineering report unchanged);
- choosing the ChemSep set for the refitted pairs reproduces the pre-refit results
  (the values recorded in pull requests #18 and #19, e.g. the UNIQUAC methanol + acetone
  + chloroform saddle at 60.05 °C);
- every `source_ids` entry resolves; every source has `kind`, `access` and a link;
- a set used outside its `valid` range produces a warning in the results.

## Effect on existing work

- Data files gain fields; nothing is removed. `source` text stays for old readers.
- `createSystem`, `system`, `mount`, `mountProperties` and `app` keep their behaviour;
  `sets` and `prefer` are new optional settings.
- Contributors cite a source once in `sources.json` and refer to it by id. The Data form
  and AGENTS.md get one line about it.
- The bundle grows by the size of `sources.json` (expected well under 30 KB).

## Alternatives considered

- **Keep free-text sources, add a selector only for `replaced` sets:** quicker, but
  leaves the duplication and gives no browsable list.
- **One file per source:** easier merges, but more files to load in a page with no
  network access; a single JSON file is simpler for artifacts.

## Steps

1. `sources.json` from the existing records (a migration script; every generated entry
   checked by a person), `source_ids` and `set` names on all records, LICENSES.md
   generated; tests.
2. Selection in the engine (`sets`, `prefer`, `Fugacity.library`, `add`), with the
   tests above.
3. The Library tab, the per-pair selectors and the source browser in the workbench.
4. Later: the same for k_ij, Henry constants and pure-component properties.
