import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { ACCOUNT_COLUMNS, db, schema } from "../db";
import { adapterFor, type AccountRow } from "../mail/adapters";
import { MailAuthError, type MailAdapter } from "../mail/types";
import { translate } from "@/lib/i18n";
import { findCode, formatCode } from "@/lib/otp";
import { inQuietHours, mayNotify } from "@/lib/quiet-hours";
import { firstMatch } from "@/lib/rules";
import type { BadgeMode } from "@/lib/types";
import { rulesByUser } from "../mail/rules";
import { notifyUser, userLocale } from "../push";
import { DbSyncSink, sweepEmptyThreads, type NewMail } from "./sink";
import { safeError } from "../log";

/** How far back the first import of a new mailbox reaches. Older mail stays at the provider. */
export const BACKFILL_DAYS = 90;

export async function loadAccount(accountId: string): Promise<AccountRow | null> {
  const [row] = await db().select(ACCOUNT_COLUMNS).from(schema.accounts).where(eq(schema.accounts.id, accountId));
  return row ?? null;
}

/** How stale "last synced" (admin only) may get before a sync that changed nothing writes it again. */
const LAST_SYNC_EVERY_MS = 15 * 60_000;

/** Saves the mailbox's status and keeps `row` in step, so the next call compares with what's stored. */
async function setStatus(row: Pick<AccountRow, "id" | "status" | "statusMessage" | "lastSyncAt">, status: AccountRow["status"], statusMessage: string | null = null) {
  // Most syncs find a healthy mailbox still healthy: no write for that.
  const fresh = row.lastSyncAt && Date.now() - row.lastSyncAt.getTime() < LAST_SYNC_EVERY_MS;
  if (status === row.status && statusMessage === row.statusMessage && (status !== "ok" || fresh)) return;
  const lastSyncAt = status === "ok" ? new Date() : row.lastSyncAt;
  await db().update(schema.accounts).set({ status, statusMessage, lastSyncAt }).where(eq(schema.accounts.id, row.id));
  Object.assign(row, { status, statusMessage, lastSyncAt });
}

/* ------------------------------- Sync lease ------------------------------- */

/** A lease outlives a crashed holder by at most this long. */
const LEASE_MS = 2 * 60_000;
const LEASE_HEARTBEAT_MS = 30_000;

const accounts = schema.accounts;
const leaseFree = () => or(isNull(accounts.syncLeaseUntil), lte(accounts.syncLeaseUntil, new Date()));

async function takeLease(accountId: string, owner: string) {
  const rows = await db()
    .update(accounts)
    .set({ syncLeaseOwner: owner, syncLeaseUntil: new Date(Date.now() + LEASE_MS), syncRequested: false })
    .where(and(eq(accounts.id, accountId), leaseFree()))
    .returning({ id: accounts.id });
  return rows.length > 0;
}

/** Lets go, unless another sync asked meanwhile: then the request is cleared and the caller runs again. */
async function releaseLease(accountId: string, owner: string): Promise<"released" | "again" | "lost"> {
  const mine = and(eq(accounts.id, accountId), eq(accounts.syncLeaseOwner, owner));
  const released = await db()
    .update(accounts)
    .set({ syncLeaseOwner: null, syncLeaseUntil: null })
    .where(and(mine, eq(accounts.syncRequested, false)))
    .returning({ id: accounts.id });
  if (released.length) return "released";
  const again = await db()
    .update(accounts)
    .set({ syncRequested: false, syncLeaseUntil: new Date(Date.now() + LEASE_MS) })
    .where(mine)
    .returning({ id: accounts.id });
  return again.length ? "again" : "lost";
}

/**
 * Only one sync per mailbox runs at a time, whichever process starts it (the worker, a reconnect that
 * restarts the worker's mailbox, a web function without a worker). A run that finds the mailbox busy
 * leaves a request instead, and the running one does one more pass before it lets go, so nothing it
 * would have seen is missed. Returns null when another run took the job.
 */
