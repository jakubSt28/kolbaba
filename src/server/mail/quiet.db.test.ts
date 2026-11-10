import { eq, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seal } from "../crypto";
import { db, schema } from "../db";
import type { OutgoingMessage, RemoteMessage } from "./types";

const adapter = vi.hoisted(() => ({
  move: vi.fn(async () => {}),
  setFlags: vi.fn(async () => {}),
  send: vi.fn<(m: OutgoingMessage) => Promise<{ messageIdHeader: string }>>(async () => ({ messageIdHeader: "<sent@x>" })),
  close: vi.fn(async () => {}),
}));
vi.mock("./adapters", () => ({
  withAdapter: async (_row: unknown, fn: (a: typeof adapter) => Promise<unknown>) => fn(adapter),
  adapterFor: () => adapter,
}));
const push = vi.hoisted(() => ({ notifyUser: vi.fn(async () => {}) }));
vi.mock("../push", () => ({ notifyUser: push.notifyUser, userLocale: async () => "en", isQuiet: async () => false }));

const { DbSyncSink } = await import("../sync/sink");
const { notifyNewMail } = await import("../sync/engine");
const { applyMailRules, createRule, noteFiling } = await import("./rules");
const { listNewsletters } = await import("./lists");
const { sendAwayReplies } = await import("./away");
const { listThreads } = await import("./service");

const DOMAIN = "quiet-test.invalid";
const ME = `me@${DOMAIN}`;
let userId = "";
let accountId = "";
let n = 0;

