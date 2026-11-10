import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { currentSessionId, withUser } from "@/server/auth/session";
import { parseBody } from "@/server/api/validate";
import { db, schema } from "@/server/db";
import { env } from "@/server/env";

/** Browsers' push services. Anything else would make our servers POST mail previews to a URL someone picked. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];

const Subscription = z.object({
  endpoint: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return url.protocol === "https:" && PUSH_HOSTS.some((host) => host.test(url.hostname));
    }, "Unknown push service"),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
  /** The subscription this device had before (the browser dropped it): it goes, so nothing is sent there twice. */
  replaces: z.string().max(2000).optional(),
});

/** The public half of this server's notification key (src/lib/push-client.ts). Public by design. */
export const GET = () => Response.json({ key: env.vapidPublicKey ?? null });

/** Register this device for Web Push (the service worker's PushSubscription.toJSON()). Sent again now and then: an upsert. */
export const POST = withUser(async (user, req) => {
  const sub = await parseBody(req, Subscription);
  const values = {
    userId: user.id,
    endpoint: sub.endpoint,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
    userAgent: req.headers.get("user-agent"),
    sessionId: await currentSessionId(),
  };
  await db()
    .insert(schema.pushSubscriptions)
    .values(values)
    .onConflictDoUpdate({ target: schema.pushSubscriptions.endpoint, set: values });
  if (sub.replaces && sub.replaces !== sub.endpoint) {
    await db()
      .delete(schema.pushSubscriptions)
      .where(and(eq(schema.pushSubscriptions.userId, user.id), eq(schema.pushSubscriptions.endpoint, sub.replaces)));
  }
  return Response.json({ ok: true });
});

export const DELETE = withUser(async (user, req) => {
  const { endpoint } = await parseBody(req, z.object({ endpoint: z.string() }));
  await db()
    .delete(schema.pushSubscriptions)
    .where(and(eq(schema.pushSubscriptions.userId, user.id), eq(schema.pushSubscriptions.endpoint, endpoint)));
  return Response.json({ ok: true });
});
