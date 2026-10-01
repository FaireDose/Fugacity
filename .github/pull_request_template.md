## What this changes

<!-- One or two sentences, in engineering terms. Link the issue: "Closes #12". -->

## Checklist for the author

- [ ] Every new number has a `source` (paper and table, databank, or fit description), following the rules in AGENTS.md
- [ ] Every new pair or property record has a `tier` (`standard`, `fitted`, `databank`, `predicted`)
- [ ] New data sources and their licenses are listed in `src/data/LICENSES.md`
- [ ] Experimental data used for fitting or testing is in `validation/data/` with its citation
- [ ] A test compares the change with data or an independent calculation
- [ ] `npm test` passes; reference results regenerated if parameters changed (`python validation/python/make_fixtures.py`)

## Checklist for the reviewer (not the author)

- [ ] I checked the cited sources against the numbers in the change
- [ ] The fit quality stated in `source` matches what the test shows
- [ ] The results are physically sensible (boiling points, azeotropes, no unexpected phase split)
- [ ] I would be comfortable teaching or designing with these results

Pull requests prepared by AI agents are reviewed like any other.
