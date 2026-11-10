import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withUser } from "@/server/auth/session";
import { parseBody } from "@/server/api/validate";
import { db, schema } from "@/server/db";
import { insightsProgress } from "@/server/insights/progress";

const Change = z.union([z.object({ key: z.string().min(1).max(300), done: z.boolean() }), z.object({ key: z.string().min(1).max(300), dismissed: z.boolean() })]);

/** How far smart categories are with the mail they're allowed to read (the first pass takes a while). */
export const GET = withUser(async (user) => Response.json(await insightsProgress(user.id), { headers: { "Cache-Control": "private, no-store" } }));

/**
 * Smart categories: mark a card done (the order arrived or was picked up, the bill is paid), or hide it
 * ("doesn't belong here"), or undo either. Every email of the card changes together.
 */
export const PATCH = withUser(async (user, req) => {
  const change = await parseBody(req, Change);
  const set = "done" in change ? { doneAt: change.done ? new Date() : null } : { dismissedAt: change.dismissed ? new Date() : null };
  await db()
    .update(schema.insights)
    .set(set)
    .where(and(eq(schema.insights.userId, user.id), eq(schema.insights.groupKey, change.key)));
  return Response.json({ ok: true });
});
