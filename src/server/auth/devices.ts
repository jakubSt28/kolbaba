import "server-only";
import { and, desc, eq, gt, inArray, like, ne } from "drizzle-orm";
import { db, schema } from "../db";
import { HttpError } from "../http-error";
import { passkeyLabel } from "./passkeys";
import { SESSION_MAX_DAYS } from "./session";

/**
 * Settings → Account: where you're signed in and which passkeys can sign you in. Sessions are listed
 * by a short prefix of their hash, never the hash itself (it's what the cookie maps to).
 */

const PUBLIC_ID = 16;
/** Re-authentication counts for this long before deleting the account. */
export const REAUTH_FRESH_MS = 5 * 60_000;

export function browserName(ua: string | null | undefined) {
  const s = ua ?? "";
  if (/Edg\//.test(s)) return "Edge";
  if (/Firefox\/|FxiOS/.test(s)) return "Firefox";
  if (/Chrome\/|CriOS/.test(s)) return "Chrome";
  if (/Safari\//.test(s)) return "Safari";
  return null;
}

export interface DeviceSession {
  id: string;
  /** "iPhone", "Mac"… (English; the app translates the known ones). */
  device: string;
  browser: string | null;
  createdAt: number;
  lastSeenAt: number;
  current: boolean;
}

export async function listSessions(userId: string, currentId: string | null): Promise<DeviceSession[]> {
  const rows = await db()
    .select()
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.userId, userId),
        gt(schema.sessions.expiresAt, new Date()),
        gt(schema.sessions.createdAt, new Date(Date.now() - SESSION_MAX_DAYS * 24 * 3600_000)),
      ),
    )
    .orderBy(desc(schema.sessions.lastSeenAt));
  return rows
    .map((r) => ({
      id: r.id.slice(0, PUBLIC_ID),
      device: passkeyLabel(r.userAgent) === "Passkey" ? "Unknown device" : passkeyLabel(r.userAgent),
      browser: browserName(r.userAgent),
      createdAt: r.createdAt.getTime(),
      lastSeenAt: (r.lastSeenAt ?? r.createdAt).getTime(),
      current: r.id === currentId,
    }))
    .sort((a, b) => Number(b.current) - Number(a.current));
}

export async function revokeSession(userId: string, publicId: string, currentId: string | null) {
  if (!/^[\w-]{16}$/.test(publicId)) throw new HttpError(404, "Not found", "not_found");
  if (currentId?.startsWith(publicId)) throw new HttpError(400, "To sign out of this device, use Sign out.", "current_session");
  const gone = await db()
    .delete(schema.sessions)
    .where(and(eq(schema.sessions.userId, userId), like(schema.sessions.id, `${publicId}%`)))
    .returning({ id: schema.sessions.id });
  if (!gone.length) throw new HttpError(404, "Not found", "not_found");
  await stopPush(userId, gone.map((g) => g.id));
}

/** A device signed out from elsewhere stops showing this account's mail in notifications. */
async function stopPush(userId: string, sessionIds: string[]) {
  if (!sessionIds.length) return;
  await db()
    .delete(schema.pushSubscriptions)
    .where(and(eq(schema.pushSubscriptions.userId, userId), inArray(schema.pushSubscriptions.sessionId, sessionIds)));
}

/** "Sign out everywhere else": every session but this one. Returns how many ended. */
export async function revokeOtherSessions(userId: string, currentId: string | null) {
  const gone = await db()
    .delete(schema.sessions)
    .where(and(eq(schema.sessions.userId, userId), currentId ? ne(schema.sessions.id, currentId) : undefined))
    .returning({ id: schema.sessions.id });
  await stopPush(userId, gone.map((g) => g.id));
  return gone.length;
}

export interface PasskeyInfo {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
  /** Synced through iCloud Keychain / Google Password Manager. */
  synced: boolean;
}

export async function listPasskeys(userId: string): Promise<PasskeyInfo[]> {
  const rows = await db().select().from(schema.passkeys).where(eq(schema.passkeys.userId, userId)).orderBy(desc(schema.passkeys.createdAt));
  return rows.map((p) => ({ id: p.id, label: p.label, createdAt: p.createdAt.getTime(), lastUsedAt: p.lastUsedAt?.getTime() ?? null, synced: p.backedUp }));
}

/** Removes a passkey. Never the last way in: a code by email always works. */
export async function deletePasskey(userId: string, passkeyId: string) {
  const gone = await db()
    .delete(schema.passkeys)
    .where(and(eq(schema.passkeys.userId, userId), eq(schema.passkeys.id, passkeyId)))
    .returning({ id: schema.passkeys.id });
  if (!gone.length) throw new HttpError(404, "Not found", "not_found");
}

export async function markReauthenticated(sessionId: string) {
  await db().update(schema.sessions).set({ reauthAt: new Date() }).where(eq(schema.sessions.id, sessionId));
}

/**
 * Deleting the account needs "it's you" from the last few minutes (a passkey, or a code by email):
 * an unlocked device someone else picked up isn't enough.
 */
export async function assertRecentlyReauthenticated(userId: string, sessionId: string | null) {
  const [s] = sessionId
    ? await db().select({ reauthAt: schema.sessions.reauthAt }).from(schema.sessions).where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.userId, userId)))
    : [];
  if (!s?.reauthAt || Date.now() - s.reauthAt.getTime() > REAUTH_FRESH_MS) {
    throw new HttpError(403, "Confirm it's you first.", "reauth_required");
  }
}
