import { eq, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomToken, seal } from "./crypto";
import { db, schema } from "./db";

const adapter = vi.hoisted(() => ({
  setFlags: vi.fn(async () => {}),
  move: vi.fn(async () => {}),
  createFolder: vi.fn(async (name: string) => ({ ref: `INBOX.${name}` })),
  moveToFolder: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
}));
vi.mock("./mail/adapters", () => ({
  withAdapter: async (_row: unknown, fn: (a: typeof adapter) => Promise<unknown>) => fn(adapter),
  adapterFor: () => adapter,
}));
vi.mock("./push", () => ({ notifyUser: vi.fn(async () => {}), userLocale: async () => "en" }));

const { describeChange, listHistory, patchOneWithHistory, patchWithHistory, recordHistory, undoHistory } = await import("./history");
const { createFolder } = await import("./mail/folders");

const DOMAIN = "history-test.invalid";
let userId = "";
let accountId = "";

async function conversation(subject: string) {
  const [t] = await db()
    .insert(schema.threads)
    .values({ userId, accountId, providerThreadId: `<${randomToken(6)}@x>`, subject, lastMessageAt: new Date(), messageCount: 1, folder: "inbox" })
    .returning();
  await db()
    .insert(schema.messages)
    .values({
      userId,
      accountId,
      threadId: t.id,
      providerMessageId: `INBOX:1:${randomToken(4)}`,
      from: { name: "Jana", email: `jana@${DOMAIN}` },
      subject,
      date: new Date(),
      messageIdHeader: `<${randomToken(6)}@x>`,
      labels: ["role:inbox"],
      imapPath: "INBOX",
      imapUid: 1,
    });
  return t.id;
}

const folderOf = async (id: string) => (await db().select().from(schema.threads).where(eq(schema.threads.id, id)))[0];

beforeEach(async () => {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
  const [u] = await db().insert(schema.users).values({ email: `me@${DOMAIN}` }).returning();
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

describe("my history", () => {
  it("says what a change was, and skips what isn't worth a line", () => {
    expect(describeChange({ folder: "inbox" }, [{ folder: "trash" }])).toEqual({ kind: "restored" });
    expect(describeChange({ folder: "archive" }, [{ folder: "inbox" }])).toEqual({ kind: "archived" });
    expect(describeChange({ folderId: "fld_1" }, [{ folder: "inbox" }], "Faktury")).toEqual({ kind: "filed", data: { folder: "Faktury" } });
    expect(describeChange({ unread: false }, [{ folder: "inbox" }])).toBeNull();
  });

  it("records a change with what it was before, and Undo from it puts that back", async () => {
    const a = await conversation("První");
    const b = await conversation("Druhá");
    await patchWithHistory(userId, [a, b], { folder: "archive" });
    const { entries } = await listHistory(userId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "archived", count: 2, subject: "První", undoable: true });
    expect((await folderOf(a)).folder).toBe("archive");

    await undoHistory(userId, entries[0].id);
    expect((await folderOf(a)).folder).toBe("inbox");
    expect((await folderOf(b)).folder).toBe("inbox");
    expect((await listHistory(userId)).entries[0]).toMatchObject({ undone: true, undoable: false });
    await expect(undoHistory(userId, entries[0].id)).rejects.toMatchObject({ status: 409 });
  });

  it("the app's own Undo marks the line instead of adding one", async () => {
    const a = await conversation("Odložit");
    await patchOneWithHistory(userId, a, { snoozedUntil: Date.now() + 3600_000 });
    await patchOneWithHistory(userId, a, { snoozedUntil: null, undo: true });
    const { entries } = await listHistory(userId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "snoozed", undone: true });
  });

  it("filing remembers the folder; undoing takes it back out", async () => {
    const folder = await createFolder(userId, { name: "Faktury" });
    const a = await conversation("Faktura");
    await patchWithHistory(userId, [a], { folderId: folder.id });
    const [entry] = (await listHistory(userId)).entries;
    expect(entry).toMatchObject({ kind: "filed", data: { folder: "Faktury" } });
    expect((await folderOf(a)).folderId).toBe(folder.id);

    await undoHistory(userId, entry.id);
    const back = await folderOf(a);
    expect(back.folderId).toBeNull();
    expect(back.folder).toBe("inbox");
  });

  it("pages newest first, and lines that can't be undone say so", async () => {
    for (let i = 0; i < 3; i++) await recordHistory(userId, { kind: "deleted_forever" }, [{ id: `t${i}`, folder: "trash", folderId: null, snoozedUntil: null, pinned: false, subject: `S${i}` }], { undoable: false });
    // Two in the same millisecond: paging must not skip either.
    const same = new Date("2026-10-12T10:00:00.123Z");
    await db().update(schema.history).set({ at: same }).where(eq(schema.history.subject, "S0"));
    await db().update(schema.history).set({ at: same }).where(eq(schema.history.subject, "S1"));
    await db().update(schema.history).set({ at: new Date("2026-10-12T11:00:00Z") }).where(eq(schema.history.subject, "S2"));
    const first = await listHistory(userId, { limit: 2 });
    expect(first.entries[0].subject).toBe("S2");
    expect(first.entries.every((e) => !e.undoable)).toBe(true);
    const rest = await listHistory(userId, { before: first.next!, limit: 2 });
    expect([...first.entries, ...rest.entries].map((e) => e.subject).sort()).toEqual(["S0", "S1", "S2"]);
    expect(rest.next).toBeNull();
  });
});
