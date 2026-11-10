import type { FetchMessageObject, MessageStructureObject } from "imapflow";
import { describe, expect, it } from "vitest";
import { buildMessage, newMessageId, smtpAutoSavesSent } from "./imap/compose";
import { toMailError } from "./imap/errors";
import { detectFolders, ownFolders, type ListedFolder } from "./imap/folders";
import {
  attachmentsFromStructure,
  decodePart,
  findTextPart,
  locate,
  makeSnippet,
  messageDate,
  parseProviderMessageId,
  providerMessageId,
  toRemoteMessage,
} from "./imap/message";
import { backoffDelay, compactUidSet, missingUids, uidSetParts, uidsBelow } from "./imap/sync";
import { MailAuthError } from "./types";

const box = (path: string, flags: string[] = [], delimiter = "/", extra: Partial<ListedFolder> = {}): ListedFolder => ({
  path,
  name: path.split(delimiter).pop()!,
  delimiter,
  flags: new Set(flags),
  ...extra,
});

describe("detectFolders", () => {
  it("uses SPECIAL-USE flags (Dovecot)", () => {
    const list = [box("INBOX"), box("Sent", ["\\Sent"]), box("Trash", ["\\Trash"]), box("Junk", ["\\Junk"]), box("Drafts", ["\\Drafts"]), box("Archive", ["\\Archive"])];
    expect(detectFolders(list)).toEqual({ inbox: "INBOX", sent: "Sent", trash: "Trash", spam: "Junk", drafts: "Drafts", archive: "Archive" });
  });

  it("handles Gmail's [Gmail]/ tree and falls back to \\All for archive", () => {
    const list = [
      box("INBOX", ["\\HasNoChildren"]),
      box("[Gmail]", ["\\HasChildren", "\\Noselect"]),
      box("[Gmail]/All Mail", ["\\All", "\\HasNoChildren"]),
      box("[Gmail]/Drafts", ["\\Drafts"]),
      box("[Gmail]/Sent Mail", ["\\Sent"]),
      box("[Gmail]/Spam", ["\\Junk"]),
      box("[Gmail]/Starred", ["\\Flagged"]),
      box("[Gmail]/Trash", ["\\Trash"]),
    ];
    expect(detectFolders(list)).toEqual({
      inbox: "INBOX",
      archive: "[Gmail]/All Mail",
      drafts: "[Gmail]/Drafts",
      sent: "[Gmail]/Sent Mail",
      spam: "[Gmail]/Spam",
      trash: "[Gmail]/Trash",
    });
  });

  it("matches Exchange names without flags", () => {
    const list = [box("INBOX"), box("Sent Items"), box("Deleted Items"), box("Junk E-mail"), box("Drafts"), box("Archive"), box("Outbox")];
    expect(detectFolders(list)).toEqual({ inbox: "INBOX", sent: "Sent Items", trash: "Deleted Items", spam: "Junk E-mail", drafts: "Drafts", archive: "Archive" });
  });

  it("matches Czech names under an INBOX. namespace (Courier-style hosters)", () => {
    const list = [
      box("INBOX", [], "."),
      box("INBOX.Odeslaná pošta", [], "."),
      box("INBOX.Koš", [], "."),
      box("INBOX.Nevyžádaná pošta", [], "."),
      box("INBOX.Rozepsané", [], "."),
      box("INBOX.Archiv", [], "."),
      box("INBOX.Projekty.Sent", [], "."),
    ];
    expect(detectFolders(list)).toEqual({
      inbox: "INBOX",
      sent: "INBOX.Odeslaná pošta",
      trash: "INBOX.Koš",
      spam: "INBOX.Nevyžádaná pošta",
      drafts: "INBOX.Rozepsané",
      archive: "INBOX.Archiv",
    });
  });

  // Seznam's real LIST output is not verified; this covers the plausible shapes (lowercase ASCII or Czech).
  it("matches Seznam-like names (unverified fixture)", () => {
    expect(detectFolders([box("INBOX"), box("sent"), box("trash"), box("spam"), box("drafts"), box("archive")])).toEqual({
      inbox: "INBOX",
      sent: "sent",
      trash: "trash",
      spam: "spam",
      drafts: "drafts",
      archive: "archive",
    });
    expect(detectFolders([box("INBOX"), box("Odeslané"), box("Koš"), box("Spam"), box("Koncepty")])).toEqual({
      inbox: "INBOX",
      sent: "Odeslané",
      trash: "Koš",
      spam: "Spam",
      drafts: "Koncepty",
    });
  });

  it("prefers flags over names, shallow over nested, and skips \\Noselect", () => {
    const list = [box("INBOX"), box("Sent"), box("Odeslane", ["\\Sent"]), box("Old/Trash"), box("Trash", ["\\Noselect"]), box("Kos")];
    expect(detectFolders(list)).toMatchObject({ sent: "Odeslane", trash: "Kos" });
  });

  it("falls back to imapflow's localized-name guess", () => {
    const list = [box("INBOX"), box("Gesendete Objekte", [], "/", { specialUse: "\\Sent", specialUseSource: "name" })];
    expect(detectFolders(list).sent).toBe("Gesendete Objekte");
  });
});

