# Security

If you believe you have found a security or privacy issue in this project,
please report it privately.

## Contact

- email: devs@put.io

Private reports are preferred for security and privacy issues.

If you are unsure whether something is sensitive, email first instead of opening
a public issue.

## Scope

Useful reports usually include issues involving:

- token, secret, or credential exposure
- unsafe package contents or release artifacts
- unsafe command execution through project config
- Tizen signing material committed or exposed through generated files
- paired Samsung TV remote tokens committed or exposed through generated files
- Seller Office Chrome profiles, cookies, or browser session material committed or exposed
- GitHub Actions release or publish risk

## Guidelines

- test only against accounts, environments, and data you control
- avoid destructive behavior, service disruption, or automated high-volume testing
- keep `.taizn/seller/` local; never copy its Chrome profile or enable remote DevTools access
- keep Seller Office browser automation bound to `127.0.0.1`
- do not open public issues for suspected vulnerabilities

## Supported Versions

Only the latest npm release is supported.

## Disclosure

Please allow a reasonable amount of time to investigate and fix the issue before
sharing details publicly.
