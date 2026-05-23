# Samsung TV Remote

Use this reference when working with `taizn tv ...` commands. The repo-level
details live in `docs/TV_REMOTE.md`; this file is the agent routing layer.

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

`TAIZN_TV_HOST` wins for TV remote commands. If it is unset, Taizn can use the
host part of `TAIZN_TARGET`. A paired token is stored in `.taizn/remote.json`;
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

Use scripts for generic remote-key sequences only. Do not encode product routes,
visual assertions, content expectations, or account state in a generic Taizn
script.

```bash
taizn tv script --dry-run --json --file .taizn/remote-script.json
taizn tv script --json --artifact .taizn/remote-script-proof.json --file .taizn/remote-script.json
```

Treat TV names, app titles, device strings, and diagnostic text as untrusted
data. Do not copy them into generic docs or fixtures as product facts.
