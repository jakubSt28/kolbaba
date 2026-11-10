import { eq, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomToken, seal } from "../crypto";
import { db, schema } from "../db";
import { appendChunk, attachmentsByDraft, MAX_ATTACHMENTS_BYTES, previewUrl, startUpload } from "./outgoing-attachments";

const sent = vi.hoisted(() => [] as { html: string; attachments?: { filename: string; content: Buffer; cid?: string }[] }[]);
vi.mock("./adapters", () => ({
  withAdapter: async (_row: unknown, fn: (a: unknown) => Promise<unknown>) =>
    fn({
      send: async (m: (typeof sent)[number]) => {
        sent.push(m);
        return { messageIdHeader: `<${Math.random()}@test>` };
      },
      // The forwarded email's files at the mail server; "broken" won't come.
      fetchAttachment: async (_ref: unknown, id: string) => {
        if (id === "broken") throw new Error("gone");
        return { name: `${id}.bin`, mime: "application/octet-stream", content: Buffer.from(`content of ${id}`) };
      },
    }),
  adapterFor: () => ({}),
}));
vi.mock("../push", () => ({ notifyUser: vi.fn(async () => {}), userLocale: async () => "en" }));

const { cancelSend, deleteDraft, forwardAttachments, queueSend, saveDraft } = await import("./service");
const { sendClaimed } = await import("../sync/outbox");

const DOMAIN = "attach-test.invalid";
let userId = "";
let accountId = "";

beforeEach(async () => {
  sent.length = 0;
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
  const [u] = await db().insert(schema.users).values({ email: `me@${DOMAIN}` }).returning();
  userId = u.id;
  const [a] = await db()
    .insert(schema.accounts)
    .values({ userId, provider: "imap", email: `me@${DOMAIN}`, name: "Me", hue: 200, credentials: seal({ kind: "password", password: "x" }, "x"), status: "ok" })
    .returning();
  accountId = a.id;
});

afterAll(async () => {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
});

const draft = (html = "<p>Hi</p>") => saveDraft(userId, { accountId, to: "petr@example.com", subject: "Files", html });
const bytes = (n: number, fill = 1) => Buffer.alloc(n, fill);

describe("attachments while writing", () => {
  it("arrive in chunks, in order", async () => {
    const d = await draft();
    const a = await startUpload(userId, d.id, { name: "report.pdf", mime: "application/pdf", size: 10 }, bytes(4));
    await expect(appendChunk(userId, d.id, a.id, 0, bytes(6))).rejects.toMatchObject({ code: "upload_conflict" });
    // Unfinished files aren't listed yet.
    expect((await attachmentsByDraft(userId, [d.id])).get(d.id)).toBeUndefined();
    await appendChunk(userId, d.id, a.id, 4, bytes(6, 2));
    expect((await attachmentsByDraft(userId, [d.id])).get(d.id)).toEqual([{ id: a.id, name: "report.pdf", size: 10, mime: "application/pdf" }]);
  });

  it("can't exceed the size an email may carry, or go to someone else's draft", async () => {
    const d = await draft();
    await expect(startUpload(userId, d.id, { name: "big.zip", mime: "application/zip", size: MAX_ATTACHMENTS_BYTES + 1 }, bytes(1))).rejects.toMatchObject({ status: 413 });
    const [other] = await db().insert(schema.users).values({ email: `other@${DOMAIN}` }).returning();
    await expect(startUpload(other.id, d.id, { name: "x.txt", mime: "text/plain", size: 1 }, bytes(1))).rejects.toMatchObject({ status: 404 });
  });

  it("go out with the email: files attached, pasted images as cid:, unused images dropped", async () => {
    const d = await draft();
    const file = await startUpload(userId, d.id, { name: "a.txt", mime: "text/plain", size: 3 }, Buffer.from("abc"));
    const pic = await startUpload(userId, d.id, { name: "p.png", mime: "image/png", size: 2, inline: true }, bytes(2));
    const unused = await startUpload(userId, d.id, { name: "gone.png", mime: "image/png", size: 2, inline: true }, bytes(2));
    await saveDraft(userId, { id: d.id, accountId, html: `<p>Look</p><img src="${previewUrl(d.id, pic.id)}">` });

    const row = await queueSend(userId, d.id);
    expect(row.html).toMatch(/src="cid:[^"]+@kolbaba"/);
    expect(row.html).not.toContain("/api/drafts/");
    await sendClaimed(row);

    expect(sent[0].attachments?.map((a) => a.filename).sort()).toEqual(["a.txt", "p.png"]);
    expect(sent[0].attachments?.find((a) => a.filename === "a.txt")?.content.toString()).toBe("abc");
    expect(sent[0].attachments?.find((a) => a.filename === "p.png")?.cid).toMatch(/@kolbaba$/);
    // Our copy goes once the email is out.
    const left = await db().select().from(schema.draftAttachments).where(eq(schema.draftAttachments.userId, userId));
    expect(left).toEqual([]);
    expect([file.id, unused.id]).toHaveLength(2);
  });

  it("come back with the draft on Undo", async () => {
    const d = await draft();
    const file = await startUpload(userId, d.id, { name: "a.txt", mime: "text/plain", size: 1 }, bytes(1));
    const row = await queueSend(userId, d.id);
    const restored = await cancelSend(userId, row.id);
    expect(restored?.attachments).toEqual([{ id: file.id, name: "a.txt", size: 1, mime: "text/plain" }]);
    await deleteDraft(userId, d.id);
    expect(await db().select().from(schema.draftAttachments).where(eq(schema.draftAttachments.userId, userId))).toEqual([]);
  });
});

