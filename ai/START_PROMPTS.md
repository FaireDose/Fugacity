# Starter prompts

Copy one of these into your AI assistant (ChatGPT, Claude, Gemini, Copilot or another).
They all begin by pointing the assistant to the project's rules in
[AGENTS.md](../AGENTS.md). If your assistant cannot open links, attach or paste that file
instead. Replace the parts in **bold** with your own choice.

Your own assistant account does the work; the project never asks for your keys or
passwords.

## Develop the simulator

### Add a thermodynamic model

> Read https://raw.githubusercontent.com/FaireDose/Fugacity/main/AGENTS.md,
> https://raw.githubusercontent.com/FaireDose/Fugacity/main/ARCHITECTURE.md and
> https://raw.githubusercontent.com/FaireDose/Fugacity/main/proposals/0000-template.md.
> I want to add the **Wilson activity model** to Fugacity. Help me write the proposal:
> the equations with open references, which layer and interface it extends, which new
> component data it needs and from which open sources, and how we will validate it
> (independent implementation and open data).

Other models: modified UNIFAC (Dortmund), Peng–Robinson with Wong–Sandler mixing,
liquid-liquid equilibria.

### Build an algorithm or a unit operation

> Read https://raw.githubusercontent.com/FaireDose/Fugacity/main/AGENTS.md,
> https://raw.githubusercontent.com/FaireDose/Fugacity/main/ARCHITECTURE.md and
> https://raw.githubusercontent.com/FaireDose/Fugacity/main/ROADMAP.md.
> I want to work on **the isothermal (PT) flash**. Explain which roadmap and architecture
> steps it depends on, propose the algorithm with open references, and write the tests
> that would prove it right. If I give you access to my fork, implement it.

Other items: dew points, PH flash, tangent-plane stability test, stream object, mixer,
flash drum, recycle solver, shortcut column, McCabe–Thiele view.

### Implement an accepted proposal (coding agents)

> Follow AGENTS.md. Implement **proposal 0001 (property package)** in this repository:
> code in the right layer, tests against an independent calculation and open data, all
> checks passing. Then open a pull request to FaireDose/Fugacity with the template filled
> in.

## Shape the roadmap

### Propose a new roadmap item

> Read https://raw.githubusercontent.com/FaireDose/Fugacity/main/ROADMAP.md and
> https://raw.githubusercontent.com/FaireDose/Fugacity/main/ARCHITECTURE.md. I think
> Fugacity should support **[your idea, for example reactive distillation]**. Help me
> write it up as a roadmap item: why it matters, what it depends on, and the steps.

### Review a proposal

> Read https://raw.githubusercontent.com/FaireDose/Fugacity/main/AGENTS.md. Review
> **https://github.com/FaireDose/Fugacity/pull/NN** as an experienced process engineer:
> check the equations against their references, the validation plan, and whether it fits
> the architecture. List concrete objections and what would resolve them. I will post the
> review myself.

## Add data

### Find open data for a pair

> Read https://raw.githubusercontent.com/FaireDose/Fugacity/main/AGENTS.md and follow it.
> I want to contribute open experimental vapour-liquid equilibrium data for
> **water + 1-propanol**. Search open sources (open-access articles, the NIST ThermoML
> Archive, open repositories), tell me what you find with links, and prepare a Fugacity
> contribution package from the best data set. Do not use numbers you have not read in
> the source.

Pick your pair from the [data wanted list](../docs/DATA_WANTED.md).

### Add a component

> Read https://raw.githubusercontent.com/FaireDose/Fugacity/main/AGENTS.md and follow it.
> Help me add **1-propanol** to Fugacity: constants from the NIST Chemistry WebBook,
> vapour-pressure coefficients from an open source, UNIQUAC r and q. Prepare a
> contribution package of type "component" and list every source.

### Report a wrong result

> Read https://raw.githubusercontent.com/FaireDose/Fugacity/main/AGENTS.md and follow it.
> Fugacity gives **[what you saw]** for **[system and conditions]**, but **[open source]**
> reports **[value]**. Help me prepare a contribution package of type "correction".

## After the assistant answers

Read the result critically; you are the engineer. Check every number against its source,
then submit:

- proposals and development ideas: the
  [Proposal, model or feature](https://github.com/FaireDose/Fugacity/issues/new?template=model-or-feature.yml)
  form, or let your coding agent open a pull request ([CONTRIBUTING.md](../CONTRIBUTING.md));
- data packages, components, corrections: the
  [Data](https://github.com/FaireDose/Fugacity/issues/new?template=ai-contribution.yml) form.
