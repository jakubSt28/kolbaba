import { simpleParser } from "mailparser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGmailAdapter, parsePubsubPush, watchGmail } from "./gmail";
import {
  draftMessage,
  json,
  makeAccount,
  makeSink,
  mockFetch,
  newsletterMessage,
  personalMessage,
  sentMessage,
  tokenResponse,
} from "./gmail/test-fixtures";
import type { GmailMessage } from "./gmail/parse";
import { MailAuthError } from "./types";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const sleep = vi.fn(async () => {});
const byId: Record<string, GmailMessage> = Object.fromEntries(
  [personalMessage, newsletterMessage, sentMessage, draftMessage].map((m) => [m.id, m]),
);
const minimal = (m: GmailMessage, labelIds = m.labelIds) => ({ id: m.id, threadId: m.threadId, labelIds });
const trashedMessage: GmailMessage = { ...personalMessage, id: "msg-trash", threadId: "thr-trash", labelIds: ["TRASH"] };
byId[trashedMessage.id] = trashedMessage;
const isBinsQuery = (url: URL) => url.searchParams.get("q") === "in:trash OR in:spam";

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = "client-id";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret";
  sleep.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("initialSync", () => {
  it("records historyId first, imports all pages except drafts, then Trash and Spam, and saves state", async () => {
    const { account } = makeAccount();
    const { sink, upserted, states, folders } = makeSink();
    const calls = mockFetch((req) => {
      if (req.route === "GET /profile") return json({ emailAddress: "me@gmail.com", historyId: "1000" });
      if (req.route === "GET /messages" && isBinsQuery(req.url)) return json({ messages: [{ id: "msg-trash", threadId: "thr-trash" }] });
      if (req.route === "GET /messages") {
        return req.url.searchParams.get("pageToken") === "p2"
          ? json({ messages: [{ id: "msg-sent", threadId: "thr-1" }], resultSizeEstimate: 1 })
          : json({
              messages: ["msg-1", "msg-news", "msg-draft", "msg-gone"].map((id) => ({ id, threadId: "t" })),
              nextPageToken: "p2",
            });
      }
      const id = req.route.match(/^GET \/messages\/([\w-]+)$/)?.[1];
      if (id && byId[id]) return json(byId[id]);
    });

    const since = new Date("2025-07-01T00:00:00Z");
    await createGmailAdapter(account, { sleep }).initialSync(sink, { since });

    expect(calls[0].route).toBe("GET /profile");
    const list = calls.find((c) => c.route === "GET /messages")!;
    expect(list.url.searchParams.get("q")).toBe(`after:${since.getTime() / 1000}`);
    expect(list.headers.get("authorization")).toBe("Bearer access-valid");
    expect(calls.find((c) => c.route === "GET /messages/msg-1")!.url.searchParams.get("format")).toBe("full");
    expect(upserted.map((m) => m.providerMessageId)).toEqual(["msg-1", "msg-news", "msg-sent", "msg-trash"]);
    expect(upserted.at(-1)!.role).toBe("trash");
    expect(calls.find((c) => c.route === "GET /messages" && isBinsQuery(c.url))!.url.searchParams.get("includeSpamTrash")).toBe("true");
    expect(upserted[0].html).toContain("posílám");
    expect(folders).toEqual([{ inbox: "INBOX", sent: "SENT", trash: "TRASH", spam: "SPAM", drafts: "DRAFT", archive: "" }]);
    // The cursor is saved before listing, progress after each batch, the finish clears the progress.
    expect(states[0]).toEqual({ historyId: "1000" });
    expect(states.slice(1, -2).every((s) => typeof (s as { importedUntil?: unknown }).importedUntil === "number")).toBe(true);
    expect(states.at(-2)).toEqual({ historyId: "1000", backfilledUntil: since.getTime(), importedUntil: undefined });
    expect(states.at(-1)).toEqual({ binsImported: true });
  });

  it("resumes an interrupted import below what it already has, with the original history cursor", async () => {
    const reached = 1759906800000;
    const { account } = makeAccount({}, { historyId: "900", importedUntil: reached });
    const { sink, states } = makeSink();
    const calls = mockFetch((req) => {
      if (req.route === "GET /messages" && isBinsQuery(req.url)) return json({});
      if (req.route === "GET /messages") return json({ messages: [{ id: "msg-1", threadId: "t" }] });
      const id = req.route.match(/^GET \/messages\/([\w-]+)$/)?.[1];
      if (id && byId[id]) return json(byId[id]);
    });

    const since = new Date("2025-07-01T00:00:00Z");
    await createGmailAdapter(account, { sleep }).initialSync(sink, { since });

    expect(calls.some((c) => c.route === "GET /profile")).toBe(false);
    const q = calls.find((c) => c.route === "GET /messages")!.url.searchParams.get("q");
    expect(q).toBe(`after:${since.getTime() / 1000} before:${Math.floor(reached / 1000) + 1}`);
    expect(states.at(-2)).toEqual({ historyId: "900", backfilledUntil: since.getTime(), importedUntil: undefined });
  });
});

