import { vi } from "vitest";
import type { MailboxCredentials } from "../../db/schema";
import type { AdapterAccount, FlagChange, RemoteMessage, SyncSink } from "../types";
import type { GmailMessage } from "./parse";

/** Realistic Gmail API payloads and a fetch mock for the Gmail adapter tests. */

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const h = (name: string, value: string) => ({ name, value });

/** multipart/mixed → related(alternative(plain, html), inline png) + pdf; encoded Czech From and Subject. */
export const personalMessage: GmailMessage = {
  id: "msg-1",
  threadId: "thr-1",
  labelIds: ["INBOX", "UNREAD", "STARRED", "CATEGORY_PERSONAL"],
  snippet: "Ahoj, posílám fakturu &amp; podklady. Díky, &#39;J&#39; &lt;3",
  historyId: "900",
  internalDate: "1759910400000",
  sizeEstimate: 48_213,
  payload: {
    partId: "",
    mimeType: "multipart/mixed",
    filename: "",
    headers: [
      h("Delivered-To", "me@gmail.com"),
      h("From", "=?UTF-8?B?RGFuaWVsIMW9xI/DoXJza8O9?= <daniel@example.cz>"),
      h("To", "Me <me@gmail.com>, =?UTF-8?Q?Petra_=C5=BD?= =?UTF-8?Q?=C4=8F=C3=A1rsk=C3=A1?= <petra@example.cz>"),
      h("Cc", "undisclosed-recipients:;"),
      h("Reply-To", '"Daniel (work)" <daniel@work.example>'),
      h("Subject", "=?ISO-8859-2?Q?Faktura_za_z=E1=F8=ED?="),
      h("Date", "Wed, 08 Oct 2025 10:00:00 +0200"),
      h("Message-ID", "<CAF+abc123@mail.gmail.com>"),
      h("In-Reply-To", "<prev@example.cz>"),
      h("References", "<root@example.cz>\r\n <prev@example.cz>"),
      h("Content-Type", 'multipart/mixed; boundary="000"'),
    ],
    body: { size: 0 },
    parts: [
      {
        partId: "0",
        mimeType: "multipart/related",
        filename: "",
        headers: [h("Content-Type", 'multipart/related; boundary="001"')],
        body: { size: 0 },
        parts: [
          {
            partId: "0.0",
            mimeType: "multipart/alternative",
            filename: "",
            headers: [h("Content-Type", 'multipart/alternative; boundary="002"')],
            body: { size: 0 },
            parts: [
              {
                partId: "0.0.0",
                mimeType: "text/plain",
                filename: "",
                headers: [h("Content-Type", 'text/plain; charset="UTF-8"')],
                body: { size: 33, data: b64("Ahoj, posílám fakturu.\r\n") },
              },
              {
                partId: "0.0.1",
                mimeType: "text/html",
                filename: "",
                headers: [h("Content-Type", 'text/html; charset="UTF-8"')],
                body: { size: 60, data: b64('<p>Ahoj, posílám fakturu.</p><img src="cid:logo@kolbaba">') },
              },
            ],
          },
          {
            partId: "0.1",
            mimeType: "image/png",
            filename: "logo.png",
            headers: [
              h("Content-Type", 'image/png; name="logo.png"'),
              h("Content-Disposition", 'inline; filename="logo.png"'),
              h("Content-ID", "<logo@kolbaba>"),
            ],
            body: { size: 4, data: b64(Buffer.from([0x89, 0x50, 0x4e, 0x47])) },
          },
        ],
      },
      {
        partId: "1",
        mimeType: "application/pdf",
        filename: "faktura-září.pdf",
        headers: [
          h("Content-Type", 'application/pdf; name="=?UTF-8?Q?faktura-z=C3=A1=C5=99=C3=AD.pdf?="'),
          h("Content-Disposition", "attachment"),
        ],
        body: { attachmentId: "ANGjdJ-volatile-1", size: 120_400 },
      },
    ],
  },
};

/** Newsletter: single-part HTML in windows-1250 with List-Unsubscribe and List-Id. */
export const newsletterMessage: GmailMessage = {
  id: "msg-news",
  threadId: "thr-news",
  labelIds: ["INBOX", "CATEGORY_PROMOTIONS"],
  snippet: "Novinky z obchodu &quot;Žďárský&quot;",
  internalDate: "1759906800000",
  sizeEstimate: 12_000,
  payload: {
    partId: "",
    mimeType: "text/html",
    filename: "",
    headers: [
      h("From", '"Obchod" <news@shop.example>'),
      h("To", "me@gmail.com"),
      h("Subject", "Novinky"),
      h("Message-ID", "<news-1@shop.example>"),
      h("List-Unsubscribe", "<mailto:unsub@shop.example>,\r\n <https://shop.example/u/1>"),
      h("List-Unsubscribe-Post", "List-Unsubscribe=One-Click"),
      h("List-Id", "Shop news <news.shop.example>"),
      h("Content-Type", "text/html; charset=windows-1250"),
    ],
    // "Léto je tady" in windows-1250 (é = 0xE9)
    body: { size: 20, data: b64(Buffer.from([...Buffer.from("<p>L"), 0xe9, ...Buffer.from("to je tady</p>")])) },
  },
};

