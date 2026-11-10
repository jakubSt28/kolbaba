import { eq, like, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seal } from "../crypto";
import { db, schema } from "../db";

const adapter = vi.hoisted(() => ({
  saveDraft: vi.fn(async (_m: { to: { email: string }[]; subject: string; html: string }, previous?: string | null) => {
    const ref = previous ? `${previous}+` : "pd_1";
    return { ref, version: `v-${ref}` };
  }),
  deleteDraft: vi.fn<(ref: string) => Promise<void>>(async () => {}),
}));
vi.mock("../mail/adapters", () => ({
  withAdapter: async (_row: unknown, fn: (a: typeof adapter) => Promise<unknown>) => fn(adapter),
  adapterFor: () => adapter,
}));

const { mirrorDrafts } = await import("./draft-mirror");
const { deleteDraft, saveDraft } = await import("../mail/service");

const DOMAIN = "mirror-test.invalid";
let userId = "";
let accountId = "";
const settle = (id: string, ago = 60_000) => db().update(schema.drafts).set({ updatedAt: new Date(Date.now() - ago) }).where(eq(schema.drafts.id, id));
const row = async (id: string) => (await db().select().from(schema.drafts).where(eq(schema.drafts.id, id)))[0];

beforeEach(async () => {
  adapter.saveDraft.mockClear();
  adapter.deleteDraft.mockClear();
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
  await db().delete(schema.providerCleanups);
  // Drafts other tests (or a local preview) left in the database aren't this test's business.
  await db().update(schema.drafts).set({ providerSyncedAt: sql`${schema.drafts.updatedAt}` });
  const [u] = await db().insert(schema.users).values({ email: `me@${DOMAIN}`, name: "Me" }).returning();
  userId = u.id;
  const [a] = await db()
    .insert(schema.accounts)
    .values({ userId, provider: "imap", email: `me@${DOMAIN}`, name: "Me", hue: 200, credentials: seal({ kind: "password", password: "x" }, "x"), status: "ok" })
    .returning();
  accountId = a.id;
});

afterAll(async () => {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
});

describe("drafts at the provider", () => {
  it("are copied once edits settle, then updated in place", async () => {
    const d = await saveDraft(userId, { accountId, to: "Petr <petr@example.com>, half-typ", subject: "Nabídka", html: "<p>Ahoj</p>" });
    await mirrorDrafts();
    expect(adapter.saveDraft).not.toHaveBeenCalled(); // still being written

    await settle(d.id);
    await mirrorDrafts();
    expect(adapter.saveDraft).toHaveBeenCalledTimes(1);
    const [message, previous] = adapter.saveDraft.mock.calls[0];
    expect(message.to.map((p) => p.email)).toEqual(["petr@example.com"]);
    expect(message.subject).toBe("Nabídka");
    expect(previous).toBeNull();
    expect((await row(d.id)).providerDraftId).toBe("pd_1");

    await mirrorDrafts();
    expect(adapter.saveDraft).toHaveBeenCalledTimes(1); // nothing changed

    await saveDraft(userId, { id: d.id, accountId, html: "<p>Ahoj, posílám</p>" });
    await settle(d.id, 30_000);
    await mirrorDrafts();
    expect(adapter.saveDraft.mock.calls[1][1]).toBe("pd_1");
    expect((await row(d.id)).providerDraftId).toBe("pd_1+");
  });

  it("go away at the provider when discarded here, and blank ones are never copied", async () => {
    const d = await saveDraft(userId, { accountId, to: "petr@example.com", subject: "Pryč", html: "<p>x</p>" });
    await settle(d.id);
    await mirrorDrafts();
    await deleteDraft(userId, d.id);
    await mirrorDrafts();
    expect(adapter.deleteDraft).toHaveBeenCalledWith("pd_1");
    expect(await db().select().from(schema.providerCleanups)).toEqual([]);

    const blank = await saveDraft(userId, { accountId, html: "" });
    await settle(blank.id);
    adapter.saveDraft.mockClear();
    await mirrorDrafts();
    expect(adapter.saveDraft).not.toHaveBeenCalled();
  });
});
