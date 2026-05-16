<div align="center">
  <p>
    <img src="https://static.put.io/images/putio-boncuk.png" width="72">
  </p>

  <h1>taizn</h1>

  <p>A tiny CLI companion for interacting with Tizen ecosystem.</p>

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
taizn apps
taizn apps put
taizn apps --json put
taizn launch GinifYRGmZ.putio
taizn prove GinifYRGmZ.putio
taizn prove --json GinifYRGmZ.putio
taizn profile
taizn package
taizn install
taizn run
taizn tv info
taizn tv pair
taizn tv press KEY_ENTER
taizn tv press --delay-ms 250 KEY_HOME KEY_DOWN KEY_ENTER
taizn --version
```

`check` verifies the configured Tizen CLI and `sdb`, then prints connected
targets without requiring `taizn.json`. Add `--json` to emit the configured
tool paths and connected targets for agents and scripts. `apps` lists installed
applications on the target, with an optional query filter. Add `--json` to emit
a structured inventory for agents and scripts. `launch` starts an already-installed
application by exact application ID, exact name, or a unique query. `prove`
checks the installed app inventory, launches the matched app, and prints a
compact proof transcript. Add `--json` when an agent or script needs structured
proof output. `profile` imports
`.taizn/certificates/author.p12` and
`.taizn/certificates/distributor.p12` into a Tizen security profile.
`package` builds and signs a `.wgt`. `install` packages and sideloads it.
`run` launches the configured variant application on the target. `tv` commands use
Samsung's websocket remote-control API to inspect a TV,
pair for a remote token, and send remote-control key presses. See
[Samsung TV Remote](./docs/TV_REMOTE.md) for pairing, environment, and limits.
`tv press` accepts one key or a sequence of keys.

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

- [Contributing](./CONTRIBUTING.md)
- [Distribution](./docs/DISTRIBUTION.md)
- [Samsung TV Remote](./docs/TV_REMOTE.md)
- [Security](./SECURITY.md)

## Repo Internals

- [Agent guide](./AGENTS.md)
- Effect source for local API research lives in ignored `.repos/effect`; dependency installs bootstrap it outside CI.

## Contributing

See [Contributing](./CONTRIBUTING.md) for setup, checks, and pull request flow.

## License

[MIT](./LICENSE)
