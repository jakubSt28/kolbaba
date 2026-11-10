import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomToken, seal } from "./crypto";
import { DbSyncSink } from "./sync/sink";
import { db, schema } from "./db";
import { HttpError } from "./http-error";
import {
  applyThreadPatch,
  deleteDraft,
  deleteThreadForever,
  deleteThreadsForever,
  emptyBin,
  getAccountImage,
  getAttachment,
  getThread,
  listThreads,
  patchThreads,
  saveDraft,
  setAccountImage,
  updateAccount,
} from "./mail/service";

/**
 * Tenant isolation: everything user B can reach through the mail service while aiming at user A's
 * ids. Each call must fail with 404 (or quietly do nothing) and leave A's data untouched.
 */

const adapter = vi.hoisted(() => ({
  setFlags: vi.fn(async () => {}),
  move: vi.fn(async () => {}),
  deleteForever: vi.fn(async () => {}),
  fetchBody: vi.fn(async () => ({ html: "<p>x</p>", text: "x", attachments: [] })),
  fetchAttachment: vi.fn(async () => ({ name: "a.pdf", mime: "application/pdf", content: Buffer.from("secret") })),
  close: vi.fn(async () => {}),
}));
vi.mock("./mail/adapters", () => ({
  withAdapter: async (_row: unknown, fn: (a: typeof adapter) => Promise<unknown>) => fn(adapter),
  adapterFor: () => adapter,
}));

const DOMAIN = "tenant-test.invalid";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function seedUser(label: string) {
  const [user] = await db().insert(schema.users).values({ email: `${label}-${randomToken(4)}@${DOMAIN}`, name: label }).returning();
  const accountId = `acc_test_${randomToken(8)}`;
  const [account] = await db()
    .insert(schema.accounts)
    .values({
      id: accountId,
      userId: user.id,
      provider: "imap",
      email: `${label}-${randomToken(4)}@${DOMAIN}`,
      name: label,
      hue: 200,
      credentials: seal({ kind: "password", password: "x" }, accountId),
      status: "ok",
      image: PNG,
    })
    .returning();
  const thread = async (folder: "inbox" | "trash") => {
    const [t] = await db()
      .insert(schema.threads)
      .values({ userId: user.id, accountId, providerThreadId: `<${randomToken(6)}@x>`, subject: `${label} secret`, lastMessageAt: new Date(), messageCount: 1, folder })
      .returning();
    const [m] = await db()
      .insert(schema.messages)
      .values({
        userId: user.id,
        accountId,
        threadId: t.id,
        providerMessageId: `INBOX:1:${randomToken(6)}`,
        from: { name: "Shop", email: `shop@${DOMAIN}` },
        subject: `${label} secret`,
        date: new Date(),
        snippet: `${label} secret snippet`,
        bodyHtml: `<p>${label} secret body</p>`,
        attachments: [{ id: "2", name: "invoice.pdf", size: 10, mime: "application/pdf" }],
        labels: [`role:${folder}`],
        imapPath: folder === "inbox" ? "INBOX" : "Trash",
        imapUid: 1,
      })
      .returning();
    await db()
      .insert(schema.insights)
      .values({
        userId: user.id,
        accountId,
        threadId: t.id,
        messageId: m.id,
        category: "order",
        groupKey: `order:${label}`,
        data: { merchant: `${label} shop`, amount: 1, currency: "CZK" },
        source: "test",
        at: new Date(),
      });
    return { thread: t, message: m };
  };
  const inbox = await thread("inbox");
  const trash = await thread("trash");
  return { user, account, inbox, trash };
}

let a: Awaited<ReturnType<typeof seedUser>>;
let b: Awaited<ReturnType<typeof seedUser>>;

beforeAll(async () => {
  a = await seedUser("alice");
  b = await seedUser("bob");
});
afterAll(async () => {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
});

const status = (p: Promise<unknown>) =>
  p.then(
    () => 200,
    (err: unknown) => (err instanceof HttpError ? err.status : 500),
  );

