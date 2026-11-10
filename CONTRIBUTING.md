# Contributing to Kolbaba

Thanks for helping. This guide covers running Kolbaba on your computer, the tests, the conventions, and how a
pull request ends up in the repository.

- **Bugs and ideas:** open an issue. For a bigger change, open an issue first so we can agree on the direction
  before you spend time on it.
- **Security issues:** don't open an issue. Follow [SECURITY.md](SECURITY.md).
- **Help with your own server:** see [selfhost/README.md](selfhost/README.md).

## Run it on your computer

You need Node.js 22 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3000. Without a `.env` file the app runs as a clickable prototype on sample mail
(`NEXT_PUBLIC_DATA_MODE=mock`, sample data in [`src/lib/mock-data.ts`](src/lib/mock-data.ts)). Most interface
work can be done like this.

### With real mailboxes

For the real thing (`live` mode) you need Postgres and two secrets. Every variable is described in
[`.env.example`](.env.example).

```bash
# Postgres: a local install, or Docker
docker run -d --name kolbaba-pg -e POSTGRES_USER=kolbaba -e POSTGRES_PASSWORD=kolbaba -e POSTGRES_DB=kolbaba -p 5432:5432 postgres:17-alpine

cp .env.example .env
# In .env: NEXT_PUBLIC_DATA_MODE=live, and CREDENTIALS_KEK=v1:<key> and SESSION_SECRET=<key>,
# each generated with: openssl rand -base64 32

npm run db:migrate
npm run dev       # the web app
npm run worker    # optional, in a second terminal: the sync worker
```

Without the worker the app still works: sending, the first import and syncing happen in the web app, but new
mail only arrives while the app is open, and scheduled mail waits until you open it. Without Resend, sign-in
codes are printed to the terminal.

### Services you need for a live setup

You only need the ones for the parts you work on.

| Service | What for | Variables |
| --- | --- | --- |
| **Postgres** | Everything in live mode | `DATABASE_URL` |
| **Google Cloud** | Sign in with Google and Gmail through the Gmail API | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_PUBSUB_*` |
| **Microsoft Entra** | Outlook.com, Hotmail and Microsoft 365 mailboxes | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` |
| **Web Push keys** | Notifications | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |
| **Resend** | The app's own emails: sign-in codes, feedback | `RESEND_API_KEY`, `MAIL_FROM` |
| **OpenAI** (optional) | Smart categories and summaries | `OPENAI_API_KEY` |
| **TypeSafe** (optional) | Sorting mail cheaply before OpenAI reads it | `TYPESAFE_API_KEY` |
| **Stripe** (optional) | Paying for Kolbaba Plus | `STRIPE_SECRET_KEY` |

IMAP mailboxes (iCloud, Yahoo, Seznam, your own domain, and Gmail with an app password) need none of these.

**Google Cloud**

