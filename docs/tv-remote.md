# Samsung TV Remote

`taizn tv` wraps Samsung's websocket remote-control API for local development
and smoke checks against a physical TV or monitor.

## Commands

```bash
taizn tv doctor
taizn tv doctor --json
taizn tv doctor --connect --json
taizn tv info
taizn tv info --json
taizn tv pair --dry-run
taizn tv press KEY_ENTER
taizn tv press --json KEY_ENTER
taizn tv press --dry-run --json KEY_ENTER
taizn tv press --delay-ms 250 KEY_HOME KEY_DOWN KEY_ENTER
taizn tv script --file .taizn/remote-script.json --dry-run --json
```

- `doctor` reports the resolved host, local `.taizn/remote.json` state, token
  presence, HTTP metadata status, and websocket endpoint. Add `--json` for a
  structured diagnostic. Add `--connect` only when you want to test the
  websocket; without a token this can trigger the TV's allow/deny prompt.
- `info` reads the TV's local `/api/v2/` metadata and reports remote-control
  support. Add `--json` to emit a structured TV capability snapshot for agents
  and scripts.
- `pair` opens a Samsung remote websocket and waits for the TV to approve the
  client. When pairing succeeds, it stores the token in `.taizn/remote.json`.
  Use `--dry-run` to validate host resolution without opening the websocket.
- `press` reconnects with the paired token and sends a Samsung remote key such
  as `KEY_HOME`, `KEY_BACK`, `KEY_UP`, `KEY_DOWN`, `KEY_LEFT`, `KEY_RIGHT`, or
  `KEY_ENTER`. Pass multiple keys to send a navigation sequence on one
  websocket connection. `--delay-ms` controls the delay between sequence keys.
  Add `--json` to emit a redacted receipt with the target, delay, and keys sent,
  or `--artifact .taizn/tv-press.json` to keep that receipt. Use `--dry-run`
  to validate key input and resolved remote state without sending keys.
- `script` reads a JSON key recipe, validates it, and sends each step through
  the paired remote token. Use `--dry-run` while assembling a flow, `--json` for
  a structured receipt, and `--artifact .taizn/remote-script-proof.json` for a
  durable proof file.

Script format:

```json
{
  "delayMs": 250,
  "steps": [
    { "keys": ["KEY_HOME", "KEY_DOWN", "KEY_ENTER"] },
    { "delayMs": 500, "key": "KEY_RETURN" }
  ]
}
```

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

`TAIZN_TV_HOST` is optional when `TAIZN_TARGET=<tv-ip>:26101` is set; `taizn`
uses the host part of `TAIZN_TARGET` as a fallback. The default remote endpoint
is `wss://<tv-ip>:8002`. Use `TAIZN_TV_PROTOCOL=ws` and `TAIZN_TV_PORT=8001`
only for older TVs or test fixtures that do not support the TLS endpoint.
`TAIZN_TV_INFO_PORT` controls the HTTP metadata endpoint used by `tv info`.

`TAIZN_TV_TOKEN` overrides `.taizn/remote.json` for one-off runs. Do not commit
remote tokens. `TAIZN_TV_TIMEOUT_MS` controls websocket pairing/key-press and
HTTP info request timeouts.

## Pairing

Run:

```bash
TAIZN_TV_HOST=<tv-ip> taizn tv pair
```

If the TV shows an allow prompt, approve it. If no prompt appears, check the TV
settings for IP remote control and device permissions, then retry pairing.

Successful pairing prints the token and writes:

```txt
.taizn/remote.json
```

The `.taizn/` directory is local state and must stay ignored.

## Scope

Remote commands only inspect metadata, diagnose remote readiness, pair, and send
key presses. They do not install widgets, launch applications, or capture
screenshots. Use the regular `taizn install` and Tizen CLI commands for app
lifecycle work. Use logs, app-level probes, Samsung Web Inspector, Remote Test
Lab, or external capture when visual proof is needed.
