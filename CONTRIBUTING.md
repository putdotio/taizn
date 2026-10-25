# Contributing

## Setup

Use the Node.js version in [`.node-version`](https://github.com/putdotio/taizn/blob/main/.node-version),
then install dependencies and the Git hooks:

```bash
git clone https://github.com/putdotio/taizn.git
cd taizn
pnpm install
pnpm exec vp run hooks:install
```

The pre-push hook runs the full gate.

## Run Locally

```bash
pnpm exec vp run smoke   # build the CLI, print version and help
pnpm exec vp run dev     # rebuild on change
```

## Validation

Run the full gate before opening or updating a pull request:

```bash
pnpm exec vp run verify
```

Focused scripts (`check`, `typecheck`, `test`, `skills:lint`) live in
[`package.json`](./package.json).
[Live Test](https://github.com/putdotio/taizn/blob/main/live-test/README.md)
covers checks against a local Tizen toolchain and TV.

## Pull Requests

- Add or update tests when behavior changes.
- List the checks you ran in the template's Verification section.

## Release

[`ci.yml`](https://github.com/putdotio/taizn/blob/main/.github/workflows/ci.yml) releases from `main` with
[`.releaserc.json`](https://github.com/putdotio/taizn/blob/main/.releaserc.json); `feat`, `fix`, `perf`, revert, and
breaking commits publish to npm. A published version can never be reused.

Settings that live outside the repo:

- GitHub Environment `release`, limited to `main`, holds the `putio-ci` app
  secret and client ID that [`ci.yml`](https://github.com/putdotio/taizn/blob/main/.github/workflows/ci.yml) passes on.
- npm Trusted Publishing for `@putdotio/taizn` trusts repository
  `putdotio/taizn`, workflow `ci.yml`, and Environment `release`.
