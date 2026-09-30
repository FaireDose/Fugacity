# Contributing

You don't need to be a software engineer. The most valuable contributions are
chemical-engineering ones: data, parameters, validation cases, and checking results.

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

Put the experimental data you used in [`validation/data/`](validation/data) as JSON and
add a test in [`test/`](test) that compares the model with it.

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
