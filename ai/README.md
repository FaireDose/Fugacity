# Working with Fugacity through AI assistants

Fugacity is built to be used and extended from AI chats such as ChatGPT, Claude, Gemini or
Copilot. This folder holds everything an assistant needs.

| File | What it is for |
|---|---|
| [START_PROMPTS.md](START_PROMPTS.md) | Copy-paste prompts for contributing: find data, add a component, report a problem, review, draft a proposal |
| [instructions/use-fugacity.md](instructions/use-fugacity.md) | Instructions any assistant can follow to build Fugacity diagrams in a chat |
| [skills/fugacity/](skills/fugacity/SKILL.md) | The same, as a Claude skill |
| [skills/fugacity-contributor/](skills/fugacity-contributor/SKILL.md) | Contributor rules as a Claude skill |
| [examples/](examples/) | Example contribution packages |
| [../AGENTS.md](../AGENTS.md) | The rules every assistant and coding agent follows in this repository |
| [../llms.txt](../llms.txt) | An index of the project for assistants that browse the web |

How the pieces fit: an assistant reads `AGENTS.md`, prepares a **contribution package**
(one JSON document with the data and its open source), the person checks the numbers and
submits it. Maintainers or coding agents turn it into a pull request, and a reviewer
checks it before it is merged. See [CONTRIBUTING.md](../CONTRIBUTING.md).

## Which chats can show Fugacity pages

| Assistant | Live pages with Fugacity | Status |
|---|---|---|
| Claude (artifacts) | Yes | Tested with version 0.1.2 |
| ChatGPT (canvas) | Unknown | Not tested yet; please report |
| Gemini (canvas) | Unknown | Not tested yet; please report |
| Others | Unknown | Please report |

If you try one, open a [bug or interface issue](https://github.com/FaireDose/Fugacity/issues/new?template=bug.yml)
with what happened, so this table can be updated.
