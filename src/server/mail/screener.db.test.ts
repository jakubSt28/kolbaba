import { eq, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seal } from "../crypto";
import { db, schema } from "../db";
import type { RemoteMessage } from "./types";

const adapter = vi.hoisted(() => ({ move: vi.fn(async () => {}), setFlags: vi.fn(async () => {}), close: vi.fn(async () => {}) }));
vi.mock("./adapters", () => ({
  withAdapter: async (_row: unknown, fn: (a: typeof adapter) => Promise<unknown>) => fn(adapter),
  adapterFor: () => adapter,
}));

const { DbSyncSink } = await import("../sync/sink");
const { archiveBlockedMail, blockSender, cleanUpSender, decideSender, forgetSender, listSenders } = await import("./screener-actions");
const { undoHistory } = await import("../history");
const { listThreads } = await import("./service");

const DOMAIN = "screener-test.invalid";
const ME = `me@${DOMAIN}`;
let userId = "";
let accountId = "";
let n = 0;

const msg = (from: string, over: Partial<RemoteMessage> = {}): RemoteMessage => ({
  providerMessageId: `INBOX:1:${++n}`,
  messageIdHeader: `<m${n}@x>`,
  references: [],
  from: { name: from.split("@")[0], email: from },
  to: [{ name: "Me", email: ME }],
  cc: [],
  bcc: [],
  replyTo: [],
  subject: `Hello ${n}`,
  date: new Date(),
  snippet: "Hi",
  attachments: [],
  unread: true,
  pinned: false,
  role: "inbox",
  labels: [],
  ...over,
});

beforeEach(async () => {
  adapter.move.mockClear();
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
  const since = Date.now() - 60_000;
  const [u] = await db().insert(schema.users).values({ email: ME, settings: { screener: true, screenerSince: since } }).returning();
  userId = u.id;
  const [a] = await db()
    .insert(schema.accounts)
    .values({ userId, provider: "imap", email: ME, name: "Me", hue: 200, credentials: seal({ kind: "password", password: "x" }, "x"), status: "ok" })
    .returning();
  accountId = a.id;
});

afterAll(async () => {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
});

const inbox = async () => (await listThreads(userId, { folder: "inbox" })).threads.map((t) => t.messages[0].from.email);
const waiting = async () => (await listThreads(userId, { folder: "screener" })).threads.map((t) => t.messages[0].from.email);

describe("screener", () => {
  it("holds the first email from someone new, quietly, but not from people already known", async () => {
    // Known: mail from before the screener was turned on, and someone the user wrote to.
    const old = new DbSyncSink({ id: accountId, userId, email: ME }, false);
    await old.upsertMessages([msg(`old@${DOMAIN}`, { date: new Date(Date.now() - 3600_000) })]);
    await old.upsertMessages([msg(ME, { role: "sent", to: [{ name: "", email: `friend@${DOMAIN}` }], date: new Date(Date.now() - 7200_000) })]);

    const sink = new DbSyncSink({ id: accountId, userId, email: ME }, true);
    await sink.upsertMessages([msg(`new@${DOMAIN}`), msg(`old@${DOMAIN}`), msg(`friend@${DOMAIN}`)]);
    expect(await waiting()).toEqual([`new@${DOMAIN}`]);
    expect(await inbox()).not.toContain(`new@${DOMAIN}`);
    // No notification for the one that waits.
    expect(sink.newMail.map((m) => m.from.email).sort()).toEqual([`friend@${DOMAIN}`, `old@${DOMAIN}`]);
  });

  it("yes lets them into Inbox; no archives what waits and what comes later", async () => {
    const sink = new DbSyncSink({ id: accountId, userId, email: ME }, true);
    await sink.upsertMessages([msg(`yes@${DOMAIN}`), msg(`no@${DOMAIN}`)]);
    await decideSender(userId, { email: `yes@${DOMAIN}` }, "allowed");
    expect(await inbox()).toContain(`yes@${DOMAIN}`);

    await decideSender(userId, { email: `NO@${DOMAIN}` }, "blocked");
    expect(adapter.move).toHaveBeenCalledWith(expect.anything(), "archive");
    expect(await waiting()).toEqual([]);

    // Later mail from them: no notification, and the worker archives it.
    adapter.move.mockClear();
    const later = new DbSyncSink({ id: accountId, userId, email: ME }, true);
    await later.upsertMessages([msg(`no@${DOMAIN}`, { subject: "Again" })]);
    expect(later.newMail).toEqual([]);
    expect(await archiveBlockedMail()).toBeGreaterThan(0);
    expect(adapter.move).toHaveBeenCalledWith(expect.anything(), "archive");
    const [blocked] = await db().select().from(schema.senders).where(eq(schema.senders.userId, userId));
    expect(blocked).toBeDefined();
  });

  it("does nothing while it's off", async () => {
    await db().update(schema.users).set({ settings: {} }).where(eq(schema.users.id, userId));
    const sink = new DbSyncSink({ id: accountId, userId, email: ME }, true);
    await sink.upsertMessages([msg(`anyone@${DOMAIN}`)]);
    expect(await waiting()).toEqual([]);
    expect(await inbox()).toContain(`anyone@${DOMAIN}`);
  });
});

