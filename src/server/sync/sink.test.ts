import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seal } from "../crypto";
import { db, schema } from "../db";
import type { RemoteMessage } from "../mail/types";
import { baseSubject, DbSyncSink, sameJson, sweepEmptyThreads } from "./sink";

const ME = "me@example.cz";
let userId = "";
let accountId = "";

function msg(over: Partial<RemoteMessage> & { providerMessageId: string }): RemoteMessage {
  return {
    references: [],
    from: { name: "Petr", email: "petr@firma.cz" },
    to: [{ name: "Me", email: ME }],
    cc: [],
    bcc: [],
    replyTo: [],
    subject: "Hello",
    date: new Date("2026-10-01T10:00:00Z"),
    snippet: "Hi there",
    attachments: [],
    unread: true,
    pinned: false,
    role: "inbox",
    labels: [],
    ...over,
  };
}

async function threadsOf() {
  return db().select().from(schema.threads).where(eq(schema.threads.accountId, accountId));
}

beforeEach(async () => {
  await db().delete(schema.users).where(eq(schema.users.email, "sink-test@example.cz"));
  const [u] = await db().insert(schema.users).values({ email: "sink-test@example.cz" }).returning();
  userId = u.id;
  const [a] = await db()
    .insert(schema.accounts)
    .values({ userId, provider: "imap", email: ME, name: "Test", hue: 200, credentials: seal("x", "test") })
    .returning();
  accountId = a.id;
});

afterAll(async () => {
  await db().delete(schema.users).where(eq(schema.users.email, "sink-test@example.cz"));
});

