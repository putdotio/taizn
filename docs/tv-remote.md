# Samsung TV Remote

`taizn tv` drives Samsung's websocket remote-control API against a physical TV
or monitor. It reads metadata, diagnoses readiness, pairs, and sends remote
keys. It does not install widgets, launch apps, or capture screenshots: use
`taizn install` and `taizn run` for the app lifecycle, and logs, app-level
probes, Samsung Web Inspector, Remote Test Lab, or external capture for visual
proof.

## Commands

```bash
taizn tv doctor --json
taizn tv doctor --connect --json
taizn tv info --json
taizn tv pair --dry-run
taizn tv press --dry-run --json KEY_ENTER
taizn tv press --delay-ms 250 KEY_HOME KEY_DOWN KEY_ENTER
taizn tv script --file .taizn/remote-script.json --dry-run --json
```

- `doctor --connect` opens the websocket; without a token, the TV can show an
  allow/deny prompt.
- `script` validates a JSON key recipe, then sends each step:

```json
{
  "delayMs": 250,
  "steps": [
    { "keys": ["KEY_HOME", "KEY_DOWN", "KEY_ENTER"] },
    { "delayMs": 500, "key": "KEY_RETURN" }
  ]
}
```

`--dry-run` validates input and resolved remote state without opening the
websocket. `--artifact .taizn/<name>.json` keeps a receipt.

## Pairing

```bash
TAIZN_TV_HOST=<tv-ip> taizn tv pair
```

Approve the prompt on the TV. If no prompt appears, check the TV settings for
IP remote control and device permissions, then retry.

Pairing prints the token as `TAIZN_TV_TOKEN=...` and saves it to
`.taizn/remote.json`. Keep `.taizn/` ignored and tokens out of commits and logs.

## Environment

```bash
TAIZN_TV_HOST=<tv-ip>
TAIZN_TV_INFO_PORT=8001
TAIZN_TV_NAME=taizn
TAIZN_TV_PORT=8002
TAIZN_TV_PROTOCOL=wss
TAIZN_TV_TIMEOUT_MS=30000
TAIZN_TV_TOKEN=<paired-remote-token>
```

- Without `TAIZN_TV_HOST`, `taizn tv` uses the host part of `TAIZN_TARGET`.
- The default endpoint is `wss://<tv-ip>:8002`. Use `TAIZN_TV_PROTOCOL=ws` and
  `TAIZN_TV_PORT=8001` only for older TVs or fixtures without the TLS endpoint.
- `TAIZN_TV_TOKEN` overrides `.taizn/remote.json` for one run.
- `TAIZN_TV_TIMEOUT_MS` bounds pairing, key presses, and metadata requests.
