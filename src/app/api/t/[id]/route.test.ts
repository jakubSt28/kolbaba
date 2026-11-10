import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const recordOpen = vi.fn(async () => "recorded" as const);
const pending: Promise<unknown>[] = [];

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  // Outside a request scope `after()` throws; run the callback and keep its promise for the test.
  after: (fn: () => Promise<unknown>) => pending.push(fn()),
}));
vi.mock("@/server/tracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/tracking")>()),
  recordOpen,
}));

const { GET } = await import("./route");

const ID = "AbCdEfGhIjKlMnOpQrStUvWx";
const call = (segment: string, headers: Record<string, string> = {}) =>
  GET(new NextRequest(`http://localhost:3000/api/t/${segment}`, { headers }), { params: Promise.resolve({ id: segment }) });

describe("GET /api/t/[id]", () => {
  beforeEach(() => {
    recordOpen.mockClear();
    pending.length = 0;
  });

  it("returns a 43-byte uncacheable GIF and records the hit", async () => {
    const res = await call(`${ID}.gif`, { "user-agent": "Mozilla/5.0", "x-forwarded-for": "17.1.2.3, 10.0.0.1" });
    const body = new Uint8Array(await res.arrayBuffer());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/gif");
    expect(res.headers.get("cache-control")).toBe("no-store, no-cache, must-revalidate, private");
    expect(body.length).toBe(43);
    expect(new TextDecoder().decode(body.slice(0, 6))).toBe("GIF89a");
    await Promise.all(pending);
    expect(recordOpen).toHaveBeenCalledWith({ trackingId: ID, userAgent: "Mozilla/5.0", ip: "17.1.2.3", hasSessionCookie: false });
  });

  it("passes our own session cookie through so the open is ignored", async () => {
    await call(`${ID}.gif`, { cookie: "kolbaba_session=abc" });
    await Promise.all(pending);
    expect(recordOpen).toHaveBeenCalledWith(expect.objectContaining({ hasSessionCookie: true }));
  });

  it("answers malformed ids with the same GIF without touching the database", async () => {
    const res = await call("nope");
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(43);
    expect(recordOpen).not.toHaveBeenCalled();
  });
});
