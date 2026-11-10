/**
 * The List-Unsubscribe header (RFC 2369): `<mailto:…>, <https://…>`. With List-Unsubscribe-Post
 * (RFC 8058) the https address unsubscribes by itself when POSTed to ("one click"); without it, it's
 * a page the user finishes on.
 */
export interface UnsubscribeOptions {
  https?: string;
  mailto?: { to: string; subject: string; body: string };
}

export function parseListUnsubscribe(header: string | null | undefined): UnsubscribeOptions {
  const out: UnsubscribeOptions = {};
  for (const [, raw] of (header ?? "").matchAll(/<\s*([^>]+?)\s*>/g)) {
    const value = raw.replace(/\s+/g, "");
    if (!out.https && /^https:\/\//i.test(value)) {
      try {
        out.https = new URL(value).toString();
      } catch {
        // Not a usable address.
      }
    } else if (!out.mailto && /^mailto:/i.test(value)) {
      const [address, query = ""] = value.slice("mailto:".length).split("?");
      const params = new URLSearchParams(query);
      let to = address;
      try {
        to = decodeURIComponent(address);
      } catch {
        // Keep it as written.
      }
      if (/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(to)) {
        out.mailto = { to, subject: params.get("subject") || "unsubscribe", body: params.get("body") || "unsubscribe" };
      }
    }
  }
  return out;
}

/** How unsubscribing from this conversation's list would go, if it can. */
export function unsubscribeMethod(header: string | null | undefined, oneClick: boolean | undefined): "one-click" | "email" | "page" | null {
  const options = parseListUnsubscribe(header);
  if (options.https && oneClick) return "one-click";
  if (options.mailto) return "email";
  if (options.https) return "page";
  return null;
}