describe("importOlder", () => {
  it("imports the next page older than the first import and moves its cursor back", async () => {
    const backfilledUntil = 1759920000000;
    const { account } = makeAccount({}, { historyId: "1000", backfilledUntil });
    const { sink, upserted, states } = makeSink();
    const calls = mockFetch((req) => {
      if (req.route === "GET /messages") return json({ messages: ["msg-1", "msg-news"].map((id) => ({ id, threadId: "t" })) });
      const id = req.route.match(/^GET \/messages\/([\w-]+)$/)?.[1];
      if (id && byId[id]) return json(byId[id]);
    });

    const done = await createGmailAdapter(account, { sleep }).importOlder!(sink, { limit: 100 });

    expect(done).toBe(false);
    const list = calls.find((c) => c.route === "GET /messages")!;
    expect(list.url.searchParams.get("q")).toBe(`before:${Math.floor(backfilledUntil / 1000) + 1} -in:drafts`);
    expect(list.url.searchParams.get("maxResults")).toBe("100");
    expect(upserted.map((m) => m.providerMessageId)).toEqual(["msg-1", "msg-news"]);
    const oldest = Math.min(Number(byId["msg-1"].internalDate), Number(byId["msg-news"].internalDate));
    expect(states.at(-1)).toEqual({ olderBefore: oldest });
  });

  it("is done when nothing older is left", async () => {
    const { account } = makeAccount({}, { historyId: "1000", backfilledUntil: 1759920000000, olderBefore: 1500000000000 });
    const { sink, upserted } = makeSink();
    mockFetch((req) => (req.route === "GET /messages" ? json({ resultSizeEstimate: 0 }) : undefined));
    expect(await createGmailAdapter(account, { sleep }).importOlder!(sink, { limit: 100 })).toBe(true);
    expect(upserted).toEqual([]);
  });
});

describe("searchOlder", () => {
  it("asks Gmail with the user's words and imports only what isn't here yet", async () => {
    const { account } = makeAccount({}, { historyId: "1000" });
    const { sink, upserted } = makeSink();
    const known = vi.fn(async () => new Set(["msg-1"]));
    const calls = mockFetch((req) => {
      if (req.route === "GET /messages") return json({ messages: ["msg-1", "msg-news"].map((id) => ({ id, threadId: "t" })) });
      const id = req.route.match(/^GET \/messages\/([\w-]+)$/)?.[1];
      if (id && byId[id]) return json(byId[id]);
    });
    const n = await createGmailAdapter(account, { sleep }).searchOlder!({ ...sink, knownMessages: known }, "faktura duben", 50);
    expect(n).toBe(1);
    expect(calls.find((c) => c.route === "GET /messages")!.url.searchParams.get("q")).toBe("faktura duben -in:drafts");
    expect(upserted.map((m) => m.providerMessageId)).toEqual(["msg-news"]);
  });
});

