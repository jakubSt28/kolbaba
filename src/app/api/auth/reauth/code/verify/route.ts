import { z } from "zod";
import { markReauthenticated } from "@/server/auth/devices";
import { verifyConfirmCode } from "@/server/auth/email-code";
import { assertSameOrigin, clearFlowCookie, FLOW_COOKIES, readFlowCookie, readJson } from "@/server/auth/http";
import { currentSessionId, withUser } from "@/server/auth/session";

const body = z.object({ code: z.string().trim().min(6).max(12) });

export const POST = withUser(async (user, req) => {
  assertSameOrigin(req);
  const { code } = await readJson(req, body);
  await verifyConfirmCode(user, await readFlowCookie(FLOW_COOKIES.confirmCode), code);
  await clearFlowCookie(FLOW_COOKIES.confirmCode);
  const session = await currentSessionId();
  if (session) await markReauthenticated(session);
  return Response.json({ ok: true });
});
