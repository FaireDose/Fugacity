# Working with Fugacity through AI assistants

Fugacity is built to be used and extended from AI chats such as ChatGPT, Claude, Gemini or
Copilot. This folder holds everything an assistant needs.

| File | What it is for |
|---|---|
| [START_PROMPTS.md](START_PROMPTS.md) | Copy-paste prompts: develop models and algorithms, shape the roadmap, review, add data |
| [instructions/use-fugacity.md](instructions/use-fugacity.md) | Instructions any assistant can follow to build Fugacity diagrams in a chat |
| [skills/fugacity/](skills/fugacity/SKILL.md) | The same, as a skill (`SKILL.md` format) |
| [skills/fugacity-contributor/](skills/fugacity-contributor/SKILL.md) | Contributor rules as a skill |
| [examples/](examples/) | Example contribution packages |
| [../AGENTS.md](../AGENTS.md) | The rules every assistant and coding agent follows in this repository |
| [../llms.txt](../llms.txt) | An index of the project for assistants that browse the web |

How the pieces fit: an assistant reads `AGENTS.md`, prepares a **contribution package**
(one JSON document with the data and its open source), the person checks the numbers and
submits it. Maintainers or coding agents turn it into a pull request, and a reviewer
checks it before it is merged. See [CONTRIBUTING.md](../CONTRIBUTING.md).

## Install the skills

Skills use the open `SKILL.md` format, which Claude, ChatGPT, Codex and a growing number of
other tools understand. Each [release](https://github.com/FaireDose/Fugacity/releases/latest)
has the skills attached as ready-to-upload files: `fugacity.zip` (build Fugacity diagrams)
and `fugacity-contributor.zip` (contribute by the project's rules).

| Where | How |
|---|---|
| **Claude** (Pro, Max, Team, Enterprise) | **Settings → Capabilities → Skills → Upload skill**, choose the zip |
| **ChatGPT** (paid plans) | **Plugins → Skills → Create → Upload from your computer**, choose the zip |
| **Codex** (all plans) | Unzip into `.agents/skills/` in your project or `~/.agents/skills/` |
| **Coding agents in a clone of this repository** | Nothing to install: they read [AGENTS.md](../AGENTS.md) |
| **Assistants without skills** | Paste [instructions/use-fugacity.md](instructions/use-fugacity.md) or a prompt from [START_PROMPTS.md](START_PROMPTS.md) |

Menu names change between versions of each app; if you can't find them, search your
assistant's help pages for "skills".

## Which chats can show Fugacity pages

| Assistant | Live pages with Fugacity | Status |
|---|---|---|
| Claude (artifacts) | Yes | Tested with version 0.1.2 |
| ChatGPT (canvas) | Unknown | Not tested yet; please report |
| Gemini (canvas) | Unknown | Not tested yet; please report |
| Others | Unknown | Please report |

If you try one, open a [bug or interface issue](https://github.com/FaireDose/Fugacity/issues/new?template=bug.yml)
with what happened, so this table can be updated.
