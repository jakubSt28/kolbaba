import { like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "./db";
import { recordTrackerBlocks, userStats } from "./stats";

const DOMAIN = "stats-test.invalid";
let userId = "";

beforeEach(async () => {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
  const [u] = await db().insert(schema.users).values({ email: `me@${DOMAIN}` }).returning();
  userId = u.id;
});

afterAll(async () => {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
});

describe("tracking blocked", () => {
  it("counts each email once, however often it's opened, and the last week apart", async () => {
    await recordTrackerBlocks(userId, ["msg_a", "msg_b"]);
    await recordTrackerBlocks(userId, ["msg_a"]);
    await recordTrackerBlocks(userId, []);
    await db()
      .insert(schema.trackerBlocks)
      .values({ userId, messageId: "msg_old", at: new Date(Date.now() - 10 * 24 * 3600_000) });
    expect(await userStats(userId)).toEqual({ trackersWeek: 2, trackersTotal: 3 });
  });
});