1. In [console.cloud.google.com](https://console.cloud.google.com), create a project.
2. In APIs & Services → Library, turn on the **Gmail API** and the **Cloud Pub/Sub API**.
3. OAuth consent screen: type *External*, with the scopes `openid`, `email`, `profile` and
   `https://www.googleapis.com/auth/gmail.modify`. Set the publishing status to **In production**: in *Testing*,
   Google expires refresh tokens after 7 days. Until Google verifies the app, it shows an "unverified app" warning
   and allows at most 100 users.
4. Credentials → Create credentials → OAuth client ID → *Web application*, with the redirect URIs
   `<APP_URL>/api/auth/google/callback` and `<APP_URL>/api/accounts/google/callback`
   (for development with `http://localhost:3000`).
5. Optional, for instant Gmail delivery: a Pub/Sub topic (`GOOGLE_PUBSUB_TOPIC=projects/<project>/topics/<topic>`)
   with `gmail-api-push@system.gserviceaccount.com` as *Pub/Sub Publisher*, and a push subscription to
   `<APP_URL>/api/webhooks/gmail?token=<random string>`, with the same string in `GOOGLE_PUBSUB_VERIFICATION_TOKEN`.
   Without Pub/Sub, Gmail is checked every 5 minutes.

**Microsoft Entra**

Register an app in [Microsoft Entra](https://entra.microsoft.com) for "Any Entra ID tenant + personal Microsoft
accounts", with the redirect URI (Web) `<APP_URL>/api/accounts/microsoft/callback`. Delegated permissions: Graph
`openid`, `email`, `profile`, `offline_access`, `Mail.Send`, and Office 365 Exchange Online
`IMAP.AccessAsUser.All` and `SMTP.Send`. Without it, Outlook shows as "coming soon".

**Web Push**

```bash
npx web-push generate-vapid-keys
```

On an iPhone, notifications work only after the app is added to the Home Screen.

## Tests and checks

```bash
npm test            # Vitest
npm run typecheck   # TypeScript, including the test files
npm run lint        # ESLint
```

Tests live next to the code as `*.test.ts`. Files named `*.db.test.ts` (and a few others that store data) need
a Postgres database, `postgres://kolbaba:kolbaba@localhost:5432/kolbaba_test` by default (`TEST_DATABASE_URL`
changes it, see [`test/setup.ts`](test/setup.ts)):

```bash
docker run -d --name kolbaba-test-pg -e POSTGRES_USER=kolbaba -e POSTGRES_PASSWORD=kolbaba -e POSTGRES_DB=kolbaba_test -p 5432:5432 postgres:17-alpine
DATABASE_URL=postgres://kolbaba:kolbaba@localhost:5432/kolbaba_test node scripts/migrate.mjs
npm test
```

Tests against a real IMAP server (Dovecot) run only when `IMAP_TEST_HOST` is set; see
[`src/server/mail/imap.integration.test.ts`](src/server/mail/imap.integration.test.ts).

Database changes: edit [`src/server/db/schema.ts`](src/server/db/schema.ts), then `npm run db:generate` writes a
new migration into `drizzle/`. Commit both.

## How it runs in production

The hosted Kolbaba is one example of a setup; any Postgres and any host that runs Node.js and Docker will do.

- **Web app on Vercel.** The `vercel-build` script applies pending migrations, then builds.
- **Worker on Fly.io**, from [`Dockerfile.worker`](Dockerfile.worker) and [`fly.toml`](fly.toml). It needs the
  same variables as the web app, plus `WORKER_SECRET`; the web app gets `WORKER_URL` and the same `WORKER_SECRET`.
- **Postgres on Neon.** The web app uses the pooled connection string in `DATABASE_URL`; migrations use the
  direct one from `DATABASE_URL_UNPOOLED` when it's set. The worker can use the direct one.
- **Self-hosted image**: [`Dockerfile.selfhost`](Dockerfile.selfhost) puts the web app and the worker in one
  container. A tag like `v1.4.2` publishes it through
  [`.github/workflows/selfhost-image.yml`](.github/workflows/selfhost-image.yml).
- **Rotating the encryption key**: add a new key at the end of `CREDENTIALS_KEK` (`v1:old,v2:new`), then run
  `npx tsx worker/rewrap-credentials.ts` ([source](worker/rewrap-credentials.ts)) to wrap every mailbox
  credential's key with the new one. After that, the old key can be removed.

## Conventions

These apply to people as much as to coding agents:

- **Translations.** The interface is in English and Czech. The English text is the key: `t("Archive")` shows
  "Archivovat" to a Czech reader. Every literal passed to `t`, `tn` or `tk` needs a Czech entry in
  [`src/lib/i18n/cs`](src/lib/i18n/cs), and `src/lib/i18n/i18n.test.ts` checks it. How it works is described at
  the top of [`src/lib/i18n/index.ts`](src/lib/i18n/index.ts). If you don't speak Czech, leave a note in the
  pull request and we'll add the translation.
- **Release notes.** A change people will notice (a new feature or setting, something new for agents, a new kind
  of mailbox) gets a note on top of `RELEASE_NOTES` in [`src/lib/whats-new.ts`](src/lib/whats-new.ts), with a new
  `id` (`YYYY-MM-DD-topic`) and its Czech in [`src/lib/i18n/cs/news.ts`](src/lib/i18n/cs/news.ts), in the same
  pull request. Small bug fixes, performance work and refactors don't.
- **Copy.** Plain language: a heading says literally what happens. No buzzwords and no big claims; state the
  concrete fact instead. Write the English first, then the Czech for meaning, not word by word.
- **Next.js.** The app runs on Next.js 16, which differs from older versions in APIs and conventions. When in
  doubt, read the guides that ship with it in `node_modules/next/dist/docs/`.
- **Sample data.** Tests, fixtures and sample mail use made-up people, companies and numbers, with addresses on
  `example.com` or a `.example` domain. Never paste a real email, invoice or invitation into a test.
- **Formatting.** There's no Prettier in this repository; don't reformat files you aren't changing.
- **Pull requests.** Small and focused, one change each. Explain why, and add screenshots for anything you can see.

## How a pull request lands

Kolbaba is developed in the maintainer's working repository, and this public repository is updated from it
automatically on every change. So an accepted pull request is not merged here with the merge button. Instead,
the maintainer applies your changes in the working repository, and a few minutes later they appear here as a
commit with you credited as co-author. GitHub then shows your pull request as **closed, not merged**, with a link
to that commit. Your work and your name are in the history all the same.

## License of contributions

Kolbaba is licensed under the [GNU AGPL v3.0 or later](LICENSE). By sending a pull request, you agree that your
contribution is licensed under the same license. There is no contributor license agreement to sign.
