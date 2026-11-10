import { NextResponse, type NextRequest } from "next/server";
import { LEGACY_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME } from "./server/auth/cookie-name";

/**
 * Optimistic gate for the app shell: in live mode, a visit without a session cookie goes to /login.
 * This only checks that the cookie exists (no DB in the proxy); the real check is `requireUser()` in
 * the data layer, and `/api/auth/me` clears a stale cookie. Mock mode (the default) is untouched.
 */
export function proxy(request: NextRequest) {
  if (process.env.NEXT_PUBLIC_DATA_MODE !== "live") return NextResponse.next();
  if (request.method !== "GET" && request.method !== "HEAD") return NextResponse.next();
  if (request.cookies.has(SESSION_COOKIE_NAME) || request.cookies.has(LEGACY_SESSION_COOKIE_NAME)) return NextResponse.next();

  const url = request.nextUrl.clone();
  const next = request.nextUrl.pathname + request.nextUrl.search;
  url.pathname = "/login";
  url.search = "";
  if (next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    /*
     * Pages only. Skipped: API routes (tracking pixel, webhooks, MCP, auth), Next internals, the login
     * page, OAuth authorize pages, .well-known, the service worker, manifest, icons and any file with
     * an extension (static assets).
     */
    "/((?!api/|_next/|login|oauth/|\\.well-known/|sw\\.js|manifest\\.webmanifest|icon|apple-icon|pwa-icon|favicon\\.ico|.*\\.[A-Za-z0-9]+$).*)",
  ],
};