export async function withSyncLease<T>(accountId: string, run: (pass: number) => Promise<T>): Promise<T[] | null> {
  const owner = crypto.randomUUID();
  if (!(await takeLease(accountId, owner))) {
    await db().update(accounts).set({ syncRequested: true }).where(eq(accounts.id, accountId));
    // The holder may have let go between the two statements; then nobody would see the request.
    if (!(await takeLease(accountId, owner))) return null;
  }
  const heartbeat = setInterval(() => {
    void db()
      .update(accounts)
      .set({ syncLeaseUntil: new Date(Date.now() + LEASE_MS) })
      .where(and(eq(accounts.id, accountId), eq(accounts.syncLeaseOwner, owner)))
      .catch(() => {});
  }, LEASE_HEARTBEAT_MS);
  const results: T[] = [];
  try {
    for (let pass = 0; ; pass++) {
      results.push(await run(pass));
      if ((await releaseLease(accountId, owner)) !== "again") return results;
    }
  } catch (err) {
    await db()
      .update(accounts)
      .set({ syncLeaseOwner: null, syncLeaseUntil: null })
      .where(and(eq(accounts.id, accountId), eq(accounts.syncLeaseOwner, owner)))
      .catch(() => {});
    throw err;
  } finally {
    clearInterval(heartbeat);
  }
}

/**
 * Bring one mailbox up to date: the first run imports the last BACKFILL_DAYS, later runs apply
 * deltas. Returns new inbox mail so the caller can notify. Auth failures flip the account into
 * `auth_error` (the UI shows "Reconnect") instead of retrying forever.
 */
export async function syncAccount(row: AccountRow, opts: { adapter?: MailAdapter } = {}): Promise<NewMail[]> {
  const passes = await withSyncLease(row.id, async (pass) => {
    // A second pass reloads the mailbox: the request may come from a reconnect with new credentials.
    const fresh = pass === 0 ? row : await loadAccount(row.id);
    return fresh ? syncOnce(fresh, pass === 0 ? opts : {}) : [];
  });
  return passes?.flat() ?? [];
}

async function syncOnce(row: AccountRow, opts: { adapter?: MailAdapter }): Promise<NewMail[]> {
  const initial = !row.syncState.backfilledUntil;
  const sink = new DbSyncSink(row, !initial);
  const adapter = opts.adapter ?? adapterFor(row);
  try {
    if (initial) {
      // Also after a failed or interrupted first import: the app shows mail as it lands while "syncing".
      if (row.status !== "syncing") await setStatus(row, "syncing");
      const since = new Date(Date.now() - BACKFILL_DAYS * 24 * 3600 * 1000);
      console.log(`[${row.id}] first import${row.syncState.importedUntil ? " (resuming)" : ""}`);
      await adapter.initialSync(sink, { since });
      await sink.saveState({ backfilledUntil: since.getTime() });
      console.log(`[${row.id}] first import finished`);
    } else {
      await adapter.incrementalSync(sink);
    }
    await sweepEmptyThreads(row.id);
    await setStatus(row, "ok");
    return sink.newMail;
  } catch (err) {
    if (err instanceof MailAuthError) {
      if (row.status !== "auth_error") {
        const locale = await userLocale(row.userId);
        await notifyUser(row.userId, {
          title: translate(locale, "Reconnect {name}", { name: row.name }),
          body: translate(locale, err.text, err.vars),
          url: "/?settings=accounts",
          tag: `auth-${row.id}`,
        });
      }
      // Keep the server's own words: a provider refusing our IP can look just like a wrong password.
      const message = err.serverReply ? `${err.message} (${err.serverReply})` : err.message;
      if (message !== row.statusMessage) console.log(`[${row.id}] sign-in refused: ${message}`);
      await setStatus(row, "auth_error", message);
      return [];
    }
    await setStatus(row, "error", safeError(err));
    throw err;
  } finally {
    if (!opts.adapter) await adapter.close().catch(() => {});
  }
}

/**
 * Older messages per history step. Steps alternate with the mailbox's normal syncs, so a step must stay
 * short even at Gmail's throttled pace (~2 messages/s) or new mail would wait behind it.
 */
const HISTORY_STEP = 100;

/**
 * One step of importing all mail older than the first import, newest first and without notifications.
 * The worker repeats it between normal syncs until the whole mailbox is in. Returns true when done.
 */
export async function importHistoryStep(row: AccountRow): Promise<boolean> {
  if (row.syncState.historyComplete) return true;
  if (!row.syncState.backfilledUntil || row.status === "auth_error") return false;
  // Busy with a sync elsewhere: the step comes round again later.
  const passes = await withSyncLease(row.id, (pass) => (pass === 0 ? historyStep(row) : syncAccountPass(row.id)));
  return (passes?.[0] as boolean | undefined) ?? false;
}

/** A sync asked for while a history step held the mailbox. */
async function syncAccountPass(accountId: string) {
  const fresh = await loadAccount(accountId);
  const mail = fresh ? await syncOnce(fresh, {}) : [];
  if (fresh && mail.length) await notifyNewMail(fresh, mail);
  return false;
}

