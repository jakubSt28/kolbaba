import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db, schema } from "./db";
import {
  classifyOpen,
  createTrackingId,
  getOpenSummaries,
  injectPixel,
  isAppleIp,
  pixelUrl,
  recordOpen,
  trackingIdFromSegment,
} from "./tracking";

const UA = {
  appleMpp: "Mozilla/5.0",
  gmailProxy: "Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)",
  yahooProxy: "YahooMailProxy; https://help.yahoo.com/kb/yahoo-mail-proxy-SLN28749.html",
  iphoneMail: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  macMail: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
  outlookWin: "Microsoft Office/16.0 (Windows NT 10.0; Microsoft Outlook 16.0.17328; Pro)",
  outlookIos: "Outlook-iOS/723.4027091.prod.iphone (4.2421.0)",
  outlookAndroid: "Outlook-Android/2.0",
  thunderbird: "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Thunderbird/128.3.0",
  thunderbirdWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:115.0) Gecko/20100101 Thunderbird/115.12.2",
  chromeMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  safariIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  androidWebView: "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36",
};

describe("pixel helpers", () => {
  it("creates unguessable URL-safe ids", () => {
    const id = createTrackingId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(createTrackingId()).not.toBe(id);
    expect(trackingIdFromSegment(`${id}.gif`)).toBe(id);
    expect(trackingIdFromSegment("short.gif")).toBeNull();
    expect(trackingIdFromSegment("../../etc/passwd")).toBeNull();
  });

  it("builds the pixel URL under APP_URL", () => {
    expect(pixelUrl("abc")).toBe("http://localhost:3000/api/t/abc.gif");
  });

  it("injects the pixel before </body>, or appends it", () => {
    const html = injectPixel("<html><body><p>Hi</p></body></html>", "https://x/api/t/a.gif?x=1&y=2");
    expect(html).toBe(
      '<html><body><p>Hi</p><img width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0" src="https://x/api/t/a.gif?x=1&amp;y=2"></body></html>',
    );
    expect(injectPixel("<p>Hi</p>", "u")).toMatch(/^<p>Hi<\/p><img [^>]*src="u">$/);
  });
});

describe("classifyOpen", () => {
  const label = (userAgent: string, ip?: string) => classifyOpen({ userAgent, ip });

  it("recognises Apple Mail Privacy Protection", () => {
    expect(label(UA.appleMpp, "104.28.40.12")).toEqual({ client: "Apple Mail", viaApple: true, viaGoogleProxy: false });
    expect(label(UA.iphoneMail, "17.58.101.4").viaApple).toBe(true);
    expect(isAppleIp("::ffff:17.1.2.3")).toBe(true);
    expect(isAppleIp("2620:149:a:b::1")).toBe(true);
    expect(isAppleIp("18.0.0.1")).toBe(false);
    expect(isAppleIp("170.1.1.1")).toBe(false);
  });

  it("recognises image proxies", () => {
    expect(label(UA.gmailProxy, "66.249.84.1")).toEqual({ client: "Gmail", viaApple: false, viaGoogleProxy: true });
    expect(label(UA.yahooProxy).client).toBe("Yahoo Mail");
  });

  it("derives coarse device · app labels", () => {
    expect(label(UA.iphoneMail, "89.24.1.1")).toEqual({ client: "iPhone · Apple Mail", viaApple: false, viaGoogleProxy: false });
    expect(label(UA.macMail).client).toBe("Mac · Apple Mail");
    expect(label(UA.outlookWin).client).toBe("Windows · Outlook");
    expect(label(UA.outlookIos).client).toBe("iPhone · Outlook");
    expect(label(UA.outlookAndroid).client).toBe("Android · Outlook");
    expect(label(UA.thunderbird).client).toBe("Linux · Thunderbird");
    expect(label(UA.thunderbirdWin).client).toBe("Windows · Thunderbird");
    expect(label(UA.chromeMac).client).toBe("Mac · Chrome");
    expect(label(UA.safariIphone).client).toBe("iPhone · Safari");
    expect(label(UA.androidWebView).client).toBe("Android · Mail app");
    expect(label("").client).toBe("Unknown client");
  });
});

/* ------------------------------- DB-backed -------------------------------- */

const suffix = Math.random().toString(36).slice(2, 10);
let userId = "";
let accountId = "";

async function track(recipients: { name: string; email: string }[], armedAt = new Date(Date.now() - 1000)) {
  const id = createTrackingId();
  await db()
    .insert(schema.trackedMessages)
    .values({ id, userId, accountId, subject: "Quarterly plan", recipients, threadId: "thr_test", armedAt });
  return id;
}

