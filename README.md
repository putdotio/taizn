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
```

Project files:

- `taizn.json`: app build, widget, signing, and variant config
- `.taizn/.env`: optional local secrets read by Node
- `.taizn/certificates/`: optional local author/distributor certs for `taizn profile`
- `.taizn/build/`: generated package staging and output

## Commands

```bash
taizn check
taizn profile
taizn package
taizn install
taizn --version
```

`check` verifies the configured Tizen CLI and `sdb`, then prints connected
targets without requiring `taizn.json`. `profile` imports
`.taizn/certificates/author.p12` and
`.taizn/certificates/distributor.p12` into a Tizen security profile.
`package` builds and signs a `.wgt`. `install` packages and sideloads it.

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
```

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
        "name": "Example",
        "packageId": "Example"
      }
    }
  }
}
```

## Docs

- [Contributing](./CONTRIBUTING.md)
- [Distribution](./docs/DISTRIBUTION.md)
- [Security](./SECURITY.md)

## Repo Internals

- [Agent guide](./AGENTS.md)

## Contributing

See [Contributing](./CONTRIBUTING.md) for setup, checks, and pull request flow.

## License

[MIT](./LICENSE)
