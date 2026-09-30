---
name: fugacity-contributor
description: Help a contributor add chemicals, open-access phase-equilibrium data, fitted parameters or roadmap work to the Fugacity repository, following its sourcing rules and file formats. Use when working in a clone of FaireDose/Fugacity.
---

# Contributing to Fugacity

Fugacity is an open-source phase-equilibrium and process-simulation library
(https://github.com/FaireDose/Fugacity). Read `CONTRIBUTING.md` and `ARCHITECTURE.md` in
the repository before changing anything; they override this file if they differ.

## Non-negotiable rules

1. **Open sources only.** Use data that anyone can read for free: open-access articles,
   the NIST TRC ThermoML Archive (https://trc.nist.gov/ThermoML/), the NIST Chemistry
   WebBook, open repositories, or databanks whose license allows redistribution. Do not
   use numbers from paywalled articles or commercial databanks unless the same numbers
   are openly available, and cite the open copy.
2. **Never supply numbers from memory.** Every value must be transcribed from a source you
   actually opened in this session. If you cannot open a source, say so and stop.
3. **Cite precisely:** citation, DOI, link to the open copy, access/license, and the table
   or figure. Say when values were read off a graph.
4. **Tell the contributor to check every transcribed value** against the source before
   opening a pull request.

## Finding data for a pair

1. Check `docs/DATA_WANTED.md` for missing or databank-only pairs.
2. Search the ThermoML Archive and open-access literature for isobaric T-x-y (near
   101.3 kPa) or isothermal P-x-y data. Prefer data with a consistency test.
3. Write the data to `validation/data/<system>.json` with a `source` block
   (citation, doi, open_copy, access, tables) and SI-style units stated in the keys
   (`T_C`, `P_kPa`, `x_1`, `y_1`).
4. Fit parameters: add an entry to `FITS` in `validation/python/fit_parameters.py`
   and run `python validation/python/fit_parameters.py --write`. Label the pair
   `tier: "fitted"` and state the fit quality in `source`.
5. Add a test in `test/` comparing the model with the new data; run
   `python validation/python/make_fixtures.py`, `npm run build`, `npm test` and
   `npm run wanted`.
6. Add any new source and its license to `src/data/LICENSES.md`.

## Adding a component

Follow the entry format in `CONTRIBUTING.md` section 1. Constants from the NIST
Chemistry WebBook or an open databank; vapour-pressure coefficients from an open source
or fitted to open data (describe the fit); UNIQUAC r and q from UNIFAC group sums or the
ChemSep database.

## Roadmap work

Small items: implement with tests, following the layer rules in `ARCHITECTURE.md`.
Items in the architecture track, new layers, or changes to interfaces and file formats
need an accepted proposal in `proposals/` first; if none exists, help the contributor
write one from `proposals/0000-template.md` instead of writing code.

## Pull request

Fill in the author checklist in `.github/pull_request_template.md`. The review is done
by someone else; do not approve your own work.
