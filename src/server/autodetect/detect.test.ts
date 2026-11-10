import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DnsResolvers } from "./dns";
import { baseDomain } from "./dns";
import { clearDetectionCache, type DetectDeps, detectMailSettings, fillPlaceholders, splitEmail } from "./index";
import type { Fetch } from "./ispdb";
import { knownByMx } from "./known";
import type { Probe, ProbeResult } from "./probe";
import { sourceLabel } from "./types";

const seznamXml = readFileSync(new URL("./fixtures/seznam.cz.xml", import.meta.url), "utf8");

const config = (host: string, username = "%EMAILADDRESS%", name = "Example") => `
  <clientConfig version="1.1"><emailProvider id="x"><displayName>${name}</displayName>
    <incomingServer type="imap"><hostname>${host}</hostname><port>993</port><socketType>SSL</socketType><username>${username}</username></incomingServer>
    <outgoingServer type="smtp"><hostname>${host.replace(/^imap/, "smtp")}</hostname><port>465</port><socketType>SSL</socketType><username>${username}</username></outgoingServer>
  </emailProvider></clientConfig>`;

/** Fake network: URL → body; everything else 404. DNS: name → records; everything else NXDOMAIN. */
function deps(opts: {
  urls?: Record<string, string>;
  mx?: Record<string, string[]>;
  srv?: Record<string, { name: string; port: number }>;
  /** IP → PTR names, and hostname → addresses. */
  ptr?: Record<string, string[]>;
  a?: Record<string, string[]>;
  probe?: (host: string, port: number) => boolean | ProbeResult;
}): Partial<DetectDeps> & { fetch: ReturnType<typeof vi.fn>; probe: ReturnType<typeof vi.fn> } {
  const fetch = vi.fn<Fetch>(async (url) => {
    const body = opts.urls?.[url];
    return body ? new Response(body) : new Response("", { status: 404 });
  });
  const nx = () => Promise.reject(Object.assign(new Error("queryMx ENOTFOUND"), { code: "ENOTFOUND" }));
  const dns: DnsResolvers = {
    resolveMx: (d) => (opts.mx?.[d] ? Promise.resolve(opts.mx[d].map((exchange, i) => ({ exchange, priority: (i + 1) * 10 }))) : nx()),
    resolveSrv: (n) => (opts.srv?.[n] ? Promise.resolve([{ ...opts.srv[n], priority: 0, weight: 0 }]) : nx()),
    reverse: (ip) => (opts.ptr?.[ip] ? Promise.resolve(opts.ptr[ip]) : nx()),
    addresses: (h) => (opts.a?.[h] ? Promise.resolve(opts.a[h]) : nx()),
  };
  const probe = vi.fn<Probe>(async (s) => {
    const result = opts.probe?.(s.host, s.port) ?? false;
    return typeof result === "boolean" ? { ok: result } : result;
  });
  return {
    fetch,
    dns,
    probe,
    timeoutMs: 100,
    guessBudgetMs: 100,
  };
}

const ISPDB = (d: string) => `https://autoconfig.thunderbird.net/v1.1/${d}`;

beforeEach(() => clearDetectionCache());

