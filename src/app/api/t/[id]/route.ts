import { after, type NextRequest } from "next/server";
import { LEGACY_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME } from "@/server/auth/cookie-name";
import { recordOpen, trackingIdFromSegment } from "@/server/tracking";
import { logError } from "@/server/log";

/** 1×1 transparent GIF (43 bytes). */
const GIF = Buffer.from("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", "base64");

/** First hop of X-Forwarded-For; only used in memory to recognise Apple's proxy, never stored. */
function clientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || null;
}

/**
 * Read-tracking pixel, `/api/t/<id>.gif`. Always the same GIF with no-store headers, whether the id
 * exists or not, so the endpoint can't be used to probe ids. Reading the request makes the route
 * dynamic under Cache Components; recording happens in `after()` so the image is never delayed.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const trackingId = trackingIdFromSegment(id);
  const hit = {
    userAgent: req.headers.get("user-agent"),
    ip: clientIp(req),
    hasSessionCookie: req.cookies.has(SESSION_COOKIE_NAME) || req.cookies.has(LEGACY_SESSION_COOKIE_NAME),
  };
  if (trackingId) {
    after(() =>
      recordOpen({ trackingId, ...hit }).catch((err) => {
        logError("recording open failed", err);
      }),
    );
  }
  return new Response(new Uint8Array(GIF), {
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(GIF.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
      Expires: "0",
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
    },
  });
}
