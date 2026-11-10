import { lookup, Resolver } from "node:dns/promises";
import type { ServerConfig } from "../db/schema";

/** The DNS calls autodetection needs; injectable so tests don't touch the network. */
export interface DnsResolvers {
  resolveMx(domain: string): Promise<{ exchange: string; priority: number }[]>;
  resolveSrv(name: string): Promise<{ name: string; port: number; priority: number; weight: number }[]>;
  /** Hostnames of an IP address (PTR). */
  reverse(ip: string): Promise<string[]>;
  /** All addresses of a hostname, as a connection would resolve it. */
  addresses(host: string): Promise<string[]>;
}

export function systemResolvers(timeoutMs: number): DnsResolvers {
  const r = new Resolver({ timeout: timeoutMs, tries: 1 });
  return {
    resolveMx: (d) => r.resolveMx(d),
    resolveSrv: (n) => r.resolveSrv(n),
    reverse: (ip) => r.reverse(ip),
    addresses: async (h) => (await lookup(h, { all: true })).map((a) => a.address),
  };
}

/** Resolve or give up after `ms`; DNS errors (NXDOMAIN, SERVFAIL, timeouts) all mean "nothing here". */
export async function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.catch(() => null),
      new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), ms))),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** MX hostnames, most preferred first. */
export async function lookupMx(dns: DnsResolvers, domain: string, ms: number): Promise<string[]> {
  const records = (await within(dns.resolveMx(domain), ms)) ?? [];
  return records
    .filter((r) => r.exchange && r.exchange !== ".")
    .sort((a, b) => a.priority - b.priority)
    .map((r) => r.exchange.toLowerCase().replace(/\.$/, ""));
}

/**
 * Registrable domain of a host, close enough for ISPDB lookups (mx1.forpsi.com → forpsi.com).
 * Handles two-level public suffixes like co.uk / com.au without shipping the whole suffix list.
 */
export function baseDomain(host: string) {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".");
  if (labels.length <= 2) return labels.join(".");
  const [sld, tld] = labels.slice(-2);
  const twoLevel = tld.length === 2 && /^(co|com|net|org|gov|ac|edu|or|ne)$/.test(sld);
  return labels.slice(twoLevel ? -3 : -2).join(".");
}

async function srvOne(dns: DnsResolvers, name: string, secure: boolean, ms: number): Promise<ServerConfig | undefined> {
  const records = (await within(dns.resolveSrv(name), ms)) ?? [];
  // "." target means the service is explicitly not offered (RFC 6186 §3.4).
  const best = records
    .filter((r) => r.name && r.name !== "." && r.port > 0)
    .sort((a, b) => a.priority - b.priority || b.weight - a.weight)[0];
  return best ? { host: best.name.toLowerCase().replace(/\.$/, ""), port: best.port, secure, username: "%EMAILADDRESS%" } : undefined;
}

/** RFC 6186 service records. Implicit TLS (RFC 8314) wins over STARTTLS when both exist. */
export async function lookupSrv(dns: DnsResolvers, domain: string, ms: number) {
  const [imaps, imap, submissions, submission] = await Promise.all([
    srvOne(dns, `_imaps._tcp.${domain}`, true, ms),
    srvOne(dns, `_imap._tcp.${domain}`, false, ms),
    srvOne(dns, `_submissions._tcp.${domain}`, true, ms),
    srvOne(dns, `_submission._tcp.${domain}`, false, ms),
  ]);
  return { imap: imaps ?? imap, smtp: submissions ?? submission };
}