const msg = (from: string, over: Partial<RemoteMessage> = {}): RemoteMessage => ({
  providerMessageId: `INBOX:1:${++n}`,
  messageIdHeader: `<q${n}@x>`,
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

const sink = (live = true) => new DbSyncSink({ id: accountId, userId, email: ME }, live);
const inbox = async () => (await listThreads(userId, { folder: "inbox" })).threads;

beforeEach(async () => {
  adapter.move.mockClear();
  adapter.send.mockClear();
  push.notifyUser.mockClear();
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
  const [u] = await db().insert(schema.users).values({ email: ME, name: "Me" }).returning();
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

describe("notifications", () => {
  it("follow the mailbox's setting, quiet hours, VIPs, rules and watched conversations", async () => {
    const s = sink();
    await s.upsertMessages([
      msg(`petra@${DOMAIN}`, { subject: "Saturday?" }),
      msg(`news@shop-${DOMAIN}`, { subject: "Weekend deals", bulk: true }),
      msg(`no-reply@bank-${DOMAIN}`, { subject: "Your code", snippet: "Your verification code is 482913" }),
      msg(`info@alza-${DOMAIN}`, { subject: "Order shipped" }),
    ]);
    const titles = () => push.notifyUser.mock.calls.map((c) => (c as unknown as [string, { title: string }])[1].title);

    // Only people: no newsletter or shop's automatic mail, but the sign-in code comes through.
    await notifyNewMail({ userId, name: "Me", id: accountId, notify: "people" }, s.newMail);
    expect(titles().sort()).toEqual(["482 913 · no-reply", "petra"].sort());

    // A rule files Alza's mail away: no buzz for it.
    push.notifyUser.mockClear();
    await createRule(userId, { from: `alza-${DOMAIN}`, action: "archive" });
    await notifyNewMail({ userId, name: "Me", id: accountId, notify: "all" }, s.newMail);
    expect(titles().some((x) => x.startsWith("info"))).toBe(false);
    expect(titles()).toHaveLength(3);

    // Quiet hours all day: only a VIP (and the code) get through.
    push.notifyUser.mockClear();
    await db()
      .update(schema.users)
      .set({ settings: { quietHours: { on: true, from: "00:00", to: "23:59", tz: "UTC" } } })
      .where(eq(schema.users.id, userId));
    await db().insert(schema.contacts).values({ userId, name: "Petra", emails: [`petra@${DOMAIN}`], vip: true });
    await notifyNewMail({ userId, name: "Me", id: accountId, notify: "all" }, s.newMail);
    expect(titles().sort()).toEqual(["482 913 · no-reply", "petra"].sort());

    // "Nothing" for the mailbox, but the newsletter conversation is watched: it still notifies.
    push.notifyUser.mockClear();
    const news = s.newMail.find((m) => m.subject === "Weekend deals")!;
    await db().update(schema.threads).set({ watchedAt: new Date() }).where(eq(schema.threads.id, news.threadId));
    await notifyNewMail({ userId, name: "Me", id: accountId, notify: "none" }, s.newMail);
    expect(titles()).toEqual(["news"]);
  });
});

describe("rules", () => {
  it("offer one after the third filing of a sender into the same folder, then not again right away", async () => {
    const [folder] = await db().insert(schema.mailFolders).values({ userId, name: "Shopping", hue: 30 }).returning();
    await sink(false).upsertMessages([
      msg(`objednavky@alza-${DOMAIN}`, { subject: "A" }),
      msg(`info@alza-${DOMAIN}`, { subject: "B" }),
      msg(`novinky@alza-${DOMAIN}`, { subject: "C" }),
      msg(`x@alza-${DOMAIN}`, { subject: "D" }),
    ]);
    const ids = (await inbox()).map((t) => t.id);
    expect(await noteFiling(userId, [ids[0]], folder.id)).toBeNull();
    expect(await noteFiling(userId, [ids[1]], folder.id)).toBeNull();
    expect(await noteFiling(userId, [ids[2]], folder.id)).toEqual({ sender: `@alza-${DOMAIN}`, name: `alza-${DOMAIN}`, folderId: folder.id });
    expect(await noteFiling(userId, [ids[3]], folder.id)).toBeNull();
  });

  it("file new mail once, leave the user's own last word alone, and can sweep Inbox when made", async () => {
    await sink(false).upsertMessages([msg(`deals@mall-${DOMAIN}`, { subject: "Old offer" })]);
    const { rule, applied } = await createRule(userId, { from: `mall-${DOMAIN}`, action: "archive", markRead: true }, { applyNow: true });
    expect(applied).toBe(1);
    expect(rule.applied).toBe(1);
    expect(adapter.move).toHaveBeenCalledWith(expect.anything(), "archive");
    adapter.move.mockClear();

    await sink().upsertMessages([
      msg(`deals@mall-${DOMAIN}`, { subject: "New offer" }),
      msg(`petr@${DOMAIN}`, { subject: "Lunch?" }),
    ]);
    expect(await applyMailRules()).toBe(1);
    expect((await inbox()).map((t) => t.subject)).toEqual(["Lunch?"]);
    // Looked at once: back in Inbox by hand, it stays there.
    expect(await applyMailRules()).toBe(0);

    // The user wrote last in a conversation with them: their reply isn't new mail to file.
    await sink().upsertMessages([
      msg(`help@mall-${DOMAIN}`, { subject: "Your question", messageIdHeader: "<help@x>" }),
      msg(ME, { subject: "Re: Your question", role: "sent", unread: false, inReplyTo: "<help@x>", references: ["<help@x>"], date: new Date(Date.now() + 1000) }),
    ]);
    const before = adapter.move.mock.calls.length;
    await applyMailRules();
    expect(adapter.move.mock.calls.length).toBe(before);
  });
});

describe("newsletters", () => {
  it("count who sends what and how much of it gets read, blocked senders aside", async () => {
    await sink(false).upsertMessages([
      msg(`news@shop-${DOMAIN}`, { subject: "Deals 1", bulk: true, date: new Date(Date.now() - 3 * 86_400_000) }),
      msg(`news@shop-${DOMAIN}`, { subject: "Deals 2", bulk: true, unread: false, date: new Date(Date.now() - 2 * 86_400_000) }),
      msg(`news@shop-${DOMAIN}`, { subject: "Deals 3", bulk: true, date: new Date(Date.now() - 86_400_000) }),
      msg(`hello@blog-${DOMAIN}`, { subject: "Post", bulk: true, unread: false }),
      msg(`spam@junk-${DOMAIN}`, { subject: "Junk", bulk: true }),
      msg(`petra@${DOMAIN}`, { subject: "Not a list" }),
    ]);
    await db().insert(schema.senders).values({ userId, email: `spam@junk-${DOMAIN}`, status: "blocked", bin: true });
    const lists = await listNewsletters(userId);
    expect(lists.map((l) => l.email)).toEqual([`news@shop-${DOMAIN}`, `hello@blog-${DOMAIN}`]);
    expect(lists[0]).toMatchObject({ total: 3, recent: 3, read: 1, inInbox: 3, lastSubject: "Deals 3" });
  });
});

describe("out of office", () => {
  it("answers each person once, marked as automatic, and leaves lists and strangers alone when asked", async () => {
    await db()
      .update(schema.users)
      .set({ settings: { away: { on: true, from: Date.now() - 60_000, until: null, subject: "Out of office", message: "Back on Monday.", accountIds: null, onlyKnown: false } } })
      .where(eq(schema.users.id, userId));
    await sink().upsertMessages([
      msg(`petra@${DOMAIN}`, { subject: "Saturday?" }),
      msg(`petra@${DOMAIN}`, { subject: "And Sunday?" }),
      msg(`news@shop-${DOMAIN}`, { subject: "Deals", bulk: true }),
      msg(`noreply@bank-${DOMAIN}`, { subject: "Statement" }),
    ]);
    expect(await sendAwayReplies()).toBe(1);
    const [sent] = adapter.send.mock.calls[0];
    expect(sent.to).toEqual([{ name: "petra", email: `petra@${DOMAIN}` }]);
    expect(sent.subject).toBe("Out of office");
    expect(sent.text).toBe("Back on Monday.");
    expect(sent.headers?.["Auto-Submitted"]).toBe("auto-replied");
    // Not twice in a few days.
    expect(await sendAwayReplies()).toBe(0);

    // Several replies: one saved for later, one on in this mailbox, only for people from the address book.
    const reply = { from: Date.now() - 60_000, until: null, subject: "", onlyKnown: true };
    await db()
      .update(schema.users)
      .set({
        settings: {
          awayReplies: [
            { ...reply, id: "saved", name: "Holiday", on: false, message: "On holiday.", accountIds: [accountId] },
            { ...reply, id: "trip", name: "Trip", on: true, message: "On a trip.", accountIds: [accountId] },
          ],
        },
      })
      .where(eq(schema.users.id, userId));
    await sink().upsertMessages([msg(`stranger@${DOMAIN}`, { subject: "Hi" })]);
    expect(await sendAwayReplies()).toBe(0);
    // Once they're in the address book, they get the reply that's on.
    await db().insert(schema.contacts).values({ userId, name: "Known now", emails: [`stranger@${DOMAIN}`] });
    adapter.send.mockClear();
    expect(await sendAwayReplies()).toBe(1);
    expect(adapter.send.mock.calls[0][0]).toMatchObject({ subject: "Re: Hi", text: "On a trip." });
  });
});
