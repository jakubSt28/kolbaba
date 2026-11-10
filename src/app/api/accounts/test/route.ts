import { translate } from "@/lib/i18n";
import { assertSameOrigin, readJson } from "@/server/auth/http";
import { withUser } from "@/server/auth/session";
import { detectMailSettings, testConnection, type TestConnectionResult } from "@/server/autodetect";
import { testBody } from "@/server/autodetect/schemas";
import { requestLocale } from "@/server/i18n";
import { clientIp, limit, LIMITS } from "@/server/rate-limit";

/**
 * POST { email, password, imap?, smtp? } → TestConnectionResult. Servers the client leaves out are
 * detected first, so the simple form only needs email + password.
 */
export const POST = withUser(async (user, req) => {
  assertSameOrigin(req);
  const { email, password, ...given } = await readJson(req, testBody);
  await limit(...LIMITS.mailboxTest(user.id, clientIp(req)));
  const locale = requestLocale(req);
  let { imap, smtp } = given;
  if (!imap || !smtp) {
    const detected = await detectMailSettings(email, { locale });
    if (!detected.supported || detected.method !== "password") {
      return Response.json({
        ok: false,
        reason: "unsupported",
        message:
          detected.message ??
          translate(locale, "{provider} accounts connect with “Sign in with {via}”, not a password.", {
            provider: detected.providerLabel,
            via: detected.provider === "gmail" ? "Google" : detected.providerLabel,
          }),
      } satisfies TestConnectionResult);
    }
    imap ??= detected.imap;
    smtp ??= detected.smtp;
  }
  if (!imap || !smtp) {
    return Response.json({
      ok: false,
      reason: "servers_unknown",
      message: translate(locale, "We couldn't find the mail servers for this address. Enter them below."),
    } satisfies TestConnectionResult);
  }
  return Response.json(await testConnection({ email, password, imap, smtp, locale }));
});
