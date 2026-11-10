import { and, eq, gt, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { translate } from "@/lib/i18n";
import { db, schema } from "@/server/db";
import { processInsights } from "@/server/insights/run";
import { clearOrphanAttachments } from "@/server/mail/outgoing-attachments";
import { releaseSnooze } from "@/server/mail/service";
import { archiveBlockedMail } from "@/server/mail/screener-actions";
import { archiveMutedMail } from "@/server/mail/mute";
import { applyMailRules } from "@/server/mail/rules";
import { sendAwayReplies } from "@/server/mail/away";
import { scanAllContacts } from "@/server/contacts";
import { importAllDrafts } from "@/server/sync/draft-import";
import { mirrorDrafts } from "@/server/sync/draft-mirror";
import { notifyUser, userLocale } from "@/server/push";
import { failStuckSends, processDueOutbox } from "@/server/sync/outbox";
import type { Supervisor } from "./supervisor";
import { logWarn } from "@/server/log";

/** Run `fn` every `ms`, never overlapping itself, never letting one failure stop the loop. */
function every(ms: number, name: string, fn: () => Promise<unknown>) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await fn();
    } catch (err) {
      logWarn(`[${name}]`, err);
    } finally {
      running = false;
    }
  }, ms);
  return () => clearInterval(timer);
}

/** Snoozed conversations whose time came: back to Inbox with a notification. */
export async function wakeSnoozed() {
  const woken = await db()
    .update(schema.threads)
    .set({ snoozedUntil: null, unread: true, wokeAt: new Date() })
    .where(and(isNotNull(schema.threads.snoozedUntil), lte(schema.threads.snoozedUntil, new Date())))
    .returning({ id: schema.threads.id, userId: schema.threads.userId, subject: schema.threads.subject, folderId: schema.threads.folderId });
  for (const t of woken) {
    const locale = await userLocale(t.userId);
    // Filed mail comes back in its own folder.
    const [folder] = t.folderId
      ? await db().select({ name: schema.mailFolders.name }).from(schema.mailFolders).where(eq(schema.mailFolders.id, t.folderId))
      : [];
    await notifyUser(t.userId, {
      title: folder ? translate(locale, "Back in {folder}", { folder: folder.name }) : translate(locale, "Back in your Inbox"),
      body: t.subject || translate(locale, "(no subject)"),
      url: `/?thread=${t.id}`,
      tag: t.id,
    });
  }
  return woken.length;
}

/** Woken or un-snoozed conversations: what snooze archived at the provider goes back to its Inbox. */
export async function releaseSnoozes() {
  const t = schema.threads;
  const due = await db()
    .select({ id: t.id, userId: t.userId })
    .from(t)
    .where(
      and(
        // Written as threads_snooze_release_idx says it, so this reads the few snoozed conversations, not all of them.
        sql`(${t.snoozedAt} is not null or ${t.snoozeMoved} <> '[]'::jsonb)`,
        or(isNull(t.snoozedUntil), lte(t.snoozedUntil, new Date())),
      ),
    )
    .limit(50);
  for (const row of due) await releaseSnooze(row.userId, row.id).catch((err) => logWarn(`[snooze] ${row.id}`, err));
}

/**
 * "Remind me if nobody replies": a due reminder already shows the thread in Inbox (see the inbox
 * query); here we only send the push, once — for reminders that came due since the last tick.
 */
export async function remindFollowUps(since: Date, until: Date) {
  const due = await db()
    .select({
      id: schema.threads.id,
      userId: schema.threads.userId,
      subject: schema.threads.subject,
      participants: schema.threads.participants,
    })
    .from(schema.threads)
    .where(and(gt(schema.threads.followUpAt, since), lte(schema.threads.followUpAt, until)));
  for (const t of due) {
    const locale = await userLocale(t.userId);
    const who = t.participants[0]?.name || t.participants[0]?.email || translate(locale, "They");
    await notifyUser(t.userId, {
      title: translate(locale, "No reply from {name} yet", { name: who.split(" ")[0] }),
      body: t.subject || translate(locale, "(no subject)"),
      url: `/?thread=${t.id}`,
      tag: `follow-${t.id}`,
    });
  }
  return due.length;
}

