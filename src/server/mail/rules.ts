import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { firstMatch, normalizeFrom, senderKey } from "@/lib/rules";
import type { MailRule, RuleAction, RuleSuggestion } from "@/lib/types";
import { db, schema } from "../db";
import { HttpError } from "../http-error";
import { logWarn } from "../log";
import { moveThread, moveToOwnFolder, setUnread } from "./service";

/**
 * The user's rules for new mail: "mail from Alza goes to Shopping". Kolbaba offers one after the user
 * files the same sender's mail into the same folder by hand a few times, and Settings has the list
 * with an editor. The worker applies them to mail that arrives (`applyMailRules`); a matched email
 * never notifies (src/server/sync/engine.ts).
 */

type RuleRow = typeof schema.rules.$inferSelect;

/** Kolbaba asks after this many filings of one sender into one folder, and again after as many more. */
export const SUGGEST_AFTER = 3;
/** New mail only: a rule made today doesn't sweep a mailbox's history (that's "apply to Inbox now"). */
const NEW_MAIL_MS = 24 * 3600_000;
const MAX_RULES = 200;

export const ruleDto = (r: RuleRow): MailRule => ({
  id: r.id,
  accountId: r.accountId,
  from: r.fromMatch,
  subject: r.subjectMatch,
  action: r.action,
  folderId: r.folderId,
  markRead: r.markRead,
  applied: r.applied,
  lastAppliedAt: r.lastAppliedAt?.getTime() ?? null,
});

/** In the order they're tried: the oldest first. */
export async function listRules(userId: string): Promise<MailRule[]> {
  const rows = await db().select().from(schema.rules).where(eq(schema.rules.userId, userId)).orderBy(asc(schema.rules.createdAt));
  return rows.map(ruleDto);
}

export interface RuleInput {
  accountId?: string | null;
  from?: string;
  subject?: string;
  action: RuleAction;
  folderId?: string | null;
  markRead?: boolean;
}

