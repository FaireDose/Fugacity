# Proposals

Larger changes to Fugacity start as a short written proposal: new layers, changes to an
interface or file format, the steps of the architecture track in the
[roadmap](../ROADMAP.md), and changes to the project's rules.

## How it works

1. Copy [`0000-template.md`](0000-template.md) to `NNNN-short-title.md` (next free number).
2. Open a pull request with the file, and a discussion in the **Proposals** category of
   GitHub Discussions with a poll, linking to each other.
3. Discussion stays open for at least 14 days. Update the proposal as comments come in.
4. Maintainers and data reviewers decide by lazy consensus (see [GOVERNANCE.md](../GOVERNANCE.md)).
   Polls are advisory.
5. The status in the file is set to **Accepted** or **Declined**, and the pull request is merged
   either way, so the reasoning stays on record.
6. Accepted proposals are implemented through normal pull requests, by contributors or by
   Claude on a maintainer's request.

## Index

| # | Title | Status |
|---|---|---|
| 0001 | [Property package interface](0001-property-package.md) | Draft |
| 0002 | [Pure-component properties, gases and Peng–Robinson](0002-pure-component-properties.md) | Accepted |
