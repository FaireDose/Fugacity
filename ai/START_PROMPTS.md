# Starter prompts

Copy one of these into your AI assistant (ChatGPT, Claude, Gemini, Copilot or another).
They all begin by pointing the assistant to the project's rules in
[AGENTS.md](../AGENTS.md). If your assistant cannot open links, attach or paste that file
instead.

Your own assistant account does the work; the project never asks for your keys or
passwords.

## Find open data for a pair

> Read https://raw.githubusercontent.com/FaireDose/Fugacity/main/AGENTS.md and follow it.
> I want to contribute open experimental vapour-liquid equilibrium data for
> **water + 1-propanol**. Search open sources (open-access articles, the NIST ThermoML
> Archive, open repositories), tell me what you find with links, and prepare a Fugacity
> contribution package from the best data set. Do not use numbers you have not read in
> the source.

Pick your pair from the [data wanted list](../docs/DATA_WANTED.md).

## Add a component

> Read https://raw.githubusercontent.com/FaireDose/Fugacity/main/AGENTS.md and follow it.
> Help me add **1-propanol** to Fugacity: constants from the NIST Chemistry WebBook,
> vapour-pressure coefficients from an open source, UNIQUAC r and q. Prepare a
> contribution package of type "component" and list every source.

## Report a wrong result

> Read https://raw.githubusercontent.com/FaireDose/Fugacity/main/AGENTS.md and follow it.
> Fugacity gives **[what you saw]** for **[system and conditions]**, but **[open source]**
> reports **[value]**. Help me prepare a contribution package of type "correction".

## Review a contribution

> Read https://raw.githubusercontent.com/FaireDose/Fugacity/main/AGENTS.md and follow it.
> Review pull request **https://github.com/FaireDose/Fugacity/pull/NN**: compare every
> number in it with the cited source and list any differences. Do not approve it; I will
> write the review myself.

## Draft a roadmap proposal

> Read https://raw.githubusercontent.com/FaireDose/Fugacity/main/AGENTS.md,
> https://raw.githubusercontent.com/FaireDose/Fugacity/main/ARCHITECTURE.md and
> https://raw.githubusercontent.com/FaireDose/Fugacity/main/ROADMAP.md. Help me write a
> proposal for roadmap step **A4 (equilibrium solver contract)** using
> https://raw.githubusercontent.com/FaireDose/Fugacity/main/proposals/0000-template.md.

## After the assistant answers

1. Check every number it transcribed against the source, then set
   `"checked_by_human": true` in the package.
2. Submit the package with the
   [AI-prepared contribution](https://github.com/FaireDose/Fugacity/issues/new?template=ai-contribution.yml)
   form. If your assistant can open pull requests (see CONTRIBUTING.md, level 3), let it do
   that instead.