describe("block from any email", () => {
  it("sends what's in Inbox from a whole domain to Trash now and later, and Undo brings it back", async () => {
    await db().update(schema.users).set({ settings: {} }).where(eq(schema.users.id, userId));
    const sink = new DbSyncSink({ id: accountId, userId, email: ME }, true);
    await sink.upsertMessages([msg(`sales@spam-${DOMAIN}`), msg(`ceo@spam-${DOMAIN}`), msg(`friend@${DOMAIN}`)]);
    const res = await blockSender(userId, { email: `sales@spam-${DOMAIN}` }, { domain: true });
    expect(res.key).toBe(`@spam-${DOMAIN}`);
    expect(res.threads).toHaveLength(2);
    expect(adapter.move).toHaveBeenCalledWith(expect.anything(), "trash");
    expect(await inbox()).toEqual([`friend@${DOMAIN}`]);
    expect((await listSenders(userId, "blocked"))[0]).toMatchObject({ email: `@spam-${DOMAIN}`, bin: true, domain: true });

    // Later mail from anyone there: no notification, and the worker puts it in Trash.
    adapter.move.mockClear();
    const later = new DbSyncSink({ id: accountId, userId, email: ME }, true);
    await later.upsertMessages([msg(`new@spam-${DOMAIN}`)]);
    expect(later.newMail).toEqual([]);
    expect(await archiveBlockedMail()).toBe(1);
    expect(adapter.move).toHaveBeenCalledWith(expect.anything(), "trash");

    // Undo in My history: unblocked, and the two are back in Inbox.
    await undoHistory(userId, res.historyId!);
    expect(await listSenders(userId, "blocked")).toEqual([]);
    expect((await inbox()).filter((e) => e.endsWith(`spam-${DOMAIN}`)).length).toBeGreaterThanOrEqual(2);
  });

  it("won't block everyone at a free email service", async () => {
    await expect(blockSender(userId, { email: "someone@gmail.com" }, { domain: true })).rejects.toMatchObject({ code: "free_mail_domain" });
  });

  it("unblocking a screener no lets them in; unblocking a block forgets it", async () => {
    await decideSender(userId, { email: `nope@${DOMAIN}` }, "blocked");
    await blockSender(userId, { email: `bad@${DOMAIN}` });
    await forgetSender(userId, `nope@${DOMAIN}`);
    await forgetSender(userId, `bad@${DOMAIN}`);
    const rows = await db().select().from(schema.senders).where(eq(schema.senders.userId, userId));
    expect(rows.map((r) => [r.email, r.status])).toEqual([[`nope@${DOMAIN}`, "allowed"]]);
  });

  it("cleans up after unsubscribing, pinned mail aside", async () => {
    await db().update(schema.users).set({ settings: {} }).where(eq(schema.users.id, userId));
    const sink = new DbSyncSink({ id: accountId, userId, email: ME }, true);
    await sink.upsertMessages([msg(`news@${DOMAIN}`), msg(`news@${DOMAIN}`, { pinned: true }), msg(`news@${DOMAIN}`, { role: "archive" })]);
    const archived = await cleanUpSender(userId, `news@${DOMAIN}`, "archive");
    expect(archived.threads).toHaveLength(1);
    const trashed = await cleanUpSender(userId, `news@${DOMAIN}`, "trash");
    // The one archived just now and the one already in Archive; the pinned one stays.
    expect(trashed.threads).toHaveLength(2);
    expect(await inbox()).toEqual([`news@${DOMAIN}`]);
  });
});

