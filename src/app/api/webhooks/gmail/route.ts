import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { safeEqual } from "@/server/crypto";
import { db, schema } from "@/server/db";
import { env } from "@/server/env";
import { parsePubsubPush } from "@/server/mail/gmail";
import { verifyPushToken } from "@/server/mail/pubsub-auth";
import { syncAccount } from "@/server/sync/engine";
import { hasWorker, nudgeWorker } from "@/server/worker-client";
import { logWarn } from "@/server/log";

export const maxDuration = 120;

/**
 * Gmail push via Pub/Sub: "something changed in <email>". The request proves it's from our subscription
 * with a Google-signed token for our service account (authenticated push), or, until the subscription
 * is switched to that, with the shared token in its URL (?token=…). We answer 2xx quickly (Pub/Sub
 * retries otherwise) and sync in the background.
 */
export async function POST(req: Request) {
  const serviceAccount = env.googlePubsubServiceAccount;
  const signed = serviceAccount ? await verifyPushToken(req.headers.get("authorization"), { audience: env.googlePubsubAudience, serviceAccount }) : false;
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const expected = env.googlePubsubToken;
  const shared = !!expected && safeEqual(token, expected);
  if (!signed && !shared) return new Response(null, { status: 403 });

  const push = parsePubsubPush(await req.json().catch(() => null));
  if (!push) return new Response(null, { status: 204 });

  const accounts = await db()
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.provider, "gmail"), eq(schema.accounts.email, push.emailAddress.toLowerCase())));

  if (hasWorker()) {
    await Promise.all(accounts.map((a) => nudgeWorker({ kind: "sync", accountId: a.id })));
  } else {
    after(async () => {
      for (const a of accounts) await syncAccount(a).catch((err) => logWarn(`push sync failed ${a.id}`, err));
    });
  }
  return new Response(null, { status: 204 });
}
