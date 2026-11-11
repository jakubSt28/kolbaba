import { afterEach, describe, expect, it } from "vitest";
import { safeFetch } from "./net";

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };

/** A fetch that answers from a table of address → response and remembers what it was asked. */
function fakeFetch(routes: Record<string, () => Response>) {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", headers: { ...(init?.headers as Record<string, string>) }, body: init?.body as string | undefined });
    expect(init?.redirect).toBe("manual");
    const route = routes[url];
    if (!route) throw new TypeError("fetch failed");
    return route();
  }) as typeof fetch;
  return { fetchFn, calls };
}

const redirect = (to: string, status = 302) => new Response(null, { status, headers: { location: to } });
const PRIVATE = ["intranet.example.com", "10.0.0.5", "127.0.0.1", "localhost", "::1"];
const resolve = async (host: string) => (PRIVATE.includes(host) ? null : "203.0.113.10");

afterEach(() => {
  delete process.env.SELF_HOSTED;
});

describe("safeFetch", () => {
  it("fetches a public https address", async () => {
    const { fetchFn, calls } = fakeFetch({ "https://cal.example.com/feed.ics": () => new Response("BEGIN:VCALENDAR", { status: 200, headers: { etag: '"1"' } }) });
    const res = await safeFetch("https://cal.example.com/feed.ics", { headers: { Accept: "text/calendar" } }, { fetch: fetchFn, resolve });
    expect(res).toMatchObject({ status: 200, text: "BEGIN:VCALENDAR", url: "https://cal.example.com/feed.ics" });
    expect(res.headers.get("etag")).toBe('"1"');
    expect(calls).toEqual([{ url: "https://cal.example.com/feed.ics", method: "GET", headers: { Accept: "text/calendar" }, body: undefined }]);
  });

  it("gives back error statuses instead of throwing", async () => {
    const { fetchFn } = fakeFetch({ "https://cal.example.com/": () => new Response("no", { status: 401 }) });
    expect(await safeFetch("https://cal.example.com/", {}, { fetch: fetchFn, resolve })).toMatchObject({ status: 401, text: "no" });
  });

  it("refuses private addresses, plain http and things that aren't addresses", async () => {
    const { fetchFn, calls } = fakeFetch({});
    const deps = { fetch: fetchFn, resolve };
    await expect(safeFetch("https://intranet.example.com/cal", {}, deps)).rejects.toThrow("intranet.example.com is not a public address");
    await expect(safeFetch("https://10.0.0.5/", {}, deps)).rejects.toThrow("not a public address");
    await expect(safeFetch("https://[::1]/", {}, deps)).rejects.toThrow("not a public address");
    await expect(safeFetch("http://cal.example.com/feed.ics", {}, deps)).rejects.toThrow("Only https addresses are allowed");
    await expect(safeFetch("file:///etc/passwd", {}, deps)).rejects.toThrow("Only https addresses are allowed");
    await expect(safeFetch("not an address", {}, deps)).rejects.toThrow("Not a valid address");
    expect(calls).toEqual([]);
  });

  it("checks real addresses by default", async () => {
    const { fetchFn, calls } = fakeFetch({});
    await expect(safeFetch("https://127.0.0.1/", {}, { fetch: fetchFn })).rejects.toThrow("not a public address");
    await expect(safeFetch("https://192.168.1.20:8443/dav", {}, { fetch: fetchFn })).rejects.toThrow("not a public address");
    expect(calls).toEqual([]);
  });

  it("lets a self-hosted copy reach its own network, over http too", async () => {
    process.env.SELF_HOSTED = "1";
    const { fetchFn } = fakeFetch({ "http://10.0.0.5/dav/": () => new Response("ok") });
    expect((await safeFetch("http://10.0.0.5/dav/", {}, { fetch: fetchFn, resolve })).text).toBe("ok");
    await expect(safeFetch("ftp://10.0.0.5/", {}, { fetch: fetchFn, resolve })).rejects.toThrow("Only https");
  });

  it("follows redirects itself, keeping the method and the password within one origin", async () => {
    const { fetchFn, calls } = fakeFetch({
      "https://example.com/.well-known/caldav": () => redirect("/dav/", 301),
      "https://example.com/dav/": () => redirect("https://example.com/dav/home/", 307),
      "https://example.com/dav/home/": () => new Response("<multistatus/>", { status: 207 }),
    });
    const res = await safeFetch("https://example.com/.well-known/caldav", { method: "PROPFIND", headers: { Authorization: "Basic abc", Depth: "0" }, body: "<propfind/>" }, { fetch: fetchFn, resolve });
    expect(res).toMatchObject({ status: 207, url: "https://example.com/dav/home/" });
    expect(calls.map((c) => [c.url, c.method, c.headers.Authorization, c.body])).toEqual([
      ["https://example.com/.well-known/caldav", "PROPFIND", "Basic abc", "<propfind/>"],
      ["https://example.com/dav/", "PROPFIND", "Basic abc", "<propfind/>"],
      ["https://example.com/dav/home/", "PROPFIND", "Basic abc", "<propfind/>"],
    ]);
  });

  it("drops the password when a redirect leaves the origin, and doesn't bring it back", async () => {
    const { fetchFn, calls } = fakeFetch({
      "https://example.com/cal": () => redirect("https://dav.example.net/cal"),
      "https://dav.example.net/cal": () => redirect("https://example.com/final"),
      "https://example.com/final": () => new Response("done"),
    });
    const res = await safeFetch("https://example.com/cal", { headers: { authorization: "Basic abc", Depth: "1" } }, { fetch: fetchFn, resolve });
    expect(res.url).toBe("https://example.com/final");
    expect(calls.map((c) => c.headers)).toEqual([{ authorization: "Basic abc", Depth: "1" }, { Depth: "1" }, { Depth: "1" }]);
  });

  it("checks every hop of a redirect", async () => {
    const { fetchFn, calls } = fakeFetch({
      "https://example.com/a": () => redirect("https://intranet.example.com/secret"),
      "https://example.com/b": () => redirect("http://example.com/plain"),
      "https://example.com/c": () => redirect("https://10.0.0.5/admin"),
    });
    const deps = { fetch: fetchFn, resolve };
    await expect(safeFetch("https://example.com/a", {}, deps)).rejects.toThrow("not a public address");
    await expect(safeFetch("https://example.com/b", {}, deps)).rejects.toThrow("Only https addresses are allowed");
    await expect(safeFetch("https://example.com/c", {}, deps)).rejects.toThrow("not a public address");
    expect(calls.map((c) => c.url)).toEqual(["https://example.com/a", "https://example.com/b", "https://example.com/c"]);
  });

  it("gives up after five redirects", async () => {
    const routes: Record<string, () => Response> = {};
    for (let i = 0; i < 10; i++) routes[`https://example.com/${i}`] = () => redirect(`/${i + 1}`);
    const { fetchFn, calls } = fakeFetch(routes);
    await expect(safeFetch("https://example.com/0", {}, { fetch: fetchFn, resolve })).rejects.toThrow("Too many redirects");
    expect(calls).toHaveLength(6);
    // Five are fine.
    routes["https://example.com/5"] = () => new Response("here");
    expect((await safeFetch("https://example.com/0", {}, { fetch: fetchFn, resolve })).text).toBe("here");
  });

  it("turns a redirected POST and a 303 into a GET without the body", async () => {
    const { fetchFn, calls } = fakeFetch({
      "https://example.com/post": () => redirect("/see", 303),
      "https://example.com/see": () => new Response("ok"),
    });
    await safeFetch("https://example.com/post", { method: "post", headers: { "Content-Type": "text/plain" }, body: "x" }, { fetch: fetchFn, resolve });
    expect(calls.map((c) => [c.method, c.body, c.headers])).toEqual([
      ["POST", "x", { "Content-Type": "text/plain" }],
      ["GET", undefined, {}],
    ]);
  });

  it("sends a name and password written into the address as a header", async () => {
    const { fetchFn, calls } = fakeFetch({ "https://cal.example.com/feed.ics": () => new Response("ok") });
    await safeFetch("https://jan%40example.com:s3cret@cal.example.com/feed.ics", {}, { fetch: fetchFn, resolve });
    expect(calls[0]).toMatchObject({ url: "https://cal.example.com/feed.ics", headers: { Authorization: `Basic ${Buffer.from("jan@example.com:s3cret").toString("base64")}` } });
  });

  it("stops waiting after the timeout", async () => {
    const hanging = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)))) as typeof fetch;
    await expect(safeFetch("https://slow.example.com/", { timeoutMs: 30 }, { fetch: hanging, resolve })).rejects.toThrow("No answer within");
  });

  it("stops reading a body that is too large", async () => {
    const chunk = new Uint8Array(1024).fill(65);
    let sent = 0;
    const endless = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            sent++;
            controller.enqueue(chunk);
          },
        }),
      );
    const { fetchFn } = fakeFetch({
      "https://example.com/endless": endless,
      "https://example.com/declared": () => new Response("small", { headers: { "content-length": "999999" } }),
      "https://example.com/fits": () => new Response("x".repeat(4096)),
    });
    const deps = { fetch: fetchFn, resolve };
    await expect(safeFetch("https://example.com/endless", { maxBytes: 4096 }, deps)).rejects.toThrow("The response is larger than 4 kB");
    expect(sent).toBeLessThan(20);
    await expect(safeFetch("https://example.com/declared", { maxBytes: 4096 }, deps)).rejects.toThrow("larger than");
    expect((await safeFetch("https://example.com/fits", { maxBytes: 4096 }, deps)).text).toHaveLength(4096);
  });

  it("says so when the server can't be reached", async () => {
    const { fetchFn } = fakeFetch({});
    await expect(safeFetch("https://down.example.com/", {}, { fetch: fetchFn, resolve })).rejects.toThrow("Could not reach down.example.com");
  });
});
