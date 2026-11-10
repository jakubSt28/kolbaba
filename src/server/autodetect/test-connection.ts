import "server-only";
import { ImapFlow } from "imapflow";
import { createTransport } from "nodemailer";
import { translate, type Locale } from "@/lib/i18n";
import type { ServerConfig } from "../db/schema";
import { type KnownProvider, knownByHost } from "./known";
import { resolvePublic } from "./probe";

/**
 * Log in to IMAP and authenticate to SMTP with what the user typed, and turn failures into one
 * clear sentence. Most failed setups are a password problem (often "needs an app password"), so
 * that is where the copy is most specific.
 */

export type TestFailureReason =
  | "invalid_credentials"
  | "app_password_required"
  | "imap_disabled"
  | "unreachable"
  | "tls"
  | "server_error"
  /** Returned by the test route only: nothing to test with a password (OAuth or unsupported provider). */
  | "unsupported"
  /** Returned by the test route only: detection found no servers; ask the user for them. */
  | "servers_unknown";

export type TestConnectionResult =
  | {
      ok: true;
      /** The configs that worked, with the username variant the server accepted. */
      imap: ServerConfig & { username: string };
      smtp: ServerConfig & { username: string };
    }
  | {
      ok: false;
      reason: TestFailureReason;
      protocol?: "imap" | "smtp";
      message: string;
      hint?: { url: string; label: string };
    };

type Failure = Extract<TestConnectionResult, { ok: false }>;

export interface TestDeps {
  verifyImap(server: ServerConfig, user: string, pass: string): Promise<void>;
  verifySmtp(server: ServerConfig, user: string, pass: string): Promise<void>;
  /** Allow servers on private/loopback addresses (local dev with a test IMAP server). */
  allowPrivateHosts: boolean;
}

const TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 8_000, socketTimeout: 20_000 };

async function imapflowVerify(server: ServerConfig, user: string, pass: string) {
  const client = new ImapFlow({
    host: server.host,
    port: server.port,
    secure: server.secure,
    // Never fall back to plaintext: a password must not cross the wire unencrypted.
    doSTARTTLS: server.secure ? undefined : true,
    auth: { user, pass },
    logger: false,
    verifyOnly: true,
    disableAutoIdle: true,
    ...TIMEOUTS,
  });
  client.on("error", () => {}); // connect() rejects with the same error; don't crash on the event
  try {
    await client.connect();
  } finally {
    client.close();
  }
}

async function nodemailerVerify(server: ServerConfig, user: string, pass: string) {
  const transport = createTransport({
    host: server.host,
    port: server.port,
    secure: server.secure,
    requireTLS: !server.secure,
    auth: { user, pass },
    ...TIMEOUTS,
  });
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

const defaultDeps: TestDeps = {
  verifyImap: imapflowVerify,
  verifySmtp: nodemailerVerify,
  allowPrivateHosts: process.env.NODE_ENV !== "production",
};

/* ---------------------------- Error classification ---------------------------- */

type MailError = Error & {
  code?: string;
  authenticationFailed?: boolean;
  serverResponseCode?: string;
  responseCode?: number;
  response?: unknown;
  responseText?: string;
};

function errorText(err: unknown) {
  const e = (err ?? {}) as MailError;
  return [e.message, e.responseText, typeof e.response === "string" ? e.response : "", e.serverResponseCode, e.code]
    .filter(Boolean)
    .join(" ");
}

export function isAuthError(err: unknown) {
  const e = (err ?? {}) as MailError;
  return (
    e.authenticationFailed === true ||
    e.code === "EAUTH" ||
    e.serverResponseCode === "AUTHENTICATIONFAILED" ||
    e.responseCode === 535
  );
}

const APP_PASSWORD_TEXT = /application-specific password|app(lication)? password|\b5\.7\.9\b|InvalidSecondFactor/i;
const IMAP_DISABLED_TEXT = /not enabled for IMAP|enable IMAP|yet to enable IMAP|IMAP (access )?(is )?(disabled|not (enabled|allowed|permitted))|IMAP.{0,20}turned off/i;
const WEB_LOGIN_TEXT = /log ?in via your web browser|WEBALERT|web login required/i;
const THROTTLE_TEXT = /too many|rate limit|throttl|try again later/i;
const NOT_FOUND_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "EDNS"]);
const TLS_TEXT = /certificate|self[- ]signed|CERT_|SSL routines|wrong version number|packet length too long|EPROTO|\bETLS\b|STARTTLS|TLS/i;

interface Context {
  protocol: "imap" | "smtp";
  server: ServerConfig;
  provider: KnownProvider | null;
  /** IMAP already succeeded, so an SMTP auth failure isn't about the password itself. */
  imapOk?: boolean;
  /** The language of the message (default English). */
  locale?: Locale;
}

