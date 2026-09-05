# Live Test

Fixture harness for checking `taizn` against a local Tizen toolchain and,
optionally, a connected device.

## Setup

```bash
mkdir -p live-test/app/.taizn/certificates
```

If another local consumer app already has `.taizn/.env` and certificates,
bootstrap the fixture from that app without copying unrelated app config:

```bash
vp run live:test:setup -- --from ../consumer-app --target <tv-ip>
```

The setup command writes only allowlisted harness keys and certificate files into
ignored `live-test/app/.taizn/` state. It also reads the source app's
`taizn.json` signing profile into `TAIZN_LIVE_PROFILE`, and it adds default
local Tizen CLI paths when they exist. Add `--json` for a machine-readable
summary, or use `--help` to list all overrides.

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
TAIZN_LIVE_BEACON_HOST=<computer-ip-reachable-from-tv>
TAIZN_LIVE_BEACON_TIMEOUT_MS=15000
TAIZN_TV_TIMEOUT_MS=5000
LIVE_TEST_FETCH_URLS=https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js,https://cdnjs.cloudflare.com/ajax/libs/normalize/8.0.1/normalize.min.css
LIVE_TEST_REMOTE_DELAY_MS=250
LIVE_TEST_REMOTE_KEYS=KEY_UP,KEY_ENTER
LIVE_TEST_REQUIRE_REMOTE=0
```

## Commands

```bash
vp run live:test:setup -- --from ../consumer-app --target <tv-ip>
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

- `live:test:profile` imports the fixture signing profile.
- `live:test` packages the fixture app.
- `live:test:doctor` runs `taizn tv doctor --json` from the fixture app root,
  using `TAIZN_TARGET`, `TAIZN_TV_HOST`, and local `.taizn/remote.json` state.
- `live:test:doctor:connect` also passes `--connect` to test the Samsung
  websocket endpoint. This can trigger the TV allow/deny prompt when no token is
  configured.
- `live:test:install` packages and installs it on `TAIZN_TARGET`, or on the
  single connected `sdb devices` target.
- `live:test:prove` checks that the fixture app, or `TAIZN_LIVE_PROVE_APP`, is
  installed and launchable on the target.
- `live:test:remote` writes `.taizn/live-remote.json` with `tv doctor
--connect` results. Set `LIVE_TEST_REMOTE_KEYS` to send a key sequence after
  the remote connection is ready and a token is already configured with
  `taizn tv pair`. Set `LIVE_TEST_REQUIRE_REMOTE=1` when a missing or timed-out
  websocket remote should fail the command.
- `live:test:roundtrip` packages, installs, launches, and writes
  `.taizn/live-roundtrip.json` with the install transcript plus smoke results.
  If the fixture app is already installed with a different author certificate,
  it uninstalls the fixture package ID and retries the install once. It also
  starts a local HTTP beacon and fails unless the launched fixture app reports
  that its JavaScript ran on the TV. Roundtrip always proves the selected
  fixture variant, ignoring `TAIZN_LIVE_PROVE_APP`. Set `LIVE_TEST_FETCH_URLS`
  to a comma- or newline-separated URL list when you also need the TV WebView to
  prove it can fetch remote assets; fetch results are included in the beacon
  step of `.taizn/live-roundtrip.json`.
- `live:test:smoke` writes `.taizn/live-smoke.json` with structured `check`,
  `apps`, `prove`, and `tv doctor` results from the selected target.
- `live:test:tv-assets` runs roundtrip with neutral hosted asset load probes.
- `live:test:tv-assets:production` runs the same proof against the production
  fixture variant.

The fixture writes `live-test/app/taizn.json` from
`live-test/app/taizn.template.json`. Package and install use
`TAIZN_LIVE_PROFILE`, then the active local Tizen profile, then
`taizn-live-test`. Proof uses `TAIZN_LIVE_PROVE_APP` when set, otherwise the
configured `TAIZN_VARIANT` application ID from the fixture template.

Finite JSON/read and launch-proof CLI steps have a two-minute wrapper watchdog.
The CLI applies its own shorter deadlines to finite SDB/Tizen subprocesses.
Packaging, signing, installation, and uninstall steps retain their existing
duration behavior.

## Roundtrip Proof

`live:test:roundtrip` starts a local HTTP beacon and waits for the launched TV
fixture to report back. Set `TAIZN_LIVE_BEACON_HOST` when the computer has
multiple network interfaces and the automatic same-subnet choice is wrong.
`TAIZN_LIVE_BEACON_TIMEOUT_MS` defaults to `15000`, which leaves room for the
fixture's per-asset timeout.

When `LIVE_TEST_FETCH_URLS` is set, `.js` URLs are verified by loading a
`script` element and `.css` URLs are verified by loading a stylesheet link.
Other URL types use `fetch`. The `live:test:tv-assets` presets use this path to
prove the TV WebView can load neutral public assets:

```txt
https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js
https://cdnjs.cloudflare.com/ajax/libs/normalize/8.0.1/normalize.min.css
```
