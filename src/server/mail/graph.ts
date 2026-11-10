import type { AdapterAccount } from "./types";
import { GRAPH_SEND_SCOPE, refreshMicrosoftToken } from "../microsoft";

/**
 * Sending through Microsoft Graph, for Microsoft 365 organisations that turned SMTP off: the very same
 * MIME message, posted to /me/sendMail. Graph files it into Sent Items. One request takes up to 4 MB and
 * the message goes base64-encoded (a third bigger), so a bigger email (attachments) can't go this way.
 */
const GRAPH_MAX_BYTES = 2_900_000;

export async function sendWithGraph(account: AdapterAccount, mime: Buffer) {
  const creds = account.credentials;
  if (creds.kind !== "oauth" || creds.issuer !== "microsoft") throw new Error("Graph sending needs a Microsoft account");
  if (mime.length > GRAPH_MAX_BYTES) {
    // The outbox gives up after a few tries and tells the user it couldn't be sent.
    throw new Error("SMTP is off for this Microsoft 365 mailbox and the email is too big for Graph");
  }
  // A Graph token is its own: the mailbox's token is for outlook.office.com.
  const { accessToken } = await refreshMicrosoftToken(creds.refreshToken, [GRAPH_SEND_SCOPE, "offline_access"]);
  const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "text/plain" },
    body: mime.toString("base64"),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Graph sendMail failed: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
}
