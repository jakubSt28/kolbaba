import type { ServerConfig } from "../db/schema";

/**
 * Mozilla "clientConfig" XML (Thunderbird ISPDB and a domain's own autoconfig file).
 * https://wiki.mozilla.org/Thunderbird:Autoconfiguration:ConfigFileFormat
 *
 * The format is small and flat, so a few regexes beat pulling in an XML parser.
 */

export interface ClientConfig {
  displayName?: string;
  imap?: ServerConfig;
  smtp?: ServerConfig;
}

export type Fetch = (url: string, init: { signal: AbortSignal; headers?: Record<string, string>; redirect?: RequestRedirect }) => Promise<Response>;

const MAX_XML_BYTES = 256 * 1024;

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

function tag(xml: string, name: string) {
  const m = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : undefined;
}

function attr(attrs: string, name: string) {
  return attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1];
}

/**
 * First usable server of a type, in the file's order (which is the provider's preference).
 * Plain-text servers are skipped: we never send a password unencrypted.
 */
function server(xml: string, element: "incomingServer" | "outgoingServer", type: string): ServerConfig | undefined {
  const re = new RegExp(`<${element}\\b([^>]*)>([\\s\\S]*?)</${element}>`, "gi");
  for (const [, attrs, body] of xml.matchAll(re)) {
    if (attr(attrs, "type")?.toLowerCase() !== type) continue;
    const host = tag(body, "hostname");
    const port = Number(tag(body, "port"));
    const socket = tag(body, "socketType")?.toUpperCase();
    if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) continue;
    if (socket !== "SSL" && socket !== "STARTTLS") continue;
    const username = tag(body, "username");
    return { host: host.toLowerCase(), port, secure: socket === "SSL", ...(username ? { username } : {}) };
  }
  return undefined;
}

/** Parse a clientConfig document. Placeholders (%EMAILADDRESS% …) are left in for `fillPlaceholders`. */
export function parseClientConfig(xml: string): ClientConfig | null {
  const clean = xml.replace(/<!--[\s\S]*?-->/g, "");
  if (!/<clientConfig\b/i.test(clean)) return null;
  const provider = clean.match(/<emailProvider\b[^>]*>([\s\S]*?)<\/emailProvider>/i)?.[1] ?? clean;
  const imap = server(provider, "incomingServer", "imap");
  if (!imap) return null;
  return {
    displayName: tag(provider, "displayName") || tag(provider, "displayShortName"),
    imap,
    smtp: server(provider, "outgoingServer", "smtp"),
  };
}

/** GET a config file; any failure (timeout, 404, junk) is just "no answer". */
export async function fetchClientConfig(fetchFn: Fetch, url: string, timeoutMs: number): Promise<ClientConfig | null> {
  try {
    // No redirects: an answer must come from the address asked (a redirect could point anywhere, our own network included).
    const res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/xml, text/xml" }, redirect: "error" });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > MAX_XML_BYTES) return null;
    return parseClientConfig(text);
  } catch {
    return null;
  }
}

export const ispdbUrl = (domain: string) => `https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(domain)}`;

/** The domain's own autoconfig locations, in Thunderbird's order. HTTPS only: the answer decides where a password goes. */
export const autoconfigUrls = (domain: string, email: string) => [
  `https://autoconfig.${domain}/mail/config-v1.1.xml?emailaddress=${encodeURIComponent(email)}`,
  `https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml`,
];
