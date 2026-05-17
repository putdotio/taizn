<div align="center">
  <h1>taizn</h1>

  <p>A typed Tizen TV packaging, install, remote-control, and live proof harness.</p>

  <p>
    <a href="https://github.com/putdotio/taizn/actions/workflows/ci.yml?query=branch%3Amain" style="text-decoration:none;"><img src="https://img.shields.io/github/actions/workflow/status/putdotio/taizn/ci.yml?branch=main&style=flat&label=ci&colorA=000000&colorB=000000" alt="CI"></a>
    <a href="https://www.npmjs.com/package/@putdotio/taizn" style="text-decoration:none;"><img src="https://img.shields.io/npm/v/%40putdotio%2Ftaizn?style=flat&label=npm&logo=npm&colorA=000000&colorB=000000" alt="npm version"></a>
    <a href="https://github.com/putdotio/taizn/blob/main/LICENSE" style="text-decoration:none;"><img src="https://img.shields.io/github/license/putdotio/taizn?style=flat&label=license&colorA=000000&colorB=000000" alt="License"></a>
  </p>
</div>

## Install

```bash
pnpm add -D @putdotio/taizn
```

Install the Tizen command-line tools and make sure `tizen` and `sdb` work
locally.

`taizn` wraps Tizen Studio CLI and Samsung TV remote-control primitives for app
repos that need repeatable widget packaging and real-device proof. It owns the
generic build, sign, install, launch, target inventory, remote diagnostics, and
hosted-asset roundtrip layers; app-specific journeys, credentials, content IDs,
and product assertions stay in the consumer app repo.

## Usage

Create `taizn.json` in the app directory, keep `.taizn/` ignored, then run:

```bash
pnpm exec taizn check
pnpm exec taizn package
pnpm exec taizn install
pnpm exec taizn run
```

Project files:

- `taizn.json`: app build, widget, signing, and variant config
- `.taizn/.env`: optional local secrets read by Node
- `.taizn/certificates/`: optional local author/distributor certs for `taizn profile`
- `.taizn/remote.json`: optional paired Samsung TV remote token
- `.taizn/build/`: generated package staging and output

## Commands

```bash
taizn check
taizn check --json
taizn check --artifact .taizn/check.json
taizn describe
taizn dx score
taizn apps
taizn apps example
taizn apps --json example
taizn apps --artifact .taizn/apps.json example
taizn apps --json --fields applications example
taizn launch --dry-run Example.app
taizn prove Example.app
taizn prove --json Example.app
taizn prove --dry-run --json --fields application.id,target Example.app
taizn prove --artifact .taizn/proof.json Example.app
taizn inspect wgt .taizn/build/output/example.wgt
taizn inspect wgt --json --fields config,entryCount .taizn/build/output/example.wgt
taizn validate submission
taizn validate submission --json .taizn/build/output/example.wgt
taizn probe hosted-assets --dry-run --json
taizn logs capture --json --app Example.app
taizn logs capture --output ndjson --app Example.app
taizn targets list --json
taizn targets current --json
taizn profile --dry-run
taizn package --dry-run
taizn install --dry-run
taizn run --dry-run
taizn tv doctor
taizn tv doctor --json
taizn tv doctor --connect --json
taizn tv info
taizn tv info --json
taizn tv pair --dry-run
taizn tv press KEY_ENTER
taizn tv press --json KEY_ENTER
taizn tv press --dry-run --json KEY_ENTER
taizn tv press --artifact .taizn/tv-press.json KEY_ENTER
taizn tv press --delay-ms 250 KEY_HOME KEY_DOWN KEY_ENTER
taizn tv script --file .taizn/remote-script.json --dry-run --json
taizn --version
```

`check` verifies the configured Tizen CLI and `sdb`, then prints connected
targets without requiring `taizn.json`. Add `--json` to emit the configured
tool paths and connected targets for agents and scripts. `apps` lists installed
applications on the target, with an optional query filter. Add `--json` to emit
a structured inventory for agents and scripts. Most JSON commands support
`--fields <mask>` to keep agent context small. `launch` starts an already-installed
application by exact application ID, exact name, or a unique query. `prove`
checks the installed app inventory, launches the matched app, and prints a
compact proof transcript. Add `--json` when an agent or script needs structured
proof output, or `--artifact <path>` to write the same proof inside the app
directory. `describe` prints the agent-facing command surface as JSON, and
`dx score` prints the current Agent DX CLI scorecard.
`inspect wgt` reads a `.wgt` archive and extracts neutral metadata such as
entries, `config.xml`, application ID, package ID, name, and privileges.
`validate submission` checks generic package metadata for the selected variant
without automating Samsung TV Seller Office. `probe hosted-assets` discovers
configured hosted asset URLs from the selected variant's index HTML, or accepts
URLs as arguments, and can dry-run or probe them from the local machine.
`logs capture` records a bounded `sdb dlog -d` snapshot and supports
`--output ndjson` for one object per log line. `targets` reports
configured, connected, and optional `.taizn/targets.json` alias state. `profile` imports
`.taizn/certificates/author.p12` and
`.taizn/certificates/distributor.p12` into a Tizen security profile.
`package` builds and signs a `.wgt`. `install` packages and sideloads it.
`run` launches the configured variant application on the target. `tv` commands use
Samsung's websocket remote-control API to inspect a TV,
diagnose remote-control readiness, pair for a remote token, and send remote-control
key presses. Add `--json` to `tv doctor` for structured host/token/connection
diagnostics, to `tv info` for a structured TV capability snapshot, or to
`tv press` for a structured key-sequence receipt. See
[Samsung TV Remote](./docs/TV_REMOTE.md) for pairing, environment, and limits.
`--dry-run` validates mutating platform commands without changing device or
package state where the underlying platform allows it. `tv press` accepts one
key or a sequence of keys. `tv script` accepts a small JSON key recipe and
supports `--dry-run`, `--json`, and `--artifact`.

