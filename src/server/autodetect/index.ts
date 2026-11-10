import "server-only";
import { domainToASCII } from "node:url";
import { tk, translate, type Locale } from "@/lib/i18n";
import type { ServerConfig } from "../db/schema";
import { baseDomain, type DnsResolvers, lookupMx, lookupSrv, systemResolvers, within } from "./dns";
import { autoconfigUrls, type ClientConfig, type Fetch, fetchClientConfig, ispdbUrl } from "./ispdb";
import { knownByDomain, knownByHost, knownByMx, toDetection } from "./known";
import { certificateCovers, type Probe, type ProbeResult, resolvePublic, tcpProbe } from "./probe";
import type { Detection, DetectionSource } from "./types";
import { env } from "../env";
import { microsoftEnabled } from "../microsoft";

export type { AppPasswordHint, Detection, DetectionSource } from "./types";
export { sourceLabel } from "./types";
export { testConnection, type TestConnectionResult, type TestFailureReason } from "./test-connection";

/**
 * Find IMAP/SMTP settings from just an email address, the way Thunderbird does: built-in table,
 * ISPDB, the domain's autoconfig file, MX, SRV, and finally probing common hostnames (following a
 * shared host's certificate to its real name). Network failures never throw; each step just falls
 * through to the next.
 */

export interface DetectDeps {
  fetch: Fetch;
  dns: DnsResolvers;
  probe: Probe;
  /** Per HTTP/DNS request. */
  timeoutMs: number;
  /** Time for each round of hostname-guessing probes. */
  guessBudgetMs: number;
}

const CACHE_TTL_MS = 3600_000;
/** "Nothing found" may be a passing network problem, so it's remembered only briefly. */
const NOT_FOUND_TTL_MS = 5 * 60_000;
const CACHE_MAX = 5000;
const cache = new Map<string, { expires: number; detection: Detection }>();

export function clearDetectionCache() {
  cache.clear();
}

export function splitEmail(email: string) {
  const at = email.trim().lastIndexOf("@");
  if (at < 1) return null;
  const local = email.trim().slice(0, at);
  // Lowercased punycode, so "Firma.CZ" and "příklad.cz" become cacheable DNS names.
  const domain = domainToASCII(email.trim().slice(at + 1).replace(/\.$/, ""));
  return domain && domain.includes(".") ? { local, domain } : null;
}

/** Substitute Mozilla-style placeholders in hostnames and usernames. */
export function fillPlaceholders(detection: Detection, email: string): Detection {
  const parts = splitEmail(email);
  if (!parts) return detection;
  const fill = (s: string) =>
    s
      .replaceAll("%EMAILADDRESS%", email.trim())
      .replaceAll("%EMAILLOCALPART%", parts.local)
      .replaceAll("%EMAILDOMAIN%", parts.domain);
  const server = (s?: ServerConfig) =>
    s && { ...s, host: fill(s.host), ...(s.username !== undefined ? { username: fill(s.username) } : {}) };
  return { ...detection, imap: server(detection.imap), smtp: server(detection.smtp) };
}

/** The user-facing texts of a (cached, English) detection in the reader's language. */
function localize(detection: Detection, locale: Locale): Detection {
  const { messageVars, ...rest } = detection;
  return {
    ...rest,
    ...(rest.message ? { message: translate(locale, rest.message, messageVars) } : {}),
    ...(rest.appPassword ? { appPassword: { ...rest.appPassword, label: translate(locale, rest.appPassword.label) } } : {}),
  };
}

/**
 * Autoconfig only from public addresses: the domain is the user's input, and its autoconfig host could
 * point into our own network. (Redirects aren't followed either, see fetchClientConfig.)
 */
const publicFetch: Fetch = async (url, init) => {
  const host = new URL(url).hostname;
  if (!(await resolvePublic(host, 3000))) throw new Error(`${host} isn't a public address`);
  return fetch(url, init);
};

export async function detectMailSettings(email: string, deps: Partial<DetectDeps> & { locale?: Locale } = {}): Promise<Detection> {
  const locale = deps.locale ?? "en";
  const parts = splitEmail(email);
  if (!parts) {
    return {
      provider: "imap",
      providerLabel: "",
      method: "password",
      source: "none",
      supported: false,
      message: translate(locale, "That doesn't look like an email address."),
    };
  }
  const hit = cache.get(parts.domain);
  if (hit && hit.expires > Date.now()) return localize(withGmailPassword(withMicrosoft(fillPlaceholders(hit.detection, email))), locale);

  const timeoutMs = deps.timeoutMs ?? 3000;
  const detection = await detectDomain(parts.domain, email, {
    fetch: deps.fetch ?? publicFetch,
    dns: deps.dns ?? systemResolvers(timeoutMs),
    probe: deps.probe ?? tcpProbe,
    timeoutMs,
    guessBudgetMs: deps.guessBudgetMs ?? 6000,
  });

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(parts.domain, {
    expires: Date.now() + (detection.source === "none" ? NOT_FOUND_TTL_MS : CACHE_TTL_MS),
    detection,
  });
  return localize(withGmailPassword(withMicrosoft(fillPlaceholders(detection, email))), locale);
}

