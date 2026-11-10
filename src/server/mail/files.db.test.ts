import { like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomToken, seal } from "../crypto";
import { db, schema } from "../db";
import type { AttachmentMeta } from "../db/schema";
import { listFiles } from "./files";

const DOMAIN = "files-test.invalid";
let userId = "";
let accountId = "";

async function mail(subject: string, attachments: AttachmentMeta[], opts: { folder?: "inbox" | "trash"; date?: Date; from?: string } = {}) {
  const [t] = await db()
    .insert(schema.threads)
    .values({ userId, accountId, providerThreadId: `<${randomToken(6)}@x>`, subject, lastMessageAt: new Date(), messageCount: 1, folder: opts.folder ?? "inbox" })
    .returning();
  await db()
    .insert(schema.messages)
    .values({
      userId,
      accountId,
      threadId: t.id,
      providerMessageId: `INBOX:1:${randomToken(4)}`,
      from: { name: opts.from ?? "Jana Dvořáková", email: `${(opts.from ?? "jana").toLowerCase().split(" ")[0]}@${DOMAIN}` },
      subject,
      date: opts.date ?? new Date(),
      attachments,
      labels: ["role:inbox"],
    });
}

const file = (name: string, mime: string, size = 50_000, extra: Partial<AttachmentMeta> = {}): AttachmentMeta => ({ id: randomToken(3), name, mime, size, ...extra });

beforeEach(async () => {
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

describe("files", () => {
  it("lists real files only, newest first, filtered by kind and by name or sender", async () => {
    await mail("Faktura", [file("faktura-rijen.pdf", "application/pdf"), file("logo.png", "image/png", 3000)], { date: new Date("2026-10-10") });
    await mail("Fotky", [file("IMG_1.jpg", "image/jpeg"), file("inline.png", "image/png", 90_000, { inline: true })], { date: new Date("2026-10-11"), from: "Petr Novák" });
    await mail("Pozvánka", [file("invite.ics", "text/calendar")]);
    await mail("Smazané", [file("stare.xlsx", "application/vnd.ms-excel")], { folder: "trash" });

    const all = await listFiles(userId);
    expect(all.files.map((f) => f.name)).toEqual(["IMG_1.jpg", "faktura-rijen.pdf"]);
    expect(all.files[1]).toMatchObject({ kind: "pdf", subject: "Faktura", url: expect.stringContaining("/api/attachments/") });

    expect((await listFiles(userId, { kind: "pdf" })).files.map((f) => f.name)).toEqual(["faktura-rijen.pdf"]);
    expect((await listFiles(userId, { query: "petr" })).files.map((f) => f.name)).toEqual(["IMG_1.jpg"]);
    expect((await listFiles(userId, { query: "říjen".normalize() })).files).toHaveLength(0);
    expect((await listFiles(userId, { query: "rijen" })).files.map((f) => f.name)).toEqual(["faktura-rijen.pdf"]);
    expect((await listFiles(userId, { since: new Date("2026-10-11").getTime() })).files.map((f) => f.name)).toEqual(["IMG_1.jpg"]);
  });

  it("pages by email, so one email's files stay together", async () => {
    for (let i = 0; i < 45; i++) {
      await mail(`Zpráva ${i}`, [file(`a${i}.pdf`, "application/pdf"), file(`b${i}.pdf`, "application/pdf")], { date: new Date(Date.UTC(2026, 9, 1, 0, i)) });
    }
    const first = await listFiles(userId);
    expect(first.files).toHaveLength(80);
    expect(first.nextCursor).not.toBeNull();
    const rest = await listFiles(userId, { cursor: first.nextCursor! });
    expect(rest.files).toHaveLength(10);
    expect(rest.nextCursor).toBeNull();
    expect(new Set([...first.files, ...rest.files].map((f) => f.name)).size).toBe(90);
  });
});
