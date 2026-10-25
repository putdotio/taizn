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

Merges to `main` publish to npm when they contain releasable commits; see
[Distribution](./docs/distribution.md). Use Conventional Commits:

- `feat:` releases a minor version.
- `fix:`, `perf:`, and `revert:` release a patch version.
- `feat!:` or a `BREAKING CHANGE:` footer releases a major version.
- `docs:`, `test:`, `refactor:`, `chore:`, `ci:`, and `deps:` do not release.
