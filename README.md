# taizn

Small CLI for packaging and sideloading Samsung Tizen web widgets.

## Install

```bash
pnpm add -D taizn
```

Install Samsung's Tizen Studio and make sure `tizen` and `sdb` work locally.

## Project Files

- `taizn.json`: app build, widget, signing, and variant config
- `.taizn/.env`: optional local secrets read by Node
- `.taizn/certificates/`: optional local author/distributor certs for `taizn profile`
- `.taizn/build/`: generated package staging and output

Keep `.taizn/` ignored.

## Commands

```bash
taizn profile
taizn package
taizn install
```

`profile` imports `.taizn/certificates/author.p12` and
`.taizn/certificates/distributor.p12` into a Tizen security profile.
`package` builds and signs a `.wgt`. `install` packages and sideloads it.

## Environment

```bash
TAIZN_CERT_PASSWORD=...
TAIZN_DIST_PASSWORD=...
TAIZN_VARIANT=development
TAIZN_TARGET=192.168.1.99:26101
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
