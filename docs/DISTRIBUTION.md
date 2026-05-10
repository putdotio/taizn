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

## Release Environment

The release job uses the GitHub Environment named `release`.

Environment entries:

- secrets: `NPM_TOKEN`, `PUTIO_RELEASE_BOT_PRIVATE_KEY`
- variables: `PUTIO_RELEASE_BOT_CLIENT_ID`
- approval: none
- branch policy: `main`
- deployment records: disabled with `deployment: false`

Keep `NPM_TOKEN` in the `release` Environment so pull requests stay
publish-secret-free.

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
