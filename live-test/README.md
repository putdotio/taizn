# Live Test

Small fixture app for checking `taizn` against a local Tizen toolchain and,
optionally, a connected device.

## Setup

```bash
mkdir -p live-test/app/.taizn/certificates
```

Put signing files here:

- `live-test/app/.taizn/certificates/author.p12`
- `live-test/app/.taizn/certificates/distributor.p12`

Create `live-test/app/.taizn/.env` when you want local defaults:

```bash
TAIZN_CERT_PASSWORD=...
TAIZN_DIST_PASSWORD=...
TAIZN_LIVE_PROFILE=taizn-live-test
TAIZN_LIVE_PROVE_APP=TaiznLiveD.taizn
TAIZN_TARGET=<tv-ip>:26101
```

## Commands

```bash
vp run live:test:profile
vp run live:test
vp run live:test:install
vp run live:test:prove
```

- `live:test:profile` imports the fixture signing profile.
- `live:test` packages the fixture app.
- `live:test:install` packages and installs it on `TAIZN_TARGET`, or on the
  single connected `sdb devices` target.
- `live:test:prove` checks that the fixture app, or `TAIZN_LIVE_PROVE_APP`, is
  installed and launchable on the target.

The fixture writes `live-test/app/taizn.json` from
`live-test/app/taizn.template.json`. Package and install use
`TAIZN_LIVE_PROFILE`, then the active local Tizen profile, then
`taizn-live-test`. Proof uses `TAIZN_LIVE_PROVE_APP` when set, otherwise the
configured `TAIZN_VARIANT` application ID from the fixture template.
