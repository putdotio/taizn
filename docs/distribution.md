# Distribution

Every merge to `main` must be releasable. [`ci.yml`](../.github/workflows/ci.yml)
runs `vp run verify` on pull requests and `main`. On `main`, the shared
`frontend-release-npm` workflow from
[`putdotio/.github`](https://github.com/putdotio/.github) runs semantic-release
with [`.releaserc.json`](../.releaserc.json). It publishes
`@putdotio/taizn` to npm, creates a GitHub release, and commits the version
back to `main` with `[skip ci]`. Commit types decide the release; see
[Contributing](../CONTRIBUTING.md#release).

## Release Environment

The release job uses the GitHub Environment `release`, limited to `main`, with
no approval:

- secret `PUTIO_CI_APP_PRIVATE_KEY` and variable `PUTIO_CI_APP_CLIENT_ID` for
  the `putio-ci` app that writes release commits and GitHub releases;
- npm Trusted Publishing: the package trusts owner `putdotio`, repository
  `taizn`, workflow `ci.yml`, and Environment `release`, and publishes with
  provenance.

## Package Contents

`files` in [`package.json`](../package.json) ships the docs and skill with the
CLI. Packaged docs link files outside the tarball by absolute GitHub URL.

`effect` and the `@effect/platform-node*` dependencies use exact pins, and
consumers install exactly those versions. Bump them together and keep them
compatible.
