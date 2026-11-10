import { generateCodeVerifier, generateState } from "arctic";
import { cookies } from "next/headers";
import { pathCookie, SECURE_COOKIES } from "@/server/auth/cookie-name";
import { createChallenge } from "@/server/auth/challenges";
import { getUser } from "@/server/auth/session";
import { microsoftAuthUrl, microsoftEnabled } from "@/server/microsoft";

const COOKIE = pathCookie("kolbaba_mailbox_oauth");

/** Start connecting an Outlook.com / Hotmail or Microsoft 365 mailbox. `?hint=` pre-fills Microsoft's account picker. */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return Response.redirect(new URL("/login", req.url), 303);
  if (!microsoftEnabled()) return Response.redirect(new URL("/?connect_error=Outlook%20isn%27t%20available%20yet", req.url), 303);
  const hint = new URL(req.url).searchParams.get("hint") ?? undefined;
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const token = await createChallenge({ kind: "mailbox-oauth", challenge: state, userId: user.id, data: { codeVerifier } });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: SECURE_COOKIES,
    sameSite: "lax",
    path: "/api/accounts/microsoft",
    maxAge: 600,
  });
  return Response.redirect(microsoftAuthUrl({ state, codeVerifier, loginHint: hint }), 303);
}
