# Contributing

Fugacity grows through chemical engineers: people who know where good data lives, can
tell a sensible result from a wrong one, and want better open tools for teaching and
design. You don't need to be a software engineer.

**The main way to contribute is through your AI assistant**: ChatGPT, Claude, Gemini,
Copilot or any other. You talk to it; it searches open sources, reads the project's rules
and prepares your contribution in the right format; you check the numbers and submit.
Working without an assistant is also fine, see [below](#without-an-ai-assistant).

## What you can contribute

| Contribution | What it involves | Typical time |
|---|---|---|
| **Data for a pair** (most wanted) | Find open experimental VLE data for a pair on the [data wanted list](docs/DATA_WANTED.md) | 30–60 minutes with an assistant |
| **A component** | Constants and vapour pressure from open sources | 20–30 minutes |
| **A correction** | A value or result that disagrees with an open source | 10 minutes |
| **A review** | Check someone else's numbers against their source | 15–30 minutes |
| **Roadmap work** | A feature, or a proposal for an architecture step | days |

## Contribute through your AI assistant

There are three levels. Start with level 1; move up only if you want to.

### Level 1: chat only (any assistant, any plan)

You need: an AI assistant, and a free [GitHub account](https://github.com/signup) to submit.

1. Pick a pair from the [data wanted list](docs/DATA_WANTED.md), or another contribution.
2. Open your assistant and paste a prompt from [ai/START_PROMPTS.md](ai/START_PROMPTS.md).
   Each prompt points the assistant to the rules in [AGENTS.md](AGENTS.md). If your
   assistant can't open links, attach or paste that file.
3. The assistant searches open sources and prepares a **contribution package**: one JSON
   document with the data, its source and the table it came from.
4. **Check every number against the source yourself.** Assistants make transcription
   mistakes. Then set `"checked_by_human": true` in the package.
5. Submit it with the
   [AI-prepared contribution](https://github.com/FaireDose/Fugacity/issues/new?template=ai-contribution.yml)
   form. A maintainer or a coding agent turns it into a pull request, and a reviewer checks
   it.

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

Coding agents can change files, run the tests and open the pull request for you. Examples:
Claude Code, OpenAI Codex, GitHub Copilot's coding agent, Cursor. Most of them read
[AGENTS.md](AGENTS.md) automatically.

1. **Make your own copy of the repository:** on the
   [repository page](https://github.com/FaireDose/Fugacity) click **Fork** → **Create fork**.
2. **Connect the agent to your GitHub account** with its own setup (each agent has a
   "connect GitHub" or "add repository" step). Give it access to your fork only.
3. **Ask it**, for example: *"Follow AGENTS.md. Add the data in this package to Fugacity,
   fit the parameters, run the tests, and open a pull request to FaireDose/Fugacity."*
4. **Read what it changed** before the pull request goes out, and check the numbers.

Your assistant or agent runs on your own account and plan. The project never asks for
your keys or passwords, and its own keys are used only by maintainers.

## Without an AI assistant

Everything above works by hand too: open an issue with one of the
[forms](https://github.com/FaireDose/Fugacity/issues/new/choose), or edit the files and
open a pull request. The formats are described below and in [AGENTS.md](AGENTS.md).

## The rules

These apply to everyone, human or AI, and are repeated in [AGENTS.md](AGENTS.md).

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

## Roadmap work

The [roadmap](ROADMAP.md) lists what comes next, including the **architecture track**
(design steps A1–A12) and the **assistant compatibility** track.

- **Small items:** open an issue saying you're taking it, then a pull request.
- **Architecture steps, interface or file-format changes:** write a proposal first, see
  [proposals/](proposals/README.md). An assistant can help you draft it; see the prompt in
  [ai/START_PROMPTS.md](ai/START_PROMPTS.md).

Engine code follows [ARCHITECTURE.md](ARCHITECTURE.md): each layer only uses the one below it.

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