describe("ownFolders", () => {
  it("is everything the user made, named without the INBOX. prefix, shallow ones first", () => {
    const list = [
      box("INBOX", [], "."),
      box("INBOX.Sent", ["\\Sent"], "."),
      box("INBOX.Archive", [], "."),
      box("INBOX.Klienti.Acme", [], "."),
      box("INBOX.Klienti", ["\\HasChildren"], "."),
      box("INBOX.Templates", [], "."),
      box("INBOX.Stare", ["\\Noselect"], "."),
      box("INBOX.Faktury", [], "."),
    ];
    const special = detectFolders(list);
    expect(ownFolders(list, special)).toEqual([
      { ref: "INBOX.Faktury", name: "Faktury" },
      { ref: "INBOX.Klienti", name: "Klienti" },
      { ref: "INBOX.Klienti.Acme", name: "Klienti / Acme" },
    ]);
  });

  it("leaves out Gmail's [Gmail] tree and anything with a special-use flag", () => {
    const list = [box("INBOX"), box("[Gmail]", ["\\Noselect"]), box("[Gmail]/All Mail", ["\\All"]), box("[Gmail]/Starred", ["\\Flagged"]), box("Work")];
    expect(ownFolders(list, detectFolders(list))).toEqual([{ ref: "Work", name: "Work" }]);
  });

  // What a Czech Microsoft 365 mailbox listed over IMAP (October 2026).
  it("leaves out Exchange's calendars, contacts and tasks in Czech, and folders inside the bin", () => {
    const list = [
      box("INBOX"),
      box("Archivovat"),
      box("Deník"),
      box("Historie konverzací"),
      box("Kalendář", ["\\HasChildren"]),
      box("Kalendář/Narozeniny"),
      box("Kalendář/Svátky Česko"),
      box("Kontakty"),
      box("Koncepty", ["\\Drafts"]),
      box("Nevyžádaná pošta", ["\\Junk"]),
      box("Odchozí pošta"),
      box("Odeslaná pošta", ["\\Sent"]),
      box("Odstraněná pošta", ["\\Trash", "\\HasChildren"]),
      box("Odstraněná pošta/Škola"),
      box("Úlohy"),
      box("Klienti"),
      box("Klienti/Kontakty"),
    ];
    const special = detectFolders(list);
    expect(special.archive).toBe("Archivovat");
    expect(ownFolders(list, special)).toEqual([
      { ref: "Klienti", name: "Klienti" },
      { ref: "Klienti/Kontakty", name: "Klienti / Kontakty" },
    ]);
  });

  it("keeps a folder called Kontakty where the server isn't Exchange", () => {
    const list = [box("INBOX"), box("Kontakty"), box("Úkoly"), box("trash")];
    expect(ownFolders(list, detectFolders(list))).toEqual([
      { ref: "Kontakty", name: "Kontakty" },
      { ref: "Úkoly", name: "Úkoly" },
    ]);
  });
});

describe("message ids", () => {
  it("round-trips paths containing colons", () => {
    const id = providerMessageId("Work:2026", "1712", 42);
    expect(parseProviderMessageId(id)).toEqual({ path: "Work:2026", uidValidity: "1712", uid: 42 });
    expect(parseProviderMessageId("gmail-id")).toBeNull();
  });

  it("locates by explicit columns first", () => {
    expect(locate({ providerMessageId: "INBOX:1:5", imapPath: "Archive", imapUid: 9 })).toEqual({ path: "Archive", uid: 9 });
    expect(locate({ providerMessageId: "INBOX:1:5" })).toEqual({ path: "INBOX", uid: 5 });
  });
});

