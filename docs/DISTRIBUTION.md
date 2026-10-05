# Distribution

## Delivery Model

Every merge to `main` should be releasable.

CI runs:

1. `vp install`
2. `vp run verify`
3. `semantic-release` on `main`

The release workflow publishes the scoped `@putdotio/taizn` package to npm, creates a
GitHub release, and commits the released `package.json` version back to `main`
with `[skip ci]`.

A new push cancels a stale pull-request run. Every `main` push and manual
dispatch gets its own run, so each pushed range is scanned. Releases run one at
a time in the shared workflow's own concurrency group, which never cancels a
running publish.

The release job calls the [shared frontend release workflow](https://github.com/putdotio/.github) from `putdotio/.github`, pinned to a reviewed commit SHA; the semantic-release action and plugin pins live there. The `verify` job ends with the shared [links](https://github.com/putdotio/.github#actionslinks) and [scan](https://github.com/putdotio/.github#actionsscan) actions from the same repository: an offline Markdown link and anchor check on every run, and an Actionlint and Zizmor audit when a `main` push changes workflows, or of the full history on manual dispatch.

## Package Contents

`files` in [`package.json`](../package.json)
lists what the npm package ships. It carries the docs and skill so consumers
can follow the README's support, contribution, and automation links without
cloning the repository. Packaged docs link files outside the tarball by
absolute GitHub URL.

The published dependencies pin Effect, platform-node, and platform-node-shared to
the same prerelease. Keep these aligned: consumers do not inherit the repository
pnpm overrides, and a newer shared runtime can be incompatible.

## Release Environment

The release job uses the GitHub Environment named `release`.

Environment entries:

- secrets: `PUTIO_CI_APP_PRIVATE_KEY`
- variables: `PUTIO_CI_APP_CLIENT_ID`
- approval: none
- branch policy: `main`
- deployment records: disabled with `deployment: false`

The npm package uses Trusted Publishing from GitHub Actions. On npm, configure owner `putdotio`, repository `taizn`, workflow `ci.yml`, and Environment named `release` for the package.

During the `@semantic-release/npm` publish step, npm detects the GitHub OIDC identity, mints short-lived publish credentials, and publishes provenance for the release job.

Release GitHub writes use `putio-ci`, and the release bot token is minted only after dependencies are installed.

## Versioning

Conventional Commits drive releases; the type-to-release mapping is in
[Contributing](../CONTRIBUTING.md#release).
