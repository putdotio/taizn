# Agent Guide

Keep this repo boring: one CLI package, one verify command, one release lane.

## Start Here

- [README](./README.md)
- [Contributing](./CONTRIBUTING.md)
- [Distribution](./docs/DISTRIBUTION.md)
- [Security](./SECURITY.md)

## Repo Shape

- `src/tizen-cli.mts` owns the CLI.
- `taizn.json` is the consumer project config file.
- `.taizn/` is consumer-local generated and secret material; keep it ignored.
- CI runs `vp run verify`.
- Releases publish the unscoped `taizn` npm package from `main`.

## Working Rules

- Keep behavior project-agnostic; no put.io app assumptions in the CLI.
- Keep docs concise and current-state.
- Prefer one obvious flow over compatibility modes.

## Verification

```bash
vp install
vp run verify
```
