import { eq, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "./db";
import { recordUsage, UsageBody, usageOverview } from "./usage";

const DOMAIN = "usage-test.invalid";
let me = "";
let other = "";

beforeEach(async () => {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
  const rows = await db()
    .insert(schema.users)
    .values([{ email: `me@${DOMAIN}` }, { email: `other@${DOMAIN}` }])
    .returning();
  [me, other] = rows.map((r) => r.id);
});
afterAll(async () => {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
});

/** This test's rows only: the database may hold other tests' counts. */
const ours = async () => (await db().select().from(schema.featureUsage)).filter((r) => r.userId === me || r.userId === other);

describe("feature usage", () => {
  it("adds batches to the same day instead of new rows", async () => {
    await recordUsage(me, { inbox: 3, contacts: 1 });
    await recordUsage(me, { inbox: 2 });
    await recordUsage(other, { inbox: 1 });
    const rows = await ours();
    expect(rows.filter((r) => r.userId === me && r.feature === "inbox")).toHaveLength(1);
    expect(rows.find((r) => r.userId === me && r.feature === "inbox")?.count).toBe(5);
    expect(rows.find((r) => r.userId === other && r.feature === "inbox")?.count).toBe(1);
  });

  it("counts people and uses, and can leave someone out", async () => {
    const before = await usageOverview([me, other]);
    const base = (f: string) => before.stats.find((s) => s.feature === f) ?? { users: 0, week: 0, month: 0 };
    await recordUsage(me, { files: 4 });
    await recordUsage(other, { files: 1 });

    const all = await usageOverview();
    const files = all.stats.find((s) => s.feature === "files")!;
    expect(files.users - base("files").users).toBe(2);
    expect(files.month - base("files").month).toBe(5);
    expect(files.week - base("files").week).toBe(5);

    const withoutMe = (await usageOverview([me])).stats.find((s) => s.feature === "files")!;
    expect(withoutMe.users - base("files").users).toBe(1);
    expect(withoutMe.month - base("files").month).toBe(1);
  });

  it("goes with the account", async () => {
    await recordUsage(me, { search: 1 });
    await db().delete(schema.users).where(eq(schema.users.id, me));
    expect(await db().select().from(schema.featureUsage).where(eq(schema.featureUsage.userId, me))).toEqual([]);
  });

  it("takes only known features and sane counts", () => {
    expect(UsageBody.safeParse({ counts: { inbox: 2, files: 1 } }).success).toBe(true);
    expect(UsageBody.safeParse({ counts: { "drop table": 1 } }).success).toBe(false);
    expect(UsageBody.safeParse({ counts: { inbox: 0 } }).success).toBe(false);
    expect(UsageBody.safeParse({ counts: { inbox: 1e6 } }).success).toBe(false);
  });
});
