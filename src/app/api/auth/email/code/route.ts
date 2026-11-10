import { assertSameOrigin, FLOW_COOKIES, handle, readJson, setFlowCookie } from "@/server/auth/http";
import { EMAIL_CODE_TTL_MS, sendEmailCode } from "@/server/auth/email-code";
import { emailCodeBody } from "@/server/auth/schemas";
import { requestLocale } from "@/server/i18n";
import { clientIp } from "@/server/rate-limit";

/** "Continue with email": a 6-digit code to that address, for signing in or creating an account alike. */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const { email } = await readJson(req, emailCodeBody);
  const token = await sendEmailCode({ email, ip: clientIp(req), locale: requestLocale(req) });
  await setFlowCookie(FLOW_COOKIES.emailCode, token, EMAIL_CODE_TTL_MS);
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
});
