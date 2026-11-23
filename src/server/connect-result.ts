import { CONNECT_COOKIE, CONNECT_KEYS, type ConnectMessage } from "@/lib/connect-message";
import { SECURE_COOKIES } from "./auth/cookie-name";

/**
 * Back to the app after connecting a mailbox or calendar. Ids and flags stay in the URL; the sentences
 * to show go in a cookie the app reads once (src/lib/connect-message.ts), so nobody can make the app
 * say something by crafting a link.
 */
export function connectRedirect(req: Request, params: Record<string, string>) {
  const query: Record<string, string> = {};
  const message: ConnectMessage = {};
  for (const [key, value] of Object.entries(params)) {
    if ((CONNECT_KEYS as readonly string[]).includes(key)) message[key as keyof ConnectMessage] = value;
    else query[key] = value;
  }
  // `connect` makes the app look for the message even when nothing else is in the query.
  if (Object.keys(message).length) query.connect = "";
  const headers = new Headers({ location: new URL(`/?${new URLSearchParams(query)}`, req.url).toString(), "cache-control": "no-store" });
  if (Object.keys(message).length) {
    // Readable by the app's script (not httpOnly): it holds nothing but the text it shows.
    const cookie = [`${CONNECT_COOKIE}=${encodeURIComponent(JSON.stringify(message))}`, "Path=/", "Max-Age=120", "SameSite=Lax"];
    if (SECURE_COOKIES) cookie.push("Secure");
    headers.append("set-cookie", cookie.join("; "));
  }
  return new Response(null, { status: 303, headers });
}
