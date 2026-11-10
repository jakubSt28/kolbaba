import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { insightKey } from "@/lib/insights";
import { plusState } from "@/lib/plus";
import { callsLeft, recordUsage, withinDailyBudget, type AiTokens } from "../ai-usage";
import { ACCOUNT_COLUMNS, columnsWithout, db, schema } from "../db";
import { env } from "../env";
import { withAdapter } from "../mail/adapters";
import { alertOperator } from "../ops-alert";
import { PLUS_COLUMNS } from "../plus";
import { roleOf } from "../sync/sink";
import { accountProblem, extractWithAI, isTransient } from "./extract";
import { hasJev, JevUnavailable, triageWithJev } from "./jev";
import { afterSkip, afterSort, hiddenKinds, loadMemory, saveMemory, senderOf, skipBySender, sortsBeforeKnown, type Memory } from "./memory";
import { afterSorting, firstLook, isRecent, RECENT_DAYS, senderLabel, type Availability } from "./plan";
import { looksLikeAsk, looksLikeInsight, looksLikeSecurity } from "./prefilter";
import { fromSchemaOrg, type Extracted } from "./schema-org";
import { emailText } from "./text";
import { redactSecrets } from "./redact";
import { logWarn } from "../log";

/**
 * Smart categories, one step for everyone who turned them on (the worker runs it every 20 s). Each
 * email gets the cheapest look that's good enough (plan.ts): rules first, then Jev sorting it, and
 * OpenAI filling in the card only for recent mail Jev doesn't rule out. Older mail gets at most a card
 * without details. Senders that keep sending nothing aren't sorted again (memory.ts). Every call counts
 * against the user's daily caps and everyone's daily budget (src/server/ai-usage.ts), kept in the
 * database so a restart can't reset them.
 *
 * It's part of Kolbaba Plus (src/lib/plus.ts): the trial covers the last 90 days, a subscription or a
 * gift the older mail too, and without Plus nothing new is read (the cards already found stay).
 *
 * Emails looked at per user and step, newest first, so new mail is in within a step or two.
 */
const BATCH = 250;
/** Recent emails sorted per step: about as many as READ_PER_STEP can then read. */
const RECENT_SORTS_PER_STEP = 80;
const READ_PER_STEP = 40;
const SORT_CONCURRENCY = 8;
const READ_CONCURRENCY = 6;

/** After this long without Jev, the rules decide about recent mail instead of letting it wait. */
const JEV_PATIENCE = 24 * 3600_000;
/** How long to leave Jev alone after it failed. */
const JEV_RETRY = 10 * 60_000;

/** Jev failing for everyone: since when, and when to try again. In memory: a restart just tries again. */
let jevDown: { since: number; retryAt: number } | null = null;

function jevAvailability(now = Date.now()): Availability {
  if (!hasJev()) return "off";
  if (!jevDown || now >= jevDown.retryAt) return "yes";
  return now - jevDown.since > JEV_PATIENCE ? "off" : "down";
}

function noteJevDown(err: JevUnavailable) {
  const now = Date.now();
  jevDown = { since: jevDown?.since ?? now, retryAt: now + JEV_RETRY };
  logWarn("[insights] jev unavailable:", err);
  if (err.account)
    void alertOperator("jev-account", "TypeSafe: došel kredit nebo nefunguje klíč", [
      "Jev (TypeSafe) odmítá třídit poštu:",
      err.message,
      "",
      "Nová pošta zatím čeká a do 24 hodin rozhodnou pravidla. Dobij kredit na https://console.typesafe.ai/settings/billing.",
    ]);
  else if (now - jevDown.since > 3600_000)
    void alertOperator("jev-down", "TypeSafe nefunguje přes hodinu", ["Jev (TypeSafe) neodpovídá od " + new Date(jevDown.since).toISOString() + ".", err.message]);
}

function noteOpenAiProblem(problem: "credit" | "key", err: unknown) {
  void alertOperator(`openai-${problem}`, problem === "credit" ? "OpenAI: došel kredit" : "OpenAI: nefunguje klíč", [
    "OpenAI odmítá číst poštu pro chytré kategorie a shrnutí:",
    err instanceof Error ? err.message : String(err),
    "",
    "Pošta počká, dokud to nepůjde. Kredit: https://platform.openai.com/settings/organization/billing",
  ]);
}

