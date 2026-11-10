import { like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, schema } from "./db";

/** Endpoints the push service says are gone (410); every other send succeeds. */
const gone = vi.hoisted(() => new Set<string>());
const sent = vi.hoisted(() => [] as string[]);
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: () => {},
    sendNotification: vi.fn(async ({ endpoint }: { endpoint: string }) => {
      if (gone.has(endpoint)) throw Object.assign(new Error("Gone"), { statusCode: 410 });
      sent.push(endpoint);
    }),
  },
}));
process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ??= "test-public";
process.env.VAPID_PRIVATE_KEY ??= "test-private";

const { notifyUser } = await import("./push");

const DOMAIN = "push-test.invalid";
let userId = "";
const endpoint = (name: string) => `https://web.push.apple.com/${DOMAIN}/${name}`;

async function subscribe(name: string, sessionId: string | null, daysAgo: number) {
  await db()
    .insert(schema.pushSubscriptions)
    .values({ userId, endpoint: endpoint(name), p256dh: "k", auth: "a", sessionId, createdAt: new Date(Date.now() - daysAgo * 24 * 3600_000) });
}

const left = async () =>
  (await db().select({ endpoint: schema.pushSubscriptions.endpoint }).from(schema.pushSubscriptions).where(like(schema.pushSubscriptions.endpoint, `%${DOMAIN}%`)))
    .map((r) => r.endpoint)
    .sort();

beforeEach(async () => {
  gone.clear();
  sent.length = 0;
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
  const [u] = await db().insert(schema.users).values({ email: `me@${DOMAIN}`, name: "" }).returning();
  userId = u.id;
});
afterAll(async () => {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
});

describe("notifyUser", () => {
  it("sends once per device: a device with two subscriptions gets only the newest", async () => {
    await subscribe("mac-old", "sess-mac", 10);
    await subscribe("mac-new", "sess-mac", 1);
    await subscribe("iphone", "sess-iphone", 3);
    await subscribe("legacy", null, 30);
    await notifyUser(userId, { title: "Hi", body: "" });
    expect(sent.sort()).toEqual([endpoint("iphone"), endpoint("legacy"), endpoint("mac-new")]);
    expect(await left()).toHaveLength(4);
  });

  it("falls back to the older subscription when the newest is gone, and prunes it", async () => {
    await subscribe("mac-old", "sess-mac", 10);
    await subscribe("mac-new", "sess-mac", 1);
    gone.add(endpoint("mac-new"));
    await notifyUser(userId, { title: "Hi", body: "" });
    expect(sent).toEqual([endpoint("mac-old")]);
    expect(await left()).toEqual([endpoint("mac-old")]);
  });
});
