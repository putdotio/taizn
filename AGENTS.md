# Agent Guide

`taizn` is a typed Tizen TV packaging and live-device proof harness for
consumer apps. Keep it a shell-out tool, not an app framework.

## Start Here

Read only what the task needs:

- Consumer config, env, and command contracts: [README.md](README.md)
- Release settings outside the repo: [CONTRIBUTING.md](CONTRIBUTING.md#release)
- Seller Office session safety: [docs/seller-office.md](docs/seller-office.md)
- Samsung TV remote pairing and keys: [docs/tv-remote.md](docs/tv-remote.md)
- Agent workflow shipped with the package:
  [skills/taizn/SKILL.md](skills/taizn/SKILL.md)

## Ways To Hurt Yourself

- **Merging publishes.** A `feat`, `fix`, `perf`, revert, or breaking commit on
  `main` publishes `@putdotio/taizn` to npm
  ([`.releaserc.json`](https://github.com/putdotio/taizn/blob/main/.releaserc.json)). A published version can never be
  reused, so the commit type is the release decision.
- **Taking over someone's TV.** A Samsung TV on the network may be someone's
  set in use. `install`, `launch`, `prove`, and the matching live tests change
  what the TV runs; roundtrip may uninstall an existing fixture package.
  `tv press` and `tv script` send remote keys. `tv pair` and `--connect` can
  raise an allow/deny prompt on the TV. `check`, `apps`, `tv info`, and
  `tv doctor` without `--connect` only read.
- **Acting in Seller Office.** `seller` commands ride a human-owned Samsung
  seller session, so they stay read-only; see Sharp Edges.

## Generic Tool Boundary

- Keep put.io product behavior out: no put.io app IDs, hosted app URLs,
  content IDs, account data, credentials, journeys, or product assertions.
- `@putdotio/taizn`, release-bot wiring, copyright, and security contacts are
  ownership metadata, not permission for product-specific fixtures.
- Samples use neutral data such as `Example.app`, `Fixture.app`, and public
  third-party asset URLs.
- Consumer repos own `LIVE_TEST_FETCH_URLS`, launch and proof targets, product
  smoke flows, and store-submission metadata.

## Patterns

- Keep CLI wiring thin: parse and dispatch, then call named implementation
  functions.
- Write reusable operations as `Effect.fn` programs with typed errors; provide
  Node services at the executable edge.
- Parse `taizn.json` and `TAIZN_*` with Effect Schema before implementation
  code sees them.
- `process.cwd()` is the consumer app root.
- `.taizn/` stays consumer-local; it can hold env, certs, generated widgets,
  paired remote tokens, and device state.
- Keep file and process side effects explicit: copy, stage, clean, run Tizen,
  fail clearly.
- Prefer small helpers over new framework layers or compatibility modes.

## Effect

The installed version's guide is `node_modules/effect/AGENTS.md`. Read it for
the APIs the change touches; search `node_modules/effect/src` for the rest.

## Sharp Edges

- Plain `taizn` behaves like `taizn package`.
- `check`, `apps`, `launch`, `prove`, `sdk`, and `tv` commands run without a
  consumer `taizn.json`.
- `sdk backup` stages privately, renames the mode `0600` archive into place,
  and refuses an existing output. `sdk restore` extracts into private staging,
  validates the tree, and only then moves backup roots into home. `--json` runs
  keep tar's output off the terminal and report its stderr as the error
  `cause`. Keep machine-specific paths and secret-store integrations out.
- Do not leak `TAIZN_*`, `TIZEN_*`, or `SDB` into the consumer build command.
- Redact password args when reporting failed Tizen commands.
- Missing config, env, or files and child-command failures print no stack
  traces.
- `install` auto-picks a target only when exactly one `sdb devices` target is
  connected.
- `tv` commands resolve the host from `TAIZN_TV_HOST`, `.taizn/remote.json`, or
  the host part of `TAIZN_TARGET`.
- `tv` commands send Samsung remote keys only: no screenshots, app launch, or
  widget install. `tv script` JSON may encode key sequences and delays, never
  product journeys, visual assertions, or content expectations.
- `seller login` mutates local state only. It launches a visible human-owned
  Chrome on `.taizn/seller/chrome-profile` with DevTools bound to `127.0.0.1`,
  and writes the port to `.taizn/seller.json`. It never reads, requests, or
  stores Samsung credentials.
- A failed or interrupted `seller login` stops the exact browser tree it
  spawned and removes the fresh `.taizn/seller.json`. After success, the
  session belongs to the operator and stays running.
- `seller apps list` attaches to the saved DevTools port and uses only
  `Page.navigate` plus a sanitizing `Runtime.evaluate` extraction. No clicks,
  form input, uploads, submissions, or private portal endpoint calls.
- Seller reads fail closed: signed-out is `SellerAuthenticationRequired`,
  layout drift is `SellerPortalDrift`. Never guess missing application card
  fields; keep raw HTML and portal responses out of output and artifacts.
- `inspect wgt`, `validate submission`, `probe hosted-assets`, `logs capture`,
  and `targets` stay generic; product-specific checks belong in consumer repos.
- Agent-facing commands prefer `--json`, support `--artifact` for proof when
  useful, use `--fields` for context control, and sandbox artifact paths to the
  app directory.
- Mutating platform commands expose `--dry-run` unless a dry run would mislead.
  If a dry run is not real proof, say what it validates.
- CLI tests default to the in-process harness (`runTaiznInProcess` over
  `runTaiznCli` from `src/main.ts`) so V8 coverage attributes them. Spawn
  `dist/taizn.mjs` only when the process boundary is under test; coverage
  skips those runs (see `vite.config.ts`).

## When Contracts Change

- Command surface: update `src/describe.ts` and CLI tests; guardrail changes
  also update `skills/taizn/SKILL.md`.
- Config, env, or output: update `README.md` and CLI tests.
- Release settings outside the repo: update [CONTRIBUTING.md](CONTRIBUTING.md#release).
- `CLAUDE.md` stays a one-line `@AGENTS.md` import.
- `files` in `package.json` ships the docs and skill; they link files outside
  the tarball by absolute GitHub URL.

## Checks

Run Vite+ through the pinned devDependency as `pnpm exec vp`. In a new
worktree, `.worktreeinclude` copies local env files; then run:

```bash
pnpm install
pnpm exec vp run hooks:install
pnpm exec vp run verify
```

Focused scripts live in [`package.json`](package.json). If live-test env is
missing, run
`pnpm exec vp run live:test:setup -- --from <consumer-app> --target <tv-ip>`.
Without a consumer app, put `author.p12` and `distributor.p12` in
`live-test/app/.taizn/certificates/` and the
[`.env.example`](https://github.com/putdotio/taizn/blob/main/.env.example) keys
in `live-test/app/.taizn/.env`.

Which proof a change needs:

- Docs only: `pnpm exec vp run check`, plus `pnpm exec vp run skills:lint` for
  `skills/`. No device run.
- Source, config, env, command, or output: `pnpm exec vp run verify`.
- Device-facing behavior: `verify`, then the matching
  `pnpm exec vp run live:test:*` script. Only live tests prove real Tizen
  behavior.

## Delivery

Open a pull request. [`ci.yml`](https://github.com/putdotio/taizn/blob/main/.github/workflows/ci.yml) runs `verify` on
pull requests and releases from `main`.
