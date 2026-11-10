import { desc, eq } from "drizzle-orm";
import webpush from "web-push";
import type { Locale } from "@/lib/i18n";
import { inQuietHours } from "@/lib/quiet-hours";
import { db, schema } from "./db";
import { env } from "./env";

export interface PushPayload {
  title: string;
  body: string;
  /** Opened when the notification is tapped, e.g. "/?thread=thr_…". */
  url?: string;
  /** Notifications with the same tag replace each other (e.g. one per thread). */
  tag?: string;
  /** App icon badge count (iOS PWA honours it via the service worker). */
  badge?: number;
}

/** The language the user's app last ran in (notifications can't ask the browser). */
export async function userLocale(userId: string): Promise<Locale> {
  const [row] = await db().select({ settings: schema.users.settings }).from(schema.users).where(eq(schema.users.id, userId));
  return row?.settings.locale === "cs" ? "cs" : "en";
}

/** The user's quiet hours are on right now: news that can wait (an open, a new email) stays silent. */
export async function isQuiet(userId: string, now = new Date()) {
  const [row] = await db().select({ settings: schema.users.settings }).from(schema.users).where(eq(schema.users.id, userId));
  return inQuietHours(row?.settings.quietHours, now);
}

let configured = false;

function configure() {
  if (configured) return true;
  if (!env.vapidPublicKey || !env.vapidPrivateKey) return false;
  webpush.setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey);
  configured = true;
  return true;
}

/**
 * Send a Web Push notification to every device of the user, once each. A device (one sign-in) can end up
 * with two subscriptions when Safari takes a new one and the old one was never handed back (seen on a Mac
 * and an iPhone, Nov 2026): it gets the newest, and an older one only if the push service says the newest
 * is gone. Dead subscriptions are pruned.
 */
export async function notifyUser(userId: string, payload: PushPayload) {
  if (!configure()) return;
  const subs = await db()
    .select()
    .from(schema.pushSubscriptions)
    .where(eq(schema.pushSubscriptions.userId, userId))
    .orderBy(desc(schema.pushSubscriptions.createdAt));
  const devices = new Map<string, typeof subs>();
  for (const sub of subs) {
    const device = sub.sessionId ?? sub.id;
    devices.set(device, [...(devices.get(device) ?? []), sub]);
  }
  await Promise.all(
    [...devices.values()].map(async (newestFirst) => {
      for (const sub of newestFirst) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify(payload),
            { TTL: 60 * 60, urgency: "high" },
          );
          return;
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status !== 404 && status !== 410) {
            console.warn("push failed", status, (err as Error).message);
            return;
          }
          await db().delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, sub.id));
        }
      }
    }),
  );
}