describe("known providers", () => {
  it("offers Google sign-in for Gmail without touching the network", async () => {
    const d = deps({});
    const result = await detectMailSettings("jan@gmail.com", d);
    expect(result).toMatchObject({ provider: "gmail", method: "oauth", source: "known", supported: true });
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("returns Seznam servers with the address filled in and the 2FA app-password hint", async () => {
    const result = await detectMailSettings("Jan.Novak@email.cz", deps({}));
    expect(result).toMatchObject({
      providerLabel: "Seznam",
      method: "password",
      imap: { host: "imap.seznam.cz", port: 993, secure: true, username: "Jan.Novak@email.cz" },
      smtp: { host: "smtp.seznam.cz", port: 465, secure: true, username: "Jan.Novak@email.cz" },
      appPassword: { required: "with2fa", url: "https://o-seznam.cz/napoveda/ucet/dvoufazove-overeni/" },
    });
  });

  it("marks iCloud and Yahoo as always needing an app password", async () => {
    expect((await detectMailSettings("a@icloud.com", deps({}))).appPassword?.required).toBe("always");
    expect((await detectMailSettings("a@yahoo.com", deps({}))).appPassword?.required).toBe("always");
  });

  it("recognises Outlook and Proton but explains they aren't supported yet", async () => {
    const outlook = await detectMailSettings("a@hotmail.com", deps({}));
    expect(outlook).toMatchObject({ supported: false, providerLabel: "Outlook.com" });
    expect(outlook.message).toMatch(/coming soon/);
    const proton = await detectMailSettings("a@proton.me", deps({}));
    expect(proton.supported).toBe(false);
    expect(proton.message).toMatch(/Bridge/);
  });
});

describe("Gmail on a self-hosted copy", () => {
  afterEach(() => {
    delete process.env.SELF_HOSTED;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it("connects with an app password when the server has no Google app of its own", async () => {
    process.env.SELF_HOSTED = "1";
    const result = await detectMailSettings("jan@gmail.com", deps({}));
    expect(result).toMatchObject({ provider: "imap", method: "password", providerLabel: "Gmail", supported: true });
    expect(result.oauth).toBeUndefined();
    expect(result.appPassword?.url).toContain("myaccount.google.com");
    expect(result.imap?.host).toBe("imap.gmail.com");
  });

  it("uses Google's sign-in when the owner set up their own app", async () => {
    process.env.SELF_HOSTED = "1";
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    expect(await detectMailSettings("jan@gmail.com", deps({}))).toMatchObject({ provider: "gmail", method: "oauth" });
  });
});

describe("lookup chain", () => {
  it("uses ISPDB and fills %EMAILLOCALPART%", async () => {
    const result = await detectMailSettings("petr@firma.cz", deps({ urls: { [ISPDB("firma.cz")]: config("imap.firma.cz", "%EMAILLOCALPART%", "Firma") } }));
    expect(result).toMatchObject({
      source: "ispdb",
      providerLabel: "Firma",
      imap: { host: "imap.firma.cz", username: "petr" },
      smtp: { host: "smtp.firma.cz", username: "petr" },
    });
    expect(sourceLabel(result.source)).toBe("Thunderbird database");
  });

  it("parses the real-world Seznam ISPDB file when it comes from the network", async () => {
    const result = await detectMailSettings("a@seznam-alias.cz", deps({ urls: { [ISPDB("seznam-alias.cz")]: seznamXml } }));
    // imap.seznam.cz is known, so the Seznam app-password hint comes along.
    expect(result).toMatchObject({ source: "ispdb", providerLabel: "Seznam", imap: { host: "imap.seznam.cz" } });
    expect(result.appPassword?.required).toBe("with2fa");
  });

  it("turns an ISPDB answer pointing at Gmail into Google sign-in", async () => {
    const result = await detectMailSettings("a@school.edu", deps({ urls: { [ISPDB("school.edu")]: config("imap.gmail.com") } }));
    expect(result).toMatchObject({ provider: "gmail", method: "oauth", providerLabel: "Google Workspace" });
  });

  it("falls back to the domain's autoconfig file, then its .well-known copy", async () => {
    const own = "https://autoconfig.acme.cz/mail/config-v1.1.xml?emailaddress=a%40acme.cz";
    const wellKnown = "https://acme.cz/.well-known/autoconfig/mail/config-v1.1.xml";
    expect(await detectMailSettings("a@acme.cz", deps({ urls: { [own]: config("imap.acme.cz") } }))).toMatchObject({
      source: "autoconfig",
      imap: { host: "imap.acme.cz" },
    });
    clearDetectionCache();
    expect(await detectMailSettings("a@acme.cz", deps({ urls: { [wellKnown]: config("mail.acme.cz") } }))).toMatchObject({
      source: "autoconfig",
      imap: { host: "mail.acme.cz" },
    });
  });

  it("recognises Google Workspace and Microsoft 365 by MX", async () => {
    expect(await detectMailSettings("a@shop.cz", deps({ mx: { "shop.cz": ["aspmx.l.google.com.", "alt1.aspmx.l.google.com."] } }))).toMatchObject({
      provider: "gmail",
      method: "oauth",
      providerLabel: "Google Workspace",
      source: "mx",
    });
    const ms = await detectMailSettings("a@corp.cz", deps({ mx: { "corp.cz": ["corp-cz.mail.protection.outlook.com"] } }));
    expect(ms).toMatchObject({ providerLabel: "Microsoft 365", supported: false });
    // Domains added to Microsoft 365 since mid-2026.
    const newer = await detectMailSettings("a@nova.cz", deps({ mx: { "nova.cz": ["nova-cz.c-v1.mx.microsoft"] } }));
    expect(newer).toMatchObject({ providerLabel: "Microsoft 365", supported: false });
    // iCloud with a custom domain: it asks for the @icloud.com address to sign in with.
    const icloud = await detectMailSettings("daniel@rodina.cz", deps({ mx: { "rodina.cz": ["mx01.mail.icloud.com"] } }));
    expect(icloud).toMatchObject({ providerLabel: "iCloud Mail", supported: true, askUsername: "Your @icloud.com address" });
  });

  it("maps Czech webhosts from MX to their real servers", async () => {
    expect(await detectMailSettings("a@one.cz", deps({ mx: { "one.cz": ["wes2-mx1.wedos.net", "wes2-mx2.wedos.net"] } }))).toMatchObject({
      providerLabel: "WEDOS",
      imap: { host: "wes2-imap.wedos.net", port: 993, secure: true, username: "a@one.cz" },
      smtp: { host: "wes2-smtp.wedos.net", port: 465 },
    });
    expect(await detectMailSettings("a@two.cz", deps({ mx: { "two.cz": ["mxavas.forpsi.com"] } }))).toMatchObject({
      providerLabel: "Forpsi",
      imap: { host: "imap.forpsi.com" },
    });
    expect(await detectMailSettings("a@three.cz", deps({ mx: { "three.cz": ["mx1.seznam.cz"] } }))).toMatchObject({
      providerLabel: "Seznam",
      imap: { host: "imap.seznam.cz" },
    });
    expect(await detectMailSettings("business@truhlarstvi.example", deps({ mx: { "truhlarstvi.example": ["email4.webglobe.cz", "email.webglobe.cz"] } }))).toMatchObject({
      providerLabel: "Webglobe",
      imap: { host: "mail.webglobe.cz", port: 993, secure: true, username: "business@truhlarstvi.example" },
      smtp: { host: "mail.webglobe.cz", port: 465, secure: true },
    });
  });

  it("looks up the MX host's own domain in ISPDB", async () => {
    const result = await detectMailSettings(
      "a@klient.cz",
      deps({ mx: { "klient.cz": ["mx.hosting-xy.cz"] }, urls: { [ISPDB("hosting-xy.cz")]: config("imap.hosting-xy.cz", "%EMAILADDRESS%", "Hosting XY") } }),
    );
    expect(result).toMatchObject({ source: "mx", providerLabel: "Hosting XY", imap: { host: "imap.hosting-xy.cz" } });
  });

  it("uses RFC 6186 SRV records, preferring implicit TLS", async () => {
    const result = await detectMailSettings(
      "a@srv.cz",
      deps({
        srv: {
          "_imaps._tcp.srv.cz": { name: "imap.provider.net.", port: 993 },
          "_imap._tcp.srv.cz": { name: "imap.provider.net", port: 143 },
          "_submission._tcp.srv.cz": { name: "smtp.provider.net", port: 587 },
        },
      }),
    );
    expect(result).toMatchObject({
      source: "srv",
      imap: { host: "imap.provider.net", port: 993, secure: true },
      smtp: { host: "smtp.provider.net", port: 587, secure: false },
    });
  });

  it("guesses hostnames and keeps the most preferred one that answers", async () => {
    const open = new Set(["mail.guess.cz:993", "imap.guess.cz:143", "smtp.guess.cz:587"]);
    const result = await detectMailSettings("a@guess.cz", deps({ probe: (h, p) => open.has(`${h}:${p}`) }));
    expect(result).toMatchObject({
      source: "guess",
      imap: { host: "mail.guess.cz", port: 993, secure: true },
      smtp: { host: "smtp.guess.cz", port: 587, secure: false },
    });
  });

  it("guesses on the MX host and its domain when the address's own names don't answer", async () => {
    const open = new Set(["imap.hostik.cz:993", "smtp.hostik.cz:465"]);
    const result = await detectMailSettings("a@klient.cz", deps({ mx: { "klient.cz": ["mx1.hostik.cz"] }, probe: (h, p) => open.has(`${h}:${p}`) }));
    expect(result).toMatchObject({
      source: "guess",
      providerLabel: "hostik.cz",
      imap: { host: "imap.hostik.cz", port: 993, secure: true },
      smtp: { host: "smtp.hostik.cz", port: 465, secure: true },
    });
    // The MX host itself comes before the names under its domain.
    clearDetectionCache();
    const both = new Set([...open, "mx1.hostik.cz:993"]);
    expect((await detectMailSettings("a@klient.cz", deps({ mx: { "klient.cz": ["mx1.hostik.cz"] }, probe: (h, p) => both.has(`${h}:${p}`) }))).imap?.host).toBe("mx1.hostik.cz");
  });

  it("prefers the address's own names over the MX host's domain", async () => {
    const open = new Set(["imap.klient.cz:993", "imap.hostik.cz:993"]);
    const result = await detectMailSettings("a@klient.cz", deps({ mx: { "klient.cz": ["mx1.hostik.cz"] }, probe: (h, p) => open.has(`${h}:${p}`) }));
    expect(result).toMatchObject({ providerLabel: "klient.cz", imap: { host: "imap.klient.cz" } });
  });

  it("doesn't guess at a spam filter's servers", async () => {
    const d = deps({ mx: { "firma.cz": ["eu-smtp-inbound-1.mimecast.com"] }, probe: (h) => h.endsWith("mimecast.com") });
    expect((await detectMailSettings("a@firma.cz", d)).source).toBe("none");
    expect(d.probe.mock.calls.map(([s]) => s.host)).not.toContainEqual(expect.stringMatching(/mimecast/));
  });

  it("follows a shared host's certificate to the server's real name on the same address", async () => {
    // imap.firma.cz is mail050.webglobe.com, whose certificate is for *.webglobe.com only.
    const shared: ProbeResult = { ok: false, address: "203.0.113.87", certNames: ["*.webglobe.com", "webglobe.com"] };
    const open = new Set(["mail050.webglobe.com:993", "mail050.webglobe.com:465", "imap.webglobe.com:993"]);
    const result = await detectMailSettings(
      "a@firma.cz",
      deps({
        ptr: { "203.0.113.87": ["mail050.webglobe.com."] },
        // imap.webglobe.com is a server too, but another one: the mailbox isn't there.
        a: { "mail050.webglobe.com": ["203.0.113.87"], "imap.webglobe.com": ["203.0.113.161"] },
        probe: (h, p) => (h.endsWith(".firma.cz") ? shared : open.has(`${h}:${p}`)),
      }),
    );
    expect(result).toMatchObject({
      source: "guess",
      providerLabel: "webglobe.com",
      imap: { host: "mail050.webglobe.com", port: 993, secure: true, username: "a@firma.cz" },
      smtp: { host: "mail050.webglobe.com", port: 465, secure: true },
    });
  });

  it("follows only to names the certificate covers", async () => {
    const shared: ProbeResult = { ok: false, address: "203.0.113.5", certNames: ["server12.hosting.cz"] };
    const d = deps({
      ptr: { "203.0.113.5": ["static-203-0-113-5.isp.net"] },
      a: { "static-203-0-113-5.isp.net": ["203.0.113.5"], "server12.hosting.cz": ["203.0.113.5"] },
      probe: (h, p) => (h.endsWith(".firma.cz") ? shared : h === "server12.hosting.cz" || (h.endsWith("isp.net") && p === 993)),
    });
    const result = await detectMailSettings("a@firma.cz", d);
    expect(result).toMatchObject({ imap: { host: "server12.hosting.cz", port: 993 }, smtp: { host: "server12.hosting.cz", port: 465 } });
    expect(d.probe.mock.calls.map(([s]) => s.host)).not.toContain("static-203-0-113-5.isp.net");
  });

  it("says so plainly when nothing is found", async () => {
    const result = await detectMailSettings("a@nowhere.cz", deps({}));
    expect(result).toMatchObject({ source: "none", supported: true, imap: undefined });
    expect(result.message).toMatch(/couldn't find the mail servers for nowhere\.cz/);
  });

  it("falls through hanging HTTP and DNS within the timeouts", async () => {
    const hang = () => new Promise<never>(() => {});
    const d: Partial<DetectDeps> = {
      fetch: (_url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
      dns: { resolveMx: hang, resolveSrv: hang, reverse: hang, addresses: hang },
      probe: async (s) => ({ ok: s.host === "imap.slow.cz" && s.port === 993 }),
      timeoutMs: 50,
      guessBudgetMs: 50,
    };
    const started = Date.now();
    const result = await detectMailSettings("a@slow.cz", d);
    expect(result).toMatchObject({ source: "guess", imap: { host: "imap.slow.cz" } });
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("caching and helpers", () => {
  it("caches per domain but fills the username per address", async () => {
    const d = deps({ urls: { [ISPDB("cache.cz")]: config("imap.cache.cz") } });
    await detectMailSettings("a@cache.cz", d);
    const calls = d.fetch.mock.calls.length;
    const second = await detectMailSettings("b@cache.cz", d);
    expect(d.fetch.mock.calls.length).toBe(calls);
    expect(second.imap?.username).toBe("b@cache.cz");
  });

  it("normalises the domain (case, IDN)", () => {
    expect(splitEmail("Jan@Firma.CZ")).toEqual({ local: "Jan", domain: "firma.cz" });
    expect(splitEmail("jan@příklad.cz")?.domain).toBe("xn--pklad-zsa96e.cz");
    expect(splitEmail("nope")).toBeNull();
  });

  it("fills placeholders in hostnames too", () => {
    const filled = fillPlaceholders(
      { provider: "imap", providerLabel: "x", method: "password", source: "ispdb", supported: true, imap: { host: "mail.%EMAILDOMAIN%", port: 993, secure: true, username: "%EMAILLOCALPART%" } },
      "eva@ab.cz",
    );
    expect(filled.imap).toEqual({ host: "mail.ab.cz", port: 993, secure: true, username: "eva" });
  });

  it("derives base domains for MX hosts", () => {
    expect(baseDomain("mx1.forpsi.com.")).toBe("forpsi.com");
    expect(baseDomain("mx.mail.example.co.uk")).toBe("example.co.uk");
  });

  it("matches Zoho's regional MX to its pro servers", () => {
    expect(knownByMx(["mx.zoho.eu"])?.imap).toMatchObject({ host: "imappro.zoho.eu" });
  });
});
