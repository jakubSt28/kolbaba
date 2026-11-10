import { verifyEmailCode } from "@/server/auth/email-code";
import { assertSameOrigin, clearFlowCookie, FLOW_COOKIES, handle, readFlowCookie, readJson, userAgent } from "@/server/auth/http";
import { safeNext } from "@/server/auth/safe-next";
import { codeBody } from "@/server/auth/schemas";
import { createSession } from "@/server/auth/session";

/** The code from the email: signs in the account with that address, or lets this browser create one. */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const { code, next } = await readJson(req, codeBody);
  const { user } = await verifyEmailCode(await readFlowCookie(FLOW_COOKIES.emailCode), code);
  if (!user) return Response.json({ newAccount: true }, { headers: { "Cache-Control": "no-store" } });
  await clearFlowCookie(FLOW_COOKIES.emailCode);
  await createSession(user.id, userAgent(req));
  return Response.json({ user, redirectTo: safeNext(next) }, { headers: { "Cache-Control": "no-store" } });
});
