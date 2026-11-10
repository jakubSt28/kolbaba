import { NextResponse, type NextRequest } from "next/server";
import { finishGoogleSignIn } from "@/server/auth/google-signin";
import { FLOW_COOKIES, takeFlowCookie, userAgent } from "@/server/auth/http";
import { createSession, HttpError } from "@/server/auth/session";
import { logError } from "@/server/log";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const token = await takeFlowCookie(FLOW_COOKIES.google);
  const fail = (code: string) => NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(code)}`, req.url), 302);

  // The user closed the consent screen or picked "Cancel".
  if (params.get("error")) return fail(params.get("error") === "access_denied" ? "google_cancelled" : "google_failed");

  let destination: string;
  try {
    const { user, next } = await finishGoogleSignIn({ token, state: params.get("state"), code: params.get("code") });
    await createSession(user.id, userAgent(req));
    destination = next;
  } catch (err) {
    if (!(err instanceof HttpError)) logError("[google sign-in]", err);
    return fail(err instanceof HttpError ? (err.code ?? "google_failed") : "google_failed");
  }
  return NextResponse.redirect(new URL(destination, req.url), 302);
}
