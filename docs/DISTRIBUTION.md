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

## Package Contents

The npm package includes `dist`, `README.md`, `docs`, `skills`, `AGENTS.md`,
`CONTRIBUTING.md`, and `SECURITY.md` so package consumers can follow the
README's support, contribution, and automation links without cloning extra
context.

## Release Environment

The release job uses the GitHub Environment named `release`.

Environment entries:

- secrets: `PUTIO_RELEASE_BOT_PRIVATE_KEY`
- variables: `PUTIO_RELEASE_BOT_CLIENT_ID`
- approval: none
- branch policy: `main`
- deployment records: disabled with `deployment: false`

The npm package uses Trusted Publishing from GitHub Actions. On npm, configure owner `putdotio`, repository `taizn`, workflow `ci.yml`, and Environment named `release` for the package.

During the `@semantic-release/npm` publish step, npm detects the GitHub OIDC identity, mints short-lived publish credentials, and publishes provenance for the release job.

Release GitHub writes use `putio-releaser`, and the release-bot remote is configured only after dependencies are installed.

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
