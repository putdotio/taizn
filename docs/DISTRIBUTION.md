# Distribution

## Delivery Model

Every merge to `main` should be releasable.

CI runs:

1. `vp install`
2. `vp run verify`
3. `semantic-release` on `main`

The release workflow publishes the scoped `@putdotio/taizn` package to npm, creates a
GitHub release, and commits the released `package.json` version back to `main`
with `[skip ci]`.

Verify jobs can cancel stale runs; release jobs queue so package publishing is
not interrupted.

## Release Environment

The release job uses the GitHub Environment named `release`.

Environment entries:

- secrets: `PUTIO_RELEASE_BOT_PRIVATE_KEY`
- variables: `PUTIO_RELEASE_BOT_CLIENT_ID`
- approval: none
- branch policy: `main`
- deployment records: disabled with `deployment: false`

The npm package uses Trusted Publishing from GitHub Actions. On npm, configure owner `putdotio`, repository `taizn`, workflow `ci.yml`, and Environment named `release` for the package.

The workflow grants `id-token: write` so npm can mint short-lived publish credentials and provenance; do not add a long-lived `NPM_TOKEN` secret.

Release GitHub writes use `putio-release-bot`, and the release-bot remote is configured only after dependencies are installed.

## Local Checks

```bash
vp install
vp run verify
```

## Versioning

Conventional Commits drive releases:

- `feat:` publishes a minor release
- `fix:` publishes a patch release
- breaking changes publish a major release
