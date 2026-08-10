<div align="center">
  <p>
    <img src="https://static.put.io/images/putio-boncuk.png" width="72" alt="put.io Boncuk logo">
  </p>

  <h1>taizn</h1>

  <p>Tizen TV packaging, install, remote-control, and live proof harness.</p>
  <p>Generic platform mechanics for consumer app repos that need repeatable Samsung TV delivery checks.</p>

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

Node `>=24.18`

Install the Tizen command-line tools separately and make sure `tizen` and `sdb`
work locally.

## Quick Start

Create `taizn.json` in the app directory, keep `.taizn/` ignored, then run:

```bash
pnpm exec taizn check
pnpm exec taizn package
pnpm exec taizn install
pnpm exec taizn run
```

Common project files:

| Path                   | Purpose                                        |
| ---------------------- | ---------------------------------------------- |
| `taizn.json`           | App build, widget, signing, and variant config |
| `.taizn/.env`          | Optional local secrets read by Node            |
| `.taizn/certificates/` | Optional local author and distributor certs    |
| `.taizn/remote.json`   | Optional paired Samsung TV remote token        |
| `.taizn/build/`        | Generated package staging and output           |

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

## Automation

Prefer JSON and artifacts when `taizn` feeds another tool:

```bash
pnpm exec taizn describe
pnpm exec taizn check --json --fields targets,tools.sdb
pnpm exec taizn prove --dry-run --json --fields application.id,target Example.app
pnpm exec taizn prove --json --artifact .taizn/proof.json Example.app
pnpm exec taizn prepare submission --json --artifact .taizn/submission.json package.wgt
pnpm exec taizn validate submission --json --fields ok,problems
pnpm exec taizn tv doctor --connect --json --artifact .taizn/tv-doctor.json
```

Use `--dry-run` before mutating platform state when the command supports it.
Artifact paths must stay inside the app directory; `.taizn/...` is the normal
home for local proof state.

## Command Surface

| Command                              | Purpose                                            |
| ------------------------------------ | -------------------------------------------------- |
| `describe`                           | Print the machine-readable command surface         |
| `check`                              | Verify Tizen CLI, `sdb`, and target readiness      |
| `apps`                               | List installed target applications                 |
| `launch`                             | Start an already-installed app                     |
| `prove`                              | Resolve, launch, and record installed-app proof    |
| `inspect wgt`                        | Read neutral `.wgt` archive metadata               |
| `prepare submission`                 | Create a deterministic signed-WGT manifest         |
| `validate submission`                | Check generic package metadata                     |
| `probe hosted-assets`                | Discover or probe hosted asset URLs                |
| `logs capture`                       | Record a bounded `sdb dlog -d` snapshot            |
| `targets list` / `targets current`   | Report configured and connected target state       |
| `profile`                            | Import local Tizen signing certificates            |
| `package`                            | Build and sign a `.wgt`                            |
| `install`                            | Package and sideload the widget                    |
| `run`                                | Launch the configured variant application          |
| `tv doctor` / `tv info`              | Inspect Samsung TV remote-control readiness        |
| `tv pair` / `tv press` / `tv script` | Pair and send Samsung remote-control key sequences |

See [Samsung TV Remote](./docs/TV_REMOTE.md) for pairing, environment, and
limits.

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
TAIZN_TV_PORT=8002
TAIZN_TV_PROTOCOL=wss
TAIZN_TV_TOKEN=<paired-remote-token>
```

`taizn tv` uses `TAIZN_TV_HOST`, or the host part of `TAIZN_TARGET` when no TV
host is set. `taizn tv pair` writes the paired remote token to
`.taizn/remote.json`; keep `.taizn/` ignored.

## Boundaries

`taizn` owns platform mechanics: Tizen CLI, `sdb`, widget archives, local
submission preparation, Samsung remote keys, target inventory, logs,
hosted-asset probes, and proof artifacts. Consumer apps own product journeys,
credentials, app IDs, content IDs, account state, visual assertions, release
decisions, and Samsung TV Seller Office portal mutations.

## Docs

- [Contributing](./CONTRIBUTING.md)
- [Distribution](./docs/DISTRIBUTION.md)
- [Live Test](./live-test/README.md)
- [Samsung TV Remote](./docs/TV_REMOTE.md)
- [Security](./SECURITY.md)

## Repo Internals

- [Agent guide](./AGENTS.md)
- [Taizn skill](./skills/taizn/SKILL.md)

## License

[MIT](./LICENSE)
