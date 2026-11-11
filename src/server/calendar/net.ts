import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { resolvePublic } from "../autodetect/probe";
import { env } from "../env";

/**
 * HTTP to addresses a user typed: a CalDAV server, a link to an .ics file. The hosted app must not be
 * talked into calling its own network, so every address (and every redirect) has to be public https.
 */

export interface SafeFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface SafeFetchDeps {
  fetch?: typeof fetch;
  /** The host's public address, or null when it has none (default: resolvePublic). */
  resolve?: (host: string) => Promise<string | null>;
}

export interface SafeResponse {
  status: number;
  headers: Headers;
  text: string;
  /** The address that answered, after redirects. */
  url: string;
}

const MAX_REDIRECTS = 5;
const DNS_TIMEOUT_MS = 5000;

/**
 * The address has to be https and public; returns the address the name resolved to. A self-hosted copy
 * may call anything (people run their own servers at home) and gets null.
 */
async function check(url: URL, resolve: (host: string) => Promise<string | null>): Promise<string | null> {
  if (url.protocol !== "https:" && !(url.protocol === "http:" && env.selfHosted)) throw new Error("Only https addresses are allowed");
  if (env.selfHosted) return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const address = await resolve(host);
  if (!address) throw new Error(`${url.hostname} is not a public address`);
  return address;
}

const UNPACK: Record<string, () => NodeJS.ReadWriteStream> = { gzip: createGunzip, "x-gzip": createGunzip, deflate: createInflate, br: createBrotliDecompress };

/**
 * One https request sent to the very address that was just checked. Plain fetch would look the name up
 * again, and a name that answers "public" the first time and "10.0.0.1" the second would get through.
 * The certificate is still checked against the name.
 */
function pinnedRequest(url: URL, address: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }): Promise<Response> {
  return new Promise((resolve, reject) => {
    const family = isIP(address) === 6 ? 6 : 4;
    const req = httpsRequest(
      url,
      {
        method: init.method,
        headers: { "accept-encoding": "gzip, deflate, br", ...init.headers },
        signal: init.signal,
        // Node asks with `all` set or not, depending on the version: answer both ways.
        lookup: (_host, options, callback) => (options.all ? callback(null, [{ address, family }]) : callback(null, address, family)),
      },
      (res) => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          if (Array.isArray(value)) value.forEach((v) => headers.append(name, v));
          else if (value !== undefined) headers.set(name, value);
        }
        const status = res.statusCode ?? 502;
        const empty = init.method === "HEAD" || status === 204 || status === 205 || status === 304;
        const unpack = UNPACK[(res.headers["content-encoding"] ?? "").toLowerCase()];
        if (empty) res.resume();
        const stream = empty ? null : unpack ? res.pipe(unpack()) : res;
        resolve(new Response(stream ? (Readable.toWeb(Readable.from(stream)) as ReadableStream<Uint8Array>) : null, { status, headers }));
      },
    );
    req.on("error", reject);
    req.end(init.body);
  });
}

/** The body as text, read no further than the cap. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const tooLarge = () => new Error(`The response is larger than ${Math.round(maxBytes / 1024)} kB`);
  if (Number(res.headers.get("content-length")) > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** fetch for addresses a user typed (a CalDAV server, an .ics link). On the hosted app it refuses anything that doesn't
 *  resolve to a public address (resolvePublic), https only (http allowed only when env.selfHosted), follows up to 5
 *  redirects by hand re-checking every hop, drops the Authorization header when a redirect leaves the origin, enforces a
 *  timeout (default 15 s) and a response size cap (default 10 MB; read the body through the cap and throw when exceeded).
 *  When env.selfHosted, private addresses are allowed (people run their own servers at home). */
export async function safeFetch(url: string, init: SafeFetchInit = {}, deps: SafeFetchDeps = {}): Promise<SafeResponse> {
  const fetchFn = deps.fetch ?? fetch;
  const resolve = deps.resolve ?? ((host: string) => resolvePublic(host, DNS_TIMEOUT_MS));
  const timeoutMs = init.timeoutMs ?? 15_000;
  const maxBytes = init.maxBytes ?? 10 * 1024 * 1024;
  // One deadline for the whole exchange, redirects and body included.
  const signal = AbortSignal.timeout(timeoutMs);

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new Error("Not a valid address");
  }
  const headers = { ...init.headers };
  // fetch refuses a name and password inside the address: they go where they belong.
  if (target.username || target.password) {
    const login = `${decodeURIComponent(target.username)}:${decodeURIComponent(target.password)}`;
    if (!Object.keys(headers).some((h) => h.toLowerCase() === "authorization")) headers.Authorization = `Basic ${Buffer.from(login, "utf8").toString("base64")}`;
    target.username = "";
    target.password = "";
  }
  const origin = target.origin;
  let method = (init.method ?? "GET").toUpperCase();
  let body = init.body;

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const address = await check(target, resolve);
      if (signal.aborted) throw signal.reason;
      // The hosted app sends the request to the address it checked; a test's own fetch and a self-hosted copy go the plain way.
      const send = address && !deps.fetch ? pinnedRequest(target, address, { method, headers, body, signal }) : fetchFn(target.href, { method, headers, body, redirect: "manual", signal });
      const res = await send.catch(() => {
        throw new Error(`Could not reach ${target.hostname}`);
      });
      const location = [301, 302, 303, 307, 308].includes(res.status) ? res.headers.get("location") : null;
      if (!location) return { status: res.status, headers: res.headers, text: await readCapped(res, maxBytes), url: target.href };

      await res.body?.cancel().catch(() => {});
      let next: URL;
      try {
        next = new URL(location, target);
      } catch {
        throw new Error("The server redirected to an address that isn't one");
      }
      next.username = "";
      next.password = "";
      if (next.origin !== origin) {
        // The password was meant for the address asked, not for wherever that one points.
        for (const name of Object.keys(headers)) if (name.toLowerCase() === "authorization") delete headers[name];
      }
      // As browsers do: "see other" becomes a GET, and so does a redirected POST.
      if ((res.status === 303 && method !== "HEAD") || ((res.status === 301 || res.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
        for (const name of Object.keys(headers)) if (name.toLowerCase() === "content-type") delete headers[name];
      }
      target = next;
    }
  } catch (error) {
    if (signal.aborted) throw new Error(`No answer within ${Math.round(timeoutMs / 1000)} s`);
    throw error instanceof Error ? error : new Error(String(error));
  }
  throw new Error("Too many redirects");
}
