# Live Test

Fixture harness that checks `taizn` against a local Tizen toolchain and,
optionally, a connected TV.

## Setup

Bootstrap the fixture from a consumer app that already has `.taizn/.env` and
certificates:

```bash
pnpm exec vp run live:test:setup -- --from ../consumer-app --target <tv-ip>
```

It copies only allowlisted harness keys and certificate files into the ignored
`live-test/app/.taizn/`, reads the source app's signing profile into
`TAIZN_LIVE_PROFILE`, and adds local Tizen CLI paths it finds. `--help` lists
the overrides; [`setup-core.ts`](./setup-core.ts) lists the copied keys.

Without a consumer app, put `author.p12` and `distributor.p12` in
`live-test/app/.taizn/certificates/` and write `live-test/app/.taizn/.env`:

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

The harness writes `live-test/app/taizn.json` from
`live-test/app/taizn.template.json`. Signing uses `TAIZN_LIVE_PROFILE`, then
the active Tizen profile, then `taizn-live-test`.

## Commands

Run each with `pnpm exec vp run <script>`; [`package.json`](../package.json)
maps each to its harness flags.

| Script                           | Touches the TV | Proves                                                                                      |
| -------------------------------- | -------------- | ------------------------------------------------------------------------------------------- |
| `live:test:profile`              | no             | Imports the fixture signing profile.                                                        |
| `live:test`                      | no             | Packages the fixture app.                                                                   |
| `live:test:doctor`               | reads          | `taizn tv doctor --json` from the fixture root.                                             |
| `live:test:doctor:connect`       | may prompt     | Adds `--connect`; without a token the TV can show an allow/deny prompt.                     |
| `live:test:install`              | installs       | Packages and installs on `TAIZN_TARGET` or the single connected `sdb` target.               |
| `live:test:prove`                | launches       | The fixture app, or `TAIZN_LIVE_PROVE_APP`, is installed and launchable.                    |
| `live:test:remote`               | sends keys     | Writes `.taizn/live-remote.json`; sends `LIVE_TEST_REMOTE_KEYS` once a paired token exists. |
| `live:test:smoke`                | launches       | Writes `.taizn/live-smoke.json` with `check`, `apps`, `prove`, and `tv doctor` results.     |
| `live:test:roundtrip`            | reinstalls     | Package, install, launch, and on-TV JavaScript through the [beacon](#roundtrip-proof).      |
| `live:test:tv-assets`            | reinstalls     | Roundtrip plus hosted asset loads.                                                          |
| `live:test:tv-assets:production` | reinstalls     | The same against the production fixture variant.                                            |

- `LIVE_TEST_REQUIRE_REMOTE=1` makes a missing or timed-out remote fail
  `live:test:remote`.
- Roundtrip ignores `TAIZN_LIVE_PROVE_APP`. If the fixture is installed with a
  different author certificate, it uninstalls the fixture package and retries
  once.
- `check`, `apps`, and `prove` run under a two-minute watchdog. Packaging,
  signing, install, and uninstall have no deadline.

## Roundtrip Proof

Roundtrip starts a local HTTP beacon and waits for the launched fixture to
report back. Set `TAIZN_LIVE_BEACON_HOST` when the automatic same-subnet choice
picks the wrong interface. `TAIZN_LIVE_BEACON_TIMEOUT_MS` defaults to `15000`,
which covers the fixture's per-asset timeout.

`LIVE_TEST_FETCH_URLS`, comma- or newline-separated, also proves the TV WebView
can load remote assets: `.js` through a `script` element, `.css` through a
stylesheet link, anything else through `fetch`. Results land in the beacon step
of `.taizn/live-roundtrip.json`. The `live:test:tv-assets` presets load the
public URLs in [`harness-core.ts`](./harness-core.ts).
