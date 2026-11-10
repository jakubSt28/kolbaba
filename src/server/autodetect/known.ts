import { tk } from "@/lib/i18n";
import type { ServerConfig } from "../db/schema";
import type { AppPasswordHint, Detection } from "./types";

/**
 * Providers we know by heart. Looking them up first means no network round-trip for the big
 * mailbox providers, and lets us attach things no config database has: OAuth instead of a password,
 * app-password instructions, and a friendly "not yet" for providers we can't connect to.
 *
 * Usernames are templates (`%EMAILADDRESS%`), filled in per address by `fillPlaceholders`.
 */

export interface KnownProvider {
  id: string;
  label: string;
  domains: string[];
  provider: "gmail" | "imap";
  method: "oauth" | "password";
  imap?: ServerConfig;
  smtp?: ServerConfig;
  appPassword?: AppPasswordHint;
  /** Where to switch IMAP on, for providers that ship with it off. */
  enableImap?: string;
  supported: boolean;
  message?: string;
  /** Matches this provider's IMAP/SMTP hostnames, so a connection test can recognise it on a custom domain. */
  hosts?: RegExp;
}

const EMAIL = "%EMAILADDRESS%";
const ssl = (host: string, port: number): ServerConfig => ({ host, port, secure: true, username: EMAIL });
const starttls = (host: string, port: number): ServerConfig => ({ host, port, secure: false, username: EMAIL });

const gmail: KnownProvider = {
  id: "gmail",
  label: "Gmail",
  domains: ["gmail.com", "googlemail.com"],
  provider: "gmail",
  method: "oauth",
  imap: ssl("imap.gmail.com", 993),
  smtp: ssl("smtp.gmail.com", 465),
  // Only relevant if someone forces the password route; the normal path is OAuth.
  appPassword: {
    required: "always",
    url: "https://myaccount.google.com/apppasswords",
    label: tk("Create an app password"),
    steps: "Google Account → Security → 2-Step Verification → App passwords",
  },
  enableImap: "Gmail settings → Forwarding and POP/IMAP → Enable IMAP",
  supported: true,
  hosts: /(^|\.)(gmail|googlemail)\.com$/,
};

const seznam: KnownProvider = {
  id: "seznam",
  label: "Seznam",
  domains: ["seznam.cz", "email.cz", "post.cz", "spoluzaci.cz"],
  provider: "imap",
  method: "password",
  imap: ssl("imap.seznam.cz", 993),
  smtp: ssl("smtp.seznam.cz", 465),
  appPassword: {
    required: "with2fa",
    url: "https://o-seznam.cz/napoveda/ucet/dvoufazove-overeni/",
    label: tk("How to create an app password"),
    steps: "Seznam account → Security → Two-step verification → App password",
  },
  enableImap: "Seznam Email → Settings → POP3/IMAP",
  supported: true,
  hosts: /(^|\.)seznam\.cz$/,
};

const icloud: KnownProvider = {
  id: "icloud",
  label: "iCloud Mail",
  domains: ["icloud.com", "me.com", "mac.com"],
  provider: "imap",
  method: "password",
  imap: ssl("imap.mail.me.com", 993),
  smtp: starttls("smtp.mail.me.com", 587),
  appPassword: {
    required: "always",
    url: "https://support.apple.com/en-us/102654",
    label: tk("Create an app-specific password"),
    steps: "account.apple.com → Sign-In and Security → App-Specific Passwords",
  },
  supported: true,
  hosts: /(^|\.)mail\.me\.com$/,
};

