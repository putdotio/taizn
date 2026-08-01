# Agent Guide

`taizn` is a typed Tizen TV packaging and live-device proof harness for
consumer apps. Keep it a shell-out tool, not an app framework.

## Generic Tool Boundary

- Keep `taizn` free of put.io product behavior. Do not add put.io app IDs,
  hosted app URLs, content IDs, account data, credentials, journeys, or product
  assertions.
- `@putdotio/taizn`, `putdotio/taizn`, release-bot wiring, copyright, and
  security contacts are ownership/publishing metadata only; do not treat them
  as permission to add product-specific fixtures.
- Use neutral examples such as `Example.app`, `Fixture.app`, and public
  third-party asset URLs when docs or tests need sample app data.
- Consumer repos own their own `LIVE_TEST_FETCH_URLS`, launch/proof targets,
  product smoke flows, and store-submission metadata.

## Patterns

- Keep CLI wiring thin: parse/dispatch commands, then call named implementation functions.
- Keep reusable operations as `Effect.fn` programs with typed errors; provide Node services at the executable edge.
- Parse `taizn.json` and `TAIZN_*` with Effect Schema before implementation code sees them.
- Treat `process.cwd()` as the consumer app root.
- Keep `.taizn/` consumer-local; it can hold env, certs, generated widgets, paired TV remote tokens, and device state.
- Keep file/process side effects explicit: copy, stage, clean, run Tizen, fail clearly.
- Prefer small helpers over new framework layers or compatibility modes.

## Sharp Edges

- Plain `taizn` should behave like `taizn package`.
- `check` should verify Tizen tooling and connected targets without requiring a
  consumer `taizn.json`.
- `apps` should list installed target apps without requiring a consumer
  `taizn.json`.
- `launch` should start an already-installed target app without requiring a
  consumer `taizn.json`.
- `prove` should produce a compact installed-and-launched proof transcript
  without requiring a consumer `taizn.json`.
- Do not leak `TAIZN_*`, `TIZEN_*`, or `SDB` into the consumer build command.
- Redact password args when reporting failed Tizen commands.
- Missing config/env/files and child-command failures should not print stack traces.
- `install` should only auto-pick a target when exactly one `sdb devices` target is connected.
- `tv` commands should not require a consumer `taizn.json`; they use `TAIZN_TV_HOST`, `.taizn/remote.json`, or the host part of `TAIZN_TARGET`.
- `tv` commands send Samsung remote keys only; do not imply screenshot, app launch, or widget install support there.
- `tv script` is still a remote-key driver only. JSON scripts may encode key
  sequences and delays, but not product journeys, visual assertions, or content
  expectations.
- `inspect wgt`, `validate submission`, `probe hosted-assets`, `logs capture`,
  and `targets` are generic harness surfaces. Keep product-specific checks in
  consumer repos.
- Agent-facing commands should prefer `--json`, support `--artifact` for proof
  when useful, use `--fields` for context control, and sandbox artifact paths to
  the app directory.
- Mutating platform commands should expose `--dry-run` unless a dry run would
  be misleading. If a dry run is not real proof, say what it validates.
- Keep `skills/taizn/SKILL.md` aligned when command-surface guardrails change.
- Unit tests use `@effect/vitest` through `vp run test`; only `vp run live:test:*` proves real Tizen behavior.

## When Contracts Change

- Config/env/command/output changes: update `README.md` and CLI tests.
- CI/release/publishing changes: update `docs/DISTRIBUTION.md`.
- Keep `CLAUDE.md` as a symlink to this file.

## Worktrees

`.worktreeinclude` carries env and `.repos/effect` into managed worktrees;
Claude symlinks `.repos`. Run `vp install`, `vp run hooks:install`, and
`vp run verify`. If live-test env is missing, run
`vp run live:test:setup -- --from <consumer-app> --target <tv-ip>`.

## Checks

```bash
vp install
vp run hooks:install
vp run verify
```

Fast loops:

```bash
vp run check
vp run typecheck
vp run smoke
vp run test
```

Effect source is bootstrapped into ignored `.repos/effect` by `scripts/prepare-effect.sh` outside CI.

Live Tizen checks when the local toolchain/certs/device exist:

```bash
vp run live:test:profile
vp run live:test
vp run live:test:doctor
vp run live:test:doctor:connect
vp run live:test:install
vp run live:test:prove
vp run live:test:remote
vp run live:test:roundtrip
vp run live:test:smoke
vp run live:test:tv-assets
vp run live:test:tv-assets:production
```

Use `LIVE_TEST_FETCH_URLS` with `live:test:roundtrip` when the TV WebView needs
to prove it can fetch specific remote assets.
Use `live:test:tv-assets` or `live:test:tv-assets:production` to run that same
roundtrip against the neutral hosted-asset probe preset.
Use `LIVE_TEST_REQUIRE_REMOTE=1` with `live:test:remote` when websocket remote
control is a required gate instead of a diagnostic artifact.
Use `LIVE_TEST_REMOTE_KEYS` only after `taizn tv pair` has configured a
Samsung remote token.
