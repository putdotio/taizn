# Taizn Command Surfaces

Use this reference when the task needs command-specific routing beyond the
main skill workflow.

## Discovery

Start with the live command contract:

```bash
taizn describe
```

Use `README.md` for the public command overview. Use `src/describe.ts` when the
runtime contract and docs disagree.

## Packaging And Proof

- `check` reads local Tizen tools and connected targets.
- `profile`, `package`, `install`, `run`, and `launch` mutate platform or build
  state; dry-run them before executing when the command supports it.
- `prove` gives the smallest install/launch proof transcript for an already
  packageable app.
- `probe hosted-assets` checks generic hosted asset reachability; consumer repos
  choose the URLs.

Useful shapes:

```bash
taizn check --json --fields targets,tools.sdb
taizn package --dry-run
taizn prove --dry-run --json --fields application.id,target Example.app
taizn prove --json --artifact .taizn/proof.json Example.app
taizn probe hosted-assets --dry-run --json
```

## Inspection And Submission

- `inspect wgt` reads widget metadata and archive contents.
- `prepare submission` creates a deterministic manifest containing widget
  identity and compatibility metadata, signature presence, package size, and
  SHA-256 from an existing `.wgt`. It does not need Seller Office credentials.
- `validate submission` checks generic metadata and archive consistency. It does
  not automate Seller Office.
- Keep submission metadata generic in Taizn. App-specific store decisions belong
  in the consumer repo.

Useful shapes:

```bash
taizn inspect wgt --json --fields config,entryCount .taizn/build/output/example.wgt
taizn prepare submission --json --artifact .taizn/submission.json package.wgt
taizn validate submission --json --fields ok,problems
```

## Logs And Targets

- `logs capture` can emit JSON or NDJSON and should be bounded by app name or
  duration when possible.
- `targets list` is the generic target inventory surface.

```bash
taizn logs capture --output ndjson --app Example
taizn targets list --json --fields targets
```

## Artifacts

Use `--artifact .taizn/<name>.json` for proof that should survive the terminal.
Taizn rejects artifact paths outside the app directory; keep generated artifacts
under `.taizn/` or another ignored app-local folder.
