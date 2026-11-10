import { after } from "next/server";
import { eq } from "drizzle-orm";
import { withUser } from "@/server/auth/session";
import { db, schema } from "@/server/db";
import { syncAccount } from "@/server/sync/engine";
import { hasWorker, nudgeWorker } from "@/server/worker-client";
import { logWarn } from "@/server/log";

export const maxDuration = 300;

/** Pull-to-refresh: ask for a sync of every mailbox. Without a worker the sync runs here, after the response. */
export const POST = withUser(async (user) => {
  const accounts = await db().select().from(schema.accounts).where(eq(schema.accounts.userId, user.id));
  if (hasWorker()) {
    await Promise.all(accounts.map((a) => nudgeWorker({ kind: "sync", accountId: a.id })));
  } else {
    after(async () => {
      for (const a of accounts) await syncAccount(a).catch((err) => logWarn(`sync failed ${a.id}`, err));
    });
  }
  return Response.json({ ok: true });
});