/**
 * A self-hosted copy rarely has a Google app of its own, and ours can't be lent: there, Gmail connects
 * over IMAP with an app password. The servers and the steps are already in the Gmail entry (known.ts).
 */
function withGmailPassword(detection: Detection): Detection {
  if (detection.provider !== "gmail" || !env.selfHosted || env.hasGoogle) return detection;
  return { ...detection, provider: "imap", method: "password", oauth: undefined, appPassword: knownByHost("imap.gmail.com")?.appPassword };
}

/** Outlook and Microsoft 365 sign in with Microsoft once the app registration is set up; until then they're "coming soon". */
function withMicrosoft(detection: Detection): Detection {
  const microsoft = detection.method === "oauth" && detection.provider === "imap";
  if (!microsoft || !microsoftEnabled()) return detection;
  return {
    ...detection,
    supported: true,
    oauth: "microsoft",
    // Outlook.com lets mail apps in only once IMAP is on in its settings (off for many accounts).
    message: detection.providerLabel === "Outlook.com" ? tk("Before you continue: in Outlook on the web, turn on Settings → Mail → Forwarding and IMAP → Let devices and apps use IMAP.") : undefined,
    messageVars: undefined,
  };
}

/**
 * Settings found outside the built-in table may still point at a provider we know (a custom domain
 * listed in ISPDB with imap.gmail.com, say). Then the provider's OAuth / app-password knowledge applies.
 */
function fromServers(source: DetectionSource, label: string, imap: ServerConfig, smtp?: ServerConfig): Detection {
  const known = knownByHost(imap.host);
  if (known?.provider === "gmail") return toDetection(known, source, "Google Workspace");
  // A custom domain at Microsoft 365 (found through ISPDB or autoconfig): Microsoft's sign-in, like Outlook.com.
  if (known?.method === "oauth") return toDetection(known, source, "Microsoft 365");
  return {
    provider: "imap",
    providerLabel: known?.label ?? label,
    method: "password",
    imap,
    smtp,
    source,
    appPassword: known?.appPassword,
    supported: known?.supported ?? true,
    message: known?.message,
  };
}

const fromConfig = (c: ClientConfig | null, source: DetectionSource, fallbackLabel: string) =>
  c?.imap ? fromServers(source, c.displayName || fallbackLabel, c.imap, c.smtp) : null;

async function detectDomain(domain: string, email: string, deps: DetectDeps): Promise<Detection> {
  const known = knownByDomain(domain);
  if (known) return known;

  const { fetch: fetchFn, dns, timeoutMs } = deps;
  // Independent lookups start together so the worst case is ~one timeout, not the sum of them;
  // answers are still taken in priority order.
  const ispdb = fetchClientConfig(fetchFn, ispdbUrl(domain), timeoutMs);
  const autoconfig = Promise.all(autoconfigUrls(domain, email).map((u) => fetchClientConfig(fetchFn, u, timeoutMs)));
  const mx = lookupMx(dns, domain, timeoutMs);
  const srv = lookupSrv(dns, domain, timeoutMs);

  const fromIspdb = fromConfig(await ispdb, "ispdb", domain);
  if (fromIspdb) return fromIspdb;

  for (const c of await autoconfig) {
    const d = fromConfig(c, "autoconfig", domain);
    if (d) return d;
  }

  const mxHosts = await mx;
  const byMx = knownByMx(mxHosts);
  if (byMx) return byMx;
  if (mxHosts.length) {
    // Like Thunderbird: the mail host's own domain may be in ISPDB (mx.example-hosting.cz → example-hosting.cz).
    const mxDomain = baseDomain(mxHosts[0]);
    if (mxDomain !== domain) {
      const d = fromConfig(await fetchClientConfig(fetchFn, ispdbUrl(mxDomain), timeoutMs), "mx", mxDomain);
      if (d) return d;
    }
  }

  const service = await srv;
  if (service.imap) return fromServers("srv", domain, service.imap, service.smtp);

  const guessed = await guess(domain, mxHosts, deps);
  if (guessed) return guessed;

  return {
    provider: "imap",
    providerLabel: domain,
    method: "password",
    source: "none",
    supported: true,
    message: tk("We couldn't find the mail servers for {domain}. Check the address for typos, or enter the servers yourself. Your email provider's help pages list them."),
    messageVars: { domain },
  };
}

/**
 * Spam filters and forwarders: their MX says nothing about where the mailbox is, so their own
 * hostnames aren't worth guessing at.
 */
const RELAY_MX =
  /(^|\.)(mimecast\.com|pphosted\.com|ppe-hosted\.com|barracudanetworks\.com|messagelabs\.com|mailcontrol\.com|iphmx\.com|spamexperts\.(com|eu|net)|antispamcloud\.com|hornetsecurity\.com|trendmicro\.(com|eu)|sophos\.com|mailchannels\.net|cloudflare\.net|improvmx\.com|forwardemail\.net|mailgun\.org|amazonaws\.com|spamfilter\.io|virusfree\.cz|spamfree\.cz)$/;