describe("tokens", () => {
  it("refreshes an expiring token once for concurrent calls and persists it", async () => {
    const { account, saved } = makeAccount({ accessToken: "access-old", expiresAt: Date.now() + 30_000 });
    const calls = mockFetch((req) => {
      if (req.url.href === TOKEN_URL) return tokenResponse("access-new");
      if (req.route.startsWith("GET /messages/")) return json(personalMessage);
    });
    const adapter = createGmailAdapter(account, { sleep });
    await Promise.all([adapter.fetchBody({ providerMessageId: "msg-1" }), adapter.fetchBody({ providerMessageId: "msg-1" })]);

    const tokenCalls = calls.filter((c) => c.url.href === TOKEN_URL);
    expect(tokenCalls).toHaveLength(1);
    expect(new URLSearchParams(tokenCalls[0].body).get("grant_type")).toBe("refresh_token");
    expect(new URLSearchParams(tokenCalls[0].body).get("refresh_token")).toBe("refresh-1");
    expect(saved).toEqual([
      expect.objectContaining({ kind: "oauth", refreshToken: "refresh-1", accessToken: "access-new" }),
    ]);
    expect((saved[0] as { expiresAt: number }).expiresAt).toBeGreaterThan(Date.now() + 3000_000);
    expect(calls.filter((c) => c.route.startsWith("GET /messages")).map((c) => c.headers.get("authorization"))).toEqual([
      "Bearer access-new",
      "Bearer access-new",
    ]);
  });

  it("refreshes and retries once on 401", async () => {
    const { account, saved } = makeAccount();
    let attempts = 0;
    mockFetch((req) => {
      if (req.url.href === TOKEN_URL) return tokenResponse("access-new");
      if (req.route === "GET /profile") {
        attempts++;
        return req.headers.get("authorization") === "Bearer access-new"
          ? json({ emailAddress: "me@gmail.com", historyId: "1" })
          : json({ error: { code: 401, message: "Invalid Credentials" } }, { status: 401 });
      }
    });
    await createGmailAdapter(account, { sleep }).verify();
    expect(attempts).toBe(2);
    expect(saved).toHaveLength(1);
  });

  it("gives up with MailAuthError when the refreshed token is rejected too", async () => {
    const { account } = makeAccount();
    mockFetch((req) => {
      if (req.url.href === TOKEN_URL) return tokenResponse();
      return json({ error: { code: 401 } }, { status: 401 });
    });
    await expect(createGmailAdapter(account, { sleep }).verify()).rejects.toMatchObject({ reason: "oauth_revoked" });
  });

  it("maps a revoked refresh token to oauth_revoked", async () => {
    const { account } = makeAccount({ accessToken: undefined });
    mockFetch((req) => {
      if (req.url.href === TOKEN_URL) return json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, { status: 400 });
    });
    const err = await createGmailAdapter(account, { sleep }).verify().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MailAuthError);
    expect(err).toMatchObject({ reason: "oauth_revoked" });
  });
});

it("backs off on 429 using Retry-After and on 5xx", async () => {
  const { account } = makeAccount();
  const responses = [
    json({ error: { code: 429 } }, { status: 429, headers: { "Retry-After": "2" } }),
    json({ error: { code: 503 } }, { status: 503 }),
    json({ emailAddress: "me@gmail.com", historyId: "1" }),
  ];
  mockFetch(() => responses.shift());
  await createGmailAdapter(account, { sleep }).verify();
  expect(sleep).toHaveBeenCalledTimes(2);
  expect(sleep).toHaveBeenNthCalledWith(1, 2000);
});

it("waits for the next minute on a 403 per-minute quota error", async () => {
  const { account } = makeAccount();
  const quota = {
    error: {
      code: 403,
      message: "Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user' of service 'gmail.googleapis.com'.",
      status: "PERMISSION_DENIED",
      details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "RATE_LIMIT_EXCEEDED" }],
    },
  };
  const responses = [json(quota, { status: 403 }), json(quota, { status: 403 }), json({ emailAddress: "me@gmail.com", historyId: "1" })];
  mockFetch(() => responses.shift());
  await createGmailAdapter(account, { sleep }).verify();
  expect(sleep).toHaveBeenNthCalledWith(1, 20_000);
  expect(sleep).toHaveBeenNthCalledWith(2, 40_000);
});

it("verify rejects a different Google account", async () => {
  const { account } = makeAccount();
  mockFetch(() => json({ emailAddress: "someone@gmail.com", historyId: "1" }));
  await expect(createGmailAdapter(account, { sleep }).verify()).rejects.toBeInstanceOf(MailAuthError);
});

