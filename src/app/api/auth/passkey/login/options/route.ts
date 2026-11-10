import { assertSameOrigin, FLOW_COOKIES, handle, setFlowCookie } from "@/server/auth/http";
import { relyingParty, startPasskeyLogin } from "@/server/auth/passkeys";
import { clientIp, limit, LIMITS } from "@/server/rate-limit";

/** Sign-in options for discoverable credentials (button press or browser autofill). */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  await limit(LIMITS.signIn(clientIp(req)));
  const { options, token } = await startPasskeyLogin(relyingParty(req.headers.get("origin")));
  await setFlowCookie(FLOW_COOKIES.passkeyLogin, token);
  return Response.json({ options }, { headers: { "Cache-Control": "no-store" } });
});
