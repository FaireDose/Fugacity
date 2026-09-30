# Contributing

Fugacity grows through chemical engineers who want an open process simulator: people who
know the models behind Aspen or DWSIM, can tell a sensible result from a wrong one, and
want better open tools for teaching and design. You don't need to be a software engineer.

**The main way to contribute is through your AI assistant**: ChatGPT, Claude, Gemini,
Copilot or any other. You bring the engineering (which equation of state, which mixing
rule, which flash algorithm, how to validate it); the assistant reads the project's rules,
writes the code or prepares the data in the right format; you check the result and
submit. Working without an assistant is also fine, see [below](#without-an-ai-assistant).

## What you can contribute

| Contribution | Examples | Typical time |
|---|---|---|
| **Develop the simulator** | An equation of state (Peng–Robinson, SRK), an activity model (Wilson, UNIFAC), dew points and flash algorithms, enthalpy, unit operations, the flowsheet solver, new views. See [Develop the simulator](#develop-the-simulator) | days, with an assistant |
| **Shape the roadmap** | Write a proposal for an architecture step, propose a new roadmap item, review someone's proposal | hours |
| **Data for a pair** | Find open experimental VLE data for a pair on the [data wanted list](docs/DATA_WANTED.md) | 30–60 minutes with an assistant |
| **A component** | Constants and vapour pressure from open sources | 20–30 minutes |
| **A correction or a review** | A result that disagrees with an open source; checking someone else's work | 10–30 minutes |

## Contribute through your AI assistant

There are three levels. Start with level 1; move up only if you want to.

### Level 1: chat only (any assistant, any plan)

You need: an AI assistant, and a free [GitHub account](https://github.com/signup) to submit.

1. Pick something: a roadmap item from [ROADMAP.md](ROADMAP.md), a model you know well,
   or a pair from the [data wanted list](docs/DATA_WANTED.md).
2. Open your assistant and paste a prompt from [ai/START_PROMPTS.md](ai/START_PROMPTS.md).
   Each prompt points the assistant to the rules in [AGENTS.md](AGENTS.md). If your
   assistant can't open links, attach or paste that file.
3. Work it out together:
   - **Development:** the assistant drafts a **proposal** (the design, the equations with
     open references, and how it will be validated) and can draft the code. Submit it with
     the [model or feature](https://github.com/FaireDose/Fugacity/issues/new?template=model-or-feature.yml)
     form. Once the proposal is accepted, the code follows through level 3 or a maintainer.
   - **Data:** the assistant searches open sources and prepares a **contribution
     package** (one JSON document with the data, its source and table). Check every number
     against the source, set `"checked_by_human": true`, and submit it with the
     [AI-prepared contribution](https://github.com/FaireDose/Fugacity/issues/new?template=ai-contribution.yml)
     form.
4. A maintainer or a coding agent turns it into a pull request, and a reviewer checks it.

### Level 2: let your assistant read the repository

The assistant then sees the current data and the wanted list, so it avoids duplicates and
uses the project's names. The repository is public, so this is read-only and safe.

- **Claude:** in a chat, click **+** → **Add from GitHub**, paste
  `https://github.com/FaireDose/Fugacity`, and select `AGENTS.md`, `docs/DATA_WANTED.md`
  and the `src/data` folder.
- **ChatGPT:** connect the GitHub app under **Settings → Apps** (called **Plugins** in some
  versions), authorize it on GitHub, then mention the repository in your chat.
  Availability depends on your plan.
- **Other assistants:** give them the links in [llms.txt](llms.txt); most can read raw
  files from GitHub.

Then continue as in level 1.

### Level 3: let a coding agent open the pull request

This is the natural level for development work: equations of state, algorithms, unit
operations and views are code, and a coding agent can write it, run the tests and open the
pull request for you. Examples:
Claude Code, OpenAI Codex, GitHub Copilot's coding agent, Cursor. Most of them read
[AGENTS.md](AGENTS.md) automatically.

1. **Make your own copy of the repository:** on the
   [repository page](https://github.com/FaireDose/Fugacity) click **Fork** → **Create fork**.
2. **Connect the agent to your GitHub account** with its own setup (each agent has a
   "connect GitHub" or "add repository" step). Give it access to your fork only.
3. **Ask it**, for example: *"Follow AGENTS.md. Implement the Peng–Robinson equation of
   state as described in the accepted proposal, validate it against an independent Python
   implementation, run the tests, and open a pull request to FaireDose/Fugacity."*
4. **Read what it changed** before the pull request goes out: the equations, the
   references, and the validation results.

Your assistant or agent runs on your own account and plan. The project never asks for
your keys or passwords, and its own keys are used only by maintainers.

## Develop the simulator

The [roadmap](ROADMAP.md) is the list of what to build, from thermodynamics up to the
flowsheet. Anyone can pick an item, and anyone can propose new ones.

### How development works

1. **Claim it.** Open an issue (or a
   [model or feature](https://github.com/FaireDose/Fugacity/issues/new?template=model-or-feature.yml)
   form) saying what you will build, so work isn't duplicated.
2. **Propose it.** New models, algorithms, layers, interfaces and file formats start as a
   short [proposal](proposals/README.md): the equations with open references, where the
   code fits in [ARCHITECTURE.md](ARCHITECTURE.md), and how it will be validated. Small
   items (a new view, a unit conversion, a fix) can go straight to a pull request.
3. **Build it** in the right layer. Each layer only uses the one below it: a new equation of
   state belongs in the thermodynamics layer and must not know about unit operations.
4. **Validate it independently.** Compare against an independent implementation (the
   Python reference in [`validation/python/`](validation/python), or an open library such
   as [thermo](https://github.com/CalebBell/thermo)) and against open experimental data or
   published worked examples. The comparison goes into `test/`.
5. **Open the pull request.** A reviewer checks the equations, the references and the
   validation.

### Example: adding the Peng–Robinson equation of state

1. **Proposal:** Peng–Robinson (1976) with the classic alpha function and van der Waals
   mixing rules with binary interaction parameters `k_ij`; later variants (Twu alpha,
   volume translation, Wong–Sandler mixing with an activity model) as follow-ups. It
   extends the property package ([proposal 0001](proposals/0001-property-package.md)) with
   fugacity coefficients for both phases (φ-φ), next to the existing γ-φ route.
2. **Data:** critical constants and acentric factors from the NIST Chemistry WebBook or an
   open databank; `k_ij` from an openly licensed set (ChemSep ships Peng–Robinson `k_ij`)
   or fitted to open data. Acentric factors are a new component field.
3. **Code:** `src/thermo/eos/pengRobinson.js`: cubic solution for Z, phase selection,
   `ln φ_i`, residual enthalpy for later energy balances.
4. **Validation:** pure-component vapour pressures and saturated densities against the NIST
   WebBook; binary VLE for a hydrocarbon system against open data; every value also
   against an independent Python implementation.
5. **View:** allow `model: "PR"` in `Fugacity.mount`, so the T-x-y and P-x-y diagrams work
   with the new model.

### Other development items to pick up

| Area | Items | Roadmap |
|---|---|---|
| Thermodynamics | Property package with enthalpy; Wilson; modified UNIFAC (Dortmund); SRK and Peng–Robinson; liquid-liquid equilibria | A1, A3, v0.2, v0.3, Later |
| Equilibrium algorithms | Dew points; PT, PH and PQ flash; phase stability (tangent plane); VLLE | A4, v0.2, v0.3 |
| Streams and units | Stream object; mixer, splitter, heater/cooler, pump, valve, flash drum | A5, A6, v0.3, v0.4 |
| Flowsheet | File format; sequential-modular solver with recycles; design specifications | A7, A8, v0.4 |
| Distillation | Shortcut column; McCabe–Thiele; rigorous MESH column | v0.5 |
| Interface | P-x-y view; flowsheet drawing; stream tables; column profiles; background workers | A9, A11 |
| Working with assistants | Schemas and checks that tell an assistant exactly what to fix | A10, C5 |

## Without an AI assistant

Everything above works by hand too: open an issue with one of the
[forms](https://github.com/FaireDose/Fugacity/issues/new/choose), or edit the files and
open a pull request. The formats are described below and in [AGENTS.md](AGENTS.md).

## The rules

These apply to everyone, human or AI, and are repeated in [AGENTS.md](AGENTS.md). Rules
1–3 apply to every number: data, constants, parameters, and the reference values used to
validate a model.

1. **Open sources only.** Every number must come from a source that anyone can read for
   free, so any reviewer can check it:
   - open-access articles (for example CC BY journals, open-access papers in
     *J. Chem. Eng. Data*);
   - the [NIST TRC ThermoML Archive](https://trc.nist.gov/ThermoML/), which publishes the data
     of *J. Chem. Eng. Data*, *J. Chem. Thermodynamics*, *Fluid Phase Equilibria*,
     *Thermochimica Acta* and *Int. J. Thermophysics* (about 2003–2019) under the NIST open
     license, even when the article itself is behind a paywall;
   - the [NIST Chemistry WebBook](https://webbook.nist.gov/) for pure-component properties;
   - open data repositories (Zenodo, figshare, university repositories, open theses);
   - databanks with a license that allows redistribution (for example ChemSep).

   Not accepted: numbers from paywalled articles or commercial databanks (DDB, DIPPR,
   DECHEMA volumes) that are not also available openly.
2. **Every number has a source:** citation, DOI or link, and the table or figure. Say if
   values were read off a graph.
3. **A person checks every number** an assistant transcribed. Numbers an assistant
   "remembers" without a source are never accepted.
4. **Every model has a test** against experimental data or an independent calculation.
   Equations and algorithms cite an open reference (textbook, open article, or openly
   documented implementation).
5. **Record the license** of any new source in [`src/data/LICENSES.md`](src/data/LICENSES.md).

## Formats

### Contribution package

What your assistant prepares; described in [AGENTS.md](AGENTS.md#contribution-package-format),
with a full example in [ai/examples/](ai/examples/). To check a package:
`npm run check-package -- file.json`, or in a page `Fugacity.checkPackage(pkg)`. The check
catches missing sources, invalid CAS numbers, mole fractions outside 0–1 and similar
mistakes; the reviewer still checks the numbers themselves.

### Component entry

Components live in [`src/data/components.json`](src/data/components.json):

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

### Validation data

Experimental data used for fitting or testing goes into
[`validation/data/`](validation/data) as JSON with a `source` block (citation, doi,
open_copy, access, tables). Parameters are fitted with
[`validation/python/fit_parameters.py`](validation/python/fit_parameters.py): add an entry
to `FITS` and run it with `--write`.

## Shape the roadmap

The roadmap is not fixed. To add an item or change priorities, open a
[model or feature](https://github.com/FaireDose/Fugacity/issues/new?template=model-or-feature.yml)
issue or a discussion in the *Proposals* category; larger changes become a proposal and
are decided as described in [GOVERNANCE.md](GOVERNANCE.md). Reviewing other people's
proposals, with your engineering judgement, is one of the most useful contributions.

## How a contribution gets in

1. **Issue or package** submitted through a form.
2. **Pull request** made by you, your coding agent, another contributor, or a maintainer
   (possibly with Claude's GitHub integration).
3. **Automatic checks** run: all tests, the validation data, the data wanted list.
4. **Independent review** by someone other than the author, with the checklist in the
   pull request. Data changes need a data reviewer (see [GOVERNANCE.md](GOVERNANCE.md)).
5. **Merge and release.**

## Running the checks yourself

You need [Node.js](https://nodejs.org) 22 or newer.

```
npm install
npm run build
npm test
npm run wanted                           # refresh docs/DATA_WANTED.md after changing data
npm run check-package -- file.json       # check a contribution package
```

The Python tools in [`validation/python/`](validation/python) need numpy and scipy. After
changing parameters, regenerate the reference results with
`python validation/python/make_fixtures.py`.

By contributing you agree that your contribution is published under the project's
licenses (MIT for code; data under the license of its source) and that you follow the
[code of conduct](CODE_OF_CONDUCT.md).
