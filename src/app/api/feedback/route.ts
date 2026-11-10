import { readJson, userAgent } from "@/server/auth/http";
import { withUser } from "@/server/auth/session";
import { FeedbackBody, npsSeen, saveFeedback } from "@/server/feedback";
import { requestLocale } from "@/server/i18n";

/** Feedback from inside the app: the 0–10 answer, or an idea. */
export const POST = withUser(async (user, req) => {
  await saveFeedback(user, await readJson(req, FeedbackBody), { locale: requestLocale(req), userAgent: userAgent(req) });
  return Response.json({ ok: true }, { status: 201 });
});

/** The 0–10 question was dismissed: it comes back in a few months. */
export const DELETE = withUser(async (user) => {
  await npsSeen(user.id);
  return Response.json({ ok: true });
});
