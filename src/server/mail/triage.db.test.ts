import { and, eq, like } from "drizzle-orm";
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
const { applyThreadPatch, listThreads, setNote, toTsQuery } = await import("./service");
const { archiveMutedMail } = await import("./mute");

const DOMAIN = "triage-test.invalid";
const ME = `me@${DOMAIN}`;
let userId = "";
let accountId = "";
let n = 0;
const DAY = 86_400_000;

const msg = (from: string, over: Partial<RemoteMessage> = {}): RemoteMessage => ({
  providerMessageId: `INBOX:1:${++n}`,
  messageIdHeader: `<t${n}@x>`,
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

/** A message the user sent, `daysAgo` days back, to `to`. */
const sent = (to: string, daysAgo: number, over: Partial<RemoteMessage> = {}) =>
  msg(ME, { role: "sent", unread: false, to: [{ name: "", email: to }], date: new Date(Date.now() - daysAgo * DAY), providerMessageId: `Sent:1:${++n}`, ...over });

beforeEach(async () => {
  adapter.move.mockClear();
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
  const [u] = await db().insert(schema.users).values({ email: ME }).returning();
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

const list = async (folder: "inbox" | "unanswered" | "archive", query?: string) => (await listThreads(userId, { folder, query })).threads;

describe("mute", () => {
  it("takes a conversation out of Inbox and keeps new replies out, without a notification", async () => {
    const first = new DbSyncSink({ id: accountId, userId, email: ME }, true);
    await first.upsertMessages([msg(`all@${DOMAIN}`, { subject: "Reunion", messageIdHeader: "<root@x>" })]);
    const [thread] = await list("inbox");
    await applyThreadPatch(userId, thread.id, { muted: true });
    expect(adapter.move).toHaveBeenCalledWith(expect.anything(), "archive");
    expect(await list("inbox")).toEqual([]);

    const reply = new DbSyncSink({ id: accountId, userId, email: ME }, true);
    await reply.upsertMessages([msg(`other@${DOMAIN}`, { subject: "Re: Reunion", inReplyTo: "<root@x>", references: ["<root@x>"] })]);
    expect(reply.newMail).toEqual([]);
    expect(await list("inbox")).toEqual([]);
    adapter.move.mockClear();
    expect(await archiveMutedMail()).toBe(1);
    expect(adapter.move).toHaveBeenCalledWith(expect.anything(), "archive");

    // Back to Inbox by hand: listening again.
    await applyThreadPatch(userId, thread.id, { folder: "inbox" });
    const [back] = await list("inbox");
    expect(back.id).toBe(thread.id);
    expect(back.muted).toBeUndefined();
  });
});

describe("no reply yet", () => {
  it("lists the user's own questions nobody answered, after three working days, until dismissed", async () => {
    const sink = new DbSyncSink({ id: accountId, userId, email: ME }, false);
    await sink.upsertMessages([
      sent(`petr@${DOMAIN}`, 6, { subject: "Contract", snippet: "Could you sign it by Friday?" }),
      sent(`jana@${DOMAIN}`, 6, { subject: "Thanks", snippet: "Thanks, see you!", messageIdHeader: "<thanks@x>", inReplyTo: "<asked@x>", references: ["<asked@x>"] }),
      sent(`noreply@${DOMAIN}`, 6, { subject: "Ticket", snippet: "Any news?" }),
      sent(`eva@${DOMAIN}`, 1, { subject: "Fresh", snippet: "Free tomorrow?" }),
      sent(`old@${DOMAIN}`, 40, { subject: "Ancient", snippet: "Still there?" }),
    ]);
    // Jana's thread started with her email, so the user's "Thanks" doesn't wait for anything.
    await sink.upsertMessages([msg(`jana@${DOMAIN}`, { subject: "Dinner", messageIdHeader: "<asked@x>", date: new Date(Date.now() - 7 * DAY) })]);
    const waiting = await list("unanswered");
    expect(waiting.map((t) => t.subject)).toEqual(["Contract"]);
    expect(waiting[0].awaiting).toBe(true);

    await applyThreadPatch(userId, waiting[0].id, { noReplyDismissed: true });
    expect(await list("unanswered")).toEqual([]);
  });
});

describe("search", () => {
  it("understands from:, has:attachment and in:all", async () => {
    const sink = new DbSyncSink({ id: accountId, userId, email: ME }, false);
    await sink.upsertMessages([
      msg(`billing@vodafone-${DOMAIN}`, { subject: "Faktura září", attachments: [{ id: "1", name: "f.pdf", size: 10, mime: "application/pdf" }] }),
      msg(`petr@${DOMAIN}`, { subject: "Faktura od Petra" }),
      msg(`billing@vodafone-${DOMAIN}`, { subject: "Faktura srpen", role: "archive" }),
    ]);
    expect((await list("inbox", "faktura from:vodafone")).map((t) => t.subject)).toEqual(["Faktura září"]);
    expect((await list("inbox", "has:attachment")).map((t) => t.subject)).toEqual(["Faktura září"]);
    expect((await list("inbox", "from:vodafone in:all")).map((t) => t.subject).sort()).toEqual(["Faktura srpen", "Faktura září"]);
  });

  it("finds a part of an address or a link, with or without diacritics", async () => {
    const sink = new DbSyncSink({ id: accountId, userId, email: ME }, false);
    await sink.upsertMessages([
      msg("info@nasereality.test", { subject: "Děkujeme za Vaše hodnocení", role: "archive" }),
      msg(`petr@${DOMAIN}`, { subject: "Nový byt", snippet: "Mrkni na https://www.nasereality.test/nabidka" }),
      msg(`jana@${DOMAIN}`, { subject: "Oběd", snippet: "Zítra?" }),
    ]);
    const subjects = async (folder: "inbox" | "archive", query: string) => (await list(folder, query)).map((t) => t.subject).sort();
    expect(await subjects("inbox", "nasereality in:all")).toEqual(["Děkujeme za Vaše hodnocení", "Nový byt"]);
    expect(await subjects("archive", "info@nasereality.test")).toEqual(["Děkujeme za Vaše hodnocení"]);
    expect(await subjects("inbox", "dekujeme in:all")).toEqual(["Děkujeme za Vaše hodnocení"]);
    expect(await subjects("inbox", "obed")).toEqual(["Oběd"]);
    expect(await subjects("inbox", "zítra")).toEqual(["Oběd"]);
  });
});

describe("inbox order", () => {
  it("merges reminders that came due into Inbox by when each last moved, page by page", async () => {
    const sink = new DbSyncSink({ id: accountId, userId, email: ME }, false);
    const ago = (days: number) => new Date(Date.now() - days * DAY);
    await sink.upsertMessages([
      msg(`a@${DOMAIN}`, { subject: "Old", date: ago(3) }),
      msg(`b@${DOMAIN}`, { subject: "Recent", date: ago(1) }),
      msg(`c@${DOMAIN}`, { subject: "Reminder", date: ago(10), role: "archive" }),
      msg(`d@${DOMAIN}`, { subject: "Snoozed", date: ago(0.5) }),
      msg(`e@${DOMAIN}`, { subject: "Woken", date: ago(5) }),
    ]);
    const set = async (subject: string, patch: Partial<typeof schema.threads.$inferInsert>) =>
      db()
        .update(schema.threads)
        .set(patch)
        .where(and(eq(schema.threads.accountId, accountId), eq(schema.threads.subject, subject)));
    await set("Reminder", { followUpAt: ago(2) });
    await set("Snoozed", { snoozedUntil: new Date(Date.now() + DAY) });
    await set("Woken", { wokeAt: new Date(Date.now() - 3600_000) });
    await set("Old", { pinned: true });

    const first = await listThreads(userId, { folder: "inbox", limit: 2 });
    expect(first.threads.map((t) => t.subject)).toEqual(["Woken", "Recent"]);
    const second = await listThreads(userId, { folder: "inbox", limit: 2, cursor: first.nextCursor! });
    expect(second.threads.map((t) => t.subject)).toEqual(["Reminder", "Old"]);
    expect(second.nextCursor).toBeNull();
    expect((await listThreads(userId, { folder: "pinned" })).threads.map((t) => t.subject)).toEqual(["Old"]);
  });

  it("leaves one-letter words out of a search next to longer ones", () => {
    expect(toTsQuery("a faktura")).toBe("faktur:*");
    expect(toTsQuery("x")).toBe("x:*");
  });

  it("splits an address into its words, as the index does", () => {
    expect(toTsQuery("info@nasereality.test")).toBe("info:* & naserealit:* & (test:* | teset:*)");
    expect(toTsQuery("www.nasereality.test/nabidka")).toBe("www:* & naserealit:* & (test:* | teset:*) & (nabidk:* | nabidce:* | nabidci:* | nabidek:*)");
  });

  it("finds a Czech word in its other forms", async () => {
    const sink = new DbSyncSink({ id: accountId, userId, email: ME }, false);
    await sink.upsertMessages([msg(`obchod@${DOMAIN}`, { subject: "Zdržení výroby", snippet: "U kšiltovek se nám výroba protáhla." })]);
    const found = await listThreads(userId, { query: "kšiltovka in:all" });
    expect(found.threads.map((t) => t.subject)).toContain("Zdržení výroby");
    expect((await listThreads(userId, { query: "kšiltovkami in:all" })).threads.map((t) => t.subject)).toContain("Zdržení výroby");
  });
});

describe("notes", () => {
  it("keeps a private note with the conversation", async () => {
    const sink = new DbSyncSink({ id: accountId, userId, email: ME }, false);
    await sink.upsertMessages([msg(`petr@${DOMAIN}`)]);
    const [thread] = await list("inbox");
    expect(await setNote(userId, thread.id, "  Called him on the 15th.  ")).toBe("Called him on the 15th.");
    const [row] = await db().select().from(schema.threads).where(eq(schema.threads.id, thread.id));
    expect(row.note).toBe("Called him on the 15th.");
    expect((await list("inbox"))[0].note).toBe("Called him on the 15th.");
    await setNote(userId, thread.id, "");
    expect((await list("inbox"))[0].note).toBeUndefined();
  });
});
