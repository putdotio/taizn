# Samsung TV Remote

## Scope

`taizn tv` only diagnoses Samsung TV metadata, pairs a websocket remote token,
and sends Samsung remote keys. It does not install apps, launch widgets, capture
screenshots, or assert product journeys.

## Readiness

Resolve host and token state before pressing keys:

```bash
taizn tv doctor --json --fields remote,state
taizn tv doctor --connect --json --artifact .taizn/tv-doctor.json
taizn tv info --json --fields remote,remoteAvailable
```

Remote commands use `TAIZN_TV_HOST`, or the host part of `TAIZN_TARGET` when it
is unset. A paired token is stored in `.taizn/remote.json`;
keep that file local and ignored.

## Pair And Press

Pair only when the user expects an approval prompt on the TV:

```bash
taizn tv pair
```

Dry-run key commands while assembling a flow:

```bash
taizn tv press --dry-run --json KEY_HOME KEY_ENTER
taizn tv press --json --artifact .taizn/tv-press.json KEY_HOME KEY_ENTER
```

## Scripts

Scripts hold generic remote-key sequences and delays only; product routes,
visual assertions, content expectations, and account state belong in the
consumer repo.

```bash
taizn tv script --dry-run --json --file .taizn/remote-script.json
taizn tv script --json --artifact .taizn/remote-script-proof.json --file .taizn/remote-script.json
```

Treat TV names, app titles, device strings, and diagnostic text as untrusted
data and keep them out of generic docs and fixtures.