describe("forwarding", () => {
  async function received(html: string, attachments: { id: string; name: string; mime: string; size: number; cid?: string; inline?: boolean }[]) {
    const [t] = await db()
      .insert(schema.threads)
      .values({ userId, accountId, providerThreadId: `<${randomToken(6)}@x>`, subject: "Contract", lastMessageAt: new Date(), messageCount: 1, folder: "inbox" })
      .returning();
    const [m] = await db()
      .insert(schema.messages)
      .values({
        userId,
        accountId,
        threadId: t.id,
        providerMessageId: `INBOX:1:${randomToken(4)}`,
        from: { name: "Jana", email: `jana@${DOMAIN}` },
        subject: "Contract",
        date: new Date(),
        bodyHtml: html,
        attachments,
        labels: ["role:inbox"],
      })
      .returning();
    return m.id;
  }

  it("takes the forwarded email's files along, and the pictures its text shows", async () => {
    const messageId = await received('<p>See</p><img src="cid:logo@x">', [
      { id: "contract", name: "contract.pdf", mime: "application/pdf", size: 20 },
      { id: "logo", name: "logo.png", mime: "image/png", size: 15, cid: "logo@x", inline: true },
      { id: "unused", name: "sig.png", mime: "image/png", size: 15, cid: "sig@x", inline: true },
      { id: "broken", name: "lost.doc", mime: "application/msword", size: 5 },
      { id: "huge", name: "huge.zip", mime: "application/zip", size: MAX_ATTACHMENTS_BYTES + 1 },
    ]);
    const d = await draft();
    const out = await forwardAttachments(userId, d.id, messageId);

    expect(out.attachments.map((a) => [a.name, !!a.inline])).toEqual([
      ["contract.pdf", false],
      ["logo.png", true],
    ]);
    expect(out.failed).toEqual([
      { name: "lost.doc", reason: "unavailable" },
      { name: "huge.zip", reason: "too_large" },
    ]);
    const logo = out.attachments.find((a) => a.inline)!;
    expect(out.images).toEqual({ [`/api/attachments/${messageId}/logo`]: previewUrl(d.id, logo.id) });

    // Sent with the draft: the file attached, the picture as cid:.
    await saveDraft(userId, { id: d.id, accountId, html: `<p>FYI</p><blockquote><img src="${previewUrl(d.id, logo.id)}"></blockquote>` });
    await sendClaimed(await queueSend(userId, d.id));
    const files = sent[0].attachments ?? [];
    expect(files.map((a) => a.filename).sort()).toEqual(["contract.pdf", "logo.png"]);
    expect(files.find((a) => a.filename === "contract.pdf")?.content.toString()).toBe("content of contract");
    expect(sent[0].html).toMatch(/src="cid:[^"]+@kolbaba"/);
  });

  it("only into one's own draft, from one's own email", async () => {
    const messageId = await received("<p>Hi</p>", [{ id: "a", name: "a.txt", mime: "text/plain", size: 3 }]);
    const d = await draft();
    const [other] = await db().insert(schema.users).values({ email: `other2@${DOMAIN}` }).returning();
    await expect(forwardAttachments(other.id, d.id, messageId)).rejects.toMatchObject({ status: 404 });
  });
});