/** Sent reply (SENT without INBOX → role "sent"). */
export const sentMessage: GmailMessage = {
  id: "msg-sent",
  threadId: "thr-1",
  labelIds: ["SENT"],
  snippet: "Díky, mám to.",
  internalDate: "1759914000000",
  sizeEstimate: 2_000,
  payload: {
    partId: "",
    mimeType: "text/plain",
    filename: "",
    headers: [
      h("From", "Me <me@gmail.com>"),
      h("To", "daniel@example.cz, Petra <petra@example.cz>"),
      h("Bcc", "boss@example.cz"),
      h("Subject", "Re: Faktura za září"),
      h("Message-ID", "<sent-1@gmail.com>"),
      h("In-Reply-To", "<CAF+abc123@mail.gmail.com>"),
      h("References", "<root@example.cz> <prev@example.cz> <CAF+abc123@mail.gmail.com>"),
      h("Content-Type", "text/plain; charset=UTF-8"),
    ],
    body: { size: 15, data: b64("Díky, mám to.") },
  },
};

export const draftMessage: GmailMessage = {
  id: "msg-draft",
  threadId: "thr-draft",
  labelIds: ["DRAFT"],
  snippet: "",
  internalDate: "1759914100000",
  payload: { partId: "", mimeType: "text/plain", headers: [h("Subject", "draft")], body: { size: 1, data: b64("x") } },
};

export function makeAccount(
  credentials: Partial<Extract<MailboxCredentials, { kind: "oauth" }>> = {},
  syncState: AdapterAccount["syncState"] = {},
) {
  const saved: MailboxCredentials[] = [];
  const account: AdapterAccount = {
    id: "acc_1",
    email: "Me@Gmail.com",
    fromName: "Me",
    provider: "gmail",
    folders: {},
    credentials: {
      kind: "oauth",
      refreshToken: "refresh-1",
      accessToken: "access-valid",
      expiresAt: Date.now() + 3600_000,
      scope: "https://www.googleapis.com/auth/gmail.modify",
      ...credentials,
    },
    syncState,
    saveCredentials: vi.fn(async (c: MailboxCredentials) => {
      saved.push(c);
    }),
  };
  return { account, saved };
}

export function makeSink() {
  const upserted: RemoteMessage[] = [];
  const flags: FlagChange[] = [];
  const removed: string[] = [];
  const states: object[] = [];
  const folders: object[] = [];
  const sink: SyncSink = {
    upsertMessages: vi.fn(async (m: RemoteMessage[]) => void upserted.push(...m)),
    updateFlags: vi.fn(async (c: FlagChange[]) => void flags.push(...c)),
    removeMessages: vi.fn(async (ids: string[]) => void removed.push(...ids)),
    saveState: vi.fn(async (s: object) => void states.push(s)),
    saveFolders: vi.fn(async (f: object) => void folders.push(f)),
  };
  return { sink, upserted, flags, removed, states, folders };
}

export interface MockRequest {
  url: URL;
  method: string;
  /** "GET /messages/msg-1" relative to the Gmail users/me base, or the full pathname for other hosts. */
  route: string;
  headers: Headers;
  body: string;
}

export const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" }, ...init });

/** Replaces global fetch; `handler` returns a Response or undefined (→ 404 "Not Found" like Gmail). */
export function mockFetch(handler: (req: MockRequest) => Response | undefined | Promise<Response | undefined>) {
  const calls: MockRequest[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/(upload\/)?gmail\/v1\/users\/me/, "");
    const req: MockRequest = {
      url,
      method: request.method,
      route: `${request.method} ${path}`,
      headers: request.headers,
      body: await request.text(),
    };
    calls.push(req);
    return (await handler(req)) ?? json({ error: { code: 404, message: "Requested entity was not found." } }, { status: 404 });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

/** Google's token endpoint returning a fresh access token. */
export function tokenResponse(accessToken = "access-new", extra: Record<string, unknown> = {}) {
  return json({ access_token: accessToken, expires_in: 3599, token_type: "Bearer", scope: "https://www.googleapis.com/auth/gmail.modify", ...extra });
}
