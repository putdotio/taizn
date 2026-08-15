# Seller Office

Taizn supports local, operator-assisted, read-only discovery from Samsung TV
Seller Office. Authentication stays in a visible Chrome profile owned by the
operator.

## Start

From the consumer app directory:

```bash
taizn seller login --dry-run --json
taizn seller login
```

Complete Samsung login and MFA in the opened browser. Taizn never requests or
reads the password, cookies, MFA values, or browser tokens.

Then list applications:

```bash
taizn seller apps list --json
taizn seller apps list --json --fields applications
taizn seller apps list --json --artifact .taizn/seller-apps.json
taizn seller close
```

The result contains only a schema version and sanitized application name,
Seller app ID, type, status, and update date. It does not contain account,
group, cookie, token, raw HTML, or raw portal-response data.

## Local State

| Path                            | Contents                                                   |
| ------------------------------- | ---------------------------------------------------------- |
| `.taizn/seller/chrome-profile/` | Dedicated human-owned Chrome profile and Samsung session   |
| `.taizn/seller.json`            | Schema version, owner token, process ID, and DevTools port |

Keep all of `.taizn/` ignored. Treat the Chrome profile as sensitive session
material even though Taizn does not inspect or print it.

Set `TAIZN_SELLER_BROWSER` when Google Chrome is not at the platform default
location.

## Safety Boundary

- Browser DevTools binds to `127.0.0.1` only.
- Taizn navigates the visible public portal UI; it does not call undocumented
  Seller Office HTTP endpoints.
- Login remains interactive and human-owned; CI login is unsupported.
- `taizn seller login` tears down the browser process tree if startup fails or
  the command is interrupted. A successful login hands the browser to the
  local session state until `taizn seller close` is run.
- Portal layout drift fails with `SellerPortalDrift` instead of guessing.
- A signed-out browser fails with `SellerAuthenticationRequired`.
- Upload, pre-test, release requests, submission, and other portal mutations are
  not supported by this read-only surface.

## Recovery

- Missing state: run `taizn seller login`.
- Signed out: finish login in the visible dedicated browser, then retry.
- Finished or abandoned task: run `taizn seller close`; it is safe to repeat.
- Browser connection failed: failed startup normally cleans itself up. If
  cleanup also fails, Taizn preserves partial ownership state and refuses
  automatic teardown without endpoint proof; close the dedicated profile
  manually and verify its process tree is gone before removing that stale state.
- Portal drift: stop automation and update the adapter against the current
  visible page before retrying.
