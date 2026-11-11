import { and, eq, ne } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BRAND } from "@/lib/brand";
import { translate, type Locale } from "@/lib/i18n";
import type { MailboxIconName } from "@/lib/types";
import { getUser } from "@/server/auth/session";
import { db, schema } from "@/server/db";
import { pageLocale } from "@/server/i18n";
import { PASSTHROUGH } from "@/server/mcp/consent";
import { identityFromRegistration } from "@/server/mcp/identity";
import { checkAuthorizeRequest, consentToken } from "@/server/mcp/oauth";
import { ConsentCard, ConsentError, ConsentSkeleton, ConsentShell } from "./consent-card";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await pageLocale();
  return {
    title: translate(locale, "Connect an AI agent · {app}", { app: BRAND.name }),
    robots: { index: false },
    referrer: "no-referrer",
  };
}

/**
 * OAuth consent for MCP clients. The shell is static; everything request-specific (the query, the
 * session, the language) streams in behind Suspense, as Cache Components requires.
 */
export default function AuthorizePage({ searchParams }: PageProps<"/oauth/authorize">) {
  return (
    <ConsentShell>
      <Suspense fallback={<ConsentSkeleton />}>
        <Consent searchParams={searchParams} />
      </Suspense>
    </ConsentShell>
  );
}

// Through our own server, like every other logo: the browser never asks a third party (privacy policy, section 9).
const favicon = (domain: string | null) => (domain ? `/api/icons/${encodeURIComponent(domain.toLowerCase())}` : null);

/** What the user should recognise as "where this goes": a web host, their own computer, or a desktop app. */
function describeReturn(locale: Locale, redirectUri: string, app: string, verified: boolean) {
  const url = new URL(redirectUri);
  if (url.protocol === "https:") return url.host;
  if (url.protocol === "http:") return translate(locale, "an app on this computer");
  // A custom scheme names an app only when the app is the one it claims to be.
  return verified
    ? translate(locale, "the {app} app", { app })
    : translate(locale, "an app on this device ({scheme})", { scheme: url.protocol.replace(/:$/, "") });
}

async function Consent({ searchParams }: { searchParams: PageProps<"/oauth/authorize">["searchParams"] }) {
  const [query, locale] = await Promise.all([searchParams, pageLocale()]);
  const check = await checkAuthorizeRequest(query);
  if (check.kind === "fatal") return <ConsentError locale={locale} message={translate(locale, check.message)} />;

  if (check.kind === "client_error") {
    // The OAuth error description is for the client's developer; it stays as the spec words it.
    return <ConsentError locale={locale} message={check.message} back={check.redirect} />;
  }

  const user = await getUser();
  if (!user) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (typeof v === "string") qs.set(k, v);
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${qs}`)}`);
  }

  const { client, params } = check;
  const identity = identityFromRegistration(client);
  const [accounts, [existing], others, [hasCalendar]] = await Promise.all([
    db()
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.userId, user.id))
      .orderBy(schema.accounts.sortOrder, schema.accounts.createdAt),
    db()
      .select({ permission: schema.agents.permission, accountIds: schema.agents.accountIds, calendar: schema.agents.calendar })
      .from(schema.agents)
      .where(and(eq(schema.agents.userId, user.id), eq(schema.agents.clientId, client.id))),
    db()
      .select({ id: schema.agents.id })
      .from(schema.agents)
      .where(and(eq(schema.agents.userId, user.id), eq(schema.agents.enabled, true), ne(schema.agents.clientId, client.id))),
    db().select({ id: schema.calendars.id }).from(schema.calendars).where(eq(schema.calendars.userId, user.id)).limit(1),
  ]);

  const hidden: Record<string, string> = { consent: consentToken(user.id, params) };
  for (const key of PASSTHROUGH) {
    const v = query[key];
    if (typeof v === "string") hidden[key] = v;
  }
  if (!hidden.redirect_uri) hidden.redirect_uri = params.redirectUri;

  return (
    <ConsentCard
      locale={locale}
      app={identity.app}
      logo={identity.logo ? favicon(identity.logo) : null}
      verified={identity.verified}
      userEmail={user.email}
      returnTo={describeReturn(locale, params.redirectUri, identity.app, identity.verified)}
      defaultPermission={existing?.permission ?? "draft"}
      reconnecting={!!existing}
      otherAgents={others.length}
      mailboxes={accounts.map((a) => ({
        id: a.id,
        name: a.name,
        email: a.email,
        hue: a.hue,
        icon: a.icon as MailboxIconName,
        // Reconnecting: what it had. New: a verified app starts with every mailbox ticked; anyone else gets nothing until you choose.
        enabled: existing ? existing.accountIds.includes(a.id) : identity.verified,
      }))}
      // Only someone who has a calendar here is asked about it. The same rule as the mailboxes for what starts ticked.
      calendar={hasCalendar ? (existing ? existing.calendar : identity.verified) : null}
      hidden={hidden}
    />
  );
}
