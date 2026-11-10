# Kolbaba on your own server

[Česky](README.cs.md)

All of Kolbaba runs on your server: the app, the database and the encryption keys. Nothing from your mail goes
to the people who make Kolbaba. It's free and open source.

What you need:

- **A server with Docker.** The smallest VPS is enough (1–2 GB of RAM, for example at Hetzner), or a computer at
  home that's always on.
- **A domain**, such as `mail.example.com`, with an A record pointing at the server's address. Without HTTPS,
  notifications and installing the app on an iPhone don't work.

## Install

On the server, install Docker if it isn't there yet:

```bash
curl -fsSL https://get.docker.com | sh
```

Then install Kolbaba:

```bash
mkdir kolbaba && cd kolbaba && docker run --rm ghcr.io/jakubst28/kolbaba:1 tar -c -C /app/selfhost . | tar x && sh install.sh
```

The script asks for your domain, starts everything and prints a link. Open it, create your account and save a
passkey. That's it.

Adding a mailbox works as anywhere else. **Gmail** connects with an app password
([create one here](https://myaccount.google.com/apppasswords); two-step verification has to be on). **Outlook**
needs your own app at Microsoft, see [below](#optional).

On an iPhone, open the address in Safari and add it to the Home Screen (Share → Add to Home Screen). Then turn
on notifications in Settings.

## Updates

New versions install by themselves at 3 a.m. (UTC). The downtime is a few seconds, and the app refreshes itself
on your devices. Your server follows the `1.x` versions. A bigger change that needs you to do something would come
out as `2.x` and doesn't install by itself.

Docker Desktop on a Mac or Windows keeps Docker's settings in the system keychain, where automatic updates can't
always reach. If new versions don't arrive there, update by hand.

To update by hand: in `.env`, remove the word `autoupdate` from `COMPOSE_PROFILES`, run
`docker compose up -d --remove-orphans`, and install new versions like this:

```bash
docker compose pull && docker compose up -d
```

Automatic updates mean you trust whoever publishes them. If you want to check every change yourself, set a fixed
version in `.env` (`KOLBABA_VERSION=1.4.2`) and change it when you're ready.

## Signing in

You sign in with a passkey (Face ID, Touch ID, your screen lock). Don't have it at hand, or on a new device? The
server gives you a one-time sign-in link:

```bash
docker compose exec kolbaba kolbaba-link
```

An account for another person on the same server: `kolbaba-link --new`. Signing in to one of several accounts:
`kolbaba-link address@example.com`.

Want sign-in codes by email too? Fill in `SMTP_URL` and `MAIL_FROM` in `.env`.

## Backups

Every day a copy of the database goes into the `backups/` folder (kept for 14 days), together with the
`secrets.json` file.

**The backup is on the same disk.** It helps when something goes wrong, but not when you lose the server. So copy
the `backups/` folder and the `.env` file somewhere else as well. Whoever has `secrets.json` and the database has
access to everything, including the passwords to your mailboxes, so treat them that way. Without `secrets.json`,
the saved mailbox passwords can't be read.

Restoring the database (also when moving to a new server, after installing):

```bash
docker compose stop kolbaba
```

```bash
docker compose run --rm -T --no-deps -u root -v "$PWD/backups:/b" kolbaba sh -c "cp /b/secrets.json /data/secrets.json && chown node:node /data/secrets.json && chmod 600 /data/secrets.json"
```

```bash
docker compose exec -T postgres pg_restore -U kolbaba -d kolbaba --clean --if-exists < backups/kolbaba-DATE.dump
```

```bash
docker compose start kolbaba
```

## Optional

Everything is set in the `.env` file (it describes each setting) and applies after `docker compose up -d`.

- **Smart features** (categories, summaries): fill in `OPENAI_API_KEY`. Emails then go to OpenAI under your
  account. Without a key these features are off and nothing goes anywhere.
- **Gmail through Sign in with Google:** create an [OAuth client](https://console.cloud.google.com/apis/credentials)
  of type Web application with the redirect URIs `https://YOUR-DOMAIN/api/auth/google/callback` and
  `https://YOUR-DOMAIN/api/accounts/google/callback`, turn on the Gmail API, set the app to "In production", and
  fill in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
- **Outlook and Microsoft 365:** register an app in [Microsoft Entra](https://entra.microsoft.com) for "Any Entra
  ID tenant + personal Microsoft accounts", with the redirect URI (Web)
  `https://YOUR-DOMAIN/api/accounts/microsoft/callback`. Delegated permissions: Graph `openid`, `email`, `profile`,
  `offline_access`, `Mail.Send`, and Office 365 Exchange Online `IMAP.AccessAsUser.All`, `SMTP.Send`. Fill in
  `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET`.
- **At home through Tailscale, without a domain or open ports:** in `.env`, set `COMPOSE_PROFILES=autoupdate` and
  `APP_URL=https://your-computer.your-tailnet.ts.net`, run `docker compose up -d --remove-orphans`, then
  `tailscale serve --bg 3000`. Your phone needs Tailscale turned on. Don't use Cloudflare Tunnel: Cloudflare would
  see all the traffic.

## Where the server connects to

- your mail providers,
- `autoconfig.thunderbird.net` and DNS, when it looks up the settings of an unknown mailbox,
- the push services of Apple, Google and Mozilla, when it sends notifications (the content is encrypted),
- `ghcr.io`, for new versions (turn it off with `UPDATE_CHECK=off` and by removing `autoupdate`),
- OpenAI, only if you fill in a key.

None of it goes to Kolbaba's servers.

## When something doesn't work

```bash
docker compose ps
```

```bash
docker compose logs --tail 50 kolbaba
```

Found a bug? [Open an issue](https://github.com/jakubSt28/kolbaba/issues).

## Want help?

If you'd rather have Kolbaba set up for you, on your server or your company's, that's a paid service. Write to
[hello@kolbaba.app](mailto:hello@kolbaba.app) or use the form on
[kolbaba.app/self-hosted](https://kolbaba.app/self-hosted).

## License

Kolbaba is free software under the [GNU AGPL v3.0 or later](../LICENSE): you can run it, change it and share it.
If you offer a changed version to other people over a network, you have to give them its source code. The name
and logo have their own rules, see [TRADEMARKS.md](../TRADEMARKS.md).
