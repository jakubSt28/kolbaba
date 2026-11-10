import { and, eq, gt, isNotNull, sql } from "drizzle-orm";
import { resetAwayReplies } from "@/server/mail/away";
import { z } from "zod";
import { awayRepliesOf, MAX_AWAY_REPLIES } from "@/lib/away";
import { ACCENT_IDS } from "@/lib/brand";
import { LANGUAGE_SETTINGS } from "@/lib/i18n";
import { SECTION_ORDER } from "@/lib/sidebar-layout";
import { BADGE_MODES, SWIPE_ACTIONS } from "@/lib/types";
import { withUser } from "@/server/auth/session";
import { parseBody } from "@/server/api/validate";
import { db, schema } from "@/server/db";
import { requirePlus } from "@/server/plus";

const Settings = z.object({
  density: z.enum(["comfortable", "compact"]).optional(),
  accent: z.enum(ACCENT_IDS).optional(),
  trackByDefault: z.boolean().optional(),
  openMailbox: z.string().min(1).max(64).optional(),
  loadRemoteImages: z.boolean().optional(),
  imagesExplained: z.boolean().optional(),
  undoSendSeconds: z.number().int().min(0).max(30).optional(),
  theme: z.enum(["auto", "light", "dark"]).optional(),
  smartCategories: z.boolean().optional(),
  replyReminders: z.boolean().optional(),
  screener: z.boolean().optional(),
  summaries: z.boolean().optional(),
  swipeLeft: z.enum(SWIPE_ACTIONS).optional(),
  swipeRight: z.enum(SWIPE_ACTIONS).optional(),
  language: z.enum(LANGUAGE_SETTINGS).optional(),
  locale: z.enum(["en", "cs"]).optional(),
  newsSeen: z.string().max(60).optional(),
  tried: z.array(z.string().max(30)).max(40).optional(),
  tipShownAt: z.number().optional(),
  passkeyOfferedAt: z.number().optional(),
  stamps: z
    .record(z.string().max(30), z.number())
    .refine((o) => Object.keys(o).length <= 40)
    .optional(),
  stampCounts: z
    .record(z.string().max(30), z.number().int().min(0).max(1_000_000))
    .refine((o) => Object.keys(o).length <= 20)
    .optional(),
  zeroDays: z.array(z.string().max(10)).max(7).optional(),
  postcards: z
    .record(z.string().max(48), z.string().max(16))
    .refine((o) => Object.keys(o).length <= 80)
    .optional(),
  stampsOff: z.boolean().optional(),
  stampsSeen: z.number().optional(),
  stampShownAt: z.number().optional(),
  quietHours: z
    .object({
      on: z.boolean(),
      from: z.string().regex(/^\d{1,2}:\d{2}$/),
      to: z.string().regex(/^\d{1,2}:\d{2}$/),
      tz: z.string().max(64),
    })
    .optional(),
  badge: z.enum(BADGE_MODES).optional(),
  bundles: z.boolean().optional(),
  codeInNotification: z.boolean().optional(),
  awayReplies: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        name: z.string().max(80),
        on: z.boolean(),
        from: z.number().nullable(),
        until: z.number().nullable(),
        subject: z.string().max(200),
        message: z.string().max(4000),
        accountIds: z.array(z.string().max(64)).max(50),
        onlyKnown: z.boolean(),
      }),
    )
    .max(MAX_AWAY_REPLIES)
    .optional(),
  sidebar: z
    .object({
      sections: z.array(z.enum(SECTION_ORDER)).max(SECTION_ORDER.length).optional(),
      order: z.partialRecord(z.enum(SECTION_ORDER), z.array(z.string().max(80)).max(200)).optional(),
      hidden: z.array(z.string().max(80)).max(200).optional(),
    })
    .optional(),
});

export const PATCH = withUser(async (user, req) => {
  const patch = await parseBody(req, Settings);
  const [row] = await db().select({ settings: schema.users.settings }).from(schema.users).where(eq(schema.users.id, user.id));
  // Turning on a Plus feature starts the 14-day trial; after it, it needs Plus.
  if ((patch.smartCategories && !row?.settings.smartCategories) || (patch.replyReminders && !row?.settings.replyReminders)) await requirePlus(user.id);
  const settings = { ...row?.settings, ...patch };
  // Two devices can earn stamps at the same time: keep every stamp (from when it was first earned) and the higher counts.
  if (patch.stamps) settings.stamps = mergeMin(row?.settings.stamps, patch.stamps);
  if (patch.stampCounts) settings.stampCounts = mergeMax(row?.settings.stampCounts, patch.stampCounts);
  if (patch.postcards) settings.postcards = { ...patch.postcards, ...row?.settings.postcards };
  // Someone who picked in Settings knows why images are hidden.
  if (patch.loadRemoteImages !== undefined) settings.imagesExplained = true;
  // Everyone whose mail is already here counts as known; only people new from now on wait.
  if (patch.screener && !row?.settings.screener) settings.screenerSince = Date.now();
  // Mailboxes that start answering now: everyone who wrote last time gets the new reply too.
  const startAnswering: string[] = [];
  if (patch.awayReplies) {
    const before = awayRepliesOf(row?.settings ?? {}, []);
    const answering = new Set(before.filter((r) => r.on).flatMap((r) => r.accountIds));
    const taken = new Set<string>();
    settings.awayReplies = patch.awayReplies.map((r) => {
      // One reply per mailbox (the app keeps them apart; this is the guard).
      const accountIds = r.on ? r.accountIds.filter((id) => !taken.has(id)) : r.accountIds;
      const on = r.on && accountIds.length > 0;
      if (on) accountIds.forEach((id) => taken.add(id));
      if (on) startAnswering.push(...accountIds.filter((id) => !answering.has(id)));
      // "From now on": now is when it was turned on (mail from before gets no reply).
      const was = before.find((b) => b.id === r.id);
      const from = on && !r.from ? (was?.on && was.from ? was.from : Date.now()) : r.from;
      return { ...r, on, accountIds, from };
    });
    delete settings.away;
  }
  await db().update(schema.users).set({ settings }).where(eq(schema.users.id, user.id));
  if (startAnswering.length) await resetAwayReplies(user.id, startAnswering);
  if (patch.smartCategories === false && row?.settings.smartCategories) {
    // Consent withdrawn: what was pulled out goes, and turning it on again starts over.
    await db().delete(schema.insights).where(eq(schema.insights.userId, user.id));
    await db()
      .update(schema.messages)
      .set({ insightCheckedAt: null })
      .where(and(eq(schema.messages.userId, user.id), isNotNull(schema.messages.insightCheckedAt)));
  }
  if (patch.replyReminders === false && row?.settings.replyReminders) {
    await db().delete(schema.insights).where(and(eq(schema.insights.userId, user.id), eq(schema.insights.category, "reply")));
  }
  if (patch.replyReminders && !row?.settings.replyReminders) {
    // The last month's mail from people gets a reading; what already had a card doesn't need one.
    await db()
      .update(schema.messages)
      .set({ insightCheckedAt: null })
      .where(
        and(
          eq(schema.messages.userId, user.id),
          gt(schema.messages.date, new Date(Date.now() - 30 * 24 * 3600_000)),
          sql`not exists (select 1 from ${schema.insights} i where i.message_id = ${schema.messages.id})`,
        ),
      );
  }
  return Response.json(settings);
});

function mergeMin(a: Record<string, number> = {}, b: Record<string, number>) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = k in out ? Math.min(out[k], v) : v;
  return out;
}

function mergeMax(a: Record<string, number> = {}, b: Record<string, number>) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, v);
  return out;
}