/** Checks what the editor sent and turns it into a row's fields. */
async function clean(userId: string, input: RuleInput) {
  const from = normalizeFrom(input.from ?? "");
  if (from === null) throw new HttpError(400, "Type an email address or a domain, like petr@firma.cz or alza.cz", "invalid_rule_from");
  const subject = (input.subject ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (!from && !subject) throw new HttpError(400, "Say who the mail is from, or what its subject says", "empty_rule");
  if (input.accountId) {
    const [a] = await db()
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(and(eq(schema.accounts.id, input.accountId), eq(schema.accounts.userId, userId)));
    if (!a) throw new HttpError(404, "Mailbox not found", "not_found");
  }
  let folderId: string | null = null;
  if (input.action === "folder") {
    const [f] = input.folderId
      ? await db()
          .select({ id: schema.mailFolders.id })
          .from(schema.mailFolders)
          .where(and(eq(schema.mailFolders.id, input.folderId), eq(schema.mailFolders.userId, userId)))
      : [];
    if (!f) throw new HttpError(400, "Pick a folder", "rule_folder");
    folderId = f.id;
  }
  return { accountId: input.accountId ?? null, fromMatch: from, subjectMatch: subject, action: input.action, folderId, markRead: input.action === "trash" ? false : !!input.markRead };
}

export async function createRule(userId: string, input: RuleInput, opts: { applyNow?: boolean } = {}): Promise<{ rule: MailRule; applied: number }> {
  const [{ count }] = await db().select({ count: sql<number>`count(*)::int` }).from(schema.rules).where(eq(schema.rules.userId, userId));
  if (count >= MAX_RULES) throw new HttpError(400, "That's a lot of rules. Delete some you don't need first.", "too_many_rules");
  const fields = await clean(userId, input);
  const [row] = await db()
    .insert(schema.rules)
    .values({ userId, ...fields })
    .returning();
  // The suggestion for this sender and folder is answered.
  if (fields.fromMatch && fields.folderId) {
    await db()
      .delete(schema.ruleHints)
      .where(and(eq(schema.ruleHints.userId, userId), eq(schema.ruleHints.sender, fields.fromMatch), eq(schema.ruleHints.folderId, fields.folderId)));
  }
  const applied = opts.applyNow ? await applyToInbox(userId, row) : 0;
  const [fresh] = await db().select().from(schema.rules).where(eq(schema.rules.id, row.id));
  return { rule: ruleDto(fresh ?? row), applied };
}

export async function updateRule(userId: string, id: string, input: RuleInput): Promise<MailRule> {
  const fields = await clean(userId, input);
  const [row] = await db()
    .update(schema.rules)
    .set(fields)
    .where(and(eq(schema.rules.id, id), eq(schema.rules.userId, userId)))
    .returning();
  if (!row) throw new HttpError(404, "That rule is gone", "not_found");
  return ruleDto(row);
}

export async function deleteRule(userId: string, id: string) {
  const [row] = await db()
    .delete(schema.rules)
    .where(and(eq(schema.rules.id, id), eq(schema.rules.userId, userId)))
    .returning({ id: schema.rules.id });
  if (!row) throw new HttpError(404, "That rule is gone", "not_found");
}

/** Who wrote the newest email in each conversation that isn't the user's own, and whether the user wrote last. */
async function latestIncoming(threadIds: string[]) {
  type Latest = { email: string; name: string; subject: string; answered: boolean };
  if (!threadIds.length) return new Map<string, Latest>();
  const rows = await db().execute<{ thread_id: string; email: string; name: string; subject: string; answered: boolean | null }>(sql`
    select distinct on (m.thread_id) m.thread_id, lower(m."from"->>'email') as email, coalesce(m."from"->>'name', '') as name, m.subject,
      (select x.is_outgoing from ${schema.messages} x where x.thread_id = m.thread_id order by x.date desc limit 1) as answered
    from ${schema.messages} m
    where m.thread_id in (${sql.join(
      threadIds.map((id) => sql`${id}`),
      sql`, `,
    )}) and not m.is_outgoing
    order by m.thread_id, m.date desc`);
  return new Map(rows.map((r) => [r.thread_id, { email: r.email ?? "", name: r.name ?? "", subject: r.subject ?? "", answered: !!r.answered }]));
}

/**
 * The user filed conversations into one of their folders by hand. Counts it per sender, and the third
 * time (and every few times after, as long as they keep doing it) offers "Always do this?". Not when a
 * rule already covers the sender.
 */
export async function noteFiling(userId: string, threadIds: string[], folderId: string): Promise<RuleSuggestion | null> {
  const senders = new Map<string, string>();
  for (const m of (await latestIncoming(threadIds)).values()) {
    if (!m.email) continue;
    const key = senderKey(m.email);
    if (!senders.has(key)) senders.set(key, key.startsWith("@") ? key.slice(1) : m.name || m.email);
  }
  // A big selection from many senders isn't a habit to learn from.
  if (!senders.size || senders.size > 3) return null;
  const covered = await db()
    .select({ fromMatch: schema.rules.fromMatch })
    .from(schema.rules)
    .where(and(eq(schema.rules.userId, userId), inArray(schema.rules.fromMatch, [...senders.keys()])));
  let offer: RuleSuggestion | null = null;
  for (const [sender, name] of senders) {
    if (covered.some((c) => c.fromMatch === sender)) continue;
    const [hint] = await db()
      .insert(schema.ruleHints)
      .values({ userId, sender, folderId, count: 1 })
      .onConflictDoUpdate({
        target: [schema.ruleHints.userId, schema.ruleHints.sender, schema.ruleHints.folderId],
        set: { count: sql`${schema.ruleHints.count} + 1`, updatedAt: new Date() },
      })
      .returning();
    if (!offer && hint.count >= SUGGEST_AFTER && hint.count - hint.asked >= SUGGEST_AFTER) {
      await db()
        .update(schema.ruleHints)
        .set({ asked: hint.count })
        .where(and(eq(schema.ruleHints.userId, userId), eq(schema.ruleHints.sender, sender), eq(schema.ruleHints.folderId, folderId)));
      offer = { sender, name, folderId };
    }
  }
  return offer;
}

/** Do what the rule says to one conversation. */
async function act(userId: string, rule: Pick<RuleRow, "action" | "folderId" | "markRead">, threadId: string) {
  if (rule.action === "folder" && rule.folderId) await moveToOwnFolder(userId, threadId, rule.folderId);
  else if (rule.action === "archive") await moveThread(userId, threadId, "archive");
  else if (rule.action === "trash") await moveThread(userId, threadId, "trash");
  if (rule.markRead && rule.action !== "trash") await setUnread(userId, threadId, false);
}

async function countApplied(ruleId: string, n: number) {
  if (!n) return;
  await db()
    .update(schema.rules)
    .set({ applied: sql`${schema.rules.applied} + ${n}`, lastAppliedAt: new Date() })
    .where(eq(schema.rules.id, ruleId));
}

/** A new rule, also for what's in Inbox already ("and the 12 already in Inbox too"). */
async function applyToInbox(userId: string, rule: RuleRow) {
  const t = schema.threads;
  const rows = await db()
    .select({ id: t.id, accountId: t.accountId })
    .from(t)
    .where(and(eq(t.userId, userId), eq(t.folder, "inbox"), eq(t.screening, false), eq(t.pinned, false), gt(t.messageCount, 0), ...(rule.accountId ? [eq(t.accountId, rule.accountId)] : [])))
    .orderBy(desc(t.lastMessageAt))
    .limit(1000);
  const senders = await latestIncoming(rows.map((r) => r.id));
  let n = 0;
  for (const r of rows) {
    const m = senders.get(r.id);
    if (!m || m.answered || !firstMatch([ruleDto(rule)], { accountId: r.accountId, from: m.email, subject: m.subject })) continue;
    try {
      await act(userId, rule, r.id);
      n++;
    } catch (err) {
      logWarn(`[rules] ${r.id}`, err);
    }
  }
  if (rows.length) {
    await db()
      .update(schema.threads)
      .set({ ruledAt: new Date() })
      .where(inArray(schema.threads.id, rows.map((r) => r.id)));
  }
  await countApplied(rule.id, n);
  return n;
}

/** Every user's rules, by user, oldest first (what the worker and the notifications try in turn). */
export async function rulesByUser(userIds?: string[]) {
  const where = userIds ? inArray(schema.rules.userId, userIds.length ? userIds : ["-"]) : undefined;
  const rows = await db().select().from(schema.rules).where(where).orderBy(asc(schema.rules.createdAt));
  const out = new Map<string, RuleRow[]>();
  for (const r of rows) out.set(r.userId, [...(out.get(r.userId) ?? []), r]);
  return out;
}

/**
 * Worker: new mail in Inbox that a rule covers goes where the rule says. Each conversation is looked
 * at once per new message (`ruledAt`), so one the user moves back to Inbox stays there.
 */
export async function applyMailRules() {
  const byUser = await rulesByUser();
  if (!byUser.size) return 0;
  const t = schema.threads;
  const now = new Date();
  const rows = await db()
    .select({ id: t.id, userId: t.userId, accountId: t.accountId })
    .from(t)
    .where(
      and(
        inArray(t.userId, [...byUser.keys()]),
        eq(t.folder, "inbox"),
        eq(t.screening, false),
        isNull(t.mutedAt),
        gt(t.messageCount, 0),
        gt(t.lastMessageAt, new Date(now.getTime() - NEW_MAIL_MS)),
        or(isNull(t.ruledAt), lt(t.ruledAt, t.lastMessageAt))!,
        or(isNull(t.snoozedUntil), lte(t.snoozedUntil, now))!,
      ),
    )
    .limit(100);
  if (!rows.length) return 0;
  const senders = await latestIncoming(rows.map((r) => r.id));
  let n = 0;
  for (const r of rows) {
    const m = senders.get(r.id);
    // The user wrote last: their own reply is no new mail for a rule to file away.
    const rule = m && !m.answered ? firstMatch(byUser.get(r.userId)!.map((x) => ({ ...x, from: x.fromMatch, subject: x.subjectMatch })), { accountId: r.accountId, from: m.email, subject: m.subject }) : null;
    try {
      if (rule) {
        await act(r.userId, rule, r.id);
        await countApplied(rule.id, 1);
        n++;
      }
    } catch (err) {
      logWarn(`[rules] ${r.id}`, err);
    } finally {
      await db().update(t).set({ ruledAt: new Date() }).where(eq(t.id, r.id));
    }
  }
  return n;
}
