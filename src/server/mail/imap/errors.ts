import { tk } from "@/lib/i18n";
import { MailAuthError } from "../types";

/**
 * Turn IMAP/SMTP login failures into MailAuthError so the UI can show a reconnect or app-password
 * hint. Server wording varies, so we look at the response text; anything else passes through.
 */

const APP_PASSWORD = /application[- ]specific password|app[- ]?password|heslo pro aplikace|aplika[cč]n[ií] heslo|web login required|two[- ]step|2fa/i;
const IMAP_DISABLED = /not enabled for imap|imap (access )?(is )?disabled|imap.+not (enabled|allowed)|smtp auth.+disabled/i;

interface LoginError {
  authenticationFailed?: boolean;
  serverResponseCode?: string;
  response?: unknown;
  responseText?: string;
  responseCode?: number;
  code?: string;
  message?: string;
}

function responseText(err: LoginError): string {
  const response = typeof err.response === "string" ? err.response : "";
  return [err.message, err.responseText, response, err.serverResponseCode].filter(Boolean).join(" ");
}

/** True for a failed IMAP LOGIN/AUTHENTICATE or an SMTP 535/534 (nodemailer code EAUTH). */
function isAuthFailure(err: LoginError): boolean {
  return (
    err.authenticationFailed === true ||
    err.serverResponseCode === "AUTHENTICATIONFAILED" ||
    err.code === "EAUTH" ||
    err.responseCode === 535 ||
    err.responseCode === 534
  );
}

/** The server's own answer (imapflow's `responseText`/`response`, nodemailer's `response`); never our command. */
function serverReply(err: LoginError): string | undefined {
  const reply = err.responseText || (typeof err.response === "string" ? err.response : "");
  return reply.replace(/\s+/g, " ").trim().slice(0, 200) || undefined;
}

export function toMailError(error: unknown): unknown {
  if (error instanceof MailAuthError || !error || typeof error !== "object") return error;
  const err = error as LoginError;
  if (!isAuthFailure(err)) return error;
  const text = responseText(err);
  const mapped = IMAP_DISABLED.test(text)
    ? new MailAuthError(tk("IMAP/SMTP access is disabled for this mailbox"), "imap_disabled")
    : APP_PASSWORD.test(text)
      ? new MailAuthError(tk("The server requires an app password"), "app_password_required")
      : new MailAuthError(tk("The server rejected the username or password"), "invalid_credentials");
  mapped.serverReply = serverReply(err);
  return mapped;
}

/** Microsoft 365 with SMTP AUTH turned off for the organisation or the mailbox (535 5.7.139). */
export function smtpTurnedOff(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const text = responseText(error as LoginError);
  return /5\.7\.139|SmtpClientAuthentication is disabled|smtp auth.+disabled/i.test(text);
}
