import { describe, expect, it, vi } from "vitest";
import type { ServerConfig } from "../db/schema";
import { knownByHost } from "./known";
import { classifyError, testConnection, usernameVariants } from "./test-connection";

/** Errors shaped like the ones imapflow / nodemailer / Node really throw. */
const imapAuth = (text: string) =>
  Object.assign(new Error("Command failed"), { authenticationFailed: true, serverResponseCode: "AUTHENTICATIONFAILED", responseText: text, response: `2 NO [AUTHENTICATIONFAILED] ${text}` });
const imapNo = (text: string) => Object.assign(new Error("Command failed"), { authenticationFailed: true, responseText: text, response: `2 NO ${text}` });
const smtpAuth = (response: string) => Object.assign(new Error(`Invalid login: ${response}`), { code: "EAUTH", response, responseCode: Number(response.slice(0, 3)) });
const sysErr = (code: string, message = code) => Object.assign(new Error(message), { code });

const server = (host: string, port = 993, secure = true): ServerConfig => ({ host, port, secure });
const ctx = (host: string, protocol: "imap" | "smtp" = "imap") => ({ protocol, server: server(host), provider: knownByHost(host) });

describe("classifyError", () => {
  it("spots Gmail's app-password response on IMAP and SMTP", () => {
    const imap = classifyError(imapNo("[ALERT] Application-specific password required: https://support.google.com/accounts/answer/185833 (Failure)"), ctx("imap.gmail.com"));
    expect(imap).toMatchObject({ reason: "app_password_required", hint: { url: "https://myaccount.google.com/apppasswords" } });
    const smtp = classifyError(smtpAuth("534-5.7.9 Application-specific password required. Learn more at https://support.google.com/mail/?p=InvalidSecondFactor"), ctx("smtp.gmail.com", "smtp"));
    expect(smtp.reason).toBe("app_password_required");
  });

  it("treats a plain auth failure at Yahoo / iCloud as a missing app password", () => {
    const yahoo = classifyError(imapAuth("LOGIN Invalid credentials"), ctx("imap.mail.yahoo.com"));
    expect(yahoo).toMatchObject({ reason: "app_password_required", hint: { url: "https://help.yahoo.com/kb/SLN15241.html" } });
    expect(yahoo.message).toMatch(/Yahoo Mail doesn't let mail apps use your regular password/);
    expect(classifyError(imapAuth("Authentication failed."), ctx("imap.mail.me.com")).reason).toBe("app_password_required");
  });

  it("explains Seznam's app password with the steps and the help link", () => {
    const result = classifyError(imapAuth("Authentication failed"), ctx("imap.seznam.cz"));
    expect(result.reason).toBe("app_password_required");
    expect(result.message).toMatch(/If two-step verification is on, Seznam needs an app password/);
    expect(result.message).toMatch(/Seznam account → Security/);
    expect(result.hint?.url).toBe("https://o-seznam.cz/napoveda/ucet/dvoufazove-overeni/");
  });

  it("reports wrong credentials for an unknown provider", () => {
    const result = classifyError(smtpAuth("535 5.7.8 Error: authentication failed"), ctx("mail.firma.cz", "smtp"));
    expect(result).toMatchObject({ reason: "invalid_credentials", protocol: "smtp" });
    expect(result.message).toMatch(/didn't accept that email and password/);
  });

  it("detects IMAP switched off", () => {
    const gmail = classifyError(imapNo("[ALERT] Your account is not enabled for IMAP use. Please visit your Gmail settings page and enable your account for IMAP access. (Failure)"), ctx("imap.gmail.com"));
    expect(gmail.reason).toBe("imap_disabled");
    expect(gmail.message).toMatch(/Forwarding and POP\/IMAP/);
    const zoho = classifyError(imapNo("[ALERT] You are yet to enable IMAP for your account. Please contact your administrator (Failure)"), ctx("imappro.zoho.eu"));
    expect(zoho.reason).toBe("imap_disabled");
  });

  it("tells network and TLS problems apart", () => {
    expect(classifyError(sysErr("ENOTFOUND", "getaddrinfo ENOTFOUND imap.nope.cz"), ctx("imap.nope.cz")).reason).toBe("unreachable");
    expect(classifyError(sysErr("ECONNREFUSED", "connect ECONNREFUSED 1.2.3.4:993"), ctx("imap.x.cz")).reason).toBe("unreachable");
    expect(classifyError(sysErr("CONNECT_TIMEOUT", "Failed to establish connection in required time"), ctx("imap.x.cz")).reason).toBe("unreachable");
    const cert = classifyError(sysErr("ERR_TLS_CERT_ALTNAME_INVALID", "Hostname/IP does not match certificate's altnames"), ctx("imap.x.cz"));
    expect(cert.reason).toBe("tls");
    expect(cert.message).toMatch(/invalid security certificate/);
    const port = classifyError(sysErr("ERR_SSL_WRONG_VERSION_NUMBER", "SSL routines:ssl3_get_record:wrong version number"), ctx("imap.x.cz"));
    expect(port.message).toMatch(/SSL\/STARTTLS setting/);
    expect(classifyError(new Error("Server does not support STARTTLS"), ctx("imap.x.cz")).message).toMatch(/port 993/);
  });

  it("falls back to quoting the server", () => {
    const result = classifyError(Object.assign(new Error("Command failed"), { responseText: "Mailbox locked" }), ctx("imap.x.cz"));
    expect(result).toMatchObject({ reason: "server_error" });
    expect(result.message).toMatch(/Mailbox locked/);
  });
});

describe("usernameVariants", () => {
  it("tries the full address, then the local part (and the other way round)", () => {
    expect(usernameVariants("jan@firma.cz")).toEqual(["jan@firma.cz", "jan"]);
    expect(usernameVariants("jan@firma.cz", "jan")).toEqual(["jan", "jan@firma.cz"]);
    expect(usernameVariants("jan@firma.cz", "admin@other.cz")).toEqual(["admin@other.cz"]);
  });
});

describe("testConnection", () => {
  const input = { email: "jan@firma.cz", password: "pw", imap: server("imap.firma.cz"), smtp: server("smtp.firma.cz", 465) };

  it("returns the working usernames on success, retrying the local part once", async () => {
    const verifyImap = vi.fn(async (_s: ServerConfig, user: string) => {
      if (user !== "jan") throw imapAuth("Authentication failed");
    });
    const verifySmtp = vi.fn(async () => {});
    const result = await testConnection(input, { verifyImap, verifySmtp, allowPrivateHosts: true });
    expect(result).toEqual({ ok: true, imap: { ...input.imap, username: "jan" }, smtp: { ...input.smtp, username: "jan" } });
    expect(verifyImap).toHaveBeenCalledTimes(2);
    expect(verifySmtp).toHaveBeenCalledTimes(1);
  });

  it("doesn't retry when the failure isn't about the username", async () => {
    const verifyImap = vi.fn(async () => {
      throw sysErr("ECONNREFUSED");
    });
    const result = await testConnection(input, { verifyImap, verifySmtp: async () => {}, allowPrivateHosts: true });
    expect(result).toMatchObject({ ok: false, reason: "unreachable", protocol: "imap" });
    expect(verifyImap).toHaveBeenCalledTimes(1);
  });

  it("says receiving works when only SMTP rejects the password", async () => {
    const result = await testConnection(
      { ...input, imap: server("imap.seznam.cz"), smtp: server("smtp.seznam.cz", 465) },
      {
        verifyImap: async () => {},
        verifySmtp: async () => {
          throw smtpAuth("535 5.7.8 Authentication failed");
        },
        allowPrivateHosts: true,
      },
    );
    expect(result).toMatchObject({ ok: false, reason: "invalid_credentials", protocol: "smtp" });
    if (!result.ok) expect(result.message).toMatch(/Receiving mail works/);
  });

  it("refuses private and loopback servers in production mode", async () => {
    const verifyImap = vi.fn(async () => {});
    const result = await testConnection({ ...input, imap: server("127.0.0.1") }, { verifyImap, verifySmtp: async () => {}, allowPrivateHosts: false });
    expect(result).toMatchObject({ ok: false, reason: "unreachable" });
    expect(verifyImap).not.toHaveBeenCalled();
  });
});