## Boundaries

`taizn` is the generic Tizen TV harness layer:

- Tizen CLI and `sdb` readiness checks with structured target output
- widget staging, signing profile import, package, install, and run commands
- installed app inventory, launch by exact or unique query, and proof transcripts
- widget archive inspection, generic submission validation, hosted asset probes,
  target inventory, log capture, and proof artifacts
- Samsung TV metadata, websocket remote diagnostics, pairing, and key sequences
- local live-test fixture roundtrips, including hosted asset load probes

Consumer apps own product build scripts, private credentials, app-specific
flows, release decisions, and Samsung TV Seller Office submissions. `taizn`
prepares and proves artifacts for those workflows; it does not automate the TV
Seller Office portal.

## Environment

Copy [.env.example](./.env.example) into `.taizn/.env` or export values in the
shell:

```bash
TAIZN_CERT_PASSWORD=...
TAIZN_DIST_PASSWORD=...
TAIZN_VARIANT=development
TAIZN_TARGET=<tv-ip>:26101
TAIZN_TIZEN_CLI=~/tizen-studio/tools/ide/bin/tizen
TAIZN_SDB=~/tizen-studio/tools/sdb
TAIZN_TV_HOST=<tv-ip>
TAIZN_TV_INFO_PORT=8001
TAIZN_TV_NAME=taizn
TAIZN_TV_PORT=8002
TAIZN_TV_PROTOCOL=wss
TAIZN_TV_TIMEOUT_MS=30000
TAIZN_TV_TOKEN=<paired-remote-token>
```

`taizn tv` uses `TAIZN_TV_HOST`, or the host part of `TAIZN_TARGET` when no TV
host is set. `TAIZN_TV_INFO_PORT` controls the HTTP metadata endpoint; the
remote-control websocket still uses `TAIZN_TV_PORT`. `taizn tv pair` writes the
paired remote token to `.taizn/remote.json`; keep `.taizn/` ignored.

## Config

```json
{
  "build": {
    "command": ["pnpm", "build"],
    "output": "dist",
    "requiredFiles": ["main.css", "main.js"]
  },
  "signing": {
    "certificateDir": ".taizn/certificates",
    "profile": "my-tizen-profile"
  },
  "widget": {
    "configXml": "platforms/tizen/config.xml",
    "excludeFiles": ["js/main.js.map", "css/main.css.map"],
    "indexHtml": "platforms/tizen/index.html",
    "injectWebapis": true,
    "rewriteAssetUrls": false,
    "variants": {
      "development": {
        "applicationId": "ExampleDev.app",
        "bundleName": "example-dev",
        "icon": "platforms/tizen/icons/dev.png",
        "name": "Example Dev",
        "packageId": "ExampleDev"
      },
      "production": {
        "applicationId": "Example.app",
        "bundleName": "example",
        "excludeFiles": ["js/main.js.LICENSE.txt"],
        "icon": "platforms/tizen/icon.png",
        "indexHtml": "platforms/tizen/hosted.html",
        "injectWebapis": true,
        "name": "Example",
        "packageId": "Example",
        "rewriteAssetUrls": false
      }
    }
  }
}
```

Variant `indexHtml`, `injectWebapis`, and `rewriteAssetUrls` values override
the top-level `widget` values. Variant `excludeFiles` values are added to
top-level `widget.excludeFiles`. Use them when development packages should
bundle local app assets but production packages should load hosted asset URLs.

## Docs

- [Distribution](./docs/DISTRIBUTION.md)
- [Agent DX](./docs/AGENT_DX.md)
- [Live Test](./live-test/README.md)
- [Samsung TV Remote](./docs/TV_REMOTE.md)
- [Security](./SECURITY.md)

## Repo Internals

- [Agent guide](./AGENTS.md)
- Effect source for local API research lives in ignored `.repos/effect`; dependency installs bootstrap it outside CI.

## Contributing

See [Contributing](./CONTRIBUTING.md) for setup, checks, and pull request flow.

## License

[MIT](./LICENSE)
