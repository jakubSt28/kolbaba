import nodemailer from "nodemailer";
import { env } from "./env";
import { HttpError } from "./http-error";
import { logError } from "./log";

export interface SystemEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

/**
 * The app's own emails (sign-up codes, feedback), sent through Resend from MAIL_FROM, or through SMTP_URL
 * on a self-hosted copy. These never go through a user's mailbox. In development without a key they're
 * printed instead.
 */
export async function sendSystemEmail(mail: SystemEmail) {
  if (env.smtpUrl) return sendOverSmtp(env.smtpUrl, mail);
  const key = env.resendApiKey;
  if (!key) {
    if (process.env.NODE_ENV === "production") throw new HttpError(503, "We couldn't send the email. Please try again later.", "mail_unavailable");
    console.log(`[system mail] to ${mail.to}: ${mail.subject}\n${mail.text}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.mailFrom,
      to: [mail.to],
      subject: mail.subject,
      text: mail.text,
      ...(mail.html ? { html: mail.html } : {}),
      ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch((err: unknown) => {
    logError("[system mail]", err);
    return null;
  });
  if (!res?.ok) {
    if (res) logError("[system mail]", new Error(`Resend ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`));
    throw new HttpError(503, "We couldn't send the email. Please try again later.", "mail_unavailable");
  }
}

async function sendOverSmtp(url: string, mail: SystemEmail) {
  try {
    await nodemailer.createTransport(url).sendMail({
      from: env.mailFrom,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      ...(mail.html ? { html: mail.html } : {}),
      ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
    });
  } catch (err) {
    logError("[system mail]", err);
    throw new HttpError(503, "We couldn't send the email. Please try again later.", "mail_unavailable");
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A plain, calm email: a heading, a few lines, optionally one big code. Works without images. */
export function simpleEmailHtml(input: { heading: string; lines: string[]; code?: string; footer?: string }) {
  const p = (t: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.5;color:#3a3f4b">${escapeHtml(t)}</p>`;
  return `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#f5f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:440px;margin:0 auto;background:#fff;border-radius:16px;padding:28px">
<h1 style="margin:0 0 16px;font-size:20px;color:#1a1e27">${escapeHtml(input.heading)}</h1>
${input.lines.map(p).join("\n")}
${input.code ? `<div style="margin:20px 0;font-size:32px;font-weight:600;letter-spacing:6px;color:#1a1e27;font-variant-numeric:tabular-nums">${escapeHtml(input.code)}</div>` : ""}
${input.footer ? `<p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#8a8f99">${escapeHtml(input.footer)}</p>` : ""}
</div></body></html>`;
}