describe("recordOpen / getOpenSummaries", () => {
  beforeAll(async () => {
    const [user] = await db()
      .insert(schema.users)
      .values({ email: `tracking-${suffix}@example.com`, name: "Tester" })
      .returning();
    userId = user.id;
    const [account] = await db()
      .insert(schema.accounts)
      .values({ userId, provider: "imap", email: `tracking-${suffix}@example.com`, name: "Test", hue: 200, credentials: { kid: "v1", dek: "x", data: "x" } })
      .returning();
    accountId = account.id;
  });

  afterAll(async () => {
    if (userId) await db().delete(schema.users).where(eq(schema.users.id, userId));
  });

  const hit = (trackingId: string, o: Partial<Parameters<typeof recordOpen>[0]> = {}) => ({
    trackingId,
    userAgent: UA.iphoneMail,
    ip: "89.24.1.1",
    hasSessionCookie: false,
    ...o,
  });

  it("records at most 10 opens and notifies at most 3 times an hour, however often it's loaded", async () => {
    const id = await track([{ name: "Petr Novák", email: "petr@example.com" }]);
    const notify = vi.fn(async () => {});
    const t0 = new Date();
    const results: string[] = [];
    // A minute apart each, so the burst dedupe doesn't catch them: only the hourly caps do.
    for (let i = 0; i < 14; i++) results.push(await recordOpen(hit(id, { now: new Date(t0.getTime() + i * 61_000) }), { notify }));
    expect(results.filter((r) => r === "recorded")).toHaveLength(10);
    expect(notify).toHaveBeenCalledTimes(3);
  });

  it("records a real open, dedupes bursts and notifies with the recipient's first name", async () => {
    const id = await track([{ name: "Petr Novák", email: "petr@example.com" }]);
    const notify = vi.fn(async () => {});
    const t0 = new Date();
    expect(await recordOpen(hit(id, { now: t0 }), { notify })).toBe("recorded");
    expect(await recordOpen(hit(id, { now: new Date(t0.getTime() + 5_000) }), { notify })).toBe("duplicate");
    expect(await recordOpen(hit(id, { userAgent: UA.outlookWin, now: new Date(t0.getTime() + 6_000) }), { notify })).toBe("recorded");
    expect(await recordOpen(hit(id, { now: new Date(t0.getTime() + 61_000) }), { notify })).toBe("recorded");

    expect(notify).toHaveBeenCalledTimes(3);
    expect(notify).toHaveBeenCalledWith(userId, {
      title: "Petr opened “Quarterly plan”",
      body: "iPhone · Apple Mail",
      url: "/?thread=thr_test",
      tag: `open-${id}`,
    });

    const rows = await db().select().from(schema.openEvents).where(eq(schema.openEvents.trackedId, id));
    expect(rows).toHaveLength(3);
    // Product rule: nothing that looks like an IP is ever stored.
    expect(JSON.stringify(rows)).not.toContain("89.24");
  });

  it("stores Apple prefetches without a push", async () => {
    const id = await track([{ name: "Petr", email: "petr@example.com" }]);
    const notify = vi.fn(async () => {});
    expect(await recordOpen(hit(id, { userAgent: UA.appleMpp, ip: "17.1.2.3" }), { notify })).toBe("recorded");
    expect(notify).not.toHaveBeenCalled();
    const summary = await getOpenSummaries(userId, [id]);
    expect(summary[id].opens).toEqual([{ at: expect.any(Number), client: "Apple Mail", viaApple: true }]);
  });

  it("says 'Someone' when there are several recipients", async () => {
    const id = await track([
      { name: "Petr", email: "petr@example.com" },
      { name: "Jana", email: "jana@example.com" },
    ]);
    const notify = vi.fn(async () => {});
    await recordOpen(hit(id), { notify });
    expect(notify).toHaveBeenCalledWith(userId, expect.objectContaining({ title: "Someone opened “Quarterly plan”" }));
  });

  it("ignores our own session, unknown ids and hits before arming", async () => {
    const notify = vi.fn(async () => {});
    const id = await track([{ name: "", email: "x@example.com" }]);
    expect(await recordOpen(hit(id, { hasSessionCookie: true }), { notify })).toBe("ignored");
    expect(await recordOpen(hit("doesnotexist_doesnotexist"), { notify })).toBe("ignored");
    const future = await track([], new Date(Date.now() + 60_000));
    expect(await recordOpen(hit(future), { notify })).toBe("ignored");
    expect(notify).not.toHaveBeenCalled();
  });

  it("summarises opens only for the user's own tracked messages", async () => {
    const id = await track([{ name: "", email: "x@example.com" }]);
    const t0 = Date.now();
    await recordOpen(hit(id, { now: new Date(t0) }), { notify: async () => {} });
    await recordOpen(hit(id, { userAgent: UA.gmailProxy, now: new Date(t0 + 1000) }), { notify: async () => {} });
    const empty = await track([]);

    const summary = await getOpenSummaries(userId, [id, empty, "unknown"]);
    expect(Object.keys(summary).sort()).toEqual([empty, id].sort());
    expect(summary[id].opens.map((o) => o.client)).toEqual(["iPhone · Apple Mail", "Gmail"]);
    expect(summary[empty].opens).toEqual([]);
    expect(await getOpenSummaries("usr_someone_else", [id])).toEqual({});
    expect(await getOpenSummaries(userId, [])).toEqual({});
  });
});
