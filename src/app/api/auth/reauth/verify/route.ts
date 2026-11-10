import { z } from "zod";
import { markReauthenticated } from "@/server/auth/devices";
import { assertSameOrigin, FLOW_COOKIES, readJson, takeFlowCookie } from "@/server/auth/http";
import { finishReauth, relyingParty } from "@/server/auth/passkeys";
import { authenticationResponseSchema } from "@/server/auth/schemas";
import { currentSessionId, withUser } from "@/server/auth/session";

const body = z.object({ response: authenticationResponseSchema });

export const POST = withUser(async (user, req) => {
  assertSameOrigin(req);
  const { response } = await readJson(req, body);
  await finishReauth({ user, token: await takeFlowCookie(FLOW_COOKIES.passkeyLogin), response, rp: relyingParty(req.headers.get("origin")) });
  const session = await currentSessionId();
  if (session) await markReauthenticated(session);
  return Response.json({ ok: true });
});
