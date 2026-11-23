/**
 * What the way back from connecting a mailbox or calendar has to say ("Google sign-in was cancelled",
 * "The calendars of … are here"). It travels in a short-lived cookie the server sets, not in the URL:
 * a link in an email could put any sentence in a query string and the app would show it as its own.
 * Shared by the callbacks (src/server/connect-result.ts) and the app, so no server imports here.
 */
export const CONNECT_COOKIE = process.env.NODE_ENV === "production" ? "__Host-kolbaba_connect" : "kolbaba_connect";

/** The texts it can carry, under the names the app reads. */
export const CONNECT_KEYS = ["connect_error", "connect_notice", "calendar_connected"] as const;
export type ConnectMessage = Partial<Record<(typeof CONNECT_KEYS)[number], string>>;

/** Reads and clears the message, once. Empty without one (or when the cookie can't be read). */
export function takeConnectMessage(): ConnectMessage {
  if (typeof document === "undefined") return {};
  const raw = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${CONNECT_COOKIE}=`))
    ?.slice(CONNECT_COOKIE.length + 1);
  if (!raw) return {};
  document.cookie = `${CONNECT_COOKIE}=; Path=/; Max-Age=0${CONNECT_COOKIE.startsWith("__Host-") ? "; Secure" : ""}`;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Record<string, unknown>;
    const out: ConnectMessage = {};
    for (const key of CONNECT_KEYS) if (typeof parsed[key] === "string") out[key] = (parsed[key] as string).slice(0, 300);
    return out;
  } catch {
    return {};
  }
}
