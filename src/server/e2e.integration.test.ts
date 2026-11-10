import { and, eq } from "drizzle-orm";
import { ImapFlow } from "imapflow";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakeSmtp, type SmtpCapture } from "../../test/fake-smtp";
import { db, schema } from "./db";
import { upsertAccount } from "./mail/accounts";
import { archiveThread, getThread, listThreads, moveThread, queueSend, saveDraft, setPinned, setUnread } from "./mail/service";
import { loadAccount, syncAccount } from "./sync/engine";
import { claimOne, sendClaimed } from "./sync/outbox";

/**
 * The whole live pipeline against a real IMAP server: connect → import → thread → read/pin/archive
 * written back to the server → reply through the outbox with tracking → re-sync without duplicates.
 * Skipped unless IMAP_TEST_HOST is set (see imap.integration.test.ts for the Dovecot setup).
 */
const host = process.env.IMAP_TEST_HOST;
const port = Number(process.env.IMAP_TEST_PORT ?? 143);
const user = process.env.IMAP_TEST_USER ?? "";
const pass = process.env.IMAP_TEST_PASS ?? "";
const APP_USER = "e2e@kolbaba.test";

const mail = (headers: Record<string, string>, body: string) =>
  Object.entries({ "MIME-Version": "1.0", "Content-Type": "text/html; charset=utf-8", ...headers })
    .map(([k, v]) => `${k}: ${v}`)
    .join("\r\n") +
  "\r\n\r\n" +
  body;