/** One step of smart categories for everyone who turned them on and has Plus. Returns how many emails were looked at. */
export async function processInsights(): Promise<number> {
  if (!env.hasOpenAI) return 0;
  const users = await db()
    .select({ id: schema.users.id, ...PLUS_COLUMNS })
    .from(schema.users)
    .where(sql`(${schema.users.settings}->>'smartCategories')::boolean is true`);
  // Everyone together over today's budget: nothing goes out until tomorrow.
  if (!(await withinDailyBudget())) return 0;
  let total = 0;
  for (const u of users) {
    const plus = plusState(u);
    if (plus.level === "none") continue;
    total += await processUser(u.id, { history: plus.level === "plus" });
  }
  return total;
}

type Row = Omit<typeof schema.messages.$inferSelect, "search">;
type Found = { row: Row; data: Extracted; source: string };

/** `history`: older than RECENT_DAYS too (a subscription or a gift; the trial has the recent mail only). */
export async function processUser(userId: string, opts: { history: boolean }): Promise<number> {
  // Turned off since the step started? Then nothing more goes out.
  const [user] = await db().select({ settings: schema.users.settings }).from(schema.users).where(eq(schema.users.id, userId));
  if (!user?.settings.smartCategories) return 0;
  const replies = !!user.settings.replyReminders;
  const left = await callsLeft(userId);
  const rows = await db()
    .select(columnsWithout(schema.messages, "search"))
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.userId, userId),
        isNull(schema.messages.insightCheckedAt),
        // Older mail stays unchecked until there's Plus, then it gets its turn.
        opts.history ? undefined : gt(schema.messages.date, new Date(Date.now() - RECENT_DAYS * 86_400_000)),
      ),
    )
    .orderBy(desc(schema.messages.date))
    .limit(BATCH);
  if (!rows.length) return 0;

  /** Done with these emails (a card or not). */
  const checked: string[] = [];
  /** OpenAI read these and found nothing (or they're in Trash or Spam now): a card from an earlier reading goes. */
  const nothing: string[] = [];
  const found: Found[] = [];
  const toSort: { row: Row; text: string; recent: boolean; rule: boolean; sender: string }[] = [];
  const toRead: Row[] = [];
  let recentSorts = 0;
  const jev = jevAvailability();

  // What earlier steps learned about these senders, and the kinds of card the user hid.
  const incoming = rows.filter((r) => !r.isOutgoing);
  const memory = await loadMemory(userId, [...new Set(incoming.map((r) => senderOf(r.from)))]);
  const changed = new Set<string>();
  const remember = (sender: string, m: Memory) => {
    memory.set(sender, m);
    changed.add(sender);
  };
  /** This step's emails per sender waiting for sorting. */
  const queued = new Map<string, number>();
  const hidden = await hiddenKinds(userId);
  const isHidden = (row: Row, category: string) => hidden.has(`${senderOf(row.from)}|${category}`);

  // "Awaiting my reply" needs to know which mail is from a person and addressed to the reader.
  const mailboxes = new Map((await db().select({ id: schema.accounts.id, email: schema.accounts.email }).from(schema.accounts).where(eq(schema.accounts.userId, userId))).map((a) => [a.id, a.email.toLowerCase()]));
  const personal = replies
    ? new Map(
        (
          await db()
            .select({ id: schema.threads.id, kind: schema.threads.kind, unsubscribe: schema.threads.listUnsubscribe })
            .from(schema.threads)
            .where(inArray(schema.threads.id, [...new Set(rows.map((r) => r.threadId))]))
        ).map((t) => [t.id, t.kind === "person" && !t.unsubscribe]),
      )
    : new Map<string, boolean>();

  for (const row of rows) {
    const role = roleOf(row);
    // Our own mail, drafts, spam and trash are never an order or an invoice for us.
    if (row.isOutgoing || role === "drafts" || role === "spam" || role === "trash") {
      checked.push(row.id);
      if (role === "spam" || role === "trash") nothing.push(row.id);
      continue;
    }
    const markup = fromSchemaOrg(row.bodyHtml);
    if (markup) {
      if (!isHidden(row, markup.category)) found.push({ row, data: markup, source: "schema.org" });
      checked.push(row.id);
      continue;
    }
    const text = emailText(row.bodyHtml, row.bodyText ?? row.snippet);
    const mine = mailboxes.get(row.accountId);
    const rule =
      looksLikeInsight({ subject: row.subject, from: row.from, text }) ||
      looksLikeSecurity({ subject: row.subject, text }) ||
      (replies && looksLikeAsk({ from: row.from, text, toMe: row.to.some((p) => p.email.toLowerCase() === mine), personal: !!personal.get(row.threadId) }));
    const recent = isRecent(row.date);
    const look = firstLook({
      recent,
      rule,
      jev: jev === "yes" && left.triage <= toSort.length ? "capped" : jev,
      read: left.extract > toRead.length ? "yes" : "capped",
    });
    if (look === "nothing") checked.push(row.id);
    else if (look === "read") {
      // Unchecked until it's read: past this step's share, it waits for the next step.
      if (toRead.length < READ_PER_STEP) toRead.push(row);
    } else if (look === "sort") {
      const sender = senderOf(row.from);
      const m = memory.get(sender);
      if (skipBySender(m, { recent, rule })) {
        remember(sender, afterSkip(m!));
        checked.push(row.id);
        continue;
      }
      // A sender this step is still finding out about: the rest of their emails wait for the answer.
      if ((queued.get(sender) ?? 0) >= sortsBeforeKnown(m)) continue;
      if (recent && recentSorts >= RECENT_SORTS_PER_STEP) continue;
      if (recent) recentSorts++;
      queued.set(sender, (queued.get(sender) ?? 0) + 1);
      // The one in ten sorted anyway: the count starts over now, not when the answer comes.
      if (m && m.skipped) remember(sender, { ...m, skipped: 0 });
      toSort.push({ row, text, recent, rule, sender });
    }
    // "wait": over today's cap; it stays for tomorrow.
  }

  // Sorting: what Jev rules out is done; recent mail it doesn't goes on to be read; older mail may get a card without details.
  const sortTokens: AiTokens = { input: 0, cached: 0, output: 0 };
  let sorts = 0;
  let jevFailed = false;
  let next = 0;
  const sortWorker = async () => {
    while (!jevFailed && next < toSort.length) {
      const item = toSort[next++];
      const { row, text, recent, rule, sender } = item;
      try {
        const t = await triageWithJev({ ...redactSecrets(row.subject, text), from: row.from, date: row.date }, { replies });
        sorts++;
        sortTokens.input += t.inputTokens;
        jevDown = null;
        const sorted = afterSorting(t, { recent, replies });
        remember(sender, afterSort(memory.get(sender), sorted.kind === "nothing"));
        // A kind of card the user keeps hiding from this sender: not worth reading.
        const after = sorted.kind !== "nothing" && isHidden(row, t.category) ? { kind: "nothing" as const } : sorted;
        if (after.kind === "read") {
          if (toRead.length < READ_PER_STEP && left.extract > toRead.length) toRead.push(row);
          // Otherwise it stays unchecked and is sorted again next step (a fraction of a cent).
        } else {
          if (after.kind === "sorted") found.push({ row, data: sortedOnly(after.category, row), source: "jev" });
          checked.push(row.id);
        }
      } catch (err) {
        if (err instanceof JevUnavailable) {
          // Jev is down: recent mail the rules flag is read anyway; the rest waits for Jev to come back.
          jevFailed = true;
          noteJevDown(err);
          if (recent && rule && toRead.length < READ_PER_STEP && left.extract > toRead.length) toRead.push(row);
        } else {
          // Something about this email (Jev refused it): fall back to the rules.
          logWarn(`[insights] jev ${row.id}:`, err);
          if (recent && rule && toRead.length < READ_PER_STEP && left.extract > toRead.length) toRead.push(row);
          else checked.push(row.id);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: SORT_CONCURRENCY }, sortWorker));
  if (jevFailed) {
    // The ones nobody got to: recent mail the rules flag is read without sorting, the rest waits.
    for (const item of toSort.slice(next)) {
      if (item.recent && item.rule && toRead.length < READ_PER_STEP && left.extract > toRead.length) toRead.push(item.row);
    }
  }
  await recordUsage(userId, "triage", sorts, sortTokens);
  await saveMemory(userId, new Map([...changed].map((sender) => [sender, memory.get(sender)!])));

  // Reading: OpenAI fills in the card (amount, status, dates) for recent mail.
  await loadMissingBodies(userId, toRead);
  const readTokens: AiTokens = { input: 0, cached: 0, output: 0 };
  let reads = 0;
  let stop = false;
  let nextRead = 0;
  const readWorker = async () => {
    while (!stop && nextRead < toRead.length) {
      const row = toRead[nextRead++];
      try {
        const { data, tokens } = await extractWithAI(
          { ...redactSecrets(row.subject, emailText(row.bodyHtml, row.bodyText ?? row.snippet)), from: row.from, date: row.date },
          { replies },
        );
        reads++;
        readTokens.input += tokens.input;
        readTokens.cached += tokens.cached;
        readTokens.output += tokens.output;
        if (!data) nothing.push(row.id);
        else if (!isHidden(row, data.category)) found.push({ row, data, source: env.insightsModel });
        checked.push(row.id);
      } catch (err) {
        // Rate limit, OpenAI down or out of credit: leave the rest for the next step. Anything else: skip
        // this email, but keep a card an earlier reading made (a failed reading isn't a "nothing").
        const problem = accountProblem(err);
        if (problem) noteOpenAiProblem(problem, err);
        if (problem || isTransient(err)) stop = true;
        else {
          logWarn(`[insights] ${row.id}:`, err);
          checked.push(row.id);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: READ_CONCURRENCY }, readWorker));
  await recordUsage(userId, "extract", reads, readTokens);

  if (found.length) {
    await db()
      .insert(schema.insights)
      .values(
        found.map(({ row, data, source }) => {
          const { category, ref, ...rest } = data;
          return {
            userId,
            accountId: row.accountId,
            threadId: row.threadId,
            messageId: row.id,
            category,
            groupKey: insightKey(category, rest.merchant, ref, row.threadId, rest.order?.item),
            data: rest,
            source,
            at: row.date,
          };
        }),
      )
      // Reading mail again (a better prompt) replaces what an earlier reading said; "done" marks stay.
      .onConflictDoUpdate({
        target: schema.insights.messageId,
        set: {
          threadId: sql`excluded.thread_id`,
          category: sql`excluded.category`,
          groupKey: sql`excluded.group_key`,
          data: sql`excluded.data`,
          source: sql`excluded.source`,
          at: sql`excluded.at`,
        },
      });
  }
  // Read late (history, or "Awaiting my reply" just turned on): an ask already answered isn't waiting.
  await db().execute(sql`
    update ${schema.insights} i set done_at = now()
    where i.user_id = ${userId} and i.category = 'reply' and i.done_at is null
      and exists (select 1 from ${schema.messages} m where m.thread_id = i.thread_id and m.is_outgoing and m.date > i.at)`);
  if (nothing.length) {
    // An earlier reading may have called it an order; this one says it isn't (or it's in Trash now).
    // A card the user hid stays (hidden), so it still counts when deciding what they don't want.
    await db()
      .delete(schema.insights)
      .where(and(eq(schema.insights.userId, userId), inArray(schema.insights.messageId, nothing), isNull(schema.insights.dismissedAt)));
  }
  if (checked.length) {
    await db().update(schema.messages).set({ insightCheckedAt: new Date() }).where(inArray(schema.messages.id, checked));
  }
  return checked.length;
}

/** Older mail Jev filed without anyone reading it: the category and who sent it, no amounts or dates. */
function sortedOnly(category: Extracted["category"], row: Row): Extracted {
  return { category, merchant: senderLabel(row.from), amount: null, currency: null, ref: null };
}

/** Big IMAP messages arrive without a body; a candidate needs it, so fetch it now (and keep it, like opening it would). */
async function loadMissingBodies(userId: string, rows: Row[]) {
  const missing = rows.filter((r) => r.bodyHtml === null && r.bodyText === null);
  for (const accountId of new Set(missing.map((r) => r.accountId))) {
    const [account] = await db()
      .select(ACCOUNT_COLUMNS)
      .from(schema.accounts)
      .where(and(eq(schema.accounts.id, accountId), eq(schema.accounts.userId, userId)));
    if (!account) continue;
    await withAdapter(account, async (adapter) => {
      for (const m of missing.filter((r) => r.accountId === accountId)) {
        const body = await adapter.fetchBody({ providerMessageId: m.providerMessageId, imapPath: m.imapPath, imapUid: m.imapUid }).catch(() => null);
        if (!body) continue;
        m.bodyHtml = body.html;
        m.bodyText = body.text ?? "";
        await db().update(schema.messages).set({ bodyHtml: body.html, bodyText: body.text ?? "" }).where(eq(schema.messages.id, m.id));
      }
    }).catch((err) => logWarn(`[insights] bodies for ${accountId}:`, err));
  }
}