const structure: MessageStructureObject = {
  type: "multipart/mixed",
  childNodes: [
    {
      part: "1",
      type: "multipart/alternative",
      childNodes: [
        { part: "1.1", type: "text/plain", parameters: { charset: "windows-1250" }, encoding: "quoted-printable", size: 100 },
        {
          part: "1.2",
          type: "multipart/related",
          childNodes: [
            { part: "1.2.1", type: "text/html", parameters: { charset: "utf-8" }, encoding: "base64", size: 400 },
            { part: "1.2.2", type: "image/png", id: "<logo@kolbaba>", encoding: "base64", size: 400 },
          ],
        },
      ],
    },
    { part: "2", type: "application/pdf", disposition: "attachment", dispositionParameters: { filename: "Smlouva č. 5.pdf" }, encoding: "base64", size: 1000 },
    { part: "3", type: "message/rfc822", size: 50 },
  ],
};

describe("bodystructure", () => {
  it("lists attachments with part ids, cid and inline", () => {
    expect(attachmentsFromStructure(structure)).toEqual([
      { id: "1.2.2", name: "attachment.png", size: 300, mime: "image/png", cid: "logo@kolbaba", inline: true },
      { id: "2", name: "Smlouva č. 5.pdf", size: 750, mime: "application/pdf", inline: false },
      { id: "3", name: "message.eml", size: 50, mime: "message/rfc822", inline: false },
    ]);
  });

  it("finds the text part for snippets, and part 1 for single-part mail", () => {
    expect(findTextPart(structure)).toEqual({ part: "1.1", type: "text/plain", encoding: "quoted-printable", charset: "windows-1250" });
    expect(findTextPart({ type: "text/html", encoding: "7bit" })).toEqual({ part: "1", type: "text/html", encoding: "7bit", charset: "utf-8" });
  });

  it("decodes truncated quoted-printable in windows-1250 and truncated base64", () => {
    // "Příliš" in windows-1250 is 50 F8 ED 6C 69 9A.
    expect(decodePart(Buffer.from("P=F8=EDli=\r\n=9A k=F9=") , "quoted-printable", "windows-1250")).toBe("Příliš ků");
    const b64 = Buffer.from("Žluťoučký kůň").toString("base64");
    expect(decodePart(Buffer.from(b64.slice(0, 10)), "base64", "utf-8")).toBe("Žluť");
    // 12 chars = 9 bytes, ending in the first byte of "č".
    expect(decodePart(Buffer.from(b64.slice(0, 12) + "\r\n" + b64.slice(12, 13)), "base64", "utf-8")).toBe("Žluťou");
  });

  it("builds snippets from text or html, without quoted lines", () => {
    expect(makeSnippet("Ahoj,\n\ndíky!\n> Původní zpráva\n>> starší")).toBe("Ahoj, díky!");
    expect(makeSnippet(null, "<html><head><style>p{}</style></head><body><p>Dobrý&nbsp;den &amp; vítejte</p><p>Druhý</p></body></html>")).toBe(
      "Dobrý den & vítejte Druhý",
    );
    expect(makeSnippet("x".repeat(500))).toHaveLength(200);
  });
});

