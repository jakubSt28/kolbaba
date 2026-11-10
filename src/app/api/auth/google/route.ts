import { NextResponse, type NextRequest } from "next/server";
import { startGoogleSignIn } from "@/server/auth/google-signin";
import { FLOW_COOKIES, setFlowCookie } from "@/server/auth/http";
import { safeNext } from "@/server/auth/safe-next";
import { getUser, HttpError } from "@/server/auth/session";
import { logError } from "@/server/log";
import { clientIp, limit, LIMITS } from "@/server/rate-limit";

/**
 * GET /api/auth/google?next=/path — start "Continue with Google".
 * GET /api/auth/google?link=1 — connect Google to the signed-in account (from Settings).
 */
export async function GET(req: NextRequest) {
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  const link = req.nextUrl.searchParams.get("link") === "1";
  try {
    await limit(LIMITS.signIn(clientIp(req)));
    const user = link ? await getUser() : null;
    if (link && !user) throw new HttpError(401, "Sign in to continue", "unauthenticated");
    const { url, token } = await startGoogleSignIn({ next, linkUserId: user?.id });
    await setFlowCookie(FLOW_COOKIES.google, token);
    return NextResponse.redirect(url, 302);
  } catch (err) {
    if (!(err instanceof HttpError)) logError("[google sign-in]", err);
    const code = err instanceof HttpError ? (err.code ?? "google_failed") : "google_unavailable";
    const to = new URL("/login", req.url);
    to.searchParams.set("error", code);
    if (next !== "/") to.searchParams.set("next", next);
    return NextResponse.redirect(to, 302);
  }
}
