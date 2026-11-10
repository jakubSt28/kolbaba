import { eq, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seal } from "../crypto";
import { db, schema } from "../db";

const parse = vi.hoisted(() =>
  vi.fn<(req: { input: string; instructions: string }) => Promise<{ output_parsed: { summary: string; points: string[]; asks: string[] } }>>(async () => ({
    output_parsed: { summary: "Domluva na čtvrtek.", points: ["Čtvrtek 10:00"], asks: ["Potvrdit čas"] },
  })),
);
vi.mock("openai", () => ({ default: class {
  responses = { parse };
} }));
vi.mock("openai/helpers/zod", () => ({ zodTextFormat: () => ({}) }));

process.env.OPENAI_API_KEY = "test";
const { summarizeThread } = await import("./summary");

const DOMAIN = "summary-test.invalid";
let userId = "";
let threadId = "";

beforeEach(async () => {
  parse.mockClear();
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
  const [u] = await db().insert(schema.users).values({ email: `me@${DOMAIN}` }).returning();
  userId = u.id;
  const [a] = await db()
    .insert(schema.accounts)
    .values({ userId, provider: "imap", email: `me@${DOMAIN}`, name: "Me", hue: 200, credentials: seal({ kind: "password", password: "x" }, "x"), status: "ok" })
    .returning();
  const [t] = await db()
    .insert(schema.threads)
    .values({ userId, accountId: a.id, providerThreadId: "<s@x>", subject: "Schůzka", lastMessageAt: new Date(), messageCount: 2 })
    .returning();
  threadId = t.id;
  const msg = (n: number, html: string) => ({
    userId,
    accountId: a.id,
    threadId: t.id,
    providerMessageId: `INBOX:1:${n}`,
    from: { name: "Jana", email: "jana@example.cz" },
    subject: "Schůzka",
    date: new Date(Date.now() - (3 - n) * 3600_000),
    bodyHtml: html,
    labels: ["role:inbox"],
  });
  await db()
    .insert(schema.messages)
    .values([msg(1, "<p>Sejdeme se ve čtvrtek?</p>"), msg(2, "<p>V 10:00 se mi hodí.</p><blockquote>Sejdeme se ve čtvrtek?</blockquote>")]);
});

afterAll(async () => {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
});

describe("summarizeThread", () => {
  it("sends the conversation without quoted copies, in the reader's language, and keeps the answer", async () => {
    const out = await summarizeThread(userId, threadId, "cs");
    expect(out.summary).toBe("Domluva na čtvrtek.");
    const req = parse.mock.calls[0][0];
    expect(req.instructions).toContain("Czech");
    expect(req.input.match(/Sejdeme se ve čtvrtek\?/g)).toHaveLength(1);
    expect(req.input).toContain("V 10:00 se mi hodí.");

    await summarizeThread(userId, threadId, "cs");
    expect(parse).toHaveBeenCalledTimes(1); // cached

    // A new message makes it stale.
    await db().update(schema.threads).set({ messageCount: 3 }).where(eq(schema.threads.id, threadId));
    await summarizeThread(userId, threadId, "cs");
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("only for the conversation's owner", async () => {
    const [other] = await db().insert(schema.users).values({ email: `other@${DOMAIN}` }).returning();
    await expect(summarizeThread(other.id, threadId, "en")).rejects.toMatchObject({ status: 404 });
  });
});
