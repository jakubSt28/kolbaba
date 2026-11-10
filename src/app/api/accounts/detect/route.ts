import { assertSameOrigin, readJson } from "@/server/auth/http";
import { withUser } from "@/server/auth/session";
import { detectMailSettings } from "@/server/autodetect";
import { detectBody } from "@/server/autodetect/schemas";
import { requestLocale } from "@/server/i18n";
import { limit, LIMITS } from "@/server/rate-limit";

/** POST { email } → Detection: which provider and servers to use for this address. */
export const POST = withUser(async (user, req) => {
  assertSameOrigin(req);
  const { email } = await readJson(req, detectBody);
  await limit(LIMITS.mailboxDetect(user.id));
  return Response.json(await detectMailSettings(email, { locale: requestLocale(req) }));
});
