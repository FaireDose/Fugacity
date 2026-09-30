# Governance

How decisions are made in Fugacity, who can do what, and how to take on more
responsibility. This document changes only through an accepted proposal.

## Roles

| Role | Who | Can |
|---|---|---|
| **User** | Anyone using Fugacity, in an AI chat, a web page or code | Open issues, comment, vote in polls |
| **Contributor** | Anyone who has submitted a contribution package or a pull request, with or without an AI assistant | Propose changes and proposals |
| **Data reviewer** | Experienced chemical engineers and academics, listed in `.github/CODEOWNERS` | Approve changes to `src/data/` and `validation/` |
| **Maintainer** | People with write access, listed below | Merge approved pull requests, triage issues, ask Claude to draft pull requests, publish releases |
| **Lead maintainer** | The project founder | Everything above, repository administration, final decision when there is no consensus |

Current maintainers:

- @FaireDose (lead maintainer)

## How decisions are made

**Everyday changes** (new data, fixes, small features): a pull request that passes the
automatic checks and is approved by a reviewer who is not the author is merged.
Changes to data and validation need a data reviewer.

**Larger changes** (new layers, interfaces, file formats, the rules in `CONTRIBUTING.md`,
this document) go through a proposal, see [proposals/](proposals/README.md):

1. The author opens a pull request adding the proposal document, and a linked
   discussion in the *Proposals* category of GitHub Discussions, with a poll.
2. The discussion stays open for at least 14 days.
3. Maintainers and data reviewers decide by **lazy consensus**: the proposal is accepted if
   at least two of them support it and none objects with a reason. An objection must say
   what would make the proposal acceptable.
4. If consensus is not reached, the lead maintainer decides and writes down why.

**Polls are advisory.** They show what users need and weigh in the decision, but they do
not decide on their own: anyone can create accounts, so a public vote is easy to distort.

## Contributions prepared with AI assistants

Most contributions are prepared with an AI assistant (ChatGPT, Claude, Gemini or others)
following [AGENTS.md](AGENTS.md). They are reviewed exactly like any other contribution:
the contributor confirms they checked every number, and a reviewer compares the numbers
with the open source. An assistant never counts as a reviewer.

Contributors use their own assistant accounts. Maintainers may use a coding agent on the
project's side, for example the Claude Code GitHub Action triggered with `@claude` on an
issue, to turn contribution packages into pull requests. Only maintainers can trigger it,
and the project's keys are never shared.

## Becoming a data reviewer or maintainer

- **Data reviewer:** open an issue describing your background in thermodynamics and the
  systems you know well. Two maintainers approve; you are added to `CODEOWNERS`.
- **Maintainer:** after several merged contributions or reviews, a maintainer nominates you
  in an issue. Accepted by lazy consensus of the maintainers. Maintainers must use
  two-factor authentication on GitHub.

Inactive maintainers (no activity for 12 months) are asked whether they want to stay and
otherwise move to an emeritus list, with thanks.

## Code of conduct

Everyone follows the [code of conduct](CODE_OF_CONDUCT.md). Maintainers enforce it.

## Money and trademarks

Fugacity has no funding. If that changes, how funds are used will be decided by proposal
and published. The name "Fugacity" as used by this project, and the repository, are held
by the lead maintainer on behalf of the project.