/** Names to try per certificate: its reverse DNS, listed names and the usual names under a wildcard. */
const MAX_FOLLOW = 6;

type Kind = "imap" | "smtp";
type Hint = { address: string; certNames: string[] };

const PORTS = { imap: [[993, true], [143, false]], smtp: [[465, true], [587, false]] } as const;

const unique = <T,>(list: T[], key: (x: T) => string = String) => [...new Map(list.map((x) => [key(x), x])).values()];

/** Implicit TLS on every name before STARTTLS on any. */
const candidates = (names: string[], kind: Kind): ServerConfig[] =>
  PORTS[kind].flatMap(([port, secure]) => names.map((host) => ({ host, port, secure, username: "%EMAILADDRESS%" })));

/**
 * Probe every candidate at once and take the most preferred one that passes, without waiting for
 * the less preferred. Servers that answered with a certificate for other names come back as hints.
 */
async function firstPassing(list: ServerConfig[], kind: Kind, { probe, guessBudgetMs }: DetectDeps) {
  const results = list.map((s) => probe(s, kind, guessBudgetMs).catch((): ProbeResult => ({ ok: false })));
  const hints: Hint[] = [];
  for (const [i, pending] of results.entries()) {
    const result = await pending;
    if (result.ok) return { server: list[i], hints };
    if (result.address && result.certNames?.length) hints.push({ address: result.address, certNames: result.certNames });
  }
  return { server: undefined, hints };
}

/**
 * Shared hosting often answers on imap.<own-domain> with a certificate for its own names only
 * (imap.firma.cz → mail050.webglobe.com, certificate *.webglobe.com). A name that certificate covers
 * and that points at the very same address is that server under its real name: the address's
 * reverse DNS, a name listed on the certificate, or a usual mail name under its wildcard.
 */
async function realNames(hints: Hint[], { dns, timeoutMs }: DetectDeps): Promise<string[]> {
  const perHint = await Promise.all(
    unique(hints, (h) => h.address).map(async ({ address, certNames }) => {
      const ptr = ((await within(dns.reverse(address), timeoutMs)) ?? []).map((n) => n.toLowerCase().replace(/\.$/, ""));
      const wildcards = certNames.filter((n) => n.startsWith("*."));
      const names = unique([
        ...ptr,
        ...certNames.filter((n) => !n.startsWith("*.")),
        ...wildcards.flatMap((w) => ["imap", "mail", "smtp"].map((p) => p + w.slice(1))),
      ])
        .filter((n) => certificateCovers(certNames, n))
        .slice(0, MAX_FOLLOW);
      const same = await Promise.all(names.map(async (n) => ((await within(dns.addresses(n), timeoutMs)) ?? []).includes(address)));
      return names.filter((_, i) => same[i]);
    }),
  );
  return unique(perHint.flat());
}

/**
 * Probe the usual hostnames, like Thunderbird: on the address's own domain, then on its MX host and
 * the MX host's domain (mx1.hosting.cz → imap.hosting.cz). Only a server with a certificate valid
 * for its name counts. Failing that, follow the certificates the own-domain names answered with.
 */
async function guess(domain: string, mxHosts: string[], deps: DetectDeps): Promise<Detection | null> {
  const mx = mxHosts[0] && !RELAY_MX.test(mxHosts[0]) ? mxHosts[0] : undefined;
  const mxDomain = mx && baseDomain(mx);
  const groups = [
    { imap: [`imap.${domain}`, `mail.${domain}`], smtp: [`smtp.${domain}`, `mail.${domain}`] },
    ...(mx ? [{ imap: [mx], smtp: [mx] }] : []),
    ...(mxDomain && mxDomain !== domain ? [{ imap: [`imap.${mxDomain}`, `mail.${mxDomain}`], smtp: [`smtp.${mxDomain}`, `mail.${mxDomain}`] }] : []),
  ];
  const list = (kind: Kind) => unique(groups.flatMap((g) => candidates(g[kind], kind)), (s) => `${s.host}:${s.port}`);
  const [imap, smtp] = await Promise.all([firstPassing(list("imap"), "imap", deps), firstPassing(list("smtp"), "smtp", deps)]);

  let imapServer = imap.server;
  let smtpServer = smtp.server;
  if (!imapServer || !smtpServer) {
    const [imapNames, smtpNames] = await Promise.all([
      imapServer ? [] : realNames(imap.hints, deps),
      smtpServer ? [] : realNames(smtp.hints, deps),
    ]);
    const [imapFollowed, smtpFollowed] = await Promise.all([
      firstPassing(candidates(imapNames, "imap"), "imap", deps),
      // The IMAP server's real name usually takes mail in as well.
      firstPassing(candidates(unique([...smtpNames, ...imapNames]), "smtp"), "smtp", deps),
    ]);
    imapServer ??= imapFollowed.server;
    smtpServer ??= smtpFollowed.server;
  }
  if (!imapServer) return null;
  const label = imapServer.host.endsWith(`.${domain}`) ? domain : baseDomain(imapServer.host);
  return fromServers("guess", label, imapServer, smtpServer);
}