const yahoo: KnownProvider = {
  id: "yahoo",
  label: "Yahoo Mail",
  domains: [
    "yahoo.com", "ymail.com", "rocketmail.com", "yahoo.co.uk", "yahoo.de", "yahoo.fr", "yahoo.es",
    "yahoo.it", "yahoo.ca", "yahoo.com.au",
  ],
  provider: "imap",
  method: "password",
  imap: ssl("imap.mail.yahoo.com", 993),
  smtp: ssl("smtp.mail.yahoo.com", 465),
  appPassword: {
    required: "always",
    url: "https://help.yahoo.com/kb/SLN15241.html",
    label: tk("Create an app password"),
    steps: "Yahoo Account → Account security → App passwords (under “How you sign in”)",
  },
  supported: true,
  hosts: /(^|\.)mail\.yahoo\.com$/,
};

const aol: KnownProvider = {
  id: "aol",
  label: "AOL Mail",
  domains: ["aol.com", "aim.com"],
  provider: "imap",
  method: "password",
  imap: ssl("imap.aol.com", 993),
  smtp: ssl("smtp.aol.com", 465),
  appPassword: {
    required: "always",
    url: "https://help.aol.com/articles/Create-and-manage-app-password",
    label: tk("Create an app password"),
    steps: "AOL Account info → Account security → Generate app password",
  },
  supported: true,
  hosts: /(^|\.)aol\.com$/,
};

const outlook: KnownProvider = {
  id: "outlook",
  label: "Outlook.com",
  domains: ["outlook.com", "hotmail.com", "live.com", "msn.com", "outlook.cz", "hotmail.co.uk", "live.co.uk"],
  provider: "imap",
  method: "oauth",
  supported: false,
  message: tk("Outlook and Hotmail accounts are coming soon. Microsoft requires its own sign-in, which we're still building."),
  hosts: /(^|\.)(outlook\.com|office365\.com)$/,
};

const proton: KnownProvider = {
  id: "proton",
  label: "Proton Mail",
  domains: ["proton.me", "protonmail.com", "protonmail.ch", "pm.me"],
  provider: "imap",
  method: "password",
  supported: false,
  message:
    tk("Proton Mail is end-to-end encrypted, so other apps can only reach it through Proton Mail Bridge running on your own computer. Kolbaba can't connect to Bridge yet."),
};

const tuta: KnownProvider = {
  id: "tuta",
  label: "Tuta",
  domains: ["tuta.com", "tuta.io", "tutanota.com", "tutanota.de", "tutamail.com", "keemail.me"],
  provider: "imap",
  method: "password",
  supported: false,
  message: tk("Tuta doesn't let other mail apps connect (it has no IMAP), so Kolbaba can't add this address."),
};

const centrum: KnownProvider = {
  id: "centrum",
  label: "Centrum.cz",
  domains: ["centrum.cz"],
  provider: "imap",
  method: "password",
  imap: ssl("imap.centrum.cz", 993),
  smtp: ssl("smtp.centrum.cz", 465),
  supported: true,
  hosts: /(^|\.)centrum\.cz$/,
};

const atlas: KnownProvider = { ...centrum, id: "atlas", label: "Atlas.cz", domains: ["atlas.cz"], imap: ssl("imap.atlas.cz", 993), smtp: ssl("smtp.atlas.cz", 465), hosts: /(^|\.)atlas\.cz$/ };
const volny: KnownProvider = { ...centrum, id: "volny", label: "Volný.cz", domains: ["volny.cz"], imap: ssl("imap.volny.cz", 993), smtp: ssl("smtp.volny.cz", 465), hosts: /(^|\.)volny\.cz$/ };

const gmxNet: KnownProvider = {
  id: "gmx",
  label: "GMX",
  domains: ["gmx.net", "gmx.de", "gmx.at", "gmx.ch"],
  provider: "imap",
  method: "password",
  imap: ssl("imap.gmx.net", 993),
  smtp: ssl("mail.gmx.net", 465),
  enableImap: "GMX settings → POP3 & IMAP → allow access",
  supported: true,
  hosts: /(^|\.)gmx\.(net|com)$/,
};