async function historyStep(row: AccountRow): Promise<boolean> {
  const adapter = adapterFor(row);
  try {
    if (!adapter.importOlder) return true;
    const sink = new DbSyncSink(row, false);
    const done = await adapter.importOlder(sink, { limit: HISTORY_STEP });
    if (done) {
      await sink.saveState({ historyComplete: true });
      console.log(`[${row.id}] history import finished`);
    }
    return done;
  } finally {
    await adapter.close().catch(() => {});
  }
}

/** Home Screen badge: unread conversations in Inbox across mailboxes (only people's, or none, if the user said so). */
export async function badgeCount(userId: string, mode: BadgeMode = "all") {
  if (mode === "none") return 0;
  const t = schema.threads;
  const [{ count }] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(t)
    .where(
      and(
        eq(t.userId, userId),
        eq(t.folder, "inbox"),
        eq(t.unread, true),
        eq(t.screening, false),
        isNull(t.mutedAt),
        gt(t.messageCount, 0),
        or(isNull(t.snoozedUntil), lte(t.snoozedUntil, new Date())),
        ...(mode === "people" ? [eq(t.kind, "person")] : []),
      ),
    );
  return count;
}

/**
 * Push one notification per new message that may notify (tag per thread, so a busy thread doesn't
 * stack up). What may: the mailbox's setting (everything, people, VIPs, nothing), quiet hours, the
 * user's rules (what a rule files away stays quiet), "Notify me of replies" on a conversation, and a
 * sign-in code always (src/lib/quiet-hours.ts).
 */
export async function notifyNewMail(row: Pick<AccountRow, "userId" | "name"> & Partial<Pick<AccountRow, "id" | "notify">>, mail: NewMail[]) {
  if (!mail.length) return;
  const [user] = await db().select({ settings: schema.users.settings }).from(schema.users).where(eq(schema.users.id, row.userId));
  const settings = user?.settings ?? {};
  const threadIds = [...new Set(mail.map((m) => m.threadId))];
  const [threads, vips, rules] = await Promise.all([
    db()
      .select({ id: schema.threads.id, kind: schema.threads.kind, watchedAt: schema.threads.watchedAt, accountId: schema.threads.accountId })
      .from(schema.threads)
      .where(inArray(schema.threads.id, threadIds)),
    db()
      .select({ emails: schema.contacts.emails })
      .from(schema.contacts)
      .where(and(eq(schema.contacts.userId, row.userId), eq(schema.contacts.vip, true), eq(schema.contacts.hidden, false))),
    rulesByUser([row.userId]).then((m) => (m.get(row.userId) ?? []).map((r) => ({ accountId: r.accountId, from: r.fromMatch, subject: r.subjectMatch }))),
  ]);
  const vip = new Set(vips.flatMap((v) => v.emails.map((e) => e.toLowerCase())));
  const quiet = inQuietHours(settings.quietHours, new Date());
  const allowed = mail.filter((m) => {
    const thread = threads.find((t) => t.id === m.threadId);
    return mayNotify(row.notify ?? "all", quiet, {
      kind: thread?.kind ?? "person",
      code: !!findCode(m.subject, m.snippet),
      vip: vip.has(m.from.email.toLowerCase()),
      watched: !!thread?.watchedAt,
      ruled: !!firstMatch(rules, { accountId: thread?.accountId ?? row.id ?? "", from: m.from.email, subject: m.subject }),
    });
  });
  if (!allowed.length) return;
  const count = await badgeCount(row.userId, settings.badge);
  const locale = await userLocale(row.userId);
  for (const m of allowed.slice(-5)) {
    const sender = m.from.name || m.from.email;
    // A sign-in code goes straight into the title, readable on the lock screen without opening anything,
    // unless the user turned that off: then the notification only says a code came (the subject often holds it too).
    const otp = findCode(m.subject, m.snippet);
    const hideCode = !!otp && settings.codeInNotification === false;
    await notifyUser(row.userId, {
      title: otp && !hideCode ? `${formatCode(otp.code)} · ${sender}` : sender,
      body: hideCode ? translate(locale, "Verification code") : otp ? m.subject || translate(locale, "Verification code") : m.subject ? `${m.subject}\n${m.snippet}` : m.snippet,
      url: `/?thread=${m.threadId}`,
      tag: m.threadId,
      badge: count,
    });
  }
}
