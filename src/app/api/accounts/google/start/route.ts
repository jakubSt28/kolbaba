import { generateCodeVerifier, generateState } from "arctic";
import { cookies } from "next/headers";
import { pathCookie, SECURE_COOKIES } from "@/server/auth/cookie-name";
import { createChallenge } from "@/server/auth/challenges";
import { getUser } from "@/server/auth/session";
import { googleCalendarAuthUrl } from "@/server/calendar/google";
import { gmailAuthUrl } from "@/server/google";

const COOKIE = pathCookie("kolbaba_mailbox_oauth");

/**
 * Start connecting a Gmail / Google Workspace mailbox, or with `?calendar=1` that account's Google
 * Calendar (its own permission, asked for only then). `?hint=` pre-fills the Google account picker;
 * `?account=` is the mailbox the calendar is added for.
 */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return Response.redirect(new URL("/login", req.url), 303);
  const params = new URL(req.url).searchParams;
  const hint = params.get("hint") ?? undefined;
  const calendar = params.has("calendar");
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const token = await createChallenge({ kind: "mailbox-oauth", challenge: state, userId: user.id, data: { codeVerifier, calendar, accountId: params.get("account") } });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: SECURE_COOKIES,
    sameSite: "lax",
    path: "/api/accounts/google",
    maxAge: 600,
  });
  return Response.redirect((calendar ? googleCalendarAuthUrl : gmailAuthUrl)({ state, codeVerifier, loginHint: hint }), 303);
}