/** Map an imapflow / nodemailer / socket error to a reason and a friendly sentence (in `ctx.locale`). */
export function classifyError(err: unknown, ctx: Context): Failure {
  const { protocol, server, provider } = ctx;
  const locale = ctx.locale ?? "en";
  const text = errorText(err);
  const code = (err as MailError | null)?.code ?? "";
  const name = provider?.label;
  const host = server.host;
  const where = `${server.host}:${server.port}`;
  const fail = (reason: TestFailureReason, message: string, hint?: Failure["hint"]): Failure => ({
    ok: false,
    reason,
    protocol,
    message,
    ...(hint ? { hint } : {}),
  });
  const appHint = provider?.appPassword && { url: provider.appPassword.url, label: translate(locale, provider.appPassword.label) };

  if (IMAP_DISABLED_TEXT.test(text)) {
    const settings = provider?.enableImap;
    return fail(
      "imap_disabled",
      settings
        ? translate(locale, "IMAP access is turned off for this mailbox. Turn it on in {settings}, then try again.", { settings })
        : name
          ? translate(locale, "IMAP access is turned off for this mailbox. Turn it on in your {name} settings, then try again.", { name })
          : translate(locale, "IMAP access is turned off for this mailbox. Turn it on in your email settings, then try again."),
    );
  }

  if (APP_PASSWORD_TEXT.test(text)) {
    const steps = provider?.appPassword?.steps;
    return fail(
      "app_password_required",
      !name
        ? translate(locale, "Your provider needs an app password here because two-step verification is on. Create one in your account's security settings, then paste it in.")
        : steps
          ? translate(locale, "{name} needs an app password here because two-step verification is on. Create one in {steps}, then paste it in.", { name, steps })
          : translate(locale, "{name} needs an app password here because two-step verification is on. Create one in your account's security settings, then paste it in.", { name }),
      appHint || undefined,
    );
  }

  if (isAuthError(err)) {
    if (WEB_LOGIN_TEXT.test(text)) {
      return fail(
        "invalid_credentials",
        name
          ? translate(locale, "{name} wants you to confirm it's you. Sign in once on its website, then try again here.", { name })
          : translate(locale, "Your provider wants you to confirm it's you. Sign in once on its website, then try again here."),
      );
    }
    if (THROTTLE_TEXT.test(text)) {
      return fail(
        "server_error",
        name
          ? translate(locale, "{name} is limiting sign-in attempts. Wait a few minutes, then try again.", { name })
          : translate(locale, "The server is limiting sign-in attempts. Wait a few minutes, then try again."),
      );
    }
    // The same password just worked for IMAP, so it is not an app-password problem.
    if (protocol === "smtp" && ctx.imapOk) {
      return fail(
        "invalid_credentials",
        translate(locale, "Receiving mail works, but {host} didn't accept the password for sending. Check whether your provider uses a separate sending password.", { host }),
      );
    }
    const hint = provider?.appPassword;
    if (name && hint?.required === "always") {
      return fail(
        "app_password_required",
        hint.steps
          ? translate(locale, "{name} doesn't let mail apps use your regular password. Create an app password in {steps} and paste it here instead.", { name, steps: hint.steps })
          : translate(locale, "{name} doesn't let mail apps use your regular password. Create an app password in your {name} account and paste it here instead.", { name }),
        appHint || undefined,
      );
    }
    if (name && hint?.required === "with2fa") {
      return fail(
        "app_password_required",
        hint.steps
          ? translate(locale, "{name} didn't accept that password. If two-step verification is on, {name} needs an app password instead. Create one in {steps}.", { name, steps: hint.steps })
          : translate(locale, "{name} didn't accept that password. If two-step verification is on, {name} needs an app password instead. Create one in your {name} account.", { name }),
        appHint || undefined,
      );
    }
    return fail(
      "invalid_credentials",
      name
        ? translate(locale, "{name} didn't accept that email and password. Check them and try again. Passwords are case-sensitive.", { name })
        : translate(locale, "The server didn't accept that email and password. Check them and try again. Passwords are case-sensitive."),
    );
  }

  if (NOT_FOUND_CODES.has(code) || /getaddrinfo|ENOTFOUND/.test(text)) {
    return fail("unreachable", translate(locale, "We couldn't find a server called {host}. Check the server name for typos.", { host }));
  }

  if (/does not support STARTTLS/i.test(text)) {
    const port = protocol === "imap" ? 993 : 465;
    return fail("tls", translate(locale, "{where} doesn't offer an encrypted connection, so we didn't send your password. Try port {port} with SSL.", { where, port }));
  }
  if (/wrong version number|packet length too long|EPROTO/i.test(text)) {
    return fail("tls", translate(locale, "Couldn't start a secure connection to {where}. The port and the SSL/STARTTLS setting probably don't match.", { where }));
  }
  if (TLS_TEXT.test(text) && !/ECONNREFUSED|ETIMEDOUT|TIMEOUT/.test(code)) {
    return fail(
      "tls",
      translate(locale, "{host} has an invalid security certificate, so we stopped before sending your password. Your provider's help pages list the right server name, which often differs from your own domain.", { host }),
    );
  }

  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|TIMEDOUT|TIMEOUT|ECONNECTION|ESOCKET|NoConnection|Closed/i.test(`${code} ${text}`)) {
    return fail("unreachable", translate(locale, "We couldn't connect to {where}. Check the server and port, or try again in a moment.", { where }));
  }

  if (THROTTLE_TEXT.test(text)) {
    return fail(
      "server_error",
      name
        ? translate(locale, "{name} is limiting connections right now. Wait a few minutes, then try again.", { name })
        : translate(locale, "The server is limiting connections right now. Wait a few minutes, then try again."),
    );
  }
  const said = text.replace(/\s+/g, " ").slice(0, 160);
  return fail(
    "server_error",
    said
      ? translate(locale, "{host} answered with an error: “{said}”. Try again, or check the server settings.", { host, said })
      : translate(locale, "{host} answered with an error. Try again, or check the server settings.", { host }),
  );
}

