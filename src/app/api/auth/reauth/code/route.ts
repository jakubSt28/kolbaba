import { sendConfirmCode, EMAIL_CODE_TTL_MS } from "@/server/auth/email-code";
import { assertSameOrigin, FLOW_COOKIES, setFlowCookie } from "@/server/auth/http";
import { withUser } from "@/server/auth/session";
import { requestLocale } from "@/server/i18n";

/** "Confirm it's you" before deleting the account, without a passkey: a code to the account's address. */
export const POST = withUser(async (user, req) => {
  assertSameOrigin(req);
  const token = await sendConfirmCode(user, requestLocale(req));
  await setFlowCookie(FLOW_COOKIES.confirmCode, token, EMAIL_CODE_TTL_MS);
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
});
