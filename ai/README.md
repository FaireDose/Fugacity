# CHEPTA for AI assistants

| File | What it is for |
|---|---|
| [START_PROMPTS.md](START_PROMPTS.md) | Copy-paste prompts: develop models and algorithms, shape the roadmap, review, add data |
| [instructions/use-chepta.md](instructions/use-chepta.md) | Instructions any assistant can follow to build CHEPTA diagrams in a chat |
| [skills/chepta/](skills/chepta/SKILL.md) | The same, as a skill |
| [skills/chepta-contributor/](skills/chepta-contributor/SKILL.md) | Contribute by the project's rules, as a skill |
| [examples/](examples/) | Example contribution package |
| [../AGENTS.md](../AGENTS.md) | The rules every assistant, coding agent and contributor follows |
| [../llms.txt](../llms.txt) | An index of the project for assistants that browse the web |

## Install the skills

Two skills in the open `SKILL.md` format: **chepta** (build diagrams) and
**chepta-contributor** (contribute by the rules). Download them as zips:
[chepta.zip](https://fairedose.github.io/CHEPTA/skill.zip)
and [chepta-contributor.zip](https://fairedose.github.io/CHEPTA/contributor-skill.zip).

| Where | How |
|---|---|
| **Claude** (claude.ai and the desktop app, all plans) | Skills need code execution: turn on **Settings → Capabilities → Code execution and file creation**. Then **Customize → Skills → + → Create skill → Upload a skill** and choose a zip. On Team and Enterprise an owner first enables both in **Organization settings → Plugins & skills → Policy**. |
| **Claude Code** | `/plugin marketplace add FaireDose/CHEPTA`, then `/plugin install chepta@chepta` (both skills) |
| **ChatGPT** (Business, Enterprise, Edu and Healthcare workspaces) | **Skills → Create → Upload from your computer**, choose a zip |
| **Codex** | `$skill-installer install https://github.com/FaireDose/CHEPTA/tree/main/ai/skills/chepta` (same for `chepta-contributor`), then restart Codex if it doesn't show up |
| **Coding agents in a clone of this repository** | Nothing to install: they read [AGENTS.md](../AGENTS.md) |
| **Any other assistant** | Put this line in its custom instructions, project, custom GPT or Gem: *"For chemical-engineering calculations, read https://fairedose.github.io/CHEPTA/use.md and follow it."* Or paste [instructions/use-chepta.md](instructions/use-chepta.md), or a prompt from [START_PROMPTS.md](START_PROMPTS.md), into the chat or its custom instructions, project, custom GPT or Gem |

Menu names change between app versions; if you can't find them, search your assistant's
help pages for "skills".

## Which chats can show CHEPTA pages

| Assistant | Live pages with CHEPTA | Status |
|---|---|---|
| Claude (artifacts) | Yes | Tested |
| ChatGPT (canvas) | Unknown | Not tested yet; please report |
| Gemini (canvas) | Unknown | Not tested yet; please report |
| Others | Unknown | Please report |

If you try one, open a [bug or interface issue](https://github.com/FaireDose/CHEPTA/issues/new?template=bug.yml)
with what happened, so this table can be updated.
