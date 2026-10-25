# Agent Guide

`taizn` is a typed Tizen TV packaging and live-device proof harness for
consumer apps. Keep it a shell-out tool, not an app framework.

## Start Here

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
  seller session. They stay read-only: navigate and extract, with no clicks,
  form input, uploads, submissions, or private portal endpoint calls. They
  never read, request, or store Samsung credentials.

## Generic Tool Boundary

- Keep put.io product behavior out: no put.io app IDs, hosted app URLs,
  content IDs, account data, credentials, journeys, or product assertions.
- `@putdotio/taizn`, release-bot wiring, copyright, and security contacts are
  ownership metadata, not permission for product-specific fixtures.
- Samples use neutral data such as `Example.app`, `Fixture.app`, and public
  third-party asset URLs.
- Consumer repos own `LIVE_TEST_FETCH_URLS`, launch and proof targets, product
  smoke flows, store-submission metadata, and product-specific checks.
- `tv script` JSON encodes key sequences and delays only.
- `sdk` keeps machine-specific paths and secret-store integrations out.

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
- Prefer small helpers over new framework layers or compatibility modes.
- New agent-facing commands take `--json`, `--fields`, and, when proof is
  useful, `--artifact`. Mutating platform commands take `--dry-run` unless a
  dry run would mislead; say what a dry run validates when it is not proof.
- CLI tests default to the in-process harness (`runTaiznInProcess` over
  `runTaiznCli` from `src/main.ts`) so V8 coverage attributes them. Spawn
  `dist/taizn.mjs` only when the process boundary is under test; coverage
  skips those runs (see `vite.config.ts`).

## Effect

The installed version's guide is `node_modules/effect/AGENTS.md`. Read it for
the APIs the change touches; search `node_modules/effect/src` for the rest.

## When Contracts Change

- Command surface: update `src/describe.ts` and CLI tests; guardrail changes
  also update `skills/taizn/SKILL.md`.
- Config, env, or output: update `README.md` and CLI tests.
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

If live-test env is missing, run
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
  `pnpm exec vp run live:test:*` script from [`package.json`](package.json).
  Only live tests prove real Tizen behavior.
