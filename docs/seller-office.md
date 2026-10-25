# Seller Office

Taizn reads Samsung TV Seller Office application status through a visible
Chrome profile the operator owns. It never requests or reads the password,
cookies, MFA values, or browser tokens.

## Start

From the consumer app directory:

```bash
taizn seller login --dry-run --json
taizn seller login
```

Complete Samsung login and MFA in the opened browser. If login fails or is
interrupted, Taizn stops the browser it started. After success, the session
stays open and belongs to the operator.

Then list applications:

```bash
taizn seller apps list --json
taizn seller apps list --json --fields applications
taizn seller apps list --json --artifact .taizn/seller-apps.json
```

The result holds a schema version and each application's sanitized name,
Seller app ID, type, status, and update date. No account, group, cookie, token,
raw HTML, or raw portal data.

## Local State

| Path                            | Contents                                                 |
| ------------------------------- | -------------------------------------------------------- |
| `.taizn/seller/chrome-profile/` | Dedicated human-owned Chrome profile and Samsung session |
| `.taizn/seller.json`            | Schema version and localhost DevTools port               |

Keep `.taizn/` ignored. Treat the Chrome profile as sensitive session material.
Set `TAIZN_SELLER_BROWSER` when Chrome is not at the platform default path.

## Safety Boundary

- DevTools binds to `127.0.0.1` only.
- Taizn navigates the visible portal UI. It does not call undocumented Seller
  Office endpoints.
- Login is interactive; CI login is unsupported.
- Upload, pre-test, release requests, submission, and other portal mutations
  are unsupported.

## Recovery

| Failure                        | Fix                                                                    |
| ------------------------------ | ---------------------------------------------------------------------- |
| Missing state                  | Run `taizn seller login`.                                              |
| `SellerAuthenticationRequired` | Finish login in the visible dedicated browser, then retry.             |
| Browser connection failed      | Close the dedicated profile and run login again.                       |
| `SellerPortalDrift`            | Stop. Update the adapter against the current visible page, then retry. |
