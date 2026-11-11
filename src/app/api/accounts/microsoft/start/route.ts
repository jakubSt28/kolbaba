import { generateCodeVerifier, generateState } from "arctic";
import { cookies } from "next/headers";
import { pathCookie, SECURE_COOKIES } from "@/server/auth/cookie-name";
import { createChallenge } from "@/server/auth/challenges";
import { getUser } from "@/server/auth/session";
import { microsoftCalendarAuthUrl } from "@/server/calendar/microsoft";
import { microsoftAuthUrl, microsoftEnabled } from "@/server/microsoft";

const COOKIE = pathCookie("kolbaba_mailbox_oauth");

/**
 * Start connecting an Outlook.com / Hotmail or Microsoft 365 mailbox, or with `?calendar=1` that
 * account's calendar (its own permission). `?hint=` pre-fills Microsoft's account picker.
 */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return Response.redirect(new URL("/login", req.url), 303);
  if (!microsoftEnabled()) return Response.redirect(new URL("/?connect_error=Outlook%20isn%27t%20available%20yet", req.url), 303);
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
    path: "/api/accounts/microsoft",
    maxAge: 600,
  });
  return Response.redirect((calendar ? microsoftCalendarAuthUrl : microsoftAuthUrl)({ state, codeVerifier, loginHint: hint }), 303);
}
