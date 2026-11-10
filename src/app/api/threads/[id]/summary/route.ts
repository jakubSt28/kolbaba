import { withUser } from "@/server/auth/session";
import { env } from "@/server/env";
import { HttpError } from "@/server/http-error";
import { requestLocale } from "@/server/i18n";
import { summarizeThread } from "@/server/insights/summary";
import { requirePlus } from "@/server/plus";
import { limit, LIMITS } from "@/server/rate-limit";
import type { ThreadSummary } from "@/lib/types";
import { askWorker, hasWorker } from "@/server/worker-client";

export const maxDuration = 90;

type Ctx = { params: Promise<{ id: string }> };

/** Sum up a conversation (on request). The OpenAI key lives on the worker; without one here, it does the work. */
export const POST = withUser<Ctx>(async (user, req, ctx) => {
  const { id } = await ctx.params;
  const locale = requestLocale(req);
  await limit(LIMITS.summary(user.id));
  // Part of Plus: the first summary starts the trial.
  await requirePlus(user.id);
  if (env.hasOpenAI) return Response.json(await summarizeThread(user.id, id, locale));
  if (!hasWorker()) throw new HttpError(503, "Summaries aren't available right now.", "unavailable");
  return Response.json(await askWorker<ThreadSummary>("/summarize", { userId: user.id, threadId: id, locale }, 80_000));
});
