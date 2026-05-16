# Agent Guide

`taizn` is a small Node CLI that wraps Tizen CLI packaging/install work for a
consumer app. Keep it a typed shell-out tool, not an app framework.

## Patterns

- Keep CLI wiring thin: parse/dispatch commands, then call named implementation functions.
- Keep reusable operations as `Effect.fn` programs with typed errors; provide Node services at the executable edge.
- Parse `taizn.json` and `TAIZN_*` with Effect Schema before implementation code sees them.
- Treat `process.cwd()` as the consumer app root.
- Keep `.taizn/` consumer-local; it can hold env, certs, generated widgets, and device state.
- Keep file/process side effects explicit: copy, stage, clean, run Tizen, fail clearly.
- Prefer small helpers over new framework layers or compatibility modes.

## Sharp Edges

- Plain `taizn` should behave like `taizn package`.
- `check` should verify Tizen tooling and connected targets without requiring a
  consumer `taizn.json`.
- Do not leak `TAIZN_*`, `TIZEN_*`, or `SDB` into the consumer build command.
- Redact password args when reporting failed Tizen commands.
- Missing config/env/files and child-command failures should not print stack traces.
- `install` should only auto-pick a target when exactly one `sdb devices` target is connected.
- Unit tests use `@effect/vitest` through `vp run test`; only `vp run live:test:*` proves real Tizen behavior.

## When Contracts Change

- Config/env/command/output changes: update `README.md` and CLI tests.
- CI/release/publishing changes: update `docs/DISTRIBUTION.md`.
- Keep `CLAUDE.md` as a symlink to this file.

## Checks

```bash
vp install
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
vp run live:test:install
```