describe("incrementalSync", () => {
  it("applies added, label-changed and deleted messages from history", async () => {
    const { account } = makeAccount({}, { historyId: "1000" });
    const { sink, upserted, flags, removed, states } = makeSink();
    const sentDraft = { ...draftMessage, labelIds: ["SENT"] };
    const calls = mockFetch((req) => {
      if (req.route === "GET /history") {
        if (req.url.searchParams.get("pageToken") === "h2") {
          return json({
            history: [{ id: "1003", messagesDeleted: [{ message: { id: "msg-old" } }] }],
            historyId: "1010",
          });
        }
        return json({
          history: [
            { id: "1001", messagesAdded: [{ message: { id: "msg-news", labelIds: ["INBOX"] } }] },
            { id: "1002", labelsAdded: [{ message: { id: "msg-1" }, labelIds: ["STARRED"] }] },
            { id: "1002", labelsRemoved: [{ message: { id: "msg-sent" }, labelIds: ["UNREAD"] }] },
            { id: "1002", labelsRemoved: [{ message: { id: "msg-draft" }, labelIds: ["DRAFT"] }] },
            { id: "1002", labelsAdded: [{ message: { id: "msg-vanished" }, labelIds: ["TRASH"] }] },
            { id: "1002", labelsAdded: [{ message: { id: "msg-old" }, labelIds: ["UNREAD"] }] },
          ],
          nextPageToken: "h2",
          historyId: "1010",
        });
      }
      if (req.route === "GET /messages/msg-news") return json(newsletterMessage);
      if (req.route === "GET /messages/msg-draft") return json(sentDraft);
      if (req.route === "GET /messages/msg-1") return json(minimal(personalMessage, ["INBOX"]));
      if (req.route === "GET /messages/msg-sent") return json(minimal(sentMessage, ["SENT", "TRASH"]));
    });

    await createGmailAdapter(account, { sleep }).incrementalSync(sink);

    const history = calls.find((c) => c.route === "GET /history")!.url.searchParams;
    expect(history.get("startHistoryId")).toBe("1000");
    expect(history.getAll("historyTypes")).toEqual(["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"]);
    expect(calls.find((c) => c.route === "GET /messages/msg-1")!.url.searchParams.get("format")).toBe("minimal");
    expect(calls.some((c) => c.route === "GET /messages/msg-old")).toBe(false);

    expect(upserted.map((m) => m.providerMessageId).sort()).toEqual(["msg-draft", "msg-news"]);
    expect(upserted.find((m) => m.providerMessageId === "msg-draft")!.role).toBe("sent");
    expect(flags).toEqual([
      { providerMessageId: "msg-1", unread: false, pinned: false, role: "inbox", labels: ["INBOX"] },
      { providerMessageId: "msg-sent", unread: false, pinned: false, role: "trash", labels: ["SENT", "TRASH"] },
    ]);
    expect(removed.sort()).toEqual(["msg-old", "msg-vanished"]);
    expect(states).toEqual([{ historyId: "1010" }]);
  });

  it("falls back to a 7-day re-import when the historyId is too old", async () => {
    const { account } = makeAccount({}, { historyId: "1" });
    const { sink, upserted, states } = makeSink();
    const calls = mockFetch((req) => {
      if (req.route === "GET /history") return json({ error: { code: 404, message: "Requested entity was not found." } }, { status: 404 });
      if (req.route === "GET /profile") return json({ emailAddress: "me@gmail.com", historyId: "5000" });
      if (req.route === "GET /messages") return json({ messages: [{ id: "msg-1", threadId: "thr-1" }] });
      if (req.route === "GET /messages/msg-1") return json(personalMessage);
    });
    await createGmailAdapter(account, { sleep }).incrementalSync(sink);

    const after = Number(calls.find((c) => c.route === "GET /messages")!.url.searchParams.get("q")!.slice(6));
    expect(Date.now() / 1000 - after).toBeCloseTo(7 * 86400, -2);
    expect(upserted.map((m) => m.providerMessageId)).toEqual(["msg-1"]);
    expect(states).toEqual([{ historyId: "5000" }]);
  });
});

describe("flags and moves", () => {
  const refs = [{ providerMessageId: "a" }, { providerMessageId: "b" }];

  it("sends batchModify / trash requests with the right labels", async () => {
    const { account } = makeAccount();
    const calls = mockFetch((req) => (req.method === "POST" ? new Response(null, { status: 204 }) : undefined));
    // Real sleep: four batchModify calls (4 × 50 units) fill the one-second quota window.
    const adapter = createGmailAdapter(account, { sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });

    await adapter.setFlags(refs, { unread: false, pinned: true });
    await adapter.setFlags(refs, {});
    await adapter.move(refs, "archive");
    await adapter.move(refs, "inbox");
    await adapter.move(refs, "spam");
    await adapter.move(refs, "trash");
    await expect(adapter.move(refs, "sent")).rejects.toThrow();

    const bodies = calls.filter((c) => c.route === "POST /messages/batchModify").map((c) => JSON.parse(c.body));
    expect(bodies).toEqual([
      { ids: ["a", "b"], addLabelIds: ["STARRED"], removeLabelIds: ["UNREAD"] },
      { ids: ["a", "b"], addLabelIds: [], removeLabelIds: ["INBOX", "SPAM", "TRASH"] },
      { ids: ["a", "b"], addLabelIds: ["INBOX"], removeLabelIds: ["SPAM", "TRASH"] },
      { ids: ["a", "b"], addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] },
    ]);
    expect(calls.filter((c) => c.route.endsWith("/trash")).map((c) => c.route).sort()).toEqual([
      "POST /messages/a/trash",
      "POST /messages/b/trash",
    ]);
  });
});

