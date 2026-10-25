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

Merging a releasable commit to `main` publishes to npm
([`.releaserc.json`](https://github.com/putdotio/taizn/blob/main/.releaserc.json)).
npm Trusted Publishing trusts `putdotio/taizn`,
[`ci.yml`](https://github.com/putdotio/taizn/blob/main/.github/workflows/ci.yml),
and Environment `release`; renaming any of them breaks publishing.
