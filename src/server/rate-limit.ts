import { sql } from "drizzle-orm";
import { db, schema } from "./db";
import { hmac } from "./crypto";
import { HttpError } from "./http-error";

/**
 * Fixed-window counters in Postgres: no extra service, and every function instance and the worker
 * see the same numbers. One row per key; the window restarts once it's over.
 */
export async function hit(key: string, windowMs: number, cost = 1): Promise<{ count: number; resetAt: Date }> {
  const r = schema.rateLimits;
  const now = new Date();
  const fresh = sql`${r.windowStart} <= ${new Date(now.getTime() - windowMs).toISOString()}::timestamptz`;
  const [row] = await db()
    .insert(r)
    .values({ key, windowStart: now, count: cost })
    .onConflictDoUpdate({
      target: r.key,
      set: {
        count: sql`case when ${fresh} then ${cost}::int else ${r.count} + ${cost}::int end`,
        windowStart: sql`case when ${fresh} then ${now.toISOString()}::timestamptz else ${r.windowStart} end`,
      },
    })
    .returning({ count: r.count, windowStart: r.windowStart });
  return { count: row.count, resetAt: new Date(row.windowStart.getTime() + windowMs) };
}

export interface Limit {
  /** What is counted, e.g. `mailbox-test:user:usr_…`. */
  key: string;
  max: number;
  windowMs: number;
  /** How much this attempt counts (recipients of one email). */
  cost?: number;
}

/** Counts one attempt against every limit; over any of them → 429 with how long to wait. */
export async function limit(...limits: Limit[]) {
  for (const l of limits) {
    const { count, resetAt } = await hit(l.key, l.windowMs, l.cost);
    if (count > l.max) {
      const minutes = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 60_000));
      throw new HttpError(429, "Too many attempts. Try again in {minutes} min.", "rate_limited", { minutes });
    }
  }
}

/**
 * The caller's address as Vercel reports it, as a counter key only: hashed with our secret, so no IP
 * address is stored (the counters themselves go after two days).
 */
export function clientIp(req: Request): string {
  return pseudonym(req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown");
}

/** Addresses in counter keys are hashed too, keyed with our secret: a leaked table can't be reversed by trying every IPv4 address. */
const pseudonym = (value: string) => hmac(`limit:${value.toLowerCase()}`).slice(0, 22);

const MIN = 60_000;
const HOUR = 60 * MIN;

/** The limits per endpoint, in one place so they're easy to compare. */
export const LIMITS = {
  /** Passkey and Google sign-in attempts from one address. */
  signIn: (ip: string): Limit => ({ key: `sign-in:ip:${ip}`, max: 30, windowMs: 10 * MIN }),
  /** Sign-in codes by email asked for from one address (signing in and up). */
  emailCodes: (ip: string): Limit => ({ key: `email-code:ip:${ip}`, max: 20, windowMs: HOUR }),
  /** Codes sent to one address, whoever asks: nobody's inbox gets flooded. */
  emailCodesTo: (email: string): Limit => ({ key: `email-code:to:${pseudonym(email)}`, max: 6, windowMs: HOUR }),
  /** Wrong codes for one address before it has to wait. */
  codeAttempts: (email: string): Limit => ({ key: `code:email:${pseudonym(email)}`, max: 8, windowMs: 15 * MIN }),
  /** Logging in to mail servers with a password: without it, the app could be used to try other people's passwords. */
  mailboxTest: (userId: string, ip: string): Limit[] => [
    { key: `mailbox-test:user:${userId}`, max: 20, windowMs: HOUR },
    { key: `mailbox-test:ip:${ip}`, max: 40, windowMs: HOUR },
  ],
  mailboxDetect: (userId: string): Limit => ({ key: `mailbox-detect:user:${userId}`, max: 60, windowMs: HOUR }),
  mailboxAdd: (userId: string): Limit => ({ key: `mailbox-add:user:${userId}`, max: 20, windowMs: HOUR }),
  /** MCP clients registering themselves (RFC 7591). */
  oauthRegister: (ip: string): Limit => ({ key: `oauth-register:ip:${ip}`, max: 10, windowMs: HOUR }),
  /** Emails an AI agent may send: messages and recipients per hour, per agent and for the user overall. */
  agentSend: (agentId: string, userId: string, recipients: number): Limit[] => [
    { key: `agent-send:agent:${agentId}`, max: 20, windowMs: HOUR },
    { key: `agent-send:user:${userId}`, max: 40, windowMs: HOUR },
    { key: `agent-recipients:agent:${agentId}`, max: 100, windowMs: HOUR, cost: recipients },
  ],
  feedback: (userId: string): Limit => ({ key: `feedback:user:${userId}`, max: 20, windowMs: HOUR }),
  /** The form on kolbaba.app asking for a copy on one's own server; there is no account to count against. */
  selfHostRequest: (ip: string): Limit => ({ key: `self-host:ip:${ip}`, max: 5, windowMs: HOUR }),
  /** Crash reports from the app's error screen, per user (`user:…`) or, signed out, per address (`ip:…`). */
  clientErrors: (who: string): Limit => ({ key: `client-error:${who}`, max: 20, windowMs: HOUR }),
  /** AI summaries (each one is an OpenAI call); a cached one is free but still counts, which is fine. */
  summary: (userId: string): Limit => ({ key: `summary:user:${userId}`, max: 60, windowMs: 24 * HOUR }),
  /** Searching at the providers for mail the history import hasn't brought in yet. */
  searchOlder: (userId: string): Limit => ({ key: `search-older:user:${userId}`, max: 30, windowMs: HOUR }),
  /** Leaving mailing lists (each one is a request to someone else's server, or an email). */
  // Leaving several lists at once (Newsletters) is one request per list.
  unsubscribe: (userId: string): Limit => ({ key: `unsubscribe:user:${userId}`, max: 100, windowMs: HOUR }),
};
