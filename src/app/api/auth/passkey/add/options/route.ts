import { assertSameOrigin, FLOW_COOKIES, setFlowCookie } from "@/server/auth/http";
import { relyingParty, startAddPasskey } from "@/server/auth/passkeys";
import { withUser } from "@/server/auth/session";

/** "Add passkey" from inside the app (another device, or a passkey for a Google-only account). */
export const POST = withUser(async (user, req) => {
  assertSameOrigin(req);
  const { options, token } = await startAddPasskey(user, relyingParty(req.headers.get("origin")));
  await setFlowCookie(FLOW_COOKIES.passkeyRegister, token);
  return Response.json({ options }, { headers: { "Cache-Control": "no-store" } });
});
