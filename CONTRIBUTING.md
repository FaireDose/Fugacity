# Contributing

You don't need to be a software engineer. The most valuable contributions are
chemical-engineering ones: data, parameters, validation cases, and checking results.

## How a change gets in

1. **Suggest it.** Open an issue with one of the [forms](https://github.com/FaireDose/Fugacity/issues/new/choose):
   new component, data correction, validation case, or bug. You don't need to write code.
2. **Someone turns it into a pull request** with the data, its source and a test. This can
   be you, another contributor, or Claude when a maintainer asks it to.
3. **Automatic checks** run on every pull request.
4. **A second person reviews it**, following the checklist in the pull request. The author
   cannot be the reviewer. Changes to data and validation need a reviewer listed in
   [`.github/CODEOWNERS`](.github/CODEOWNERS). Professors who want to review data can
   ask to be added there.
5. **It is merged and released** as a new version.

## Two rules

1. **Every number has a source.** Parameters and data carry a `source` field that says
   where they come from (paper, databank, or how they were fitted).
2. **Every model has a test.** New data or models come with a check against
   experimental data or an independent calculation.

## Add a component

Add an entry to [`src/data/components.json`](src/data/components.json):

- `name`, `formula`, `cas`, `aliases` (other names people use)
- `MW`, `Tc_K`, `Pc_Pa`, `Tb_K`
- `vapourPressure`: DIPPR equation 101 coefficients with their validity range and source
- `uniquac`: `r` and `q` (from UNIFAC group sums)
- `association`: only for acids that dimerize in the vapour

Then add a test that the pure boiling point comes out right.

## Add binary parameters

Add entries to [`src/data/binaries.json`](src/data/binaries.json), one per model:

- NRTL: `tau_ij = a_ij + b_ij/T`, `alpha` (usually 0.3)
- UNIQUAC: `tau_ij = exp(a_ij + b_ij/T)`
- `source`: the paper and table, or the data they were fitted to and the fit quality

Also give each pair a `tier`: `fitted` (you regressed it from cited data), `databank`
(from a published parameter set) or `predicted` (group contribution).

Put the experimental data you used in [`validation/data/`](validation/data) as JSON and
add a test in [`test/`](test) that compares the model with it. To regress parameters,
add an entry to `FITS` in [`validation/python/fit_parameters.py`](validation/python/fit_parameters.py)
and run it with `--write`.

Record any new data source and its license in [`src/data/LICENSES.md`](src/data/LICENSES.md).

## Report a wrong result

Open an issue with the components, conditions, what Fugacity gives, what you expected,
and the source of the expected value.

## Run the checks

You need [Node.js](https://nodejs.org) 22 or newer.

```
npm install
npm run build
npm test
```

The Python reference model in [`validation/python/`](validation/python) needs numpy and
scipy. After changing parameters, regenerate its reference results with
`python validation/python/make_fixtures.py`.
