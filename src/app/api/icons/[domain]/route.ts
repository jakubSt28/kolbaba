import { withUser } from "@/server/auth/session";

type Ctx = RouteContext<"/api/icons/[domain]">;

/** Lowercase host names only ("firma.cz", "xn--fa-hia.de"): no IPs, ports, paths or "localhost". */
const DOMAIN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
const MAX_BYTES = 200_000;
const WEEK = 7 * 24 * 3600;

const missing = () => new Response(null, { status: 404, headers: { "cache-control": "private, max-age=86400" } });

/**
 * Company logos for senders and AI agents. The server fetches the icon, so DuckDuckGo sees only the
 * domain and our server, never the user's IP address, and the browser caches the result for a week.
 * SVG is refused: served from our origin it could run script.
 */
export const GET = withUser<Ctx>(async (_user, _req, ctx) => {
  const domain = (await ctx.params).domain.toLowerCase();
  if (!DOMAIN.test(domain)) return missing();

  const upstream = await fetch(`https://icons.duckduckgo.com/ip3/${domain}.ico`, {
    signal: AbortSignal.timeout(5000),
    redirect: "error",
  }).catch(() => null);
  const type = upstream?.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  if (!upstream?.ok || !type.startsWith("image/") || type === "image/svg+xml") return missing();
  const body = await upstream.arrayBuffer();
  if (!body.byteLength || body.byteLength > MAX_BYTES) return missing();

  return new Response(body, {
    headers: {
      "content-type": type,
      "cache-control": `private, max-age=${WEEK}, stale-while-revalidate=${WEEK}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
});
