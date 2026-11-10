import { request } from "node:https";
import type { LookupFunction } from "node:net";
import { isIP } from "node:net";
import { and, desc, eq } from "drizzle-orm";
import { parseListUnsubscribe } from "@/lib/unsubscribe";
import { resolvePublic } from "../autodetect/probe";
import { db, schema } from "../db";
import { HttpError } from "../http-error";
import { logWarn } from "../log";
import { withAdapter } from "./adapters";
import { senderThreads } from "./screener-actions";

/**
 * Leaving a mailing list from a conversation: the RFC 8058 one-click POST when the list offers it,
 * otherwise the unsubscribe email the list asks for, sent from the mailbox the mail came to. (A
 * plain web page is opened by the app itself; nothing to do here.)
 */
export async function unsubscribe(
  userId: string,
  threadId: string,
): Promise<{ method: "one-click" | "email"; sender: { email: string; name: string } | null; inbox: number; total: number }> {
  const [thread] = await db()
    .select()
    .from(schema.threads)
    .where(and(eq(schema.threads.id, threadId), eq(schema.threads.userId, userId)));
  if (!thread) throw new HttpError(404, "That conversation no longer exists", "not_found");
  const options = parseListUnsubscribe(thread.listUnsubscribe);

  let method: "one-click" | "email" | null = null;
  if (options.https && thread.listUnsubscribeOneClick) {
    try {
      await oneClick(options.https);
      method = "one-click";
    } catch (err) {
      logWarn(`[unsubscribe] one-click failed for ${new URL(options.https).hostname}`, err);
      if (!options.mailto) throw new HttpError(502, "The sender didn't take the request. Try again later.", "unsubscribe_failed");
    }
  }
  if (!method && options.mailto) {
    await sendUnsubscribeEmail(userId, thread.accountId, options.mailto);
    method = "email";
  }
  if (!method) throw new HttpError(409, "This sender can't be left from here", "no_unsubscribe");

  await db().update(schema.threads).set({ unsubscribedAt: new Date() }).where(eq(schema.threads.id, threadId));
  // What else from them is still around, so the app can offer to clean it up in one go.
  const [latest] = await db()
    .select({ from: schema.messages.from })
    .from(schema.messages)
    .where(and(eq(schema.messages.threadId, threadId), eq(schema.messages.isOutgoing, false)))
    .orderBy(desc(schema.messages.date))
    .limit(1);
  const sender = latest?.from.email ? { email: latest.from.email.toLowerCase(), name: latest.from.name } : null;
  const left = sender ? await senderThreads(userId, sender.email) : [];
  return { method, sender, inbox: left.filter((r) => r.folder === "inbox").length, total: left.length };
}

/**
 * POST `List-Unsubscribe=One-Click` to the list's https address. The address comes from an email, so
 * it must not reach our own network: https on 443 only, the host resolved once to a public address
 * and the connection pinned to it, no redirects followed, a short timeout.
 */
export async function oneClick(address: string, timeoutMs = 10_000): Promise<void> {
  const url = new URL(address);
  if (url.protocol !== "https:" || (url.port && url.port !== "443") || url.username || url.password) {
    throw new Error("Only plain https addresses");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const ip = await resolvePublic(host, 5000);
  if (!ip) throw new Error("Doesn't resolve to a public address");
  const family = isIP(ip);
  const pinned: LookupFunction = (_hostname, opts, callback) => {
    if (opts.all) (callback as (err: null, addresses: { address: string; family: number }[]) => void)(null, [{ address: ip, family }]);
    else callback(null, ip, family);
  };
  await new Promise<void>((resolve, reject) => {
    const req = request(
      url,
      {
        method: "POST",
        lookup: pinned,
        timeout: timeoutMs,
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "Kolbaba (+https://kolbaba.app)",
        },
      },
      (res) => {
        res.resume();
        const status = res.statusCode ?? 0;
        if (status >= 200 && status < 400) resolve();
        else reject(new Error(`HTTP ${status}`));
      },
    );
    req.on("timeout", () => req.destroy(new Error("Timed out")));
    req.on("error", reject);
    req.end("List-Unsubscribe=One-Click");
  });
}

async function sendUnsubscribeEmail(userId: string, accountId: string, mail: { to: string; subject: string; body: string }) {
  const [account] = await db()
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.id, accountId), eq(schema.accounts.userId, userId)));
  const [user] = await db().select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, userId));
  if (!account) throw new HttpError(404, "That mailbox is no longer connected", "not_found");
  const text = mail.body.slice(0, 500);
  await withAdapter(account, (adapter) =>
    adapter.send({
      from: { name: account.fromName || user?.name || "", email: account.email },
      to: [{ name: "", email: mail.to }],
      cc: [],
      bcc: [],
      subject: mail.subject.slice(0, 200),
      html: `<p>${text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)}</p>`,
      text,
    }),
  );
}
