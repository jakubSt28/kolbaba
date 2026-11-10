# Security

Kolbaba holds people's email and the passwords to their mailboxes, so we take reports seriously.

## Supported versions

Security fixes go into the latest version: the hosted app at app.kolbaba.app and the newest release of the
self-hosted image (`ghcr.io/jakubst28/kolbaba`). Self-hosted servers on the default `1` tag install new 1.x
versions by themselves overnight.

## Reporting a vulnerability

Please don't open a public issue. Email **[hello@kolbaba.app](mailto:hello@kolbaba.app)** with "Security" in the
subject, and include:

- what the problem is and what someone could do with it,
- the steps to reproduce it, or a proof of concept,
- the version or commit, and whether it's the hosted app or a self-hosted copy,
- how you'd like to be credited, if at all.

We'll reply within a few days, tell you what we found, and let you know when a fix is out. Please give us a
reasonable time to fix it before you publish anything.

## Testing rules

- Test only with your own account and your own mailboxes. Don't read, change or delete anyone else's data.
- Don't run denial-of-service tests, spam, or automated scans that put load on app.kolbaba.app. A self-hosted
  copy on your own server is the best place to test.
- Stop and report as soon as you can see data that isn't yours.

## Usually out of scope

- Missing security headers or best practices without a way to exploit them.
- Reports from automated scanners without a working attack.
- Attacks that need a device or browser that is already compromised.
- Rate limits on endpoints that don't expose data.
- Problems in mailbox providers, AI agents or MCP clients themselves, unless Kolbaba makes them worse.