describe("toRemoteMessage", () => {
  const row: FetchMessageObject = {
    seq: 3,
    uid: 77,
    size: 2048,
    flags: new Set(["\\Flagged"]),
    internalDate: new Date("2026-10-01T10:00:00Z"),
    envelope: {
      date: new Date("2026-10-01T09:59:00Z"),
      subject: "Příliš žluťoučký kůň",
      messageId: "<m77@seznam.cz>",
      inReplyTo: "<m70@example.cz>",
      from: [{ name: "Jana Nováková", address: "jana@seznam.cz" }],
      to: [{ name: "", address: "petr@example.cz" }],
      cc: [{ name: "Undisclosed", address: undefined }],
      replyTo: [{ name: "Jana", address: "jana@seznam.cz" }],
    },
    bodyStructure: structure,
    headers: Buffer.from(
      "References: <m60@example.cz>\r\n <m70@example.cz>\r\nList-Unsubscribe: <mailto:u@x.cz>,\r\n <https://x.cz/u>\r\nPrecedence: bulk\r\n\r\n",
    ),
  };

  it("maps envelope, flags, headers and attachments", () => {
    const msg = toRemoteMessage(row, { path: "INBOX", uidValidity: "1700", role: "inbox" }, { snippet: "Ahoj", html: "<p>Ahoj</p>", text: "Ahoj" });
    expect(msg).toMatchObject({
      providerMessageId: "INBOX:1700:77",
      imapPath: "INBOX",
      imapUid: 77,
      messageIdHeader: "<m77@seznam.cz>",
      inReplyTo: "<m70@example.cz>",
      references: ["<m60@example.cz>", "<m70@example.cz>"],
      from: { name: "Jana Nováková", email: "jana@seznam.cz" },
      to: [{ name: "", email: "petr@example.cz" }],
      cc: [],
      subject: "Příliš žluťoučký kůň",
      date: new Date("2026-10-01T09:59:00Z"),
      snippet: "Ahoj",
      html: "<p>Ahoj</p>",
      unread: true,
      pinned: true,
      role: "inbox",
      labels: [],
      listUnsubscribe: "<mailto:u@x.cz>, <https://x.cz/u>",
      bulk: true,
    });
    expect(msg.attachments).toHaveLength(3);
  });

  it("leaves the body undefined when it wasn't prefetched", () => {
    const msg = toRemoteMessage({ ...row, flags: new Set(["\\Seen"]), headers: undefined }, { path: "Sent", uidValidity: "1", role: "sent" }, { snippet: "" });
    expect("html" in msg).toBe(false);
    expect(msg).toMatchObject({ unread: false, pinned: false, bulk: false, references: [], listUnsubscribe: null });
  });

  it("distrusts far-future or missing Date headers", () => {
    const internalDate = new Date("2026-10-01T10:00:00Z");
    const now = internalDate.getTime();
    expect(messageDate({ envelope: { date: new Date("2030-01-01") }, internalDate }, now)).toEqual(internalDate);
    expect(messageDate({ envelope: {}, internalDate }, now)).toEqual(internalDate);
  });
});

describe("sync helpers", () => {
  it("compacts UID sets", () => {
    expect(compactUidSet([9, 1, 2, 3, 7, 10, 3])).toBe("1:3,7,9:10");
  });

  it("splits a long UID set into parts a server takes in one line", () => {
    expect(uidSetParts([9, 1, 2, 3, 7, 10], 8)).toEqual(["1:3,7", "9:10"]);
    // Every other UID of 20,000 (a folder full of gaps): ~100 kB as one set.
    const gappy = Array.from({ length: 10_000 }, (_, i) => i * 2 + 1);
    const parts = uidSetParts(gappy);
    expect(parts.every((p) => p.length <= 7000)).toBe(true);
    expect(parts.join(",")).toBe(compactUidSet(gappy));
    expect(uidSetParts([])).toEqual([]);
  });

  it("finds expunged UIDs within the re-checked window", () => {
    // Full window: only the range it covers is judged.
    expect(missingUids([50, 52, 53], 54, 3)).toEqual([51]);
    // Mailbox smaller than the window: everything below uidNext that's gone, capped.
    expect(missingUids([3], 6, 500)).toEqual([5, 4, 2, 1]);
    expect(missingUids([], 10_000, 500, 3)).toEqual([9999, 9998, 9997]);
  });

  it("enumerates ids to forget after a UIDVALIDITY change, newest first", () => {
    expect(uidsBelow(4, 100)).toEqual([3, 2, 1]);
    expect(uidsBelow(1000, 2)).toEqual([999, 998]);
    expect(uidsBelow(undefined, 10)).toEqual([]);
  });

  it("backs off exponentially with a cap", () => {
    const mid = () => 0.5;
    expect(backoffDelay(0, 60_000, mid)).toBe(1000);
    expect(backoffDelay(3, 60_000, mid)).toBe(8000);
    expect(backoffDelay(30, 60_000, mid)).toBe(60_000);
  });
});

describe("sent copy policy", () => {
  it("skips APPEND only for servers that file sent mail themselves", () => {
    expect(smtpAutoSavesSent("smtp.gmail.com")).toBe(true);
    expect(smtpAutoSavesSent("smtp.office365.com")).toBe(true);
    expect(smtpAutoSavesSent("smtp-mail.outlook.com")).toBe(true);
    expect(smtpAutoSavesSent("smtp.seznam.cz")).toBe(false);
    expect(smtpAutoSavesSent("smtp.forpsi.com")).toBe(false);
    expect(smtpAutoSavesSent("notgmail.com.evil.cz")).toBe(false);
    expect(smtpAutoSavesSent(undefined)).toBe(false);
  });
});

