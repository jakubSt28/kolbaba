import { and, eq } from "drizzle-orm";
import { hmac, safeEqual } from "../crypto";
import { db, schema } from "../db";
import { env } from "../env";

/**
 * Download links get_attachment hands an agent. They work without a session, so the agent's own tools
 * (which have no Kolbaba sign-in) can fetch and save the file, but only for a few minutes and only
 * while the agent still has access to that mailbox. Nothing is stored: the link carries the agent,
 * the message, the attachment's place in it and the expiry, signed together.
 */
export const LINK_MINUTES = 15;

/** 128 bits of HMAC, kept short so a model copies the link whole. */
const sign = (body: string) => hmac(`attachment-link:${body}`).slice(0, 22);

export function attachmentLink(agentId: string, messageId: string, index: number, name: string, now = Date.now()) {
  const expires = Math.ceil(now / 1000 + LINK_MINUTES * 60).toString(36);
  const body = [agentId, messageId, index, expires].join(".");
  // The file name at the end is only for tools that name the saved file after the URL.
  return `${env.appUrl}/api/attachment-links/${body}.${sign(body)}/${encodeURIComponent(name || "attachment")}`;
}

/** What a link points at, or null when it's forged, expired, or the agent no longer sees that mailbox. */
export async function openAttachmentLink(token: string, now = Date.now()) {
  const parts = token.split(".");
  if (parts.length !== 5) return null;
  const [agentId, messageId, index, expires, signature] = parts;
  if (!safeEqual(signature, sign(parts.slice(0, 4).join(".")))) return null;
  if (parseInt(expires, 36) * 1000 < now) return null;
  const [agent] = await db().select().from(schema.agents).where(eq(schema.agents.id, agentId));
  if (!agent?.enabled) return null;
  const [m] = await db()
    .select({ accountId: schema.messages.accountId, attachments: schema.messages.attachments })
    .from(schema.messages)
    .where(and(eq(schema.messages.id, messageId), eq(schema.messages.userId, agent.userId)));
  const meta = m?.attachments[Number(index)];
  if (!m || !meta || !agent.accountIds.includes(m.accountId)) return null;
  return { userId: agent.userId, messageId, attachmentId: meta.id };
}
