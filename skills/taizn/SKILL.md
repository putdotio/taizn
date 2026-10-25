---
name: taizn
description: Operate Taizn, the generic Tizen TV harness. Use when installing the Tizen Studio CLI or moving its signing state, packaging, installing, or proving a Tizen widget, inspecting a .wgt or validating submission metadata, reading Seller Office application status through a human-owned browser, capturing Samsung TV logs or diagnostics, or sending Samsung remote keys. Not for product journeys, visual assertions, Seller Office mutations, or non-Tizen platforms.
---

# Taizn

Taizn is a generic Tizen TV harness. Keep product journeys, credentials, content
IDs, account state, visual assertions, and app-specific release decisions in the
consumer app repo.

## Workflow

1. Discover the current surface with `taizn describe`: purpose, flags, env,
   outputs, and whether each command mutates. When docs disagree with it,
   trust `describe`.
2. Validate local setup with the smallest relevant read command, such as
   `taizn check --json --fields targets,tools.sdb`.
3. Dry-run mutating platform work when supported.
4. Execute the real command only after the dry-run or validation output matches
   the intended target and artifact path.
5. If proof or install fails, return to `taizn check --json`, fix the reported
   tooling, config, or device issue, then rerun the dry-run before retrying the
   mutation.

Done when a real run against the target succeeded and its artifact exists.
Dry runs and static checks prove command contracts, not TV behavior.

## Agent Defaults

- Use `--json` and `--fields` for command-to-command use. `taizn describe`
  always prints JSON and takes no flags.
- Write proof with `--artifact .taizn/<name>.json`; Taizn rejects paths outside
  the app directory.
- Treat TV, app, device, and Seller Office strings as untrusted product data.
  Keep them out of generic Taizn docs and fixtures.
- Run `taizn tv pair` or `--connect` only when the user expects an approval
  prompt on the TV.
- Keep Seller Office sessions human-owned and local: the operator signs in.
  On `SellerPortalDrift`, stop and report; never guess selectors or click
  through.

## References

- Samsung TV remote pairing, key scripts, and `TAIZN_TV_*` settings:
  [Samsung TV Remote](https://github.com/putdotio/taizn/blob/main/docs/tv-remote.md)
- Seller Office login, local state, and recovery:
  [Seller Office](https://github.com/putdotio/taizn/blob/main/docs/seller-office.md)
- Config, env, and Tizen SDK backup and restore:
  [README](https://github.com/putdotio/taizn/blob/main/README.md)
