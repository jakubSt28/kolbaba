import { lookup } from "node:dns/promises";
import { BlockList, connect as tcpConnect, isIP, type Socket } from "node:net";
import { type PeerCertificate, connect as tlsConnect, type TLSSocket } from "node:tls";
import type { ServerConfig } from "../db/schema";
import { within } from "./dns";

/**
 * Quick "is there a mail server here?" check for guessed hostnames. It reads the greeting, starts
 * TLS (on the plain ports through STARTTLS) and never logs in. It counts only with a certificate
 * valid for the hostname, because `imap.<custom-domain>` on shared hosting often answers with the
 * host's own certificate and would fail later anyway. That certificate still says who the server
 * is, so it comes back as `certNames` (with the `address` it answered on) for detection to follow.
 */
export interface ProbeResult {
  ok: boolean;
  address?: string;
  certNames?: string[];
}

export type Probe = (server: ServerConfig, kind: "imap" | "smtp", timeoutMs: number) => Promise<ProbeResult>;

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(net, prefix, "ipv4");
// No "::ffff:0:0/96" rule here: Node also checks IPv4 addresses against IPv4-mapped IPv6 rules, so it
// would mark every IPv4 address private. Mapped addresses are unwrapped in isPublicAddress instead.
for (const [net, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10]] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

/** "::ffff:10.0.0.1" or "::ffff:a00:1" → "10.0.0.1"; null for anything that isn't IPv4-mapped. */
function unmapIPv4(ip: string): string | null {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (dotted) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (!hex) return null;
  const [hi, lo] = [parseInt(hex[1], 16), parseInt(hex[2], 16)];
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
}

/** False for loopback, private, link-local and similar ranges: user input must not reach our own network. */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (!family) return false;
  const mapped = family === 6 ? unmapIPv4(ip) : null;
  if (mapped) return isPublicAddress(mapped);
  return !blocked.check(ip, family === 4 ? "ipv4" : "ipv6");
}

/** Resolve a hostname and return its first address, or null if it doesn't resolve or points somewhere private. */
export async function resolvePublic(host: string, timeoutMs: number): Promise<string | null> {
  if (isIP(host)) return isPublicAddress(host) ? host : null;
  const addrs = await within(lookup(host, { all: true }), timeoutMs);
  if (!addrs?.length || !addrs.every((a) => isPublicAddress(a.address))) return null;
  return addrs[0].address;
}

/** The DNS names a certificate is valid for, lowercased ("*.webglobe.com", "webglobe.com"). */
export function certificateNames(cert: Pick<PeerCertificate, "subject" | "subjectaltname">): string[] {
  const san = (cert.subjectaltname ?? "")
    .split(/,\s*/)
    .filter((n) => n.startsWith("DNS:"))
    .map((n) => n.slice(4).toLowerCase());
  const cn = cert.subject?.CN;
  return san.length ? san : typeof cn === "string" ? [cn.toLowerCase()] : [];
}

/** Whether a certificate for `names` is valid for `host`. A wildcard stands for exactly one label. */
export function certificateCovers(names: string[], host: string) {
  const h = host.toLowerCase();
  return names.some((n) => {
    if (!n.startsWith("*.")) return n === h;
    const label = h.endsWith(n.slice(1)) ? h.slice(0, h.length - n.length + 1) : "";
    return label !== "" && !label.includes(".");
  });
}

const GREETING = { imap: /^\* (OK|PREAUTH)\b/i, smtp: /^220[ -]/ };
/** A whole reply has arrived: IMAP's first line, or an SMTP reply's last line ("250 …" after "250-…" lines). */
const COMPLETE = { imap: /\n/, smtp: /^\d{3} [^\n]*\n/m };

/** The text received from now until it matches `complete`; null if the connection ends first. */
function reply(socket: Socket, complete: RegExp): Promise<string | null> {
  return new Promise((resolve) => {
    let text = "";
    const finish = (value: string | null) => {
      socket.off("data", onData).off("close", onClose);
      resolve(value);
    };
    const onData = (chunk: Buffer) => {
      text += chunk.toString("latin1");
      if (complete.test(text)) finish(text);
      else if (text.length > 16_384) finish(null);
    };
    const onClose = () => finish(null);
    socket.on("data", onData).on("close", onClose);
  });
}

function send(socket: Socket, line: string, complete: RegExp) {
  const answer = reply(socket, complete);
  socket.write(`${line}\r\n`);
  return answer;
}

/** Read the greeting and ask for TLS on a plain port (RFC 3501 §6.2.1, RFC 3207). */
async function startTls(socket: Socket, kind: "imap" | "smtp") {
  if (!GREETING[kind].test((await reply(socket, COMPLETE[kind])) ?? "")) return false;
  if (kind === "imap") return /^a OK\b/im.test((await send(socket, "a STARTTLS", /^a [^\n]*\n/m)) ?? "");
  const ehlo = await send(socket, "EHLO kolbaba.app", COMPLETE.smtp);
  if (!ehlo || !/^250[ -]STARTTLS\b/im.test(ehlo)) return false;
  return /^220 /m.test((await send(socket, "STARTTLS", COMPLETE.smtp)) ?? "");
}

function handshake(socket: TLSSocket): Promise<TLSSocket | null> {
  return new Promise((resolve) => {
    socket.once("secureConnect", () => resolve(socket)).once("error", () => resolve(null)).once("close", () => resolve(null));
  });
}

function verdict(socket: TLSSocket, address: string): ProbeResult {
  if (socket.authorized) return { ok: true };
  // Node checks the name only once the chain is trusted. A self-signed or expired certificate would
  // come along to every other name too, so only a name mismatch is worth following.
  if (String(socket.authorizationError) !== "ERR_TLS_CERT_ALTNAME_INVALID") return { ok: false };
  return { ok: false, address, certNames: certificateNames(socket.getPeerCertificate()) };
}

export const tcpProbe: Probe = async (server, kind, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  const address = await resolvePublic(server.host, timeoutMs);
  if (!address) return { ok: false };
  // Only the outermost socket is ever destroyed: after STARTTLS the TLS socket owns the plain one,
  // and destroying that one underneath it crashes Node (segfault).
  let current: Socket | undefined;
  const open = <T extends Socket>(socket: T) => {
    current = socket.on("error", () => {});
    return socket;
  };
  const timer = setTimeout(() => current?.destroy(), Math.max(0, deadline - Date.now()));
  // Not verified on connect: `verdict` reads whether the certificate fits. Only a greeting is ever read.
  const tlsOptions = { servername: server.host, rejectUnauthorized: false };
  try {
    if (server.secure) {
      const socket = await handshake(open(tlsConnect({ host: address, port: server.port, ...tlsOptions })));
      if (!socket || !GREETING[kind].test((await reply(socket, COMPLETE[kind])) ?? "")) return { ok: false };
      return verdict(socket, address);
    }
    const plain = open(tcpConnect({ host: address, port: server.port }));
    if (!(await startTls(plain, kind))) return { ok: false };
    const socket = await handshake(open(tlsConnect({ socket: plain, ...tlsOptions })));
    return socket ? verdict(socket, address) : { ok: false };
  } finally {
    clearTimeout(timer);
    current?.destroy();
  }
};
