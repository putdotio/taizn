# Agent DX

Taizn treats the agent as an untrusted operator. Agent-facing commands should be
predictable, structured, bounded, and explicit about what they can prove.

## Scorecard

Current score: **15 / 21**, agent-ready.

| Axis                      | Score | Current state                                                                                                                                                                                                                                                                |
| ------------------------- | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Machine-readable output   |     2 | Core inventory, proof, TV diagnostics, inspection, validation, logs, targets, and probes expose JSON. JSON-mode errors return structured envelopes. Logs can emit NDJSON.                                                                                                    |
| Raw payload input         |     1 | `tv script --file` accepts a JSON key recipe. Most commands still use focused flags.                                                                                                                                                                                         |
| Schema introspection      |     2 | `taizn describe` exposes command arguments, flags, env vars, mutability, dry-run support, field-mask support, output modes, and result schema names.                                                                                                                         |
| Context window discipline |     2 | Read/proof commands support `--fields`; `logs capture --output ndjson` emits one object per line.                                                                                                                                                                            |
| Input hardening           |     3 | Agent-controlled resource IDs reject control characters, traversal, encoded dot segments, query strings, and fragments. Artifact paths are sandboxed to the app directory. Samsung remote URLs use `URLSearchParams`; the explicit posture is that the agent is not trusted. |
| Safety rails              |     2 | Mutating platform commands support `--dry-run`, including package, install, run, launch/prove, TV pair/press, TV scripts, and hosted-asset probes.                                                                                                                           |
| Agent knowledge packaging |     3 | `AGENTS.md`, this document, command docs, and `skills/taizn/SKILL.md` capture agent-specific workflows and guardrails.                                                                                                                                                       |

## Command Rules

- Prefer `--json` when a command is feeding another tool.
- Use `--fields <mask>` on JSON commands to keep context small, for example
  `--fields target,application.id`.
- Prefer `--artifact <path>` for proof commands when the result should survive
  the terminal scrollback.
- Artifact paths must stay inside the app directory. Use `.taizn/...` for local
  proof state.
- Use `taizn describe` before automating a new surface. It is the compact,
  machine-readable map of the command surface.
- Use `taizn dx score` to check the current Agent DX scorecard from the binary.
- Use `--dry-run` before mutating platform state when an agent is still
  assembling a flow.
- Use `logs capture --output ndjson` when logs may be large.

## Existing Surfaces

- `check --json`: structured tool and target readiness.
- `check --json --fields targets`: compact target readiness.
- `check --artifact .taizn/check.json`: durable readiness artifact.
- `apps --json`: compact installed app inventory.
- `apps --artifact .taizn/apps.json`: durable installed app inventory artifact.
- `prove --json --artifact .taizn/proof.json`: launch proof for an installed app.
- `prove --dry-run --json --fields application.id,target`: validate launch
  resolution without starting the app.
- `tv doctor --connect --json`: remote-control readiness and redacted token state.
- `tv doctor --artifact .taizn/tv-doctor.json`: durable remote diagnostic artifact.
- `tv info --json`: TV capability snapshot.
- `tv info --artifact .taizn/tv-info.json`: durable TV capability artifact.
- `tv press --json`: key-sequence receipt.
- `tv press --dry-run --json`: validate remote key input without sending keys.
- `tv press --artifact .taizn/tv-press.json`: durable key-sequence receipt.

## New Harness Surfaces

- `vp run live:test:setup -- --from <app-dir> --target <tv-ip>` bootstraps the
  local fixture from allowlisted consumer app state and reports configured keys.
- `inspect wgt --json <path>` extracts archive entries and `config.xml` metadata.
- `validate submission --json [path]` checks generic selected-variant metadata
  without automating the Seller Office portal.
- `probe hosted-assets --dry-run --json [url...]` discovers or validates hosted
  asset URLs. Local URL fetches are not TV WebView proof; use live-test roundtrip
  commands when the TV runtime must prove the fetch path.
- `logs capture --json --app <query>` captures a compact `sdb dlog -d` snapshot.
- `logs capture --output ndjson --app <query>` emits one JSON object per log
  line.
- `targets list --json` reports configured, connected, and optional alias state.
- `tv script --file <json> --dry-run --json` validates key recipes before sending
  remote-control commands.

## TV Script Format

```json
{
  "delayMs": 250,
  "steps": [
    { "keys": ["KEY_HOME", "KEY_DOWN", "KEY_ENTER"] },
    { "delayMs": 500, "key": "KEY_RETURN" }
  ]
}
```

## Target Alias Format

`.taizn/targets.json` is optional local state and should stay ignored:

```json
{
  "targets": [
    {
      "alias": "example-tv",
      "target": "192.0.2.10:26101",
      "tvHost": "192.0.2.10"
    }
  ]
}
```

## Boundaries

Taizn owns platform mechanics: Tizen CLI, `sdb`, widget archives, Samsung remote
keys, target inventory, logs, hosted-asset probes, and proof artifacts. Consumer
apps own product journeys, credentials, app IDs, content IDs, account state,
visual assertions, and release decisions.

## Remaining Score Gaps

- Raw payload input stays at 1 because Taizn intentionally exposes focused
  platform verbs instead of a broad API-payload layer.
- Machine-readable output stays at 2 because only logs stream as NDJSON and
  structured output is not the default for every non-TTY success path.
