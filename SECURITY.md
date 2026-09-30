# Security and integrity

Fugacity's results are used for teaching and engineering, so two things matter: that the
code and data cannot be changed without review, and that problems are reported and fixed
quickly.

## Reporting a problem

- **Security issue** (for example a way to make the library run untrusted code, or a
  compromised release): report it privately through GitHub's *Report a vulnerability*
  button on the Security tab of the repository. Do not open a public issue.
- **Wrong results** (a bad parameter, a calculation error): open a public
  [data correction](https://github.com/FaireDose/Fugacity/issues/new?template=data-correction.yml)
  issue. Wrong numbers are not secret; fixing them in the open lets everyone check.

A maintainer answers within 7 days.

## What the library does and does not do

- It calculates in the viewer's browser and makes **no network requests**.
- It stores nothing and reads nothing from the page except the element it is given.
- It has no runtime dependencies; the published file is built from this repository only.

## How the repository is protected

| Protection | Effect |
|---|---|
| Branch ruleset on `main` | No direct pushes, no force-push, no branch deletion; every change needs a pull request, passing tests, and approval |
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
- An npm version can never be overwritten. Pages that load a pinned version
  (`fugacity@0.1.1`) always get exactly the reviewed code.
- Maintainers never put tokens or API keys in code, issues or pull requests.

## Secrets

The repository may hold an Anthropic API key or Claude subscription token for the Claude
GitHub Action (npm publishing needs no secret). They are available only
to workflows on this repository; GitHub withholds them from pull requests opened from
forks. If a secret is exposed, revoke it at its source (npm, Claude Console) immediately and
create a new one.