export function startJobs(supervisor: Supervisor) {
  let lastFollowUpTick = new Date();
  let draftRounds = 0;
  let insightsIdle = 0;
  const stops = [
    // Undo window is a few seconds, so the outbox is checked often (the web app also nudges).
    every(2_000, "outbox", processDueOutbox),
    every(60_000, "stuck-sends", failStuckSends),
    every(30_000, "snooze", async () => {
      await wakeSnoozed();
      await releaseSnoozes();
    }),
    // Screener and Block: mail from senders the user said no to goes to Archive (or, blocked, to Trash).
    every(30_000, "screener", archiveBlockedMail),
    // Muted conversations: a new reply goes back out of Inbox, read.
    every(30_000, "mute", archiveMutedMail),
    // The user's rules file new mail where it belongs (src/server/mail/rules.ts).
    every(30_000, "rules", applyMailRules),
    // Out of office: people who wrote get the reply, once each (src/server/mail/away.ts).
    every(60_000, "away", sendAwayReplies),
    // Drafts written here get a copy at the provider once they settle (src/server/sync/draft-mirror.ts);
    // every ten minutes, drafts started or changed in other clients come in (draft-import.ts). That
    // round signs in to every mailbox, so it isn't more often: Seznam limits connections per address.
    every(10_000, "drafts", async () => {
      await mirrorDrafts();
      if (draftRounds++ % 60 === 0) await importAllDrafts();
    }),
    every(30_000, "follow-up", async () => {
      const now = new Date();
      await remindFollowUps(lastFollowUpTick, now);
      lastFollowUpTick = now;
    }),
    // Safety net for missed IDLE events / Pub/Sub messages.
    every(5 * 60_000, "poll", async () => supervisor.syncAll()),
    every(6 * 3600_000, "gmail-watch", () => supervisor.renewGmailWatches()),
    // All older mail, a step at a time (see importHistory); a no-op once every mailbox is complete.
    every(10_000, "history", () => supervisor.importHistory()),
    // Smart categories: new mail first, then the history, a batch at a time (no-op without OPENAI_API_KEY).
    // A round that found nothing to look at waits two minutes before asking again.
    every(20_000, "insights", async () => {
      if (insightsIdle > 0) return void insightsIdle--;
      insightsIdle = (await processInsights()) ? 0 : 5;
    }),
    // The address book takes in whoever the user wrote to (src/server/contacts.ts).
    every(10 * 60_000, "contacts", scanAllContacts),
    every(6 * 3600_000, "cleanup", cleanUp),
  ];
  // Deploys restart the worker, so don't wait a whole interval for the first clean-up.
  const first = setTimeout(() => {
    void cleanUp().catch((err) => logWarn("[cleanup]", err));
    void scanAllContacts().catch((err) => logWarn("[contacts]", err));
  }, 60_000);
  return () => {
    clearTimeout(first);
    stops.forEach((stop) => stop());
  };
}

/** What we don't keep forever. The privacy policy (section 11) promises these periods; change both together. */
export async function cleanUp() {
  for (const statement of [
    sql`delete from ${schema.outbox} where status in ('sent','cancelled','failed') and send_at < now() - interval '30 days'`,
    sql`delete from ${schema.sessions} where expires_at < now()`,
    sql`delete from ${schema.authChallenges} where expires_at < now()`,
    sql`delete from ${schema.oauthCodes} where expires_at < now()`,
    sql`delete from ${schema.oauthTokens} where expires_at < now()`,
    // AI activity: the app shows all of these 30 days (src/server/mcp/activity.ts).
    sql`delete from ${schema.agentEvents} where at < now() - interval '30 days'`,
    sql`delete from ${schema.agentSessions} where last_at < now() - interval '30 days'`,
    // Read tracking: opens go with their tracked message.
    sql`delete from ${schema.trackedMessages} where created_at < now() - interval '12 months'`,
    // My history: Undo reaches back 30 days.
    sql`delete from ${schema.history} where at < now() - interval '30 days'`,
    // Attempt counters only matter inside their window (at most a day).
    sql`delete from ${schema.rateLimits} where window_start < now() - interval '2 days'`,
    // Feature usage: counts per day, a year is plenty to see trends.
    sql`delete from ${schema.featureUsage} where day < current_date - 365`,
    // Out of office: who got a reply matters only for the 4 days before they may get another.
    sql`delete from ${schema.awayReplies} where sent_at < now() - interval '4 days'`,
    // Rule suggestions: filings not repeated for 90 days are forgotten.
    sql`delete from ${schema.ruleHints} where updated_at < now() - interval '90 days'`,
    // Feedback: at most 3 years (the general limitation period, in case it ever matters).
    sql`delete from ${schema.feedback} where created_at < now() - interval '3 years'`,
    // Waitlist for one's own server: at most 3 years, as the privacy policy promises.
    sql`delete from ${schema.waitlist} where created_at < now() - interval '3 years'`,
    // AI costs per user and day: a year, like feature usage. Today's caps only read today.
    sql`delete from ${schema.aiUsage} where day < current_date - 365`,
  ]) {
    await db().execute(statement);
  }
  await clearOrphanAttachments();
}
