# Contributing

Fugacity grows through chemical engineers who want an open process simulator: people who
know the models behind Aspen or DWSIM, can tell a sensible result from a wrong one, and
want open tools for teaching and design. You don't need to program: you bring the
engineering, your AI assistant (ChatGPT, Claude, Gemini or another) does the typing, and
you check the result.

The rules (open sources only, every number cited and checked, code rules) are in one
place: **[AGENTS.md](AGENTS.md)**. Your assistant reads them; please read them too.

## Two ways to contribute

### 1. Talk to your AI assistant, then submit a form

You need an AI assistant and a free [GitHub account](https://github.com/signup).

1. **Pick something:** an item from the [roadmap](ROADMAP.md), a model you know well, or
   a pair from the [data wanted list](docs/DATA_WANTED.md).
2. **Paste a prompt** from [ai/START_PROMPTS.md](ai/START_PROMPTS.md) into your assistant.
   It points the assistant to AGENTS.md; if your assistant can't open links, attach that
   file. To have the rules always loaded, install the contributor skill
   ([how](ai/README.md#install-the-skills)).
3. **Work it out together**, then check the result yourself: the equations and
   references of a proposal, every number of a data package against its source.
4. **Submit** with one of the three forms:
   - [Proposal, model or feature](https://github.com/FaireDose/Fugacity/issues/new?template=model-or-feature.yml):
     development work or a roadmap item;
   - [Data](https://github.com/FaireDose/Fugacity/issues/new?template=ai-contribution.yml):
     data for a pair, a new component, a correction or a validation case;
   - [Bug](https://github.com/FaireDose/Fugacity/issues/new?template=bug.yml): something
     that doesn't work or displays wrongly.

A maintainer or a coding agent turns it into a pull request, and a reviewer checks it.

### 2. Join as a contributor and let a coding agent open pull requests

Anyone can join the project as a contributor. Contributors open pull requests directly:
the natural way for development work (equations of state, algorithms, unit operations,
reactors, views), with Claude Code, OpenAI Codex, GitHub Copilot's coding agent, Cursor or
another agent. They read AGENTS.md automatically.

1. Connect the agent to your GitHub account.
2. Ask it, for example: *"Follow AGENTS.md. Implement proposal NNNN (or roadmap item
   ...), validate it against an independent implementation and open data, run the tests,
   and open a pull request to FaireDose/Fugacity."*
3. Read what it changed before the pull request goes out: the equations, the references
   and the validation results.

New models, algorithms, layers, interfaces and file formats start as a short
[proposal](proposals/README.md) (path 1 is the easy way to write one); small items (a
view, a fix) can go straight to a pull request.

Your assistant or agent runs on your own account. The project never asks for your keys or
passwords.

## The ambitious part

Besides the simulator core and the **bridges** to spreadsheets, data files and other
simulators (track B), the [roadmap](ROADMAP.md) has two long-term tracks where
engineering experience matters more than code:

- **Cost engineering (E):** equipment sizing, capital and operating cost, cost of
  production per kg, with correlations from open sources. If you have estimated plants,
  you know which correlations are sensible and what accuracy to claim.
- **Agentic design (G):** AI agents that read open papers and patents, build flowsheets
  for several process routes, simulate and cost them, and recommend one, with every
  number traced. Engineers define how such a study should be done, write benchmark case
  studies with known answers, and review what the agents produce.

Start with a proposal (path 1 above), for example with the prompt *"Work on the ambitious
tracks"* in [ai/START_PROMPTS.md](ai/START_PROMPTS.md).

## What happens next

Every pull request runs the automatic tests and is reviewed by someone other than its
author; data changes need a data reviewer. Roles and decisions:
[GOVERNANCE.md](GOVERNANCE.md). Larger changes and new roadmap items go through a
[proposal](proposals/README.md); reviewing other people's proposals with your engineering
judgement is one of the most useful contributions.

By contributing you agree that your contribution is published under the project's
licenses (MIT for code; data under the license of its source) and that you follow the
[code of conduct](CODE_OF_CONDUCT.md).
