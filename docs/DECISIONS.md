# Decisions and open items

A running record of what the maintainer decided while working with the AI assistant, and of
what is still pending. Anyone picking up the work, people or assistants, should start here. The
record in force is each pull request and proposal; this page points to them.

Newest first. Pull requests are in `FaireDose/Fugacity`.

## Open items (state on 2026-10-09)

### Waiting for the maintainer

- **Review and merge:**
  - [#85](https://github.com/FaireDose/Fugacity/pull/85): method advisor; older tests reviewed against the method rules.
  - [#86](https://github.com/FaireDose/Fugacity/pull/86): Newton flash; P-H search without workarounds.
  - The pull request that adds this page.
- **Proposals 0009, 0010 and 0011:** merged in [#83](https://github.com/FaireDose/Fugacity/pull/83) with status
  **Draft**. Accept or decline each one, then set its status in the file and in `proposals/README.md`.
- **Make the new name official** (decided 2026-10-09: **CHEPTA**, *Chemical Engineering Process Tools
  for Agents*). In this order:
  1. GitHub: Settings → General → Repository name: `CHEPTA`. GitHub redirects the old links,
     clones and pull requests to the new name.
  2. Merge the rename pull request (it already uses the new links).
  3. Settings → Pages: check that the site is served at `https://fairedose.github.io/CHEPTA/`
     (the Pages workflow runs on the merge).
  4. npm (the name `chepta` was free on 2026-10-10). npm adds a trusted publisher only to a package
     that exists, so the first upload uses a token, once:
     1. npmjs.com → profile picture → Access Tokens → Generate New Token → Granular Access Token:
        expiry 1 day, Packages and scopes: Read and write, All packages. Copy the token.
     2. GitHub → Settings → Secrets and variables → Actions → New repository secret: name `NPM_TOKEN`,
        the token as value.
     3. Publish the v0.3.0 GitHub release (Releases → the draft, or Draft a new release with tag
        `v0.3.0`). The Publish workflow stages `chepta@0.3.0` with the token and attaches the skills
        (if the release already exists: Actions → Publish to npm → Run workflow, from `main`).
     3b. npmjs.com: approve the staged version with your 2FA code (the package's Staged Packages, or the
        link in npm's e-mail). Direct publishing with a token is refused by npm since 2026; staging is
        how a token can create a new package (GitHub changelog, 2026-10-02).
     4. npmjs.com → Packages → chepta → Settings → Trusted publishing → GitHub Actions: owner
        `FaireDose`, repository `CHEPTA`, workflow `publish.yml`.
     5. Delete the `NPM_TOKEN` secret on GitHub and the token on npmjs.com. Later releases are staged
        by the workflow without a token and approved on npmjs.com.
  5. npm: deprecate the old package with a pointer, `npm deprecate fugacity "Renamed: use chepta"`.
  6. Optional: check for an existing trademark (for example in the EUIPO and USPTO search
     tools) before wider promotion, and register the name where you want it protected.
  The file formats keep their keys (`fugacity_project`, `fugacity_package`), so files and
  contribution packages made under the old name stay valid.
- **The two free component places** of proposal 0008: use them now, or keep them.
- **Proposal 0005** (association models, [#48](https://github.com/FaireDose/Fugacity/pull/48)): deferred, on hold.

### Engineering, in the suggested order

1. Equation-of-state pairs: fit PR and SRK k_ij to the archive data of the 92 nonpolar or gas pairs
   that have none (docs/PAIR_SCAN.md, "Coverage by the method each pair needs"), and import the
   ChemSep k_ij of the proposal 0008 components that the batches did not bring in (for example
   methane + n-nonane).
2. Gases in polar liquids (139 pairs with archive data): Henry's-law constants for gases in water
   from the archive; other solvents need PSRK or MHV2, not in CHEPTA yet.
3. Review the two pairs whose 1-atm data sets disagree by more than 1 K (methanol + 2-propanol,
   water + 2-propanol; docs/PAIR_SCAN.md).
4. Compressor, pump and valve blocks (shown as "coming later"). Optionally, then the energy side
   of the Cavett problem (no published values to compare with).
5. A "measured solubility" option next to the model, for a future crystallizer block.
6. Grow the flowsheet suite: more seeds, P-H drums, and reactive cases once proposal 0010 exists.
7. Two liquids with an equation of state: low priority. Only with a proper method such as CPA,
   never a plain cubic equation (decision of 2026-10-09).

### After the proposals are accepted

- **0009, green chemistry components:**
  1. batch 1, 16 components from ChemSep and CoolProp;
  2. batch 2, lipids;
  3. batch 3, platform molecules from the WebBook and ThermoML, in small pull requests;
  4. the "nonvolatile" component class;
  5. batch 4, sugars and acids as solids.
  - Six names still need a CAS number: xylose, erythritol, muconic acid, levoglucosenone,
    glycerol carbonate, ethoxymethylfurfural.
- **0010, reactions:**
  1. formation data (ΔfH°, ΔfG°);
  2. the reaction description and its checks;
  3. conversion and yield reactors;
  4. equilibrium reactor;
  5. CSTR and plug flow;
  6. Gibbs reactor;
  7. views;
  8. benchmarks.
- **0011, agents:**
  1. the tool interface;
  2. the route-file format and its checker;
  3. two-pass extraction;
  4. the design-method file and decision records (first confirm the licence of the Northwestern
     open process-design textbook);
  5. route to flowsheet;
  6. comparison page;
  7. literature watch.

### On hold

- **UNIFAC:** until DDBST answers about the parameter licence (proposal 0008, Part A). DDBST was
  asked; nothing is installed.

## Standing rules from the maintainer

These apply to every piece of work, on top of [AGENTS.md](../AGENTS.md).

- **Pull requests:**
  - Every change goes through a pull request that the maintainer reviews and merges. The
    assistant never merges.
  - Each pull request starts from `main`; pull requests are not stacked.
- **No credit-consuming monitoring:** the assistant does not watch pull requests or schedule
  check-ins.
- **Method first (2026-10-09):** every test, benchmark and example first chooses the property
  method from the literature ([METHOD_SELECTION.md](METHOD_SELECTION.md)), then tests with it.
  For example, nobody uses an equation of state for water + ethanol, so no test should rely on
  one for that. A test that uses another method on purpose says so in a comment.
- **Rigorous methods, not patches:** when a solver fails, fix the method (as commercial
  simulators do), not the symptom.
- **Components, not reactions (2026-10-09):** the simulator ships components; users write the
  reactions of their own process, and Fugacity checks them. Reaction routes in green chemistry
  only guide which intermediates and products to add as components.
- **No two liquids with a plain cubic equation (2026-10-09):** if nobody uses it, Fugacity
  doesn't either.
- **Data:**
  - Good data and fits for everything. When ChemSep lacks something, go on to the NIST WebBook,
    the ThermoML Archive and other open sources (2026-10-06).
  - Known deviations go in the engineering report rather than being hidden (for example
    mesitylene, 2026-10-07).
- **Your files are yours:** files and results made with Fugacity belong to the people who
  make them ([#68](https://github.com/FaireDose/Fugacity/pull/68)).
- **Two licences on purpose:** MIT for the code, and the Artistic License 2.0 that must travel
  with the ChemSep data (README, [#81](https://github.com/FaireDose/Fugacity/pull/81)).

## Log

### 2026-10-10

- **`chepta@0.3.0` is on npm** (staged with the one-time token and approved on npmjs.com; served by
  jsDelivr). Still to do by the maintainer: steps 4.4 and 4.5 under Open items (trusted publisher,
  then delete the token and the secret), deprecate `fugacity`, and optionally deprecate the
  placeholder `chepta@0.0.0-stage`.
- **Front page:** the maintainer edits README.md directly (new flowsheet screenshot, shorter
  rename note, the "model predictions" sentence reworded, a shorter load prompt, updated
  parameter counts).
- **Engineering report comment made shorter:** the top gives the totals (❌ large, ⚠️ small,
  ✅ ok, not checked) and whether the pull request changes results; each group is folded, its
  title starting with its own counts, and opens on its problems, with every result folded
  again inside. ❌ large = a failed or lost calculation, or a deviation of more than twice the
  tolerance; the tolerances themselves are unchanged.
- **Assistants use the workbench's own exports:** asked for an Excel file of a flowsheet, ChatGPT
  wrote its own spreadsheet instead of using the workbench's. The instructions (use.md and the
  skill) now say: open the workbench and name the button (Download Excel, Excel concept model,
  Download CSV, Copy CSV, the Excel button of a diagram, File > Save); do not make the file or
  compute again in code; do not solve the flowsheet in code after `checkProject` passes; ask
  before building anything the workbench cannot do. A test keeps the button names in the
  instructions equal to those in the interface.
- **The rename is done on GitHub:** the repository is `FaireDose/CHEPTA`, #90 is merged, and the website
  is at https://fairedose.github.io/CHEPTA/. Next: the first npm upload of `chepta` with a one-time
  token (#93 merged; the steps are under Open items), after the pair data (#91).
- **Previewing a pull request before approving it:** #92 adds a workbench preview to every pull
  request (Checks → Preview → Summary → Artifacts); CONTRIBUTING.md says how to review.

### 2026-10-09 (night): pair data

- **Asked:** why common pairs such as 1-propanol + 1-butanol had no parameters, and to look for the data
  again; each pair needs only the model the method rules choose for it.
- **Found** (docs/PAIR_SCAN.md):
  - the ChemSep databank gave about 50 more activity-model pairs, now imported;
  - the whole NIST TRC ThermoML Archive (bulk file, 11,923 records) holds binary vapour-liquid data
    for 7,158 compound pairs, of which 704 are pairs of CHEPTA components;
  - 137 activity-model pairs fitted to it, one consistent data set each (validation/data/vle/), within
    fixed limits; for 25 more a data set was chosen but neither model followed it within the limits
    (for example 1-butanol + water, which splits into two liquids), so nothing was written; hydrocarbon
    pairs are left for equation-of-state k_ij.
- **Still without open data:** many classic pairs measured before 2003, for example ethanol +
  1-propanol; they stay on docs/DATA_WANTED.md.

### 2026-10-09 (evening)

- **The name is CHEPTA**, *Chemical Engineering Process Tools for Agents* (maintainer's decision).
  The rename pull request changes the name everywhere it means the software, keeps "fugacity" where
  it means the thermodynamic quantity, keeps the old script global `Fugacity` and the error class
  `FugacityError` as aliases, and keeps the file-format keys. Steps to make it official are under
  Open items.
- **Pair data**: the archive has fewer binary pairs than expected. Maintainer's point: each pair
  needs only the model the method rules choose for it (an equation of state for nonpolar pairs,
  an activity model for polar liquids), so coverage is to be counted per needed model.

### 2026-10-09

- **Questions answered:**
  - **The Cavett problem needs no compressor.** Its drums have a fixed temperature and pressure,
    and the published VMGSim flowsheet uses compressors only because VMGSim's separators are P-H
    flashes. Leaving them out loses only the energy side, which the paper does not publish.
  - **Which component batches are left:** none from proposal 0008. Urea, phthalic anhydride and
    caprolactam have no open data. Two of the four free places now hold isopentane and
    n-undecane for the Cavett problem, so two are left.
  - **The Cavett failures:** neither the recycle solver nor the models were wrong. Searches
    inside the flash gave up and stopped with an error. Two of the fixes in #84 were
    workarounds (a restart from 300 K, and a 1e-6 J/mol tolerance), which #86 now replaces.
  - **Liquid-liquid:** it works with NRTL and UNIQUAC. An equation of state detects a second
    liquid and refuses it.
  - **How proposal 0011 works.**
- **The AI agent (proposal 0011):** it must follow the way engineers build a process design. A
  "how the agent designs a process" section was added, level by level:
  1. design basis;
  2. inputs and outputs;
  3. reactor and recycles;
  4. separations;
  5. heat recovery;
  6. cost.

  Each decision is checked with Fugacity's tools, cited, and approved by a person before the
  next level.
- **Reactions:** Fugacity ships no reaction library. Proposal 0010 was changed so the user writes
  the reactions. In proposal 0009 the reaction table only explains why the intermediates and
  products were chosen as components.
- **Method selection rules** ([METHOD_SELECTION.md](METHOD_SELECTION.md)) were added and written
  into AGENTS.md. The flowsheet suite uses only cases with the recommended method and physical
  conditions.
- **Recycles:** Broyden is now the default recycle method, and new guards stop a recycle that
  grows without bound or a flowsheet that does not balance
  ([#84](https://github.com/FaireDose/Fugacity/pull/84), merged). The suite runs in CI on every
  pull request, so the maintainer has nothing to run by hand.
- **Merged:** [#83](https://github.com/FaireDose/Fugacity/pull/83) and [#84](https://github.com/FaireDose/Fugacity/pull/84).
- **Opened:**
  - [#85](https://github.com/FaireDose/Fugacity/pull/85): the older tests reviewed, and the
    equation-of-state k_ij of polar pairs labelled "not recommended".
  - [#86](https://github.com/FaireDose/Fugacity/pull/86): Newton flash with a stability check,
    replacing the restart from 300 K and the 1e-6 J/mol tolerance.
- **Documentation:**
  - this page;
  - an index of the documentation ([README.md](README.md));
  - one reference page per topic in [models/](models/).

### 2026-10-08

- **Merged:**
  - NRTL fits to measured solubilities ([#80](https://github.com/FaireDose/Fugacity/pull/80));
  - future property methods as locked chips, and alphabetical component lists ([#81](https://github.com/FaireDose/Fugacity/pull/81));
  - solid solubility in g/L and g/100 g ([#82](https://github.com/FaireDose/Fugacity/pull/82)).
- **Requested:**
  - a literature-based test method for the flowsheet solver, with many 3–7 component flowsheets
    with recycles (became the flowsheet suite, #84);
  - green chemistry components, including reaction intermediates and products (proposal 0009);
  - a reactions proposal: conversion, simple kinetics, user-defined (0010);
  - an agents-and-literature proposal (0011).
- **Interface:** future methods for ions and polymers are shown as unavailable, and the
  liquid/solid/gas tags were removed from the component list.

### 2026-10-07

- **Proposal 0008, components:** batches 1–3 ([#71](https://github.com/FaireDose/Fugacity/pull/71), [#73](https://github.com/FaireDose/Fugacity/pull/73), [#75](https://github.com/FaireDose/Fugacity/pull/75))
  and solids with solid-liquid equilibrium ([#77](https://github.com/FaireDose/Fugacity/pull/77), [#79](https://github.com/FaireDose/Fugacity/pull/79)).
  Urea, phthalic anhydride and caprolactam have no open data.
- **Measured data:** the engineering report now compares records with measured data
  ([#72](https://github.com/FaireDose/Fugacity/pull/72)).
- **Component search** by name, formula, CAS number or alias everywhere
  ([#74](https://github.com/FaireDose/Fugacity/pull/74)).
- **Excel:**
  - the flowsheet as Excel with the balances as formulas ([#65](https://github.com/FaireDose/Fugacity/pull/65));
  - an "Excel concept model" where the flash drums are formulas too ([#78](https://github.com/FaireDose/Fugacity/pull/78)).

### 2026-10-06

- **Workbench:**
  - it opens empty and loads faster in AI chats ([#49](https://github.com/FaireDose/Fugacity/pull/49));
  - project files, with naming ([#50](https://github.com/FaireDose/Fugacity/pull/50), [#53](https://github.com/FaireDose/Fugacity/pull/53)).
- **Proposal 0006, the first flowsheet**, accepted and built:
  - streams, blocks and a solver with recycles ([#54](https://github.com/FaireDose/Fugacity/pull/54)–[#57](https://github.com/FaireDose/Fugacity/pull/57));
  - degrees of freedom and energy streams ([#58](https://github.com/FaireDose/Fugacity/pull/58));
  - the workspace ([#59](https://github.com/FaireDose/Fugacity/pull/59));
  - navigation by section ([#60](https://github.com/FaireDose/Fugacity/pull/60));
  - ports, delete and reconnect, zoom, and solver settings ([#61](https://github.com/FaireDose/Fugacity/pull/61), [#63](https://github.com/FaireDose/Fugacity/pull/63), [#64](https://github.com/FaireDose/Fugacity/pull/64));
  - AI instructions ([#62](https://github.com/FaireDose/Fugacity/pull/62)).
- **Decided:**
  - the menu section is called "Properties & Equilibria" ([#66](https://github.com/FaireDose/Fugacity/pull/66));
  - in the flowsheet, the user first chooses components and method, then draws;
  - proposals 0007 and 0008 accepted, with UNIFAC on hold ([#67](https://github.com/FaireDose/Fugacity/pull/67), [#69](https://github.com/FaireDose/Fugacity/pull/69));
  - the name change waits until the flowsheet improves.
- **Association models:** no new association model for now; the current deviations are small
  except for the mixture enthalpy. Proposal 0005 stays deferred.

### 2026-10-03 to 2026-10-05

- **Workbench:**
  - one Model selector, with activity models and their vapour first, then equations of state;
  - diagrams in mol or wt %;
  - the Flash workspace with CSV export and feed flow in kmol/h, kg/h or t/h
    ([#37](https://github.com/FaireDose/Fugacity/pull/37), [#38](https://github.com/FaireDose/Fugacity/pull/38)).
- **Proposal 0004, the first 50 components:**
  - for hydrocarbons and aromatics, equations of state come first, with activity models also
    available;
  - batches and benchmark pairs ([#39](https://github.com/FaireDose/Fugacity/pull/39)–[#47](https://github.com/FaireDose/Fugacity/pull/47)).
- **New rule:** no PR monitoring, because it uses credits.

### Before 2026-10-03

- **Origin:** the project was started in Claude chat; v0.1 to v0.2.2 and proposals 0001–0004
  ([#1](https://github.com/FaireDose/Fugacity/pull/1)–[#31](https://github.com/FaireDose/Fugacity/pull/31)).
- **Flash, steps 1–5 of proposal 0001** ([#32](https://github.com/FaireDose/Fugacity/pull/32)–[#36](https://github.com/FaireDose/Fugacity/pull/36)).
