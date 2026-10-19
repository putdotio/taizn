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

The hooks run the full verification gate before each push.

## Run Locally

Build the CLI and run the fast smoke check:

```bash
pnpm exec vp run smoke
```

Rebuild on change:

```bash
pnpm exec vp run dev
```

## Validation

Run the full repo checks before opening or updating a pull request:

```bash
pnpm exec vp run verify
```

Focused commands for iteration:

```bash
pnpm exec vp run check
pnpm exec vp run typecheck
pnpm exec vp run build
pnpm exec vp run smoke
pnpm exec vp run test
```

Live checks for a local Tizen toolchain and device: [Live Test](https://github.com/putdotio/taizn/blob/main/live-test/README.md)
owns the `pnpm exec vp run live:test:*` scripts, signing profile setup, beacon
configuration, remote diagnostics, and hosted asset checks.

## Development Notes

- `src/cli.ts` owns command parsing with `effect/cli`.
- `src/config.ts` and `src/env.ts` parse external inputs with Effect Schema.
- `src/runtime.ts` owns the Node service layer and runtime boundary helpers.
- `src/tizen.ts` owns Effectful Tizen side effects.
- `src/sdk.ts` owns Tizen Studio install, backup, and restore.
- `src/remote.ts` owns Samsung TV remote-control websocket behavior.
- Tests in `test/` use `@effect/vitest` and default to the in-process harness; spawn `dist/taizn.mjs` only when the process boundary itself is under test.
- `live-test/` exercises the packed CLI against local Tizen tools.
- Keep `.taizn/` generated, local, and ignored.

## Pull Requests

- Add or update tests when behavior changes.
- Fill in the pull request template's Verification section with the checks you
  ran.

## Release

Merges to `main` publish to npm when they contain releasable commits; see
[Distribution](./docs/distribution.md). Use Conventional Commits:

- `feat:` releases a minor version.
- `fix:`, `perf:`, and `revert:` release a patch version.
- `feat!:` or a `BREAKING CHANGE:` footer releases a major version.
- `docs:`, `test:`, `refactor:`, `chore:`, `ci:`, and `deps:` do not release.
