import { after } from "next/server";
import { z } from "zod";
import { translate } from "@/lib/i18n";
import { withUser } from "@/server/auth/session";
import { parseBody } from "@/server/api/validate";
import { requestLocale } from "@/server/i18n";
import { queueSend } from "@/server/mail/service";
import { claimOne, sendClaimed } from "@/server/sync/outbox";
import { hasWorker, nudgeWorker } from "@/server/worker-client";

type Ctx = RouteContext<"/api/drafts/[id]/send">;

/** Long enough to sit out the undo window and send without a worker. */
export const maxDuration = 60;

const Body = z.object({
  scheduleAt: z.number().optional(),
  track: z.boolean().optional(),
  followUpDays: z.number().int().min(1).max(60).optional(),
});

export const POST = withUser<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, Body);
  if (body.scheduleAt && body.scheduleAt < Date.now() - 60_000) {
    return Response.json({ error: translate(requestLocale(req), "That time is in the past") }, { status: 400 });
  }
  const row = await queueSend(user.id, id, {
    scheduleAt: body.scheduleAt ? new Date(body.scheduleAt) : undefined,
    track: body.track,
    followUpDays: body.followUpDays,
  });

  if (hasWorker()) {
    await nudgeWorker({ kind: "outbox" });
  } else if (!row.scheduled) {
    // No worker yet: wait out the undo window here, then send unless it was cancelled meanwhile.
    after(async () => {
      await new Promise((r) => setTimeout(r, Math.max(0, row.sendAt.getTime() - Date.now()) + 250));
      const claimed = await claimOne(row.id);
      if (claimed) await sendClaimed(claimed);
    });
  }
  return Response.json({ outboxId: row.id, sendAt: row.sendAt.getTime(), scheduled: row.scheduled });
});
