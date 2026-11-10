import { ImapFlow } from "imapflow";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakeSmtp, type SmtpCapture } from "../../../test/fake-smtp";
import { createImapAdapter, type ImapAdapterOptions } from "./imap";
import { MailAuthError, MailNotFoundError, type AdapterAccount, type FlagChange, type RemoteMessage, type SyncSink } from "./types";
import type { FolderRole, SyncState } from "../db/schema";

/**
 * End-to-end against a real IMAP server (Dovecot). Skipped unless IMAP_TEST_HOST is set, e.g.
 *   IMAP_TEST_HOST=127.0.0.1 IMAP_TEST_PORT=14143 IMAP_TEST_USER=test@example.cz IMAP_TEST_PASS=secret
 * The account's mailbox is wiped. SMTP is a tiny in-process fake.
 */
const host = process.env.IMAP_TEST_HOST;
const port = Number(process.env.IMAP_TEST_PORT ?? 143);
const user = process.env.IMAP_TEST_USER ?? "";
const pass = process.env.IMAP_TEST_PASS ?? "";

class MemorySink implements SyncSink {
  messages = new Map<string, RemoteMessage>();
  flags: FlagChange[] = [];
  removed: string[] = [];
  state: Partial<SyncState> = {};
  folders: Partial<Record<FolderRole, string>> = {};
  async upsertMessages(messages: RemoteMessage[]) {
    for (const m of messages) this.messages.set(m.providerMessageId, m);
  }
  async updateFlags(changes: FlagChange[]) {
    this.flags.push(...changes);
    for (const c of changes) {
      const m = this.messages.get(c.providerMessageId);
      if (m && c.unread !== undefined) m.unread = c.unread;
      if (m && c.pinned !== undefined) m.pinned = c.pinned;
    }
  }
  async removeMessages(ids: string[]) {
    this.removed.push(...ids);
    for (const id of ids) this.messages.delete(id);
  }
  async saveState(patch: Partial<SyncState>) {
    this.state = { ...this.state, ...patch };
  }
  async saveFolders(folders: Partial<Record<FolderRole, string>>) {
    this.folders = folders;
  }
  forgotten: string[] = [];
  async forgetFolder(path: string) {
    this.forgotten.push(path);
    for (const [id, m] of this.messages) if (m.imapPath === path) this.messages.delete(id);
  }
  async knownUids(path: string) {
    return [...this.messages.values()].filter((m) => m.imapPath === path).map((m) => m.imapUid!);
  }
  bySubject(subject: string) {
    return [...this.messages.values()].find((m) => m.subject === subject);
  }
}

function rawMail(subject: string, body: string, extra = "") {
  return Buffer.from(
    [
      `From: "Jana Nováková" <jana@example.cz>`,
      `To: test@example.cz`,
      `Subject: ${subject}`,
      `Message-ID: <${subject.replace(/\W+/g, "-")}-${Date.now()}@example.cz>`,
      `Date: ${new Date().toUTCString()}`,
      `MIME-Version: 1.0`,
      extra,
      body,
    ]
      .filter((l) => l !== "")
      .join("\r\n"),
  );
}

const withAttachment = (subject: string) =>
  rawMail(
    subject,
    [
      "",
      "--b1",
      "Content-Type: multipart/related; boundary=b2",
      "",
      "--b2",
      "Content-Type: text/html; charset=utf-8",
      "",
      '<p>Ahoj <img src="cid:logo@x"></p>',
      "--b2",
      "Content-Type: image/png",
      "Content-ID: <logo@x>",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from("png-bytes").toString("base64"),
      "--b2--",
      "--b1",
      'Content-Type: application/pdf; name="faktura.pdf"',
      'Content-Disposition: attachment; filename="faktura.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from("%PDF-1.4 fake").toString("base64"),
      "--b1--",
      "",
    ].join("\r\n"),
    'Content-Type: multipart/mixed; boundary=b1\r\nList-Id: <news.example.cz>\r\nList-Unsubscribe: <https://example.cz/u>',
  );