describe("one user can't reach another user's mail", () => {
  it("doesn't read conversations, attachments or pictures", async () => {
    expect(await status(getThread(b.user.id, a.inbox.thread.id))).toBe(404);
    expect(await status(getAttachment(b.user.id, a.inbox.message.id, "2"))).toBe(404);
    expect(await status(getAccountImage(b.user.id, a.account.id))).toBe(404);
    expect(adapter.fetchAttachment).not.toHaveBeenCalled();
  });

  it("doesn't list them, whatever scope or folder is asked for", async () => {
    for (const folder of ["inbox", "trash", "orders", "pinned", "archive"] as const) {
      const { threads } = await listThreads(b.user.id, { scope: a.account.id, folder });
      expect(threads).toEqual([]);
      const all = await listThreads(b.user.id, { scope: "all", folder });
      expect(all.threads.every((t) => t.accountId === b.account.id)).toBe(true);
    }
    const search = await listThreads(b.user.id, { query: "alice secret" });
    expect(search.threads).toEqual([]);
  });

  it("doesn't change, move or delete them", async () => {
    expect(await status(applyThreadPatch(b.user.id, a.inbox.thread.id, { folder: "trash", unread: true, pinned: true }))).toBe(404);
    expect(await patchThreads(b.user.id, [a.inbox.thread.id], { folder: "archive" })).toEqual([a.inbox.thread.id]);
    expect(await status(deleteThreadForever(b.user.id, a.trash.thread.id))).toBe(404);
    expect(await deleteThreadsForever(b.user.id, [a.trash.thread.id])).toEqual([a.trash.thread.id]);
    // Emptying Trash with Alice's mailbox as the scope empties nothing of hers.
    expect(await emptyBin(b.user.id, "trash", a.account.id)).toBe(0);
    expect(adapter.move).not.toHaveBeenCalled();
    expect(adapter.deleteForever).not.toHaveBeenCalled();

    const [inbox] = await db().select().from(schema.threads).where(eq(schema.threads.id, a.inbox.thread.id));
    const [trash] = await db().select().from(schema.threads).where(eq(schema.threads.id, a.trash.thread.id));
    expect(inbox).toMatchObject({ folder: "inbox", unread: false, pinned: false });
    expect(trash).toMatchObject({ folder: "trash" });
  });

  it("doesn't touch mailboxes, pictures or drafts", async () => {
    expect(await status(updateAccount(b.user.id, a.account.id, { name: "pwned" }))).toBe(404);
    expect(await status(setAccountImage(b.user.id, a.account.id, null))).toBe(404);
    expect(await status(saveDraft(b.user.id, { accountId: a.account.id, to: "x@y.cz" }))).toBe(404);
    expect(await status(saveDraft(b.user.id, { accountId: b.account.id, threadId: a.inbox.thread.id }))).toBe(404);
    const draft = await saveDraft(a.user.id, { accountId: a.account.id, subject: "alice draft" });
    expect(await deleteDraft(b.user.id, draft.id)).toBe(null);
    // Reusing Alice's draft id must not overwrite her draft.
    await status(saveDraft(b.user.id, { id: draft.id, accountId: b.account.id, subject: "bob" }));
    const [still] = await db().select().from(schema.drafts).where(eq(schema.drafts.id, draft.id));
    expect(still).toMatchObject({ userId: a.user.id, subject: "alice draft" });
    const [acc] = await db().select().from(schema.accounts).where(eq(schema.accounts.id, a.account.id));
    expect(acc).toMatchObject({ name: "alice", image: PNG });
  });

  it("only attaches a user's own smart-category details", async () => {
    const own = await getThread(b.user.id, b.inbox.thread.id);
    expect(own.insight?.merchant).toBe("bob shop");
    const { threads } = await listThreads(b.user.id, { folder: "orders" });
    expect(threads.map((t) => t.insight?.merchant)).toEqual(["bob shop"]);
  });
});

describe("mailbox pictures", () => {
  it("accept only small PNG, JPEG or WebP data URLs", async () => {
    const bad = ["data:image/svg+xml;base64,PHN2Zz4=", "javascript:alert(1)", "https://evil.example/x.png", `data:image/png;base64,${"A".repeat(300_000)}`];
    for (const value of bad) expect(await status(setAccountImage(b.user.id, b.account.id, value))).toBeGreaterThanOrEqual(400);
    expect(await status(setAccountImage(b.user.id, b.account.id, PNG))).toBe(200);
  });
});

describe("mail that pretends to be ours", () => {
  it("doesn't get remote images just because From: is our own address", async () => {
    const [m] = await db()
      .insert(schema.messages)
      .values({
        userId: b.user.id,
        accountId: b.account.id,
        threadId: b.inbox.thread.id,
        providerMessageId: `INBOX:1:${randomToken(6)}`,
        from: { name: "Me", email: b.account.email },
        subject: "forged",
        date: new Date(),
        bodyHtml: '<p>hi</p><img src="https://tracker.example/p.gif">',
        labels: ["role:inbox"],
        isOutgoing: true,
        imapPath: "INBOX",
        imapUid: 2,
      })
      .returning();
    const thread = await getThread(b.user.id, b.inbox.thread.id);
    const forged = thread.messages.find((x) => x.id === m.id)!;
    expect(forged.remoteImages).toBeUndefined();
    expect(forged.html).toContain("data-blocked-src");
    expect(forged.html).not.toMatch(/\ssrc="https:\/\/tracker/);
  });
});

describe("mail with our own address in From:", () => {
  it("is incoming when it arrives in Inbox: it notifies and doesn't pose as sent mail", async () => {
    const sink = new DbSyncSink({ id: b.account.id, userId: b.user.id, email: b.account.email }, true);
    const subject = `Your account is locked ${randomToken(4)}`;
    await sink.upsertMessages([
      {
        providerMessageId: `INBOX:9:${randomToken(6)}`,
        messageIdHeader: `<forged-${randomToken(6)}@x>`,
        references: [],
        from: { name: "Me", email: b.account.email },
        to: [{ name: "Me", email: b.account.email }],
        cc: [],
        bcc: [],
        replyTo: [],
        subject,
        date: new Date(),
        snippet: "Click here",
        attachments: [],
        unread: true,
        pinned: false,
        role: "inbox",
        labels: [],
      },
    ]);
    const [row] = await db().select({ isOutgoing: schema.messages.isOutgoing }).from(schema.messages).where(eq(schema.messages.subject, subject));
    expect(row.isOutgoing).toBe(false);
    expect(sink.newMail.map((m) => m.subject)).toContain(subject);
  });
});

describe("drafts an agent wrote", () => {
  it("become the user's once the user changes them", async () => {
    const draft = await saveDraft(b.user.id, { accountId: b.account.id, subject: "agent", agentId: null });
    await db().update(schema.drafts).set({ agentId: "agt_test" }).where(eq(schema.drafts.id, draft.id));
    // Saving without changes (opening it) keeps the agent's name on it.
    expect((await saveDraft(b.user.id, { id: draft.id, accountId: b.account.id, subject: "agent" }, { byUser: true })).agentId).toBe("agt_test");
    expect((await saveDraft(b.user.id, { id: draft.id, accountId: b.account.id, subject: "mine now" }, { byUser: true })).agentId).toBeUndefined();
  });
});
