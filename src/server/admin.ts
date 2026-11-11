import "server-only";
import { and, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { plusState, type PlusState } from "@/lib/plus";
import { today } from "./ai-usage";
import { SESSION_MAX_DAYS } from "./auth/session";
import { db, schema } from "./db";
import { env } from "./env";
import { PLUS_COLUMNS } from "./plus";

/** The operator: emails in ADMIN_EMAILS may open /admin. */
export function isAdmin(email: string | null | undefined) {
  return !!email && env.adminEmails.includes(email.toLowerCase());
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  lastSeenAt: Date | null;
  /** The last MCP tool call of any connected agent, and the app it came from (e.g. "Claude Code"). */
  lastMcp: { at: Date; app: string } | null;
  mailboxes: { email: string; provider: string; status: string; lastSyncAt: Date | null }[];
  agents: number;
  passkeys: number;
  /** Devices signed in right now (live sessions, as in Settings → Account), and how many of them get push notifications. */
  devices: { signedIn: number; notifications: number };
  smartCategories: boolean;
  language: string | null;
  /** Estimated AI cost in USD (src/server/ai-usage.ts): today and the last 30 days. */
  ai: { today: number; month: number };
  plus: PlusState;
  /** Cards of the last 30 days, and how many of them the user hid as not belonging there. */
  cards: { month: number; hidden: number };
  /**
   * The calendar: when it was first opened (null: never), on how many of the last 30 days and when
   * last, how many calendars are connected and from where, and events made here in the last 30 days.
   */
  calendar: { firstOpenedAt: Date | null; lastOpenedAt: Date | null; days: number; opens: number; calendars: number; kinds: string[]; eventsMade: number };
}

export interface AdminOverview {
  users: AdminUser[];
  activeWeek: number;
  mailboxErrors: number;
  /** Net Promoter Score of the last 90 days (−100…100), with how many answered. */
  nps: { score: number | null; answers: number };
  feedback: { id: string; kind: "nps" | "idea"; score: number | null; text: string; contact: boolean; email: string | null; device: string | null; createdAt: Date }[];
  /** Estimated AI cost of everyone together, in USD. */
  ai: { today: number; month: number };
  /** Who has Plus: paying, given it by us, trying it. */
  plus: { paying: number; gifts: number; trials: number };
  /** Cards hidden as not belonging there, of all cards of the last 30 days: the measure of how good smart categories are. */
  cards: { month: number; hidden: number };
  /** The calendar: who ever opened it, who opened it in the last 7 and 30 days, who has a calendar connected. */
  calendar: { opened: number; week: number; month: number; connected: number };
  /** Who asked for a copy on their own server, newest first. */
  waitlist: { id: string; email: string; runsOn: "vps" | "home" | "unsure"; note: string; lang: string; ref: string | null; createdAt: Date }[];
}

const DAY = 24 * 3600 * 1000;

export async function adminOverview(): Promise<AdminOverview> {
  const since90 = new Date(Date.now() - 90 * DAY);
  const [users, mailboxes, scores, feedback, aiCosts, cardCounts, waitlist, calendarUse, calendarCounts] = await Promise.all([
    db()
      .select({
        id: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        createdAt: schema.users.createdAt,
        settings: schema.users.settings,
        ...PLUS_COLUMNS,
        // Correlated subqueries name their tables: drizzle leaves columns unqualified in sql``.
        lastSeenAt: sql<Date | null>`(select max(s.last_seen_at) from sessions s where s.user_id = users.id)`,
        lastMcpAt: sql<Date | null>`(select max(a.last_active_at) from agents a where a.user_id = users.id)`,
        lastMcpApp: sql<string | null>`(select a.app from agents a where a.user_id = users.id and a.last_active_at is not null order by a.last_active_at desc limit 1)`,
        agents: sql<number>`(select count(*) from agents a where a.user_id = users.id and a.enabled)::int`,
        passkeys: sql<number>`(select count(*) from passkeys p where p.user_id = users.id)::int`,
        devices: sql<number>`(select count(*) from sessions s where s.user_id = users.id and s.expires_at > now() and s.created_at > now() - make_interval(days => ${SESSION_MAX_DAYS}::int))::int`,
        // Per device, not per subscription: one session can hold two (a Mac's Safari and its Dock web app share the sign-in).
        notifications: sql<number>`(select count(distinct s.id) from push_subscriptions ps join sessions s on s.id = ps.session_id where ps.user_id = users.id and s.expires_at > now() and s.created_at > now() - make_interval(days => ${SESSION_MAX_DAYS}::int))::int`,
      })
      .from(schema.users)
      .orderBy(desc(schema.users.createdAt)),
    db()
      .select({
        userId: schema.accounts.userId,
        email: schema.accounts.email,
        provider: sql<string>`coalesce(nullif(${schema.accounts.providerLabel}, ''), ${schema.accounts.provider})`,
        status: schema.accounts.status,
        lastSyncAt: schema.accounts.lastSyncAt,
      })
      .from(schema.accounts)
      .orderBy(schema.accounts.createdAt),
    db()
      .select({ score: schema.feedback.score })
      .from(schema.feedback)
      .where(and(eq(schema.feedback.kind, "nps"), isNotNull(schema.feedback.score), gt(schema.feedback.createdAt, since90))),
    db()
      .select({
        id: schema.feedback.id,
        kind: schema.feedback.kind,
        score: schema.feedback.score,
        text: schema.feedback.text,
        contact: schema.feedback.contact,
        device: schema.feedback.device,
        createdAt: schema.feedback.createdAt,
        email: schema.users.email,
      })
      .from(schema.feedback)
      .leftJoin(schema.users, eq(schema.users.id, schema.feedback.userId))
      .orderBy(desc(schema.feedback.createdAt))
      .limit(50),
    db()
      .select({
        userId: schema.aiUsage.userId,
        today: sql<number>`coalesce(sum(${schema.aiUsage.costMicros}) filter (where ${schema.aiUsage.day} = ${today()}), 0)::bigint`,
        month: sql<number>`coalesce(sum(${schema.aiUsage.costMicros}), 0)::bigint`,
      })
      .from(schema.aiUsage)
      .where(gt(schema.aiUsage.day, new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10)))
      .groupBy(schema.aiUsage.userId),
    db()
      .select({
        userId: schema.insights.userId,
        month: sql<number>`count(*)::int`,
        hidden: sql<number>`count(*) filter (where ${schema.insights.dismissedAt} is not null)::int`,
      })
      .from(schema.insights)
      .where(gt(schema.insights.createdAt, new Date(Date.now() - 30 * DAY)))
      .groupBy(schema.insights.userId),
    db().select().from(schema.waitlist).orderBy(desc(schema.waitlist.createdAt)),
    // Opening the calendar and making an event are counted like any feature (src/lib/usage.ts), per day.
    db().execute<{ user_id: string; days: number; opens: number; last_day: string | null; week: number; events_made: number }>(sql`
      select user_id,
        count(*) filter (where feature = 'calOpen')::int as days,
        coalesce(sum(count) filter (where feature = 'calOpen'), 0)::int as opens,
        max(day) filter (where feature = 'calOpen')::text as last_day,
        count(*) filter (where feature = 'calOpen' and day > current_date - 7)::int as week,
        coalesce(sum(count) filter (where feature = 'calEventNew'), 0)::int as events_made
      from feature_usage
      where day > current_date - 30 and feature in ('calOpen', 'calEventNew')
      group by user_id`),
    db()
      .select({
        userId: schema.calendarSources.userId,
        calendars: sql<number>`count(${schema.calendars.id})::int`,
        kinds: sql<string[]>`array_agg(distinct ${schema.calendarSources.kind})`,
      })
      .from(schema.calendarSources)
      .leftJoin(schema.calendars, eq(schema.calendars.sourceId, schema.calendarSources.id))
      .groupBy(schema.calendarSources.userId),
  ]);
  const useByUser = new Map(calendarUse.map((u) => [u.user_id, u]));
  const calendarsByUser = new Map(calendarCounts.map((c) => [c.userId, c]));
  const cardsByUser = new Map(cardCounts.map((c) => [c.userId, { month: c.month, hidden: c.hidden }]));
  const usd = (micros: number | string) => Number(micros) / 1e6;
  const aiByUser = new Map(aiCosts.map((c) => [c.userId, { today: usd(c.today), month: usd(c.month) }]));

  const byUser = new Map<string, AdminUser["mailboxes"]>();
  for (const m of mailboxes) byUser.set(m.userId, [...(byUser.get(m.userId) ?? []), { email: m.email, provider: m.provider, status: m.status, lastSyncAt: m.lastSyncAt }]);

  const weekAgo = Date.now() - 7 * DAY;
  const list: AdminUser[] = users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    createdAt: u.createdAt,
    lastSeenAt: u.lastSeenAt ? new Date(u.lastSeenAt) : null,
    lastMcp: u.lastMcpAt ? { at: new Date(u.lastMcpAt), app: u.lastMcpApp ?? "" } : null,
    mailboxes: byUser.get(u.id) ?? [],
    agents: u.agents,
    passkeys: u.passkeys,
    devices: { signedIn: u.devices, notifications: u.notifications },
    smartCategories: !!u.settings.smartCategories,
    language: u.settings.locale ?? null,
    ai: aiByUser.get(u.id) ?? { today: 0, month: 0 },
    plus: plusState(u),
    cards: cardsByUser.get(u.id) ?? { month: 0, hidden: 0 },
    calendar: {
      firstOpenedAt: u.settings.calendar?.seenAt ? new Date(u.settings.calendar.seenAt) : null,
      lastOpenedAt: useByUser.get(u.id)?.last_day ? new Date(`${useByUser.get(u.id)!.last_day}T12:00:00Z`) : null,
      days: useByUser.get(u.id)?.days ?? 0,
      opens: useByUser.get(u.id)?.opens ?? 0,
      calendars: calendarsByUser.get(u.id)?.calendars ?? 0,
      kinds: calendarsByUser.get(u.id)?.kinds ?? [],
      eventsMade: useByUser.get(u.id)?.events_made ?? 0,
    },
  }));

  const answers = scores.map((s) => s.score as number);
  const promoters = answers.filter((s) => s >= 9).length;
  const detractors = answers.filter((s) => s <= 6).length;
  return {
    users: list,
    // Someone who only works through an agent is active too.
    activeWeek: list.filter((u) => [u.lastSeenAt, u.lastMcp?.at].some((d) => d && d.getTime() > weekAgo)).length,
    mailboxErrors: mailboxes.filter((m) => m.status === "auth_error" || m.status === "error").length,
    nps: { score: answers.length ? Math.round(((promoters - detractors) / answers.length) * 100) : null, answers: answers.length },
    feedback,
    ai: { today: list.reduce((sum, u) => sum + u.ai.today, 0), month: list.reduce((sum, u) => sum + u.ai.month, 0) },
    plus: {
      paying: list.filter((u) => u.plus.source === "subscription").length,
      gifts: list.filter((u) => u.plus.source === "gift").length,
      trials: list.filter((u) => u.plus.level === "trial").length,
    },
    cards: { month: list.reduce((sum, u) => sum + u.cards.month, 0), hidden: list.reduce((sum, u) => sum + u.cards.hidden, 0) },
    calendar: {
      opened: list.filter((u) => u.calendar.firstOpenedAt).length,
      week: calendarUse.filter((u) => u.week > 0).length,
      month: calendarUse.filter((u) => u.days > 0).length,
      connected: list.filter((u) => u.calendar.calendars > 0).length,
    },
    waitlist,
  };
}

/** /admin: give someone Plus for free, or take the gift back (a subscription isn't touched). */
export async function setPlusGift(userId: string, gift: boolean) {
  await db()
    .update(schema.users)
    .set({ plusGiftedAt: gift ? new Date() : null })
    .where(eq(schema.users.id, userId));
}