describe.skipIf(!host)("ImapAdapter against a live IMAP server", () => {
  let smtp: SmtpCapture;
  let raw: ImapFlow;
  const account = (overrides: Partial<AdapterAccount> = {}): AdapterAccount => ({
    id: "acc_test",
    email: user,
    fromName: "Test",
    provider: "imap",
    imap: { host: host!, port, secure: false },
    smtp: { host: "127.0.0.1", port: smtp.port, secure: false },
    folders: {},
    credentials: { kind: "password", password: pass },
    syncState: {},
    saveCredentials: async () => {},
    ...overrides,
  });

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
  });

  afterAll(async () => {
    await raw?.logout().catch(() => {});
    smtp?.server.close();
  });

  for (const variant of [
    { name: "with CONDSTORE/QRESYNC", options: {} as ImapAdapterOptions },
    { name: "without CONDSTORE (fallback)", options: { imap: { disableAutoEnable: true, qresync: false } } },
  ]) {
    it(`syncs, detects changes and performs operations ${variant.name}`, async () => {
      const tag = variant.name.includes("fallback") ? "B" : "A";
      await raw.append("INBOX", rawMail(`${tag} Příliš žluťoučký kůň`, "\r\nÚpěl ďábelské ódy.", "Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit"), ["\\Flagged"]);
      await raw.append("INBOX", withAttachment(`${tag} Faktura`), ["\\Seen"]);
      await raw.append("INBOX", rawMail(`${tag} Velká`, "\r\n" + "Dlouhý text. ".repeat(20_000), "Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit"));

      const sink = new MemorySink();
      const adapter = createImapAdapter(account(), variant.options);
      await adapter.verify();
      await adapter.initialSync(sink, { since: new Date(Date.now() - 86_400_000) });

      expect(sink.folders).toMatchObject({ inbox: "INBOX", sent: "Sent", trash: "Trash", spam: "Junk", drafts: "Drafts", archive: "Archive" });
      const kun = sink.bySubject(`${tag} Příliš žluťoučký kůň`)!;
      expect(kun).toMatchObject({ unread: true, pinned: true, role: "inbox", from: { name: "Jana Nováková", email: "jana@example.cz" } });
      expect(kun.text).toContain("Úpěl ďábelské ódy.");
      expect(kun.snippet).toBe("Úpěl ďábelské ódy.");
      const faktura = sink.bySubject(`${tag} Faktura`)!;
      expect(faktura).toMatchObject({ unread: false, bulk: true, listUnsubscribe: "<https://example.cz/u>" });
      expect(faktura.html).toContain('src="cid:logo@x"');
      expect(faktura.attachments).toEqual([
        { id: "1.2", name: "attachment.png", size: 9, mime: "image/png", cid: "logo@x", inline: true },
        { id: "2", name: "faktura.pdf", size: expect.any(Number) as number, mime: "application/pdf", inline: false },
      ]);
      // BODYSTRUCTURE only has the encoded size, so ours is an estimate.
      expect(Math.abs(faktura.attachments[1].size - 13)).toBeLessThanOrEqual(3);
      const velka = sink.bySubject(`${tag} Velká`)!;
      expect(velka.html).toBeUndefined();
      expect(velka.snippet.startsWith("Dlouhý text. Dlouhý text.")).toBe(true);
      expect(sink.state.folders?.INBOX?.uidValidity).toBeTruthy();

      // Body + attachment on demand.
      const body = await adapter.fetchBody(velka);
      expect(body.text?.length).toBeGreaterThan(200_000);
      const pdf = await adapter.fetchAttachment(faktura, "2");
      expect(pdf).toMatchObject({ name: "faktura.pdf", mime: "application/pdf" });
      expect(pdf.content.toString()).toBe("%PDF-1.4 fake");

      // Changes made by "another client".
      const next = createImapAdapter(account({ syncState: sink.state, folders: sink.folders }), variant.options);
      let lock = await raw.getMailboxLock("INBOX");
      try {
        await raw.messageFlagsAdd({ uid: String(kun.imapUid) }, ["\\Seen"], { uid: true });
        await raw.messageDelete({ uid: String(velka.imapUid) }, { uid: true });
      } finally {
        lock.release();
      }
      await raw.append("INBOX", rawMail(`${tag} Nová`, "\r\nnová zpráva", "Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit"));
      await next.incrementalSync(sink);
      expect(sink.flags.find((f) => f.providerMessageId === kun.providerMessageId)).toMatchObject({ unread: false, pinned: true });
      expect(sink.removed).toContain(velka.providerMessageId);
      expect(sink.bySubject(`${tag} Nová`)).toBeTruthy();
      expect(sink.messages.has(velka.providerMessageId)).toBe(false);
      await expect(next.fetchBody(velka)).rejects.toBeInstanceOf(MailNotFoundError);

      // Our own operations.
      await next.setFlags([faktura], { unread: true, pinned: true });
      await next.move([kun], "archive");
      lock = await raw.getMailboxLock("INBOX");
      try {
        const f = await raw.fetchOne(String(faktura.imapUid), { flags: true }, { uid: true });
        expect(f && f.flags?.has("\\Flagged")).toBe(true);
        expect(f && f.flags?.has("\\Seen")).toBe(false);
        expect(await raw.search({ uid: String(kun.imapUid) }, { uid: true })).toEqual([]);
      } finally {
        lock.release();
      }
      expect((await raw.status("Archive", { messages: true })).valueOf()).toMatchObject({ messages: tag === "A" ? 1 : 2 });
      await next.close();
      await adapter.close();
    }, 30_000);
  }

  it("detects a UIDVALIDITY change and re-imports the folder", async () => {
    const sink = new MemorySink();
    const stale: SyncState = { folders: { INBOX: { uidValidity: "1", uidNext: 5 } } };
    await createImapAdapter(account({ syncState: stale })).incrementalSync(sink);
    expect(sink.forgotten).toEqual(["INBOX"]);
    expect(sink.removed).toEqual([]);
    expect(sink.messages.size).toBeGreaterThan(0);
    expect(sink.state.folders?.INBOX?.uidValidity).not.toBe("1");
  });

  it("sends over SMTP and files a copy in Sent", async () => {
    const adapter = createImapAdapter(account());
    const res = await adapter.send({
      from: { name: "Test", email: user },
      to: [{ name: "Jana", email: "jana@example.cz" }],
      cc: [],
      bcc: [{ name: "", email: "skryty@example.cz" }],
      subject: "Příliš žluťoučký kůň",
      html: "<p>Ahoj</p>",
      text: "Ahoj",
      inReplyTo: "<parent@example.cz>",
      references: ["<root@example.cz>", "<parent@example.cz>"],
    });
    expect(res.messageIdHeader).toMatch(/^<[0-9a-f]{32}@example\.cz>$/);
    expect(res.providerMessageId).toMatch(/^Sent:\d+:\d+$/);
    const sent = smtp.mails.at(-1)!;
    expect(sent.to).toEqual(["<jana@example.cz>", "<skryty@example.cz>"]);
    expect(sent.data).not.toMatch(/^Bcc:/im);
    expect(sent.data).toContain(`Message-ID: ${res.messageIdHeader}`);

    const sink = new MemorySink();
    await adapter.initialSync(sink, { since: new Date(Date.now() - 86_400_000) });
    const copy = sink.messages.get(res.providerMessageId!)!;
    expect(copy).toMatchObject({ role: "sent", unread: false, subject: "Příliš žluťoučký kůň", inReplyTo: "<parent@example.cz>" });
    expect(copy.bcc).toEqual([{ name: "", email: "skryty@example.cz" }]);
    expect(copy.references).toEqual(["<root@example.cz>", "<parent@example.cz>"]);
  });

  it("watches INBOX and stops cleanly", async () => {
    const adapter = createImapAdapter(account());
    let changes = 0;
    const stop = await adapter.watch!(() => changes++);
    await raw.append("INBOX", rawMail("Watch", "\r\nping"));
    const deadline = Date.now() + 8000;
    while (!changes && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    expect(changes).toBeGreaterThan(0);
    await stop();
  }, 15_000);

  it("maps a wrong password to MailAuthError", async () => {
    const adapter = createImapAdapter(account({ credentials: { kind: "password", password: "wrong" } }));
    const err = await adapter.verify().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MailAuthError);
    expect((err as MailAuthError).reason).toBe("invalid_credentials");
    await expect(adapter.watch!(() => {})).rejects.toBeInstanceOf(MailAuthError);
  }, 20_000);
});
