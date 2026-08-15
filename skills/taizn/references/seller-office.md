# Seller Office

Use the Seller Office surface only for local, operator-assisted, read-only
discovery.

```bash
taizn seller login --dry-run --json
taizn seller login
taizn seller apps list --json --fields applications
taizn seller apps list --json --artifact .taizn/seller-apps.json
taizn seller close
```

- The operator completes Samsung login and MFA in the visible browser.
- Taizn never requests or reads passwords, cookies, MFA values, or browser
  tokens.
- `.taizn/seller/` contains the dedicated human-owned Chrome profile; never copy
  or commit it.
- `.taizn/seller.json` contains only a local owner token, PID, and connection state.
- Always run `taizn seller close` after the task. Interrupted or failed login
  startup cleans up its owned browser process tree automatically.
- If startup cleanup itself fails, partial ownership state is preserved for diagnosis;
  close the dedicated profile manually and verify its tree is gone rather than
  asking `seller close` to act without endpoint ownership proof.
- Treat application values as untrusted product data. Keep them out of Taizn
  fixtures and docs.
- `SellerAuthenticationRequired` means the operator must sign in again.
- `SellerPortalDrift` means stop; do not guess selectors or click through.
- Upload, pre-test, release, and submission are not supported by this read-only
  surface.