/* ---------------------------------- Testing ---------------------------------- */

/** The username to try first, and the other common form (full address ↔ local part) to try once if it fails. */
export function usernameVariants(email: string, configured?: string) {
  const address = email.trim();
  const local = address.slice(0, address.lastIndexOf("@"));
  const first = configured?.trim() || address;
  const alt = first.toLowerCase() === address.toLowerCase() ? local : !first.includes("@") ? address : null;
  return alt && alt !== first ? [first, alt] : [first];
}

async function tryLogin(
  verify: (s: ServerConfig, u: string, p: string) => Promise<void>,
  server: ServerConfig,
  users: string[],
  password: string,
): Promise<{ user: string } | { error: unknown }> {
  let lastError: unknown;
  for (const user of users) {
    try {
      await verify(server, user, password);
      return { user };
    } catch (err) {
      lastError = err;
      // Only a plain "wrong credentials" is worth retrying with the other username form;
      // anything else (network, TLS, app password) would fail the same way.
      const text = errorText(err);
      if (!isAuthError(err) || APP_PASSWORD_TEXT.test(text) || IMAP_DISABLED_TEXT.test(text) || THROTTLE_TEXT.test(text)) break;
    }
  }
  return { error: lastError };
}

export async function testConnection(
  input: { email: string; password: string; imap: ServerConfig; smtp: ServerConfig; locale?: Locale },
  deps: Partial<TestDeps> = {},
): Promise<TestConnectionResult> {
  const { verifyImap, verifySmtp, allowPrivateHosts } = { ...defaultDeps, ...deps };
  const { email, password, imap, smtp, locale } = input;
  const provider = knownByHost(imap.host);

  // User-supplied hostnames must not turn our server into a scanner of its own network.
  if (!allowPrivateHosts) {
    for (const [protocol, server] of [["imap", imap], ["smtp", smtp]] as const) {
      if (!(await resolvePublic(server.host, 3000))) {
        const message = translate(locale ?? "en", "We couldn't find a server called {host}. Check the server name for typos.", { host: server.host });
        return { ok: false, reason: "unreachable", protocol, message };
      }
    }
  }

  const imapUsers = usernameVariants(email, imap.username);
  const imapResult = await tryLogin(verifyImap, imap, imapUsers, password);
  if ("error" in imapResult) return classifyError(imapResult.error, { protocol: "imap", server: imap, provider, locale });

  // SMTP almost always takes the same login as IMAP, so start with the one that just worked.
  const smtpFirst = smtp.username?.trim() || imapResult.user;
  const smtpUsers = [smtpFirst, ...usernameVariants(email, smtpFirst).filter((u) => u !== smtpFirst)];
  const smtpResult = await tryLogin(verifySmtp, smtp, smtpUsers, password);
  if ("error" in smtpResult) {
    return classifyError(smtpResult.error, { protocol: "smtp", server: smtp, provider: provider ?? knownByHost(smtp.host), imapOk: true, locale });
  }

  return { ok: true, imap: { ...imap, username: imapResult.user }, smtp: { ...smtp, username: smtpResult.user } };
}
