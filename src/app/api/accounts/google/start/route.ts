import { generateCodeVerifier, generateState } from "arctic";
import { cookies } from "next/headers";
import { pathCookie, SECURE_COOKIES } from "@/server/auth/cookie-name";
import { createChallenge } from "@/server/auth/challenges";
import { getUser } from "@/server/auth/session";
import { gmailAuthUrl } from "@/server/google";

const COOKIE = pathCookie("kolbaba_mailbox_oauth");

/** Start connecting a Gmail / Google Workspace mailbox. `?hint=` pre-fills the Google account picker. */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return Response.redirect(new URL("/login", req.url), 303);
  const hint = new URL(req.url).searchParams.get("hint") ?? undefined;
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const token = await createChallenge({ kind: "mailbox-oauth", challenge: state, userId: user.id, data: { codeVerifier } });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: SECURE_COOKIES,
    sameSite: "lax",
    path: "/api/accounts/google",
    maxAge: 600,
  });
  return Response.redirect(gmailAuthUrl({ state, codeVerifier, loginHint: hint }), 303);
}
