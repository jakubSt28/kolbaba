import { describe, expect, it } from "vitest";
import { decodeEntities, decodeMimeWords, mapMessage, parseAddressList, roleFromLabels } from "./parse";
import { newsletterMessage, personalMessage, sentMessage } from "./test-fixtures";

describe("decodeMimeWords", () => {
  it("decodes B and Q words, joins adjacent words and keeps plain text", () => {
    expect(decodeMimeWords("=?UTF-8?B?RGFuaWVsIMW9xI/DoXJza8O9?=")).toBe("Daniel Žďárský");
    expect(decodeMimeWords("=?ISO-8859-2?Q?Faktura_za_z=E1=F8=ED?=")).toBe("Faktura za září");
    // A multi-byte character split across two B words.
    const bytes = Buffer.from("Žďárský");
    const split = `=?UTF-8?B?${bytes.subarray(0, 1).toString("base64")}?= =?UTF-8?B?${bytes.subarray(1).toString("base64")}?=`;
    expect(decodeMimeWords(split)).toBe("Žďárský");
    expect(decodeMimeWords("Re: =?utf-8?q?ahoj?= world")).toBe("Re: ahoj world");
    expect(decodeMimeWords("=?utf-8*cs?Q?=C5=A1?=")).toBe("š");
    expect(decodeMimeWords("no words here")).toBe("no words here");
  });
});

describe("parseAddressList", () => {
  it("parses display names, quotes and groups", () => {
    expect(parseAddressList('"Novák, Jan" <jan@x.cz>, =?UTF-8?Q?=C5=BDofie?= <z@x.cz>, bare@x.cz')).toEqual([
      { name: "Novák, Jan", email: "jan@x.cz" },
      { name: "Žofie", email: "z@x.cz" },
      { name: "", email: "bare@x.cz" },
    ]);
    expect(parseAddressList("Team: a@x.cz, b@x.cz;")).toEqual([
      { name: "", email: "a@x.cz" },
      { name: "", email: "b@x.cz" },
    ]);
    expect(parseAddressList("undisclosed-recipients:;")).toEqual([]);
    expect(parseAddressList(undefined)).toEqual([]);
  });
});

it("decodeEntities handles named and numeric entities", () => {
  expect(decodeEntities("a &amp; b &#39;c&#39; &#x160; &lt;3 &bogus;")).toBe("a & b 'c' Š <3 &bogus;");
});

it("roleFromLabels follows Gmail semantics", () => {
  expect(roleFromLabels(["INBOX", "SENT"])).toBe("inbox");
  expect(roleFromLabels(["SENT"])).toBe("sent");
  expect(roleFromLabels(["TRASH", "INBOX"])).toBe("trash");
  expect(roleFromLabels(["SPAM"])).toBe("spam");
  expect(roleFromLabels(["DRAFT"])).toBe("drafts");
  expect(roleFromLabels(["CATEGORY_UPDATES", "Label_12"])).toBe("archive");
});

describe("mapMessage", () => {
  it("maps a multipart message with an inline image and an attachment", () => {
    const m = mapMessage(personalMessage);
    expect(m).toMatchObject({
      providerMessageId: "msg-1",
      providerThreadId: "thr-1",
      messageIdHeader: "<CAF+abc123@mail.gmail.com>",
      inReplyTo: "<prev@example.cz>",
      references: ["<root@example.cz>", "<prev@example.cz>"],
      from: { name: "Daniel Žďárský", email: "daniel@example.cz" },
      to: [
        { name: "Me", email: "me@gmail.com" },
        { name: "Petra Žďárská", email: "petra@example.cz" },
      ],
      cc: [],
      replyTo: [{ name: "Daniel (work)", email: "daniel@work.example" }],
      subject: "Faktura za září",
      snippet: "Ahoj, posílám fakturu & podklady. Díky, 'J' <3",
      text: "Ahoj, posílám fakturu.\r\n",
      html: '<p>Ahoj, posílám fakturu.</p><img src="cid:logo@kolbaba">',
      unread: true,
      pinned: true,
      role: "inbox",
      labels: ["INBOX", "UNREAD", "STARRED", "CATEGORY_PERSONAL"],
      listUnsubscribe: null,
      bulk: false,
    });
    expect(m.date.toISOString()).toBe("2025-10-08T08:00:00.000Z");
    expect(m.attachments).toEqual([
      { id: "0.1", name: "logo.png", size: 4, mime: "image/png", cid: "logo@kolbaba", inline: true },
      { id: "1", name: "faktura-září.pdf", size: 120_400, mime: "application/pdf" },
    ]);
  });

  it("maps a newsletter, decoding the body charset", () => {
    const m = mapMessage(newsletterMessage);
    expect(m.html).toBe("<p>Léto je tady</p>");
    expect(m.text).toBeNull();
    expect(m.bulk).toBe(true);
    expect(m.listUnsubscribe).toBe("<mailto:unsub@shop.example>, <https://shop.example/u/1>");
    expect(m.snippet).toBe('Novinky z obchodu "Žďárský"');
    expect(m.from).toEqual({ name: "Obchod", email: "news@shop.example" });
    expect(m.unread).toBe(false);
  });

  it("maps a sent message", () => {
    const m = mapMessage(sentMessage);
    expect(m.role).toBe("sent");
    expect(m.bcc).toEqual([{ name: "", email: "boss@example.cz" }]);
    expect(m.references).toHaveLength(3);
    expect(m.text).toBe("Díky, mám to.");
  });

  it("reads an invitation whose calendar part came along, so the list can show when it is", () => {
    const ics = ["BEGIN:VCALENDAR", "METHOD:REQUEST", "BEGIN:VEVENT", "UID:evt-1", "DTSTART:20261015T080000Z", "SUMMARY:Plánování", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const part = (partId: string, mimeType: string, text: string, headers: { name: string; value: string }[] = []) => ({
      partId,
      mimeType,
      filename: "",
      headers: [{ name: "Content-Type", value: `${mimeType}; charset=utf-8` }, ...headers],
      body: { size: Buffer.byteLength(text), data: Buffer.from(text).toString("base64url") },
    });
    const m = mapMessage({
      ...sentMessage,
      labelIds: ["INBOX"],
      payload: {
        ...sentMessage.payload,
        mimeType: "multipart/alternative",
        body: { size: 0 },
        parts: [part("0", "text/plain", "Pozvánka"), part("1", "text/html", "<p>Pozvánka</p>"), part("2", "text/calendar", ics)],
      },
    });
    expect(m.invite).toMatchObject({ method: "REQUEST", summary: "Plánování", start: "2026-10-15T08:00:00.000Z" });
    expect(m.attachments).toEqual([{ id: "2", name: "attachment", size: Buffer.byteLength(ics), mime: "text/calendar" }]);
    expect(mapMessage(sentMessage)).not.toHaveProperty("invite");
  });

  it("leaves the body lazy for metadata-only and oversized messages", () => {
    const meta = mapMessage({ ...sentMessage, payload: { ...sentMessage.payload, body: { size: 0 } } });
    expect(meta).not.toHaveProperty("html");
    expect(meta.attachments).toEqual([]);
    const big = "x".repeat(250_000);
    const huge = mapMessage({
      ...sentMessage,
      payload: { ...sentMessage.payload, body: { size: big.length, data: Buffer.from(big).toString("base64url") } },
    });
    expect(huge).not.toHaveProperty("text");
  });
});
