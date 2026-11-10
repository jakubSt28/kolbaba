import { eq, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken, randomToken } from "../crypto";
import { db, schema } from "../db";
import { assertRecentlyReauthenticated, deletePasskey, listSessions, markReauthenticated, revokeOtherSessions, revokeSession } from "./devices";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
    has: (name: string) => jar.has(name),
  }),
}));
const { getUser, SESSION_COOKIE, SESSION_MAX_DAYS } = await import("./session");

const DOMAIN = "devices-test.invalid";
let userId = "";

async function session(over: Partial<typeof schema.sessions.$inferInsert> = {}) {
  const token = randomToken();
  await db()
    .insert(schema.sessions)
    .values({ id: hashToken(token), userId, expiresAt: new Date(Date.now() + 30 * 24 * 3600_000), userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0) Safari/604.1", ...over });
  return { token, id: hashToken(token) };
}

beforeEach(async () => {
  jar.clear();
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
  const [u] = await db().insert(schema.users).values({ email: `me-${Date.now()}@${DOMAIN}` }).returning();
  userId = u.id;
});

afterAll(async () => {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
});

describe("sessions", () => {
  it("end at the latest SESSION_MAX_DAYS after sign-in, however often they're used", async () => {
    const old = await session({ createdAt: new Date(Date.now() - (SESSION_MAX_DAYS + 1) * 24 * 3600_000) });
    jar.set(SESSION_COOKIE, old.token);
    expect(await getUser()).toBeNull();

    const fresh = await session({ expiresAt: new Date(Date.now() + 24 * 3600_000) });
    jar.set(SESSION_COOKIE, fresh.token);
    expect((await getUser())?.id).toBe(userId);
    // Renewed (less than 30 days were left), and the cookie follows.
    const [row] = await db().select().from(schema.sessions).where(eq(schema.sessions.id, fresh.id));
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 50 * 24 * 3600_000);
    expect(row.lastSeenAt).not.toBeNull();
  });

  it("are listed with the current one first, and others can be signed out", async () => {
    const mine = await session();
    const other = await session({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) Chrome/140.0 Safari/537.36" });
    await db().insert(schema.pushSubscriptions).values({ userId, endpoint: `https://fcm.googleapis.com/${randomToken(4)}`, p256dh: "k", auth: "a", sessionId: other.id });

    const list = await listSessions(userId, mine.id);
    expect(list.map((s) => [s.device, s.browser, s.current])).toEqual([
      ["iPhone", "Safari", true],
      ["Mac", "Chrome", false],
    ]);
    // The public id is a prefix, never the whole hash.
    expect(list[1].id).toHaveLength(16);

    await expect(revokeSession(userId, list[0].id, mine.id)).rejects.toMatchObject({ code: "current_session" });
    await revokeSession(userId, list[1].id, mine.id);
    expect((await listSessions(userId, mine.id)).length).toBe(1);
    // That device's notifications stop too.
    expect(await db().select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, userId))).toEqual([]);
  });

  it("sign out everywhere else keeps only this one", async () => {
    const mine = await session();
    await session();
    await session();
    expect(await revokeOtherSessions(userId, mine.id)).toBe(2);
    expect((await listSessions(userId, mine.id)).map((s) => s.current)).toEqual([true]);
  });
});

describe("passkeys", () => {
  const passkey = (id: string) => db().insert(schema.passkeys).values({ id, userId, publicKey: "pk" });

  it("any passkey can be removed: a code by email always gets you in", async () => {
    await passkey("pk-a");
    await deletePasskey(userId, "pk-a");
    await expect(deletePasskey(userId, "pk-a")).rejects.toMatchObject({ status: 404 });
    // Someone else's passkey isn't yours to remove.
    await expect(deletePasskey("usr_someone_else", "pk-b")).rejects.toMatchObject({ status: 404 });
  });

  it("deleting the account needs a fresh confirmation (passkey or code), with or without a passkey", async () => {
    const mine = await session();
    await expect(assertRecentlyReauthenticated(userId, mine.id)).rejects.toMatchObject({ status: 403, code: "reauth_required" });
    await markReauthenticated(mine.id);
    await assertRecentlyReauthenticated(userId, mine.id);
  });
});
