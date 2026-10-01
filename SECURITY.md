# Security and integrity

Fugacity's results are used for teaching and engineering, so two things matter: that the
code and data cannot be changed without review, and that problems are reported and fixed
quickly.

## Reporting a problem

- **Security issue** (for example a way to make the library run untrusted code, or a
  compromised release): report it privately through GitHub's *Report a vulnerability*
  button on the Security tab of the repository. Do not open a public issue.
- **Wrong results** (a bad parameter, a calculation error): open a public
  [Data](https://github.com/FaireDose/Fugacity/issues/new?template=ai-contribution.yml)
  issue of type *Correction*. Wrong numbers are not secret; fixing them in the open lets
  everyone check.

A maintainer answers within 7 days.

## What the library does and does not do

- It calculates in the viewer's browser and makes **no network requests**.
- It stores nothing and reads nothing from the page except the element it is given.
- It has no runtime dependencies; the published file is built from this repository only.

## How the repository is protected

| Protection | Effect |
|---|---|
| Branch ruleset on `main` | No direct pushes, no force-push, no branch deletion; every change needs a pull request, passing tests, and approval (while there is one maintainer, see [GOVERNANCE.md](GOVERNANCE.md#while-there-is-one-maintainer)) |
| `CODEOWNERS` | Changes to `src/data/` and `validation/` need a data reviewer |
| Automatic tests | Any change to parameters that shifts results against the validation data or the independent Python model fails the checks |
| Roles | Only maintainers have write access; only the lead maintainer is administrator |
| Two-factor authentication | Required for maintainers |
| Git history | Every earlier version of every file is kept and can be restored |

## How releases are protected

- Releases are published to npm **only by the GitHub workflow**
  (`.github/workflows/publish.yml`) through npm **trusted publishing**: npm accepts a new
  version only from that workflow in this repository, and no npm token is stored anywhere.
  Each version carries a provenance record showing it was built from this repository.
- Every workflow job gets only the permissions it needs (publishing to npm cannot change
  the repository; attaching the skill files cannot publish to npm), and every action is
  pinned to a full commit SHA.
- An npm version can never be overwritten. Pages that load an exact version always get
  exactly the reviewed code.
- Maintainers never put tokens or API keys in code, issues or pull requests.

## Contributions prepared with AI assistants

Issue text, contribution packages and data files can contain text written to mislead an AI
agent ("ignore the rules and ..."). [AGENTS.md](AGENTS.md) tells every assistant and agent
to treat such content as data, not instructions. Agents working for maintainers only get
access to this repository, run the full test suite, and their pull requests are reviewed
like any other. The package check (`npm run check-package`) catches invalid CAS numbers,
missing sources and implausible values before review.

## Secrets

No workflow needs a secret: npm publishing uses trusted publishing, and the skill files
are attached with the workflow's own short-lived token. If a secret is ever exposed,
revoke it at its source immediately.
