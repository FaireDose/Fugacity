# Contributing

Fugacity grows through chemical engineers: people who know where good data lives, can
tell a sensible result from a wrong one, and want better open tools for teaching and
design. You don't need to be a software engineer.

There are four ways to help. Pick the one that fits your time.

| Way | You need | Typical time |
|---|---|---|
| [1. Add or correct a component](#1-add-or-correct-a-component) | Pure-component data from an open source | 30 minutes |
| [2. Find open data for a component or pair](#2-find-open-data-for-a-component-or-pair) | Library search skills, a spreadsheet | 1–3 hours per pair |
| [3. Work on the roadmap](#3-work-on-the-roadmap) | Programming, or a clear engineering specification | days |
| [4. Review](#4-review) | Experience in thermodynamics | 15–30 minutes per change |

Every change, whoever makes it, goes through the same path:

1. **Issue.** Describe what you want to add or fix with one of the
   [issue forms](https://github.com/FaireDose/Fugacity/issues/new/choose).
2. **Pull request.** You, another contributor, or Claude (when a maintainer asks it to)
   turn the issue into a pull request with data, source and test.
3. **Automatic checks** run on every pull request.
4. **Independent review** by someone other than the author, following the checklist in
   the pull request.
5. **Merge and release.**

## The rules

1. **Open sources only.** Every number must come from a source that anyone can read for
   free, so any reviewer can check it. Accepted:
   - open-access articles (for example CC BY journals such as *Data in Brief*, MDPI journals,
     open-access papers in *J. Chem. Eng. Data*);
   - the [NIST TRC ThermoML Archive](https://trc.nist.gov/ThermoML/), which publishes the data
     of *J. Chem. Eng. Data*, *J. Chem. Thermodynamics*, *Fluid Phase Equilibria*,
     *Thermochimica Acta* and *Int. J. Thermophysics* (about 2003–2019) under the NIST open
     license, even when the article itself is behind a paywall;
   - the [NIST Chemistry WebBook](https://webbook.nist.gov/) for pure-component properties;
   - open data repositories (Zenodo, figshare, university repositories, open theses);
   - open databanks with a license that allows redistribution (for example ChemSep,
     Artistic License 2.0).

   Not accepted: numbers copied from a paywalled article or a commercial databank (DDB,
   DIPPR, DECHEMA volumes) that are not also available openly.
2. **Every number has a source.** Each entry carries a `source` field: citation, DOI or
   link, and the table or figure. Say if values were read off a graph.
3. **Every model has a test.** New data comes with a test against experimental data or an
   independent calculation.
4. **Record the license.** A new source goes into [`src/data/LICENSES.md`](src/data/LICENSES.md).
5. **No unchecked AI numbers.** If an AI assistant helped you find or transcribe data, you
   must check every value against the source yourself. Numbers an assistant "remembers"
   without a source are not accepted.

## 1. Add or correct a component

Components live in [`src/data/components.json`](src/data/components.json). One entry:

```json
"methanol": {
  "name": "Methanol",
  "formula": "CH4O",
  "cas": "67-56-1",
  "aliases": ["meoh", "methyl alcohol"],
  "MW": 32.04186,
  "Tc_K": 512.5, "Pc_Pa": 8084000, "Tb_K": 337.632,
  "vapourPressure": {
    "equation": "DIPPR101", "form": "ln(P/Pa) = A + B/T + C ln T + D T^E",
    "A": 0.0, "B": 0.0, "C": 0.0, "D": 0.0, "E": 2,
    "Tmin_K": 250, "Tmax_K": 470,
    "source": "Where the coefficients come from, and max deviation in range."
  },
  "uniquac": { "r": 1.43, "q": 1.43, "source": "..." }
}
```

- **Constants** (MW, Tc, Pc, Tb): NIST Chemistry WebBook or an open databank.
- **Vapour pressure:** coefficients from an open source, or fitted by you to open data
  (describe the fit in `source`).
- **UNIQUAC r and q:** from UNIFAC group sums or the ChemSep database.
- A component is only useful with binary parameters for it; see way 2.

Then run `npm test` (it checks that every component boils at its `Tb_K`) and
`npm run wanted` to update the list of missing pairs.

## 2. Find open data for a component or pair

This is the most valuable contribution: it turns *databank* or *missing* pairs into
pairs *fitted to experimental data*.

1. **Pick a pair** from [docs/DATA_WANTED.md](docs/DATA_WANTED.md), or propose a new
   component.
2. **Claim it** by opening a
   [validation case](https://github.com/FaireDose/Fugacity/issues/new?template=validation-case.yml)
   issue with the pair in the title, so others don't duplicate the work.
3. **Search open sources** (see the rules). Good starting points:
   - the ThermoML Archive search at <https://trc.nist.gov/ThermoML/>;
   - Google Scholar with "vapor-liquid equilibrium" + both names, filtered for free PDFs;
   - open-access journals; Zenodo and figshare.

   Prefer isobaric T-x-y data near 1 atm with a thermodynamic consistency test, or
   isothermal P-x(-y) data from a static apparatus. Azeotrope data and excess enthalpies
   are useful checks.
4. **Transcribe the data** into a new file in [`validation/data/`](validation/data), in this
   format:

   ```json
   {
     "_about": "One line: system, type of data, conditions.",
     "source": {
       "citation": "Authors, title, journal volume (year) pages",
       "doi": "10.xxxx/...",
       "open_copy": "https://... (where anyone can read the numbers)",
       "access": "Open access, CC BY 4.0",
       "tables": "Table 3"
     },
     "components": ["water", "ethanol"],
     "P_kPa": 101.325,
     "txy": [ { "T_C": 78.2, "x_1": 0.894, "y_1": 0.894 } ]
   }
   ```

5. **Fit or check parameters.** Add an entry to `FITS` in
   [`validation/python/fit_parameters.py`](validation/python/fit_parameters.py) and run it
   (`python validation/python/fit_parameters.py --write`), or open the pull request with the
   data only and ask a maintainer to fit it.
6. **Add a test** in [`test/`](test) that compares the model with your data, and open the
   pull request.

### With Claude

If you use Claude, add the contributor skill in
[`skill/fugacity-contributor/SKILL.md`](skill/fugacity-contributor/SKILL.md). It tells Claude
these rules and file formats. Then ask, for example:

> Find open-access vapour-liquid equilibrium data for water + 1-propanol at 1 atm,
> transcribe it into Fugacity's validation format, and fit NRTL parameters.

Check every number Claude transcribes against the source before you open the pull
request (rule 5). Your own Claude account pays for your usage; the project's key is only
used by maintainers.

## 3. Work on the roadmap

The [roadmap](ROADMAP.md) lists what comes next, including the **architecture track**:
design steps that each end in a written specification and tests.

- **Small items** (a new view, a dew-point routine, a unit conversion): open an issue saying
  you're taking it, then a pull request.
- **Large items** (a new layer, a change to an interface or file format, anything in the
  architecture track): write a proposal first, see [proposals/](proposals/README.md). Code
  follows once the proposal is accepted.

Every contribution to the engine follows [ARCHITECTURE.md](ARCHITECTURE.md): each layer
only uses the one below it, through its documented interface.

## 4. Review

Reviewers keep Fugacity trustworthy. A review checks the source against the numbers, the
fit quality, and whether the results make physical sense, using the checklist in every
pull request. Experienced chemical engineers and professors can ask to become data
reviewers; see [GOVERNANCE.md](GOVERNANCE.md).

## Running the checks

You need [Node.js](https://nodejs.org) 22 or newer.

```
npm install
npm run build
npm test
npm run wanted      # refresh docs/DATA_WANTED.md after changing data
```

The Python tools in [`validation/python/`](validation/python) need numpy and scipy. After
changing parameters, regenerate the reference results with
`python validation/python/make_fixtures.py`.

By contributing you agree that your contribution is published under the project's
licenses (MIT for code; data under the license of its source) and that you follow the
[code of conduct](CODE_OF_CONDUCT.md).
