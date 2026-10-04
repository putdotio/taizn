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

Verify jobs can cancel stale runs; release jobs queue so package publishing is
not interrupted.

The release job calls the [shared frontend release workflow](https://github.com/putdotio/.github) from `putdotio/.github`, pinned to a reviewed commit SHA; the semantic-release action and plugin pins live there. [`scan.yml`](https://github.com/putdotio/taizn/blob/main/.github/workflows/scan.yml) calls the shared frontend scan workflow from the same repository: Gitleaks, TruffleHog, Actionlint, and Zizmor on pull requests, weekly, and on manual dispatch. [`links.yml`](https://github.com/putdotio/taizn/blob/main/.github/workflows/links.yml) calls its offline Markdown link and anchor check on pull requests and `main`.

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
