import { and, eq, inArray, sql } from "drizzle-orm";
import type { Person } from "../db/schema";
import { db, schema } from "../db";

/**
 * Screener (opt-in, like Hey): the first email from someone new waits in "New senders" for a yes or
 * no instead of landing in Inbox and buzzing the phone. Known people pass: anyone the user ever wrote
 * to, anyone whose mail was there before the screener was turned on, and anyone already said yes to.
 * A no sends that sender's mail straight to Archive (nothing is deleted) and can be undone in Settings.
 */

export interface ScreenerState {
  on: boolean;
  since: number;
}

export async function screenerState(userId: string): Promise<ScreenerState> {
  const [u] = await db().select({ settings: schema.users.settings }).from(schema.users).where(eq(schema.users.id, userId));
  return { on: !!u?.settings.screener, since: u?.settings.screenerSince ?? Date.now() };
}

/** "petr@firma.cz" → "@firma.cz": the row that stands for everyone at that domain. */
export const domainKey = (email: string) => {
  const at = email.lastIndexOf("@");
  return at < 0 ? "" : email.slice(at).toLowerCase();
};

/** The decision about this address: its own, or else its domain's (a domain blocked from any email). */
export async function senderRule(userId: string, email: string): Promise<{ status: "allowed" | "blocked"; bin: boolean } | null> {
  const e = email.toLowerCase();
  const keys = [e, domainKey(e)].filter(Boolean);
  const rows = await db()
    .select({ email: schema.senders.email, status: schema.senders.status, bin: schema.senders.bin })
    .from(schema.senders)
    .where(and(eq(schema.senders.userId, userId), inArray(schema.senders.email, keys)));
  const row = rows.find((r) => r.email === e) ?? rows.find((r) => r.email.startsWith("@"));
  return row ? { status: row.status, bin: row.bin } : null;
}

export async function senderStatus(userId: string, email: string) {
  return (await senderRule(userId, email))?.status ?? null;
}

/** Has the user had anything to do with this address (a decision, mail before the screener, or mail they sent to it)? */
export async function isKnownSender(userId: string, email: string, since: number): Promise<boolean> {
  const e = email.toLowerCase();
  if (await senderStatus(userId, e)) return true;
  const m = schema.messages;
  const recipient = JSON.stringify([{ email: e }]);
  const [hit] = await db()
    .select({ one: sql<number>`1` })
    .from(m)
    .where(
      and(
        eq(m.userId, userId),
        sql`(
          (${m.isOutgoing} and (${m.to} @> ${recipient}::jsonb or ${m.cc} @> ${recipient}::jsonb or ${m.bcc} @> ${recipient}::jsonb))
          or (lower(${m.from}->>'email') = ${e} and ${m.date} < ${new Date(since).toISOString()}::timestamptz)
        )`,
      ),
    )
    .limit(1);
  return !!hit;
}

/** Should a new conversation that starts with this email wait for the user's decision? */
export async function shouldScreen(userId: string, from: Person, state: ScreenerState) {
  if (!state.on) return false;
  return !(await isKnownSender(userId, from.email, state.since));
}
