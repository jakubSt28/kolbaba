import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { translate, type Locale } from "@/lib/i18n";
import { hashToken, randomToken } from "../crypto";
import { db, schema } from "../db";
import { HttpError } from "../http-error";
import { requestLocale } from "../i18n";
import { LEGACY_SESSION_COOKIE_NAME, SECURE_COOKIES, SESSION_COOKIE_NAME } from "./cookie-name";
import { assertSameOrigin } from "./origin";
import { logError } from "../log";

export { HttpError };

export const SESSION_COOKIE = SESSION_COOKIE_NAME;
const DAY = 24 * 3600 * 1000;
const SESSION_DAYS = 60;
/** Sliding expiry: extend the session when it's used and less than this much is left. */
const REFRESH_WHEN_LEFT_MS = 30 * DAY;
/** However much it's used, a session ends this long after sign-in (a stolen cookie doesn't live forever). */
export const SESSION_MAX_DAYS = 180;
/** "Last active" in the device list is kept to the hour; no write on every request. */
const SEEN_EVERY_MS = 3600 * 1000;

type Jar = Awaited<ReturnType<typeof cookies>>;

function setSessionCookie(jar: Jar, token: string, expires: Date) {
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: SECURE_COOKIES,
    sameSite: "lax",
    path: "/",
    expires,
  });
}

/** The session token, from the cookie or (signed in before the rename) from the old one. */
function sessionToken(jar: Jar): { token: string; legacy: boolean } | null {
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) return { token, legacy: false };
  const old = SESSION_COOKIE !== LEGACY_SESSION_COOKIE_NAME ? jar.get(LEGACY_SESSION_COOKIE_NAME)?.value : undefined;
  return old ? { token: old, legacy: true } : null;
}

/** A cookie goes away only when cleared with the attributes it was set with (a __Host- one needs Secure and path /). */
const expire = (jar: Jar, name: string) => jar.set(name, "", { httpOnly: true, secure: SECURE_COOKIES, sameSite: "lax", path: "/", maxAge: 0 });

/** Both names go: signing out must not leave the old cookie behind. */
export function clearSessionCookies(jar: Jar) {
  if (jar.has(SESSION_COOKIE)) expire(jar, SESSION_COOKIE);
  if (SESSION_COOKIE !== LEGACY_SESSION_COOKIE_NAME && jar.has(LEGACY_SESSION_COOKIE_NAME)) expire(jar, LEGACY_SESSION_COOKIE_NAME);
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export async function createSession(userId: string, userAgent?: string | null) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY);
  await db()
    .insert(schema.sessions)
    .values({ id: hashToken(token), userId, expiresAt, userAgent: userAgent ?? null, lastSeenAt: new Date() });
  setSessionCookie(await cookies(), token, expiresAt);
}

/** The signed-in session's id (sha256 of the cookie), for "this device" and re-authentication. */
export async function currentSessionId(): Promise<string | null> {
  const found = sessionToken(await cookies());
  return found ? hashToken(found.token) : null;
}

export async function destroySession() {
  const jar = await cookies();
  const found = sessionToken(jar);
  if (found) await db().delete(schema.sessions).where(eq(schema.sessions.id, hashToken(found.token)));
  clearSessionCookies(jar);
}

/** The signed-in user, or null. Reads the request cookie, so call it at request time only. */
export async function getUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const found = sessionToken(jar);
  if (!found) return null;
  const { token } = found;
  const id = hashToken(token);
  const now = Date.now();
  const [row] = await db()
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      avatarUrl: schema.users.avatarUrl,
      expiresAt: schema.sessions.expiresAt,
      createdAt: schema.sessions.createdAt,
      lastSeenAt: schema.sessions.lastSeenAt,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(
      and(
        eq(schema.sessions.id, id),
        gt(schema.sessions.expiresAt, new Date(now)),
        gt(schema.sessions.createdAt, new Date(now - SESSION_MAX_DAYS * DAY)),
      ),
    )
    .limit(1);
  if (!row) return null;
  // Signed in before the rename: the same session moves to the new cookie (Server Components can't set cookies; an API call will).
  if (found.legacy) {
    try {
      setSessionCookie(jar, token, row.expiresAt);
      expire(jar, LEGACY_SESSION_COOKIE_NAME);
    } catch {}
  }
  const renew = row.expiresAt.getTime() - now < REFRESH_WHEN_LEFT_MS;
  if (renew || !row.lastSeenAt || now - row.lastSeenAt.getTime() > SEEN_EVERY_MS) {
    const expiresAt = renew ? new Date(Math.min(now + SESSION_DAYS * DAY, row.createdAt.getTime() + SESSION_MAX_DAYS * DAY)) : row.expiresAt;
    await db().update(schema.sessions).set({ expiresAt, lastSeenAt: new Date(now) }).where(eq(schema.sessions.id, id));
    // The cookie follows the session; Server Components can't set cookies, the next API call will.
    if (renew) {
      try {
        setSessionCookie(jar, token, expiresAt);
      } catch {}
    }
  }
  return { id: row.id, email: row.email, name: row.name, avatarUrl: row.avatarUrl };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) throw new HttpError(401, "Sign in to continue", "unauthenticated");
  return user;
}

/**
 * Wrap a route handler: resolves the user, turns HttpError into a JSON error response.
 * Usage: `export const GET = withUser(async (user, req, ctx) => Response.json(...))`.
 */
export function withUser<C = unknown>(
  handler: (user: SessionUser, req: Request, ctx: C) => Promise<Response>,
) {
  return async (req: Request, ctx: C) => {
    try {
      // Every change must come from the app's own pages: SameSite=Lax doesn't stop sibling subdomains.
      if (req.method !== "GET" && req.method !== "HEAD") assertSameOrigin(req);
      return await handler(await requireUser(), req, ctx);
    } catch (err) {
      // While `next build` prerenders a GET handler, cookies() rejects on purpose; let Next see that.
      unstable_rethrow(err);
      return errorResponse(err, requestLocale(req));
    }
  };
}

/** HttpError → its message in the reader's language; anything else → logged, generic 500. */
export function errorResponse(err: unknown, locale: Locale) {
  if (err instanceof HttpError) {
    return Response.json({ error: translate(locale, err.text, err.vars), code: err.code }, { status: err.status });
  }
  logError("[api]", err);
  return Response.json({ error: translate(locale, "Something went wrong on our side") }, { status: 500 });
}
