import { createAccountWithCode } from "@/server/auth/email-code";
import { assertSameOrigin, FLOW_COOKIES, handle, readJson, takeFlowCookie, userAgent } from "@/server/auth/http";
import { safeNext } from "@/server/auth/safe-next";
import { createAccountBody } from "@/server/auth/schemas";
import { createSession } from "@/server/auth/session";
import { clientIp, limit, LIMITS } from "@/server/rate-limit";

/** A new address, proved with its code: the account, with the name the person gave, and they're in. */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const { name, next } = await readJson(req, createAccountBody);
  await limit(LIMITS.emailCodes(clientIp(req)));
  const user = await createAccountWithCode(await takeFlowCookie(FLOW_COOKIES.emailCode), name);
  await createSession(user.id, userAgent(req));
  return Response.json({ user, redirectTo: safeNext(next) }, { headers: { "Cache-Control": "no-store" } });
});
