# Contributing

Thanks for contributing to `taizn`.

## Setup

Install the required toolchain and then install dependencies:

```bash
git clone https://github.com/putdotio/taizn.git
cd taizn
pnpm install
pnpm exec vp run hooks:install
```

Use the Node.js version in [`.node-version`](https://github.com/putdotio/taizn/blob/main/.node-version).
The hook setup makes the full verification gate run before pushes.

## Run Locally

Build the CLI and run the fast smoke check:

```bash
pnpm exec vp run smoke
```

For watch mode while editing:

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
- `src/remote.ts` owns Samsung TV remote-control websocket behavior.
- Tests in `test/` use `@effect/vitest` and default to the in-process harness; spawn `dist/taizn.mjs` only when the process boundary itself is under test.
- `live-test/` exercises the packed CLI against local Tizen tools.
- Keep `.taizn/` generated, local, and ignored.

## Pull Requests

- Keep changes focused.
- Add or update tests when behavior changes.
- Include the useful local verification command in the pull request.

## Release

Merges to `main` release automatically when commits are releasable. See
[Distribution](./docs/DISTRIBUTION.md).

Use Conventional Commits:

- `feat:` for minor releases
- `fix:` for patch releases
- `feat!:` or `BREAKING CHANGE:` for major releases
- `docs:`, `test:`, `refactor:`, `chore:`, `ci:` for non-release changes