const gmxCom: KnownProvider = { ...gmxNet, domains: ["gmx.com", "gmx.us", "gmx.co.uk", "gmx.fr"], imap: ssl("imap.gmx.com", 993), smtp: ssl("mail.gmx.com", 465) };

const webDe: KnownProvider = {
  ...gmxNet,
  id: "webde",
  label: "WEB.DE",
  domains: ["web.de"],
  imap: ssl("imap.web.de", 993),
  smtp: starttls("smtp.web.de", 587),
  enableImap: "WEB.DE settings → POP3/IMAP → allow access",
  hosts: /(^|\.)web\.de$/,
};

const fastmail: KnownProvider = {
  id: "fastmail",
  label: "Fastmail",
  domains: ["fastmail.com", "fastmail.fm"],
  provider: "imap",
  method: "password",
  imap: ssl("imap.fastmail.com", 993),
  smtp: ssl("smtp.fastmail.com", 465),
  appPassword: {
    required: "always",
    url: "https://www.fastmail.help/hc/en-us/articles/360058752854",
    label: tk("Create an app password"),
    steps: "Fastmail Settings → Privacy & Security → App passwords",
  },
  supported: true,
  hosts: /(^|\.)fastmail\.com$/,
};

const zohoAppPassword: AppPasswordHint = {
  required: "with2fa",
  url: "https://accounts.zoho.com/home#security/app_password",
  label: tk("Create an app password"),
  steps: "Zoho Accounts → Security → App passwords",
};

const zoho: KnownProvider = {
  id: "zoho",
  label: "Zoho Mail",
  domains: ["zoho.com", "zohomail.com"],
  provider: "imap",
  method: "password",
  imap: ssl("imap.zoho.com", 993),
  smtp: ssl("smtp.zoho.com", 465),
  appPassword: zohoAppPassword,
  enableImap: "Zoho Mail settings → Mail Accounts → IMAP Access",
  supported: true,
  hosts: /(^|\.)zoho\.[a-z.]+$/,
};

const zohoEu: KnownProvider = { ...zoho, domains: ["zohomail.eu"], imap: ssl("imap.zoho.eu", 993), smtp: ssl("smtp.zoho.eu", 465) };

export const KNOWN_PROVIDERS: KnownProvider[] = [
  gmail, seznam, icloud, yahoo, aol, outlook, proton, tuta, centrum, atlas, volny, gmxNet, gmxCom, webDe,
  fastmail, zoho, zohoEu,
];

const byDomain = new Map(KNOWN_PROVIDERS.flatMap((p) => p.domains.map((d) => [d, p] as const)));

export function toDetection(p: KnownProvider, source: Detection["source"], label = p.label): Detection {
  return {
    provider: p.provider,
    providerLabel: label,
    method: p.method,
    imap: p.imap,
    smtp: p.smtp,
    source,
    // OAuth providers never need one in the normal flow; the hint stays available to `knownByHost` for error copy.
    appPassword: p.method === "password" ? p.appPassword : undefined,
    ...(p.method === "oauth" ? { oauth: p.provider === "gmail" ? ("google" as const) : ("microsoft" as const) } : {}),
    supported: p.supported,
    message: p.message,
  };
}

export function knownByDomain(domain: string): Detection | null {
  const p = byDomain.get(domain);
  return p ? toDetection(p, "known") : null;
}

/** The provider behind a server hostname, e.g. imap.seznam.cz → Seznam. Used to tailor error copy. */
export function knownByHost(host: string): KnownProvider | null {
  const h = host.toLowerCase();
  return KNOWN_PROVIDERS.find((p) => p.hosts?.test(h)) ?? null;
}

/* ---------------------------------- MX ---------------------------------- */

type MxRule = { test: RegExp; detect: (m: RegExpMatchArray) => Detection };

const password = (label: string, imap: ServerConfig, smtp: ServerConfig, extra?: Partial<Detection>): Detection => ({
  provider: "imap",
  providerLabel: label,
  method: "password",
  imap,
  smtp,
  source: "mx",
  supported: true,
  ...extra,
});