describe("bodies and attachments", () => {
  it("fetches the body and resolves attachments by partId", async () => {
    const { account } = makeAccount();
    const pdf = Buffer.from("%PDF-1.7 fake");
    mockFetch((req) => {
      if (req.route === "GET /messages/msg-1") return json(personalMessage);
      if (req.route === "GET /messages/msg-1/attachments/ANGjdJ-volatile-1") {
        return json({ size: pdf.length, data: pdf.toString("base64url") });
      }
    });
    const adapter = createGmailAdapter(account, { sleep });
    const body = await adapter.fetchBody({ providerMessageId: "msg-1" });
    expect(body.text).toBe("Ahoj, posílám fakturu.\r\n");
    expect(body.attachments.map((a) => a.id)).toEqual(["0.1", "1"]);

    expect(await adapter.fetchAttachment({ providerMessageId: "msg-1" }, "1")).toEqual({
      name: "faktura-září.pdf",
      mime: "application/pdf",
      content: pdf,
    });
    const inline = await adapter.fetchAttachment({ providerMessageId: "msg-1" }, "0.1");
    expect(inline.content).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await expect(adapter.fetchAttachment({ providerMessageId: "msg-1" }, "9")).rejects.toThrow(/not found/);
  });
});

describe("send", () => {
  it("builds an RFC 822 reply with threading headers and Bcc, sent as base64url", async () => {
    const { account } = makeAccount();
    const calls = mockFetch((req) => {
      if (req.route === "POST /messages/send") return json({ id: "new-1", threadId: "thr-1", labelIds: ["SENT"] });
    });
    const result = await createGmailAdapter(account, { sleep }).send({
      from: { name: "Daniel Žďárský", email: "me@gmail.com" },
      to: [{ name: "Petra", email: "petra@example.cz" }],
      cc: [],
      bcc: [{ name: "", email: "boss@example.cz" }],
      subject: "Re: Faktura za září",
      html: "<p>Díky!</p>",
      text: "Díky!",
      inReplyTo: "<CAF+abc123@mail.gmail.com>",
      references: ["<root@example.cz>", "<CAF+abc123@mail.gmail.com>"],
      providerThreadId: "thr-1",
      attachments: [{ filename: "a.txt", content: Buffer.from("hi"), contentType: "text/plain" }],
      headers: { "X-Kolbaba": "1" },
    });

    const body = JSON.parse(calls[0].body) as { raw: string; threadId: string };
    expect(body.threadId).toBe("thr-1");
    expect(body.raw).toMatch(/^[\w-]+$/);
    const raw = Buffer.from(body.raw, "base64url");
    const parsed = await simpleParser(raw);
    expect(parsed.messageId).toBe(result.messageIdHeader);
    expect(result).toEqual({ messageIdHeader: expect.stringMatching(/^<[\w-]+@gmail\.com>$/), providerMessageId: "new-1", providerThreadId: "thr-1" });
    expect(parsed.inReplyTo).toBe("<CAF+abc123@mail.gmail.com>");
    expect(parsed.references).toEqual(["<root@example.cz>", "<CAF+abc123@mail.gmail.com>"]);
    expect(parsed.subject).toBe("Re: Faktura za září");
    expect(parsed.from?.value).toEqual([{ name: "Daniel Žďárský", address: "me@gmail.com" }]);
    expect(raw.toString()).toMatch(/^Bcc: boss@example\.cz/m);
    expect(parsed.headers.get("x-kolbaba")).toBe("1");
    expect(parsed.text?.trim()).toBe("Díky!");
    expect(parsed.html).toContain("Díky!");
    expect(parsed.attachments.map((a) => a.filename)).toEqual(["a.txt"]);
  });

  it("uses the multipart upload endpoint for large messages", async () => {
    const { account } = makeAccount();
    const calls = mockFetch((req) => {
      if (req.route === "POST /messages/send") return json({ id: "new-2", threadId: "thr-9" });
    });
    await createGmailAdapter(account, { sleep }).send({
      from: { name: "", email: "me@gmail.com" },
      to: [{ name: "", email: "x@example.cz" }],
      cc: [],
      bcc: [],
      subject: "big",
      html: "<p>big</p>",
      text: "big",
      attachments: [{ filename: "big.bin", content: Buffer.alloc(4 * 1024 * 1024, 1), contentType: "application/octet-stream" }],
    });
    expect(calls[0].url.href).toBe("https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart");
    expect(calls[0].headers.get("content-type")).toMatch(/^multipart\/related; boundary=/);
    expect(calls[0].body).toContain("Content-Type: message/rfc822");
    expect(calls[0].body).toContain("Subject: big");
  });
});

