import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seal } from "../crypto";
import { db, schema } from "../db";
import type { MailAdapter } from "../mail/types";
import { loadAccount, syncAccount, withSyncLease } from "./engine";

const EMAIL = "lease-test@example.cz";
let accountId = "";

beforeEach(async () => {
  await db().delete(schema.users).where(eq(schema.users.email, EMAIL));
  const [u] = await db().insert(schema.users).values({ email: EMAIL }).returning();
  const [a] = await db()
    .insert(schema.accounts)
    .values({ userId: u.id, provider: "imap", email: EMAIL, name: "Test", hue: 200, credentials: seal("x", "test") })
    .returning();
  accountId = a.id;
});

afterAll(async () => {
  await db().delete(schema.users).where(eq(schema.users.email, EMAIL));
});

async function lease() {
  const [row] = await db()
    .select({ owner: schema.accounts.syncLeaseOwner, requested: schema.accounts.syncRequested })
    .from(schema.accounts)
    .where(eq(schema.accounts.id, accountId));
  return row;
}

describe("withSyncLease", () => {
  it("runs once and lets go", async () => {
    expect(await withSyncLease(accountId, async () => "done")).toEqual(["done"]);
    expect(await lease()).toEqual({ owner: null, requested: false });
  });

  it("a second sync while one runs is folded into one more pass of the first", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const passes: number[] = [];
    const first = withSyncLease(accountId, async (pass) => {
      passes.push(pass);
      if (pass === 0) await gate;
      return pass;
    });
    // Let the first take the lease.
    await new Promise((r) => setTimeout(r, 50));
    const second = await withSyncLease(accountId, async () => "second");
    expect(second).toBeNull();
    expect((await lease()).requested).toBe(true);
    release();
    expect(await first).toEqual([0, 1]);
    expect(passes).toEqual([0, 1]);
    expect(await lease()).toEqual({ owner: null, requested: false });
  });

  it("an expired lease (crashed holder) can be taken over", async () => {
    await db()
      .update(schema.accounts)
      .set({ syncLeaseOwner: "dead", syncLeaseUntil: new Date(Date.now() - 1000) })
      .where(eq(schema.accounts.id, accountId));
    expect(await withSyncLease(accountId, async () => 1)).toEqual([1]);
  });

  it("lets go when the sync throws", async () => {
    await expect(withSyncLease(accountId, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect((await lease()).owner).toBeNull();
  });
});

describe("syncAccount", () => {
  const adapter = { initialSync: async () => {}, incrementalSync: async () => {}, close: async () => {} } as unknown as MailAdapter;
  const stored = async () =>
    (await db().select({ status: schema.accounts.status, lastSyncAt: schema.accounts.lastSyncAt }).from(schema.accounts).where(eq(schema.accounts.id, accountId)))[0];

  it("ends a first import as ok, then writes nothing for a sync that changed nothing", async () => {
    // A mailbox that looked healthy goes through "syncing" during the import and must come out of it.
    await db().update(schema.accounts).set({ status: "ok", lastSyncAt: new Date() }).where(eq(schema.accounts.id, accountId));
    await syncAccount((await loadAccount(accountId))!, { adapter });
    const first = await stored();
    expect(first.status).toBe("ok");
    await syncAccount((await loadAccount(accountId))!, { adapter });
    expect((await stored()).lastSyncAt).toEqual(first.lastSyncAt);
  });
});
