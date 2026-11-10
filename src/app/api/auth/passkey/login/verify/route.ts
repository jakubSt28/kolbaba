import { assertSameOrigin, FLOW_COOKIES, handle, readJson, takeFlowCookie, userAgent } from "@/server/auth/http";
import { finishPasskeyLogin, relyingParty } from "@/server/auth/passkeys";
import { safeNext } from "@/server/auth/safe-next";
import { loginVerifyBody } from "@/server/auth/schemas";
import { createSession } from "@/server/auth/session";

export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const { response, next } = await readJson(req, loginVerifyBody);
  const token = await takeFlowCookie(FLOW_COOKIES.passkeyLogin);
  const user = await finishPasskeyLogin({ token, response, rp: relyingParty(req.headers.get("origin")) });
  await createSession(user.id, userAgent(req));
  return Response.json({ user, redirectTo: safeNext(next) }, { headers: { "Cache-Control": "no-store" } });
});
