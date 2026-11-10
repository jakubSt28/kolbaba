import { assertSameOrigin, FLOW_COOKIES, setFlowCookie } from "@/server/auth/http";
import { relyingParty, startReauth } from "@/server/auth/passkeys";
import { withUser } from "@/server/auth/session";

/** "Confirm it's you" before deleting the account: one of this account's passkeys, right now. */
export const POST = withUser(async (user, req) => {
  assertSameOrigin(req);
  const { options, token } = await startReauth(user, relyingParty(req.headers.get("origin")));
  await setFlowCookie(FLOW_COOKIES.passkeyLogin, token);
  return Response.json({ options }, { headers: { "Cache-Control": "no-store" } });
});