describe.skipIf(!host)("live pipeline against IMAP", () => {
  let smtp: SmtpCapture;
  let raw: ImapFlow;
  let userId = "";
  let accountId = "";

  const flagsOf = async (path: string) => {
    const lock = await raw.getMailboxLock(path);
    try {
      // The raw connection may hold a stale view of a mailbox another connection just changed.
      await raw.noop();
      const out: { subject: string; flags: string[] }[] = [];
      if (raw.mailbox && raw.mailbox.exists) {
        for await (const m of raw.fetch("1:*", { envelope: true, flags: true })) out.push({ subject: m.envelope?.subject ?? "", flags: [...(m.flags ?? [])] });
      }
      return out;
    } finally {
      lock.release();
    }
  };

  beforeAll(async () => {
    smtp = await fakeSmtp();
    raw = new ImapFlow({ host, port, secure: false, doSTARTTLS: false, auth: { user, pass }, logger: false });
    raw.on("error", () => {});
    await raw.connect();
    for (const box of await raw.list()) {
      if (box.path === "INBOX" || box.specialUse) {
        const lock = await raw.getMailboxLock(box.path);
        try {
          if (raw.mailbox && raw.mailbox.exists) await raw.messageDelete("1:*");
        } finally {
          lock.release();
        }
      } else await raw.mailboxDelete(box.path);
    }
    const now = Date.now();
    await raw.append(
      "INBOX",
      mail(
        { From: "Petr Novák <petr@firma.cz>", To: user, Subject: "Rozpočet Q4", "Message-ID": "<a1@firma.cz>", Date: new Date(now - 3600_000).toUTCString() },
        "<p>Ahoj, posílám rozpočet. <img src=\"https://tracker.example/p.gif\" width=1 height=1></p>",
      ),
    );
    await raw.append(
      "INBOX",
      mail(
        {
          From: "Petr Novák <petr@firma.cz>",
          To: user,
          Subject: "Re: Rozpočet Q4",
          "Message-ID": "<a2@firma.cz>",
          "In-Reply-To": "<a1@firma.cz>",
          References: "<a1@firma.cz>",
          Date: new Date(now - 600_000).toUTCString(),
        },
        "<p>Ještě jedna věc: <b>termín je pátek</b>.</p>",
      ),
    );

    await db().delete(schema.users).where(eq(schema.users.email, APP_USER));
    const [u] = await db().insert(schema.users).values({ email: APP_USER, name: "Daniel" }).returning();
    userId = u.id;
    ({ id: accountId } = await upsertAccount({
      userId,
      provider: "imap",
      providerLabel: "Test",
      email: user,
      fromName: "Daniel",
      imap: { host: host!, port, secure: false },
      smtp: { host: "127.0.0.1", port: smtp.port, secure: false },
      credentials: { kind: "password", password: pass },
    }));
  }, 30_000);

  afterAll(async () => {
    await db().delete(schema.users).where(eq(schema.users.email, APP_USER));
    await raw?.logout().catch(() => {});
    smtp?.server.close();
  });

  const sync = async () => syncAccount((await loadAccount(accountId))!);

  it("imports and threads the mailbox", async () => {
    await sync();
    const { threads } = await listThreads(userId, { folder: "inbox" });
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ subject: "Rozpočet Q4", unread: true, folder: "inbox" });
    expect(threads[0].messages).toHaveLength(2);
  });

  it("serves sanitised bodies with the tracker blocked", async () => {
    const [t] = (await listThreads(userId, { folder: "inbox" })).threads;
    const full = await getThread(userId, t.id);
    expect(full.messages[1].html).toContain("termín je pátek");
    expect(full.messages[0].html).not.toContain("tracker.example");
  });

  it("writes read and pin through to the server", async () => {
    const [t] = (await listThreads(userId, { folder: "inbox" })).threads;
    await setUnread(userId, t.id, false);
    await setPinned(userId, t.id, true);
    const inbox = await flagsOf("INBOX");
    expect(inbox.every((m) => m.flags.includes("\\Seen"))).toBe(true);
    expect(inbox.filter((m) => m.flags.includes("\\Flagged"))).toHaveLength(1);
  });

  it("archives on the server and stays consistent after re-sync", async () => {
    const [t] = (await listThreads(userId, { folder: "inbox" })).threads;
    await archiveThread(userId, t.id);
    expect(await flagsOf("INBOX")).toHaveLength(0);
    expect(await flagsOf("Archive")).toHaveLength(2);
    await sync();
    expect((await listThreads(userId, { folder: "inbox" })).threads).toHaveLength(0);
    const { threads } = await listThreads(userId, { folder: "archive" });
    expect(threads).toHaveLength(1);
    expect(threads[0].messages).toHaveLength(2);
    expect(threads[0].pinned).toBe(true);
    await moveThread(userId, t.id, "inbox");
    expect(await flagsOf("INBOX")).toHaveLength(2);
    await sync();
  });

  it("replies through the outbox with tracking, without duplicates after sync", async () => {
    const [t] = (await listThreads(userId, { folder: "inbox" })).threads;
    const draft = await saveDraft(userId, { accountId, threadId: t.id, to: "petr@firma.cz", subject: "Re: Rozpočet Q4", html: "<p>Díky, <b>v pátek</b> to bude.</p>" });
    const row = await queueSend(userId, draft.id, { track: true, followUpDays: 3 });
    expect(await claimOne(row.id)).toBeNull(); // still inside the undo window
    await db().update(schema.outbox).set({ sendAt: new Date() }).where(eq(schema.outbox.id, row.id));
    await sendClaimed((await claimOne(row.id))!);

    const sent = smtp.mails.at(-1)!;
    expect(sent.data).toMatch(/In-Reply-To: <a2@firma.cz>/);
    expect(sent.data).toContain("/api/t/");
    expect(await flagsOf("Sent")).toHaveLength(1);

    const tracked = await db().select().from(schema.trackedMessages).where(eq(schema.trackedMessages.outboxId, row.id));
    expect(tracked).toHaveLength(1);

    await sync();
    const full = await getThread(userId, t.id);
    expect(full.messages).toHaveLength(3);
    expect(full.messages[2].tracked).toBe(true);
    expect(full.messages[2].html).not.toContain("/api/t/");
    const [thread] = await db().select().from(schema.threads).where(and(eq(schema.threads.id, t.id)));
    expect(thread.followUpAt).not.toBeNull();
    const msgs = await db().select().from(schema.messages).where(eq(schema.messages.threadId, t.id));
    expect(msgs.filter((m) => m.providerMessageId.startsWith("local:"))).toHaveLength(0);
  });
});
