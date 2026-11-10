import { and, eq } from "drizzle-orm";
import { seal, unseal, type Sealed } from "../crypto";
import { db, schema } from "../db";
import type { MailboxCredentials, ServerConfig } from "../db/schema";
import { revokeGoogleToken } from "../google";

/** Same palette as the client (src/lib/store.ts MAILBOX_HUES), spread so mailboxes are easy to tell apart. */
const HUES = [12, 28, 48, 88, 152, 178, 200, 228, 262, 282, 312, 340];

async function pickHue(userId: string) {
  const taken = (await db().select({ hue: schema.accounts.hue }).from(schema.accounts).where(eq(schema.accounts.userId, userId))).map((r) => r.hue);
  const free = HUES.filter((h) => !taken.some((t) => Math.abs(t - h) < 18));
  const pool = free.length ? free : HUES;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** "daniel@firma.cz" + "Firma" → "Firma"; free-mail providers get their brand name. */
function defaultName(email: string, providerLabel: string) {
  const domain = email.split("@")[1] ?? "";
  if (providerLabel && !/workspace|custom|imap/i.test(providerLabel)) return providerLabel;
  const base = domain.split(".").slice(-2, -1)[0] ?? domain;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export interface NewAccount {
  userId: string;
  provider: "gmail" | "imap";
  providerLabel: string;
  email: string;
  fromName?: string;
  name?: string;
  imap?: ServerConfig | null;
  smtp?: ServerConfig | null;
  credentials: MailboxCredentials;
}

/**
 * Create a mailbox, or refresh the credentials of an existing one with the same address
 * (that's what "Reconnect" does). Credentials are sealed with the row id as associated data.
 */
export async function upsertAccount(input: NewAccount): Promise<{ id: string; created: boolean }> {
  const email = input.email.trim().toLowerCase();
  const [existing] = await db()
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.userId, input.userId), eq(schema.accounts.email, email)));

  if (existing) {
    await db()
      .update(schema.accounts)
      .set({
        credentials: seal(input.credentials, existing.id),
        ...(input.imap ? { imap: input.imap } : {}),
        ...(input.smtp ? { smtp: input.smtp } : {}),
        status: "syncing",
        statusMessage: null,
      })
      .where(eq(schema.accounts.id, existing.id));
    return { id: existing.id, created: false };
  }

  const id = `acc_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const count = (await db().select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.userId, input.userId))).length;
  await db()
    .insert(schema.accounts)
    .values({
      id,
      userId: input.userId,
      provider: input.provider,
      providerLabel: input.providerLabel,
      email,
      name: input.name?.trim() || defaultName(email, input.providerLabel),
      fromName: input.fromName ?? "",
      hue: await pickHue(input.userId),
      imap: input.imap ?? null,
      smtp: input.smtp ?? null,
      credentials: seal(input.credentials, id),
      sortOrder: count,
    });
  return { id, created: true };
}

/**
 * After a mailbox row is deleted: a Gmail grant is revoked at Google too, unless the same address is
 * still connected in another Kolbaba account (both share one grant). Password mailboxes have nothing
 * to revoke; the app password stays valid until the user removes it at their provider.
 */
export async function revokeProviderAccess(row: { id: string; provider: string; email: string; credentials: Sealed }) {
  if (row.provider !== "gmail") return;
  const [stillConnected] = await db()
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(and(eq(schema.accounts.provider, "gmail"), eq(schema.accounts.email, row.email)))
    .limit(1);
  if (stillConnected) return;
  let credentials: MailboxCredentials;
  try {
    credentials = unseal<MailboxCredentials>(row.credentials, row.id);
  } catch (err) {
    console.warn(`[${row.id}] can't read the token to revoke it`, (err as Error).message);
    return;
  }
  if (credentials.kind === "oauth") await revokeGoogleToken(credentials.refreshToken);
}
