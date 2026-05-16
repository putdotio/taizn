# Contributing

Thanks for contributing to `taizn`.

## Setup

Install the required toolchain and then install dependencies:

```bash
git clone https://github.com/putdotio/taizn.git
cd taizn
vp install
```

Use the Node.js version in [`.node-version`](./.node-version).
Install runs `scripts/prepare-effect.sh` outside CI to clone the local Effect
source into ignored `.repos/effect` for API research.

## Run Locally

Build the CLI and run the fast smoke check:

```bash
vp run smoke
```

For watch mode while editing:

```bash
vp run dev
```

## Validation

Run the full repo checks before opening or updating a pull request:

```bash
vp run verify
```

Focused commands for iteration:

```bash
vp run check
vp run typecheck
vp run build
vp run smoke
vp run test
```

Live checks for a local Tizen toolchain and device:

```bash
vp run live:test:doctor
vp run live:test
vp run live:test:install
vp run live:test:prove
vp run live:test:smoke
vp run live:test:roundtrip
vp run live:test:tv-assets:production
```

See [Live Test](./live-test/README.md) for signing profile setup, beacon
configuration, remote diagnostics, and hosted asset checks.

## Development Notes

- `src/cli.ts` owns command parsing with `effect/unstable/cli`.
- `src/config.ts` and `src/env.ts` parse external inputs with Effect Schema.
- `src/runtime.ts` owns the Node service layer and runtime boundary helpers.
- `src/tizen.ts` owns Effectful Tizen side effects.
- `src/remote.ts` owns Samsung TV remote-control websocket behavior.
- Tests in `test/` use `@effect/vitest` and exercise the packed CLI from `dist/taizn.mjs`.
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