describe("drafts", () => {
  const message = {
    from: { name: "", email: "me@gmail.com" },
    to: [{ name: "", email: "x@example.cz" }],
    cc: [],
    bcc: [],
    subject: "Rozepsané",
    html: "<p>Ahoj</p>",
    text: "Ahoj",
    providerThreadId: "thr-1",
  };

  it("creates a Gmail draft, updates it in place, and starts over if it was deleted there", async () => {
    const { account } = makeAccount();
    const calls = mockFetch((req) => {
      if (req.route === "POST /drafts") return json({ id: "d-new", message: { id: "m-new" } });
      if (req.route === "PUT /drafts/d-1") return json({ id: "d-1", message: { id: "m-2" } });
      if (req.route === "PUT /drafts/d-gone") return json({ error: { message: "Not found" } }, { status: 404 });
    });
    const gmail = createGmailAdapter(account, { sleep });
    expect(await gmail.saveDraft!(message)).toEqual({ ref: "d-new", version: "m-new" });
    const created = JSON.parse(calls[0].body) as { message: { raw: string; threadId: string } };
    expect(created.message.threadId).toBe("thr-1");
    expect((await simpleParser(Buffer.from(created.message.raw, "base64url"))).subject).toBe("Rozepsané");

    // Every edit is a new message under the same draft: that's its version.
    expect(await gmail.saveDraft!(message, "d-1")).toEqual({ ref: "d-1", version: "m-2" });
    expect(JSON.parse(calls[1].body).id).toBe("d-1");
    expect(await gmail.saveDraft!(message, "d-gone")).toEqual({ ref: "d-new", version: "m-new" });
  });

  it("deleting a draft that's already gone is fine", async () => {
    const { account } = makeAccount();
    mockFetch((req) => {
      if (req.route === "DELETE /drafts/d-1") return new Response(null, { status: 204 });
      if (req.route === "DELETE /drafts/d-gone") return json({ error: { message: "Not found" } }, { status: 404 });
    });
    const gmail = createGmailAdapter(account, { sleep });
    await gmail.deleteDraft!("d-1");
    await gmail.deleteDraft!("d-gone");
  });
});

describe("push", () => {
  it("registers a watch on the whole mailbox", async () => {
    process.env.GOOGLE_PUBSUB_TOPIC = "projects/example-project/topics/gmail";
    const { account } = makeAccount();
    const calls = mockFetch((req) => {
      if (req.route === "POST /watch") return json({ historyId: "777", expiration: "1760000000000" });
    });
    expect(await watchGmail(account, { sleep })).toEqual({ historyId: "777", expiration: 1760000000000 });
    expect(JSON.parse(calls[0].body)).toEqual({ topicName: "projects/example-project/topics/gmail" });
    delete process.env.GOOGLE_PUBSUB_TOPIC;
  });

  it("parses Pub/Sub push bodies", () => {
    const data = Buffer.from(JSON.stringify({ emailAddress: "Me@gmail.com", historyId: 9876543 })).toString("base64");
    expect(parsePubsubPush({ message: { data, messageId: "1", publishTime: "2025-10-08T10:00:00Z" }, subscription: "s" })).toEqual({
      emailAddress: "me@gmail.com",
      historyId: "9876543",
    });
    expect(parsePubsubPush({ message: { data: "not-json" } })).toBeNull();
    expect(parsePubsubPush(null)).toBeNull();
    expect(parsePubsubPush({ message: { data: Buffer.from("{}").toString("base64") } })).toBeNull();
  });
});
