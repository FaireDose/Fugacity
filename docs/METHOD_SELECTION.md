# Choosing the property method

A calculation is only as good as its property method, and a test only means something if it uses
the method an engineer would choose for that mixture. Every new test, benchmark and example
first chooses the method by the rules below. A test that uses a method outside its recommended
domain on purpose (to check an error message, or a code path that must work for any method)
says so in a comment.

## The rules

From the decision trees of Eric Carlson (Aspen Technology) and the heuristics that follow
them, as presented in the Northwestern University *Chemical Process Design Open Textbook*, page
"Property package", revision 4210
(https://processdesign.mccormick.northwestern.edu/index.php/Property_package, free to read; the
page credits the trees to Carlson without a reference to his original article). The page lists
Towler and Sinnott (2012), Chaves (2015), Ulrich (1984) and Walas (1990) as its references.
Read on 2026-10-09:

1. **Polar or not?** Water, alcohols, acids, ketones, esters, ethers, amines and chlorinated
   solvents are polar. Hydrocarbons and the light gases are not. In gas processing, cubic
   equations of state are used with N₂, CO₂, H₂S, CO, O₂, Ar and H₂ (the Cavett problem uses
   Peng–Robinson with them).
2. **Nonpolar, real components:** Peng–Robinson or SRK, at any pressure. Use fitted k_ij where
   they exist.
3. **Polar, no electrolytes, below 10 bar, with interaction parameters:**
   - an activity model: NRTL or UNIQUAC (Wilson when there is only one liquid);
   - for the vapour, the ideal gas at low pressure, or an equation of state.
4. **Polar, above 10 bar:** PSRK, or a cubic equation with Wong–Sandler or MHV2 mixing rules.
   **Fugacity does not have these yet**; such mixtures are outside what it can calculate well.
5. **Electrolytes** (salts, ionized acids and bases): electrolyte NRTL or Pitzer. **Not in
   Fugacity yet.**
6. **Reduced temperature** by Kay's rule, Tr = T / Σ zᵢ Tc,ᵢ:
   - above about 0.75 (with no second liquid expected): an equation of state;
   - below it: an activity model for the liquid.

   Activity models can be stretched, with growing error, to about 0.9.
7. **Two liquids:**
   - NRTL and UNIQUAC describe them; Wilson can't.
   - A cubic equation of state with the classical mixing rule is not used where a second liquid
     forms. Water + hydrocarbons need special treatment, which Fugacity doesn't have.
8. **Physical sense:** no temperature below the melting point of a component that is present
   (it would freeze), and parameters used only within the temperature range they were fitted
   to.

## What this means for Fugacity today

| Mixture | Method in Fugacity | Status |
|---|---|---|
| Hydrocarbons and light gases, any pressure | Peng–Robinson or SRK with the databank's k_ij | covered |
| Polar liquids below 10 bar | NRTL or UNIQUAC with fitted or databank pairs; ideal-gas or PR/SRK vapour | covered where the pairs exist (docs/DATA_WANTED.md) |
| Polar mixtures above 10 bar | (PSRK, MHV2, Wong–Sandler, CPA) | **not available** |
| Water + hydrocarbons (two liquids) | (CPA, or a free-water approach) | **not available**; the engine refuses a second liquid with an equation of state |
| Electrolytes | (eNRTL, Pitzer) | **not available**, shown as "not available yet" |
| Polymers | (Flory–Huggins, PC-SAFT) | **not available** |

## Where the rules are applied

- **The flowsheet test suite** (docs/FLOWSHEET_TESTS.md): every generated case is checked
  against rules 2–8 before it is accepted (`method_check` in
  `validation/python/reference_flowsheet_suite.py`). Draws that fail are rejected and listed
  with the reason.

## Existing tests to review under these rules

These tests were written before the rules. They use an equation of state for polar liquids.
Each should either be changed to the recommended method, or keep a comment saying why it
deliberately uses another one:

- `test/diagrams-any-model.test.js`: methanol + water, methanol + chloroform and methanol +
  acetone + chloroform with PR or SRK. These check that the diagrams can be drawn with any
  method (a code path), not the accuracy. Proposed change: a comment saying so, or
  hydrocarbons for the equation-of-state paths.
- `test/benchmark-ethanol-dehydration.test.js`, `test/benchmark-ethyl-acetate.test.js`,
  `test/benchmark-methanol-synthesis.test.js`: PR and SRK k_ij fitted to ethanol + water, ethanol +
  ethylene glycol, water + ethylene glycol, ethyl acetate + ethanol and dimethyl ether +
  methanol (proposal 0004). Rule 4 says these mixtures need PSRK or MHV2 above 10 bar and an
  activity model below. Proposed: keep the fits, which show how far a plain cubic equation
  is off, but mark them "not recommended" in the Library and the method picker.
- `test/eos.test.js`, `test/eos-stability.test.js`: methane + water (+ nitrogen) with PR. This is
  common in gas processing for the water content of a gas. A second liquid is refused, as rule 7
  requires.