/**
 * Custom domains hosted by a provider we recognise from its MX hosts. The Czech webhosts matter:
 * most small Czech businesses have mail at one of them, and their `imap.<own-domain>` aliases
 * often carry a certificate for the host's name only.
 */
const MX_RULES: MxRule[] = [
  { test: /(^|\.)(google|googlemail)\.com$/, detect: () => toDetection(gmail, "mx", "Google Workspace") },
  // Microsoft 365: the old MX hosts, and *.mx.microsoft for domains added since mid-2026.
  { test: /\.mail\.protection\.outlook\.com$|\.mx\.microsoft$/, detect: () => ({ ...toDetection(outlook, "mx", "Microsoft 365"), message: tk("Microsoft 365 accounts are coming soon. Microsoft requires its own sign-in, which we're still building.") }) },
  { test: /(^|\.)protonmail\.ch$/, detect: () => toDetection(proton, "mx") },
  { test: /(^|\.)seznam\.cz$/, detect: () => toDetection(seznam, "mx") },
  {
    test: /(^|\.)mail\.icloud\.com$/,
    detect: () => ({
      ...toDetection(icloud, "mx"),
      message: tk("iCloud signs in to a custom domain with your @icloud.com address, not this one."),
      askUsername: tk("Your @icloud.com address"),
    }),
  },
  { test: /(^|\.)messagingengine\.com$/, detect: () => toDetection(fastmail, "mx") },
  {
    // Organisation accounts on a custom domain use the "pro" hosts; the region follows the MX.
    test: /(^|\.)zoho\.(com|eu|in|com\.au|jp|ca|sa)$/,
    detect: (m) => ({
      ...toDetection(zoho, "mx"),
      imap: ssl(`imappro.zoho.${m[2]}`, 993),
      smtp: ssl(`smtppro.zoho.${m[2]}`, 465),
    }),
  },
  { test: /(^|\.)forpsi\.com$/, detect: () => password("Forpsi", ssl("imap.forpsi.com", 993), ssl("smtp.forpsi.com", 465)) },
  {
    // MX wes1-mx1.wedos.net → mail cluster "wes1" → wes1-imap.wedos.net (WEDOS docs).
    test: /^(wes\d+)-mx[\w-]*\.wedos\.net$/,
    detect: (m) => password("WEDOS", ssl(`${m[1]}-imap.wedos.net`, 993), ssl(`${m[1]}-smtp.wedos.net`, 465)),
  },
  { test: /(^|\.)wedos\.(net|com|cz)$/, detect: () => password("WEDOS", ssl("wes1-imap.wedos.net", 993), ssl("wes1-smtp.wedos.net", 465)) },
  // Webglobe's MX hosts (email.webglobe.cz, email2…) don't take logins; mail.webglobe.cz does (Webglobe docs).
  { test: /(^|\.)webglobe\.cz$/, detect: () => password("Webglobe", ssl("mail.webglobe.cz", 993), ssl("mail.webglobe.cz", 465)) },
  { test: /(^|\.)active24\.(cz|com)$/, detect: () => password("Active24", ssl("email.active24.com", 993), ssl("email.active24.com", 465)) },
  {
    test: /(^|\.)websupport\.(cz|sk)$/,
    detect: (m) => password("Websupport", ssl(`imap.websupport.${m[2]}`, 993), ssl(`smtp.websupport.${m[2]}`, 465)),
  },
];

/** Recognise the provider from MX hostnames (already sorted by preference). */
export function knownByMx(mxHosts: string[]): Detection | null {
  for (const host of mxHosts) {
    const h = host.toLowerCase().replace(/\.$/, "");
    for (const rule of MX_RULES) {
      const m = h.match(rule.test);
      if (m) return rule.detect(m);
    }
  }
  return null;
}
