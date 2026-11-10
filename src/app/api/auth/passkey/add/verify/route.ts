import { assertSameOrigin, FLOW_COOKIES, readJson, takeFlowCookie, userAgent } from "@/server/auth/http";
import { finishAddPasskey, relyingParty } from "@/server/auth/passkeys";
import { registerVerifyBody } from "@/server/auth/schemas";
import { withUser } from "@/server/auth/session";

export const POST = withUser(async (user, req) => {
  assertSameOrigin(req);
  const { response } = await readJson(req, registerVerifyBody);
  const token = await takeFlowCookie(FLOW_COOKIES.passkeyRegister);
  const passkey = await finishAddPasskey({ user, token, response, rp: relyingParty(req.headers.get("origin")), userAgent: userAgent(req) });
  return Response.json({ passkey }, { status: 201 });
});