describe("DbSyncSink", () => {
  it("threads IMAP replies by headers, even when the reply arrives first", async () => {
    const sink = new DbSyncSink({ id: accountId, userId, email: ME });
    await sink.upsertMessages([
      msg({
        providerMessageId: "INBOX:1:2",
        messageIdHeader: "<b@x>",
        inReplyTo: "<a@x>",
        references: ["<a@x>"],
        subject: "Re: Hello",
        date: new Date("2026-10-02T10:00:00Z"),
        snippet: "Reply",
      }),
    ]);
    await sink.upsertMessages([msg({ providerMessageId: "INBOX:1:1", messageIdHeader: "<a@x>" })]);
    await sink.upsertMessages([
      msg({
        providerMessageId: "Sent:1:9",
        messageIdHeader: "<c@x>",
        references: ["<a@x>", "<b@x>"],
        from: { name: "Me", email: ME },
        role: "sent",
        unread: false,
        date: new Date("2026-10-03T10:00:00Z"),
        snippet: "My answer",
      }),
    ]);

    const [t, ...rest] = await threadsOf();
    expect(rest).toHaveLength(0);
    expect(t.subject).toBe("Hello");
    expect(t.messageCount).toBe(3);
    expect(t.snippet).toBe("My answer");
    expect(t.folder).toBe("inbox");
    expect(t.unread).toBe(true);
    expect(t.participants.map((p) => p.email)).toEqual(["petr@firma.cz"]);
    expect(t.logoDomain).toBe("firma.cz");
  });

  it("derives folder, unread and pin from flag changes and removals", async () => {
    const sink = new DbSyncSink({ id: accountId, userId, email: ME });
    await sink.upsertMessages([msg({ providerMessageId: "g1", providerThreadId: "T1", messageIdHeader: "<g1@x>" })]);
    await sink.updateFlags([{ providerMessageId: "g1", unread: false, pinned: true, role: "archive" }]);
    let [t] = await threadsOf();
    expect(t).toMatchObject({ unread: false, pinned: true, folder: "archive" });

    await sink.updateFlags([{ providerMessageId: "g1", pinned: false, role: "trash" }]);
    [t] = await threadsOf();
    expect(t).toMatchObject({ pinned: false, folder: "trash" });

    // An emptied thread survives a while (IMAP moves arrive as remove + add), then gets swept.
    await sink.removeMessages(["g1"]);
    [t] = await threadsOf();
    expect(t.messageCount).toBe(0);
    await sink.upsertMessages([msg({ providerMessageId: "g1-archived", providerThreadId: "T1", messageIdHeader: "<g1@x>", role: "archive" })]);
    const [revived, ...others] = await threadsOf();
    expect(others).toHaveLength(0);
    expect(revived).toMatchObject({ id: t.id, messageCount: 1, folder: "archive" });
    await sink.removeMessages(["g1-archived"]);
    await sweepEmptyThreads(accountId, -1);
    expect(await threadsOf()).toHaveLength(0);
  });

  it("lets the synced copy of mail we sent take over its placeholder instead of duplicating it", async () => {
    const sink = new DbSyncSink({ id: accountId, userId, email: ME });
    const sent = { messageIdHeader: "<sent@x>", from: { name: "Me", email: ME }, role: "sent" as const, unread: false, snippet: "Sent from Kolbaba" };
    await sink.upsertMessages([msg({ providerMessageId: "local:<sent@x>", ...sent })]);
    const [t] = await threadsOf();

    await sink.upsertMessages([
      msg({ providerMessageId: "INBOX:1:7", messageIdHeader: "<other@x>" }),
      msg({ providerMessageId: "Sent:1:3", imapPath: "Sent", imapUid: 3, ...sent }),
    ]);
    const rows = await db().select().from(schema.messages).where(eq(schema.messages.accountId, accountId));
    expect(rows.map((r) => r.providerMessageId).sort()).toEqual(["INBOX:1:7", "Sent:1:3"]);
    expect(rows.find((r) => r.providerMessageId === "Sent:1:3")).toMatchObject({ threadId: t.id, imapUid: 3 });
  });

  it("leaves a message alone when a server reports the same flags again", async () => {
    const sink = new DbSyncSink({ id: accountId, userId, email: ME });
    await sink.upsertMessages([msg({ providerMessageId: "INBOX:1:5", imapPath: "INBOX", imapUid: 5, pinned: true, html: "<p>Hi</p>" })]);
    const [t] = await threadsOf();
    const longAgo = new Date("2026-01-01T00:00:00Z");
    await db().update(schema.threads).set({ updatedAt: longAgo }).where(eq(schema.threads.id, t.id));

    // Without CONDSTORE every sync re-reports the newest messages, as the IMAP adapter does here.
    await sink.updateFlags([{ providerMessageId: "INBOX:1:5", imapPath: "INBOX", imapUid: 5, unread: true, pinned: true }]);
    expect((await threadsOf())[0].updatedAt).toEqual(longAgo);

    await sink.updateFlags([{ providerMessageId: "INBOX:1:5", imapPath: "INBOX", imapUid: 5, unread: false, pinned: true }]);
    const [after] = await threadsOf();
    expect(after.updatedAt).not.toEqual(longAgo);
    expect(after).toMatchObject({ unread: false, pinned: true });
  });

  it("wakes snoozed threads and clears follow-ups when someone replies", async () => {
    const sink = new DbSyncSink({ id: accountId, userId, email: ME }, true);
    await sink.upsertMessages([msg({ providerMessageId: "g1", providerThreadId: "T1", unread: false })]);
    const [t] = await threadsOf();
    await db()
      .update(schema.threads)
      .set({ snoozedUntil: new Date(Date.now() + 3600_000), followUpAt: new Date(Date.now() + 3600_000) })
      .where(eq(schema.threads.id, t.id));

    await sink.upsertMessages([msg({ providerMessageId: "g2", providerThreadId: "T1", date: new Date("2026-10-05T10:00:00Z") })]);
    const [after] = await threadsOf();
    expect(after.snoozedUntil).toBeNull();
    expect(after.followUpAt).toBeNull();
    expect(sink.newMail).toHaveLength(1);
  });

  it("keeps a snoozed conversation in Inbox while the provider has it archived", async () => {
    const sink = new DbSyncSink({ id: accountId, userId, email: ME });
    await sink.upsertMessages([msg({ providerMessageId: "s1", providerThreadId: "S" })]);
    const [t] = await threadsOf();
    await db().update(schema.threads).set({ snoozedUntil: new Date(Date.now() + 3600_000) }).where(eq(schema.threads.id, t.id));
    // The snooze archived it at the provider; the next sync sees that.
    await sink.upsertMessages([msg({ providerMessageId: "s1", providerThreadId: "S", role: "archive" })]);
    expect((await threadsOf())[0].folder).toBe("inbox");
    // Not snoozed any more (and still archived there): it's an archived conversation again.
    await db().update(schema.threads).set({ snoozedUntil: null }).where(eq(schema.threads.id, t.id));
    await sink.upsertMessages([msg({ providerMessageId: "s1", providerThreadId: "S", role: "archive" })]);
    expect((await threadsOf())[0].folder).toBe("archive");
  });

  it("someone waiting for an answer has it once the user replies in the conversation", async () => {
    const sink = new DbSyncSink({ id: accountId, userId, email: ME });
    await sink.upsertMessages([msg({ providerMessageId: "q1", providerThreadId: "Q", messageIdHeader: "<q1@x>" })]);
    const [t] = await threadsOf();
    const [m] = await db().select().from(schema.messages).where(eq(schema.messages.threadId, t.id));
    await db()
      .insert(schema.insights)
      .values({ userId, accountId, threadId: t.id, messageId: m.id, category: "reply", groupKey: `reply:${t.id}`, data: { merchant: "Petr", amount: null, currency: null, reply: { ask: "poslat smlouvu", dueAt: null } }, source: "test", at: m.date });
    await sink.upsertMessages([
      msg({ providerMessageId: "q2", providerThreadId: "Q", from: { name: "Me", email: ME }, to: [{ name: "Petr", email: "petr@firma.cz" }], role: "sent", date: new Date("2026-10-02T10:00:00Z"), inReplyTo: "<q1@x>" }),
    ]);
    const [ins] = await db().select().from(schema.insights).where(eq(schema.insights.threadId, t.id));
    expect(ins.doneAt).not.toBeNull();
  });

  it("merges sync cursors per folder", async () => {
    const sink = new DbSyncSink({ id: accountId, userId, email: ME });
    await sink.saveState({ folders: { INBOX: { uidValidity: "1", uidNext: 5 } } });
    await sink.saveState({ folders: { Sent: { uidValidity: "2" } }, backfilledUntil: 1 });
    const [a] = await db().select().from(schema.accounts).where(eq(schema.accounts.id, accountId));
    expect(a.syncState).toEqual({ folders: { INBOX: { uidValidity: "1", uidNext: 5 }, Sent: { uidValidity: "2" } }, backfilledUntil: 1 });
  });

  it("tells an unchanged sync cursor from a moved one, whatever the order of its keys", () => {
    const stored = { folders: { INBOX: { uidNext: 5, uidValidity: "1" } }, backfilledUntil: 1 };
    expect(sameJson({ backfilledUntil: 1, folders: { INBOX: { uidValidity: "1", uidNext: 5 } } }, stored)).toBe(true);
    expect(sameJson({ backfilledUntil: 1, folders: { INBOX: { uidValidity: "1", uidNext: 6 } } }, stored)).toBe(false);
  });

  it("strips reply prefixes in several languages", () => {
    expect(baseSubject("Re: Fwd: Odp: Hello")).toBe("Hello");
    expect(baseSubject("RE[2]: Faktura")).toBe("Faktura");
    expect(baseSubject("Return of the king")).toBe("Return of the king");
  });

  it("tells a person answering from a shop's info@ from the shop's automatic mail", async () => {
    const sink = new DbSyncSink({ id: accountId, userId, email: ME }, false);
    const shop = { name: "Obchod.cz", email: "info@shop.cz" };
    await sink.upsertMessages([
      msg({ providerMessageId: "k1", messageIdHeader: "<order@shop.cz>", from: shop, subject: "Objednávka je přijatá" }),
      msg({ providerMessageId: "k2", messageIdHeader: "<m157@shop.cz>", inReplyTo: "<conversation-68@shop.cz>", from: { ...shop, name: "Pavel z Obchod.cz" }, subject: "Odešleme do konce týdne" }),
      msg({ providerMessageId: "k3", messageIdHeader: "<n@app.cz>", from: { name: "App", email: "no-reply@app.cz" }, inReplyTo: "<x@app.cz>", subject: "Nové přihlášení" }),
      msg({ providerMessageId: "k4", messageIdHeader: "<me@x>", from: { name: "Me", email: ME }, role: "sent", subject: "Dotaz" }),
    ]);
    const kinds = Object.fromEntries((await threadsOf()).map((t) => [t.subject, t.kind]));
    expect(kinds).toEqual({ "Objednávka je přijatá": "notification", "Odešleme do konce týdne": "person", "Nové přihlášení": "notification", Dotaz: "person" });
  });
});
