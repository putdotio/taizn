# Contributing

## Setup

```bash
git clone https://github.com/putdotio/taizn.git
cd taizn
vp install
```

Use the Node.js version in [`.node-version`](./.node-version).

## Checks

```bash
vp run verify
```

Focused commands:

```bash
vp run check
vp run build
vp run test
```

## Commits

Use Conventional Commits:

- `feat:` for minor releases
- `fix:` for patch releases
- `feat!:` or `BREAKING CHANGE:` for major releases
- `docs:`, `test:`, `refactor:`, `chore:`, `ci:` for non-release changes

## Release

Merges to `main` release automatically when commits are releasable. See
[Distribution](./docs/DISTRIBUTION.md).
