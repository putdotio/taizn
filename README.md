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

Only the latest npm release is supported. Node: `engines.node` in
[`package.json`](./package.json).

Taizn drives the Tizen Studio CLI. Install it with `taizn sdk install` or by
hand, then check that `taizn check` finds `tizen` and `sdb`.

Tizen Studio ships `sdb` and the JDK behind `tizen` as x86_64 macOS binaries.
Apple Silicon Macs run them through Rosetta 2:

```bash
softwareupdate --install-rosetta --agree-to-license
```

Without Rosetta, commands that resolve `tizen` or `sdb` fail with
`RosettaRequired`. The Tizen TV emulator is x86-only, so Apple Silicon Macs
prove against a connected TV.

## Tizen SDK

`taizn sdk` installs Tizen Studio and moves its signing state between machines.
It needs no `taizn.json`.

```bash
pnpm exec taizn sdk install --dry-run
pnpm exec taizn sdk install --packages <package1,package2>
pnpm exec taizn sdk backup --dry-run [--full] [OUTPUT]
pnpm exec taizn sdk backup [--full] [OUTPUT]
pnpm exec taizn sdk restore --dry-run <archive.tar.gz>
pnpm exec taizn sdk restore <archive.tar.gz>
```

- `sdk install` puts the official web CLI installer's output in
  `~/tizen-studio` (macOS or x86_64 Linux) and reuses an existing install.
  Tizen Studio releases before `10.0` use a different installer name; pass
  `--installer-url`. Samsung's installer accepts a `--studio-dir` only inside
  the home directory, without spaces or non-ASCII characters. With a
  non-default `--studio-dir`, set `TAIZN_TIZEN_CLI` and `TAIZN_SDB`.
- `sdk backup` archives `~/SamsungCertificate`, `~/.tizen`, and
  `~/tizen-studio-data/{keystore,profile}`; `--full` adds the SDK, its data,
  extensions, and workspace. It runs on macOS and Linux only.
- `sdk restore` extracts a backup into the home directory and rejects entries
  outside the backup paths. A full restore refuses to run while
  `~/tizen-studio` exists; move it aside first.

Backups hold signing certificates and device keys. Each backup needs a new
output path outside the archived paths; keep it out of version control. Taizn
writes archives with mode `0600`, never replaces an existing path, and never
writes through an existing symlink on restore.

## Quick Start

Create `taizn.json` in the app directory, keep `.taizn/` ignored, then run:

```bash
pnpm exec taizn check
pnpm exec taizn package
pnpm exec taizn install
pnpm exec taizn run
```

| Path                   | Purpose                                        |
| ---------------------- | ---------------------------------------------- |
| `taizn.json`           | App build, widget, signing, and variant config |
| `.taizn/.env`          | Optional local secrets read by Node            |
| `.taizn/certificates/` | Optional local author and distributor certs    |
| `.taizn/remote.json`   | Optional paired Samsung TV remote token        |
| `.taizn/seller.json`   | Local Seller Office browser connection state   |
| `.taizn/seller/`       | Dedicated human-owned Chrome profile           |
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

Variant `indexHtml`, `injectWebapis`, and `rewriteAssetUrls` override the
top-level `widget` values; variant `excludeFiles` add to `widget.excludeFiles`.
Use them when development packages bundle local assets and production packages
load hosted asset URLs. [`src/config.ts`](https://github.com/putdotio/taizn/blob/main/src/config.ts) owns the full
schema.

## Automation

`taizn describe` prints every command as JSON: purpose, flags, env, outputs,
and whether it mutates. Prefer JSON and artifacts when `taizn` feeds another
tool:

```bash
pnpm exec taizn describe
pnpm exec taizn check --json --fields targets,tools.sdb
pnpm exec taizn prove --dry-run --json --fields application.id,target Example.app
pnpm exec taizn prove --json --artifact .taizn/proof.json Example.app
pnpm exec taizn prepare submission --json --artifact .taizn/submission.json package.wgt
pnpm exec taizn validate submission --json --fields ok,problems
pnpm exec taizn seller apps list --json --artifact .taizn/seller-apps.json
pnpm exec taizn tv doctor --connect --json --artifact .taizn/tv-doctor.json
```

- Run `--dry-run` before mutating platform state when the command supports it.
- Artifact paths must resolve inside the physical app directory, symlinks
  included. The check runs before writing and does not guard against
  concurrent filesystem changes.
- Finite SDB queries, target connections, and captured launch commands time out
  after 30 seconds per subprocess. Builds, signing, and installs have no
  deadline.

## Environment

Set these in `.taizn/.env` or export them in the shell:

```bash
TAIZN_CERT_PASSWORD=...
TAIZN_DIST_PASSWORD=...
TAIZN_VARIANT=development
TAIZN_TARGET=<tv-ip>:26101
TAIZN_TIZEN_CLI=~/tizen-studio/tools/ide/bin/tizen
TAIZN_SDB=~/tizen-studio/tools/sdb
TAIZN_SELLER_BROWSER=/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome
TAIZN_TV_HOST=<tv-ip>
TAIZN_TV_TOKEN=<paired-remote-token>
```

[Samsung TV Remote](./docs/tv-remote.md) covers pairing and the other
`TAIZN_TV_*` settings. [Seller Office](./docs/seller-office.md) covers the
read-only Seller Office workflow.

## Boundaries

`taizn` owns platform mechanics: Tizen CLI, `sdb`, widget archives, local
submission preparation, Samsung remote keys, target inventory, logs,
hosted-asset probes, and proof artifacts. Consumer apps own product journeys,
credentials, app IDs, content IDs, account state, visual assertions, release
decisions, and Seller Office portal mutations. Taizn's Seller Office surface is
a human-owned local browser session with sanitized read-only discovery.

## Docs

- [Contributing](./CONTRIBUTING.md)
- [Samsung TV Remote](./docs/tv-remote.md)
- [Seller Office](./docs/seller-office.md)
- [Agent guide](./AGENTS.md) and [Taizn skill](./skills/taizn/SKILL.md)
- [Security](https://github.com/putdotio/.github/blob/main/SECURITY.md)

## License

[MIT](./LICENSE)