describe("buildMessage", () => {
  const message = {
    from: { name: "Daniel Žďárský", email: "daniel@email.cz" },
    to: [{ name: "Jana", email: "jana@seznam.cz" }],
    cc: [{ name: "", email: "cc@example.cz" }],
    bcc: [{ name: "", email: "tajny@example.cz" }],
    subject: "Příliš žluťoučký kůň",
    html: "<p>Úpěl ďábelské ódy</p>",
    text: "Úpěl ďábelské ódy",
    inReplyTo: "<parent@seznam.cz>",
    references: ["<root@seznam.cz>"],
    headers: { "X-Kolbaba-Test": "1" },
    attachments: [{ filename: "logo.png", content: Buffer.from("png"), contentType: "image/png", cid: "logo@kolbaba" }],
  };

  it("sets Message-ID, threading headers and encodes the Czech subject", async () => {
    const built = await buildMessage(message);
    const raw = built.raw.toString("utf8");
    const headers = raw.slice(0, raw.indexOf("\r\n\r\n"));
    expect(built.messageId).toMatch(/^<[0-9a-f]{32}@email\.cz>$/);
    expect(headers).toContain(`Message-ID: ${built.messageId}`);
    expect(headers).toContain("In-Reply-To: <parent@seznam.cz>");
    expect(headers).toContain("References: <root@seznam.cz> <parent@seznam.cz>");
    expect(headers).toContain("X-Kolbaba-Test: 1");
    expect(headers).toMatch(/^Subject: =\?UTF-8\?[QB]\?/m);
    expect(headers).not.toContain("Příliš");
    expect(headers).not.toMatch(/^Bcc:/m);
    expect(raw).toContain("Content-ID: <logo@kolbaba>");
    expect(built.sentCopy.toString("utf8")).toMatch(/^Bcc: tajny@example\.cz/m);
    expect(built.envelope).toEqual({ from: "daniel@email.cz", to: ["jana@seznam.cz", "cc@example.cz", "tajny@example.cz"] });

    const { simpleParser } = await import("mailparser");
    const parsed = await simpleParser(built.raw);
    expect(parsed.subject).toBe("Příliš žluťoučký kůň");
    expect(parsed.from?.value[0]).toEqual({ name: "Daniel Žďárský", address: "daniel@email.cz" });
  });

  it("generates unique ids on the sender's domain", () => {
    expect(newMessageId("a@b.cz")).not.toBe(newMessageId("a@b.cz"));
    expect(newMessageId("a@B.CZ")).toMatch(/@b\.cz>$/);
  });
});

describe("toMailError", () => {
  it("maps IMAP and SMTP auth failures", () => {
    const imap = Object.assign(new Error("Command failed"), { authenticationFailed: true, serverResponseCode: "AUTHENTICATIONFAILED", responseText: "Authentication failed." });
    expect(toMailError(imap)).toMatchObject({ reason: "invalid_credentials" });
    expect(toMailError(imap)).toBeInstanceOf(MailAuthError);
    expect(toMailError(imap)).toMatchObject({ serverReply: "Authentication failed." });

    const gmail = Object.assign(new Error("Command failed"), {
      authenticationFailed: true,
      responseText: "[ALERT] Application-specific password required: https://support.google.com/accounts/answer/185833 (Failure)",
    });
    expect(toMailError(gmail)).toMatchObject({ reason: "app_password_required" });

    const disabled = Object.assign(new Error("Command failed"), { authenticationFailed: true, responseText: "[ALERT] Your account is not enabled for IMAP use." });
    expect(toMailError(disabled)).toMatchObject({ reason: "imap_disabled" });

    const smtp = Object.assign(new Error("Invalid login: 535 5.7.8 Authentication failed"), { code: "EAUTH", responseCode: 535 });
    expect(toMailError(smtp)).toMatchObject({ reason: "invalid_credentials" });
  });

  it("passes other errors through", () => {
    const net = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    expect(toMailError(net)).toBe(net);
  });
});
