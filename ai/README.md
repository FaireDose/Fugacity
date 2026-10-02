# Fugacity for AI assistants

| File | What it is for |
|---|---|
| [START_PROMPTS.md](START_PROMPTS.md) | Copy-paste prompts: develop models and algorithms, shape the roadmap, review, add data |
| [instructions/use-fugacity.md](instructions/use-fugacity.md) | Instructions any assistant can follow to build Fugacity diagrams in a chat |
| [skills/fugacity/](skills/fugacity/SKILL.md) | The same, as a skill |
| [skills/fugacity-contributor/](skills/fugacity-contributor/SKILL.md) | Contribute by the project's rules, as a skill |
| [examples/](examples/) | Example contribution package |
| [../AGENTS.md](../AGENTS.md) | The rules every assistant, coding agent and contributor follows |
| [../llms.txt](../llms.txt) | An index of the project for assistants that browse the web |

## Install the skills

Short version for sharing: **https://fairedose.github.io/Fugacity/install** (download
links and the steps for each assistant; the zip is at
https://fairedose.github.io/Fugacity/skill.zip).

Two skills in the open `SKILL.md` format: **fugacity** (build diagrams) and
**fugacity-contributor** (contribute by the rules). Every release attaches them as zips:
[fugacity.zip](https://github.com/FaireDose/Fugacity/releases/latest/download/fugacity.zip)
and [fugacity-contributor.zip](https://github.com/FaireDose/Fugacity/releases/latest/download/fugacity-contributor.zip).

| Where | How |
|---|---|
| **Claude** (claude.ai and the desktop app, all plans) | Skills need code execution: turn on **Settings → Capabilities → Code execution and file creation**. Then **Customize → Skills → + → Create skill → Upload a skill** and choose a zip. On Team and Enterprise an owner first enables both in **Organization settings → Plugins & skills → Policy**. |
| **Claude Code** | `/plugin marketplace add FaireDose/Fugacity`, then `/plugin install fugacity@fugacity` (both skills) |
| **ChatGPT** (Business, Enterprise, Edu and Healthcare workspaces) | **Skills → Create → Upload from your computer**, choose a zip |
| **Codex** | `$skill-installer install https://github.com/FaireDose/Fugacity/tree/main/ai/skills/fugacity` (same for `fugacity-contributor`), then restart Codex if it doesn't show up |
| **Coding agents in a clone of this repository** | Nothing to install: they read [AGENTS.md](../AGENTS.md) |
| **Any other assistant** | Paste [instructions/use-fugacity.md](instructions/use-fugacity.md), or a prompt from [START_PROMPTS.md](START_PROMPTS.md), into the chat or its custom instructions, project, custom GPT or Gem |

Menu names change between app versions; if you can't find them, search your assistant's
help pages for "skills".

## Which chats can show Fugacity pages

| Assistant | Live pages with Fugacity | Status |
|---|---|---|
| Claude (artifacts) | Yes | Tested |
| ChatGPT (canvas) | Unknown | Not tested yet; please report |
| Gemini (canvas) | Unknown | Not tested yet; please report |
| Others | Unknown | Please report |

If you try one, open a [bug or interface issue](https://github.com/FaireDose/Fugacity/issues/new?template=bug.yml)
with what happened, so this table can be updated.
