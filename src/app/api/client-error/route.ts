import { assertSameOrigin, handle, readJson, userAgent } from "@/server/auth/http";
import { getUser } from "@/server/auth/session";
import { ClientErrorBody, formatClientError } from "@/server/client-errors";
import { HttpError } from "@/server/http-error";
import { clientIp, limit, LIMITS } from "@/server/rate-limit";

/**
 * What crashed the app on someone's device, from its error screen (src/lib/report-crash.ts), into the
 * server log, so it can be found without their devtools. Signed out too (sign-in can crash as well);
 * capped per person or address so it can't flood the log.
 */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const report = await readJson(req, ClientErrorBody);
  const user = await getUser().catch(() => null);
  try {
    await limit(LIMITS.clientErrors(user ? `user:${user.id}` : `ip:${clientIp(req)}`));
  } catch (err) {
    // Over the cap: dropped quietly. Anything else (the database is down, say) mustn't lose the report.
    if (err instanceof HttpError) return new Response(null, { status: 204 });
  }
  console.error(formatClientError(report, { userId: user?.id ?? null, userAgent: userAgent(req) }));
  return new Response(null, { status: 204 });
});
