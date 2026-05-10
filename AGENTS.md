# Agent Guide

Keep this repo boring: one CLI package, one verify command, one release lane.

## Start Here

- [Overview](./README.md)
- [Contributing](./CONTRIBUTING.md)
- [Distribution](./docs/DISTRIBUTION.md)
- [Security](./SECURITY.md)

## Repo Shape

- `src/taizn.ts` is the CLI entrypoint and dispatch.
- `src/cli.ts` owns Effect CLI command wiring.
- `src/context.ts` loads typed config and environment for commands.
- `src/config.ts` owns `taizn.json` parsing with Effect Schema.
- `src/env.ts` owns `TAIZN_*` environment parsing with Effect Schema.
- `src/runtime.ts` owns process, path, env, and command helpers.
- `src/tizen.ts` owns profile, package, and install behavior.
- `src/xml.ts` owns small XML rewrite helpers.
- `taizn.json` is the consumer project config file.
- `.taizn/` is consumer-local generated and secret material; keep it ignored.
- `live-test/` is the manual fixture for local Tizen packaging and install checks.
- CI runs `vp run verify`.
- Releases publish the unscoped `taizn` npm package from `main`.
- `CLAUDE.md` is a symlink to this file.

## Working Rules

- Keep behavior project-agnostic; no put.io app assumptions in the CLI.
- Keep docs concise and current-state.
- Prefer one obvious flow over compatibility modes.
- Parse external project config at the boundary before passing values inward.
- Keep command parsing in `src/cli.ts`; keep Tizen side effects in `src/tizen.ts`.

## Verification

```bash
vp install
vp run verify
```

Fast CLI smoke:

```bash
vp run smoke
```

Manual Tizen live check:

```bash
vp run live:test
vp run live:test:install
```
