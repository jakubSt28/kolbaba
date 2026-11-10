import { eq, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomToken, seal } from "../crypto";
import { db, schema } from "../db";
import type { OutgoingMessage } from "./types";

const adapter = vi.hoisted(() => ({
  send: vi.fn<(m: OutgoingMessage) => Promise<{ messageIdHeader: string }>>(async () => ({ messageIdHeader: "<x@y>" })),
  close: vi.fn(async () => {}),
}));
vi.mock("./adapters", () => ({
  withAdapter: async (_row: unknown, fn: (a: typeof adapter) => Promise<unknown>) => fn(adapter),
  adapterFor: () => adapter,
}));

const { oneClick, unsubscribe } = await import("./unsubscribe");

const DOMAIN = "unsubscribe-test.invalid";
let userId = "";
let accountId = "";

async function newsletter(listUnsubscribe: string, oneClickFlag = false) {
  const [t] = await db()
    .insert(schema.threads)
    .values({
      userId,
      accountId,
      providerThreadId: `<${randomToken(6)}@x>`,
      subject: "Týdenní novinky",
      lastMessageAt: new Date(),
      messageCount: 1,
      folder: "inbox",
      listUnsubscribe,
      listUnsubscribeOneClick: oneClickFlag,
    })
    .returning();
  return t.id;
}

beforeEach(async () => {
  adapter.send.mockClear();
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
  const [u] = await db().insert(schema.users).values({ email: `me@${DOMAIN}`, name: "Daniel" }).returning();
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

describe("unsubscribe", () => {
  it("sends the list's unsubscribe email from the mailbox it came to", async () => {
    const id = await newsletter("<mailto:leave@lists.example.com?subject=remove>");
    expect(await unsubscribe(userId, id)).toMatchObject({ method: "email" });
    const [mail] = adapter.send.mock.calls[0];
    expect(mail).toMatchObject({ to: [{ email: "leave@lists.example.com" }], subject: "remove", from: { email: `me@${DOMAIN}`, name: "Daniel" } });
    const [t] = await db().select().from(schema.threads).where(eq(schema.threads.id, id));
    expect(t.unsubscribedAt).not.toBeNull();
  });

  it("one click never reaches our own network; it falls back to the email", async () => {
    const id = await newsletter("<https://127.0.0.1/u?id=1>, <mailto:leave@lists.example.com>", true);
    expect(await unsubscribe(userId, id)).toMatchObject({ method: "email" });
    const onlyWeb = await newsletter("<https://localhost/u>", true);
    await expect(unsubscribe(userId, onlyWeb)).rejects.toMatchObject({ status: 502 });
  });

  it("a page to finish on isn't something the server can do", async () => {
    const id = await newsletter("<https://example.com/preferences>");
    await expect(unsubscribe(userId, id)).rejects.toMatchObject({ status: 409 });
  });

  it("one click takes only plain https on 443", async () => {
    await expect(oneClick("http://example.com/u")).rejects.toThrow();
    await expect(oneClick("https://example.com:8443/u")).rejects.toThrow();
    await expect(oneClick("https://user:pw@example.com/u")).rejects.toThrow();
    await expect(oneClick("https://10.0.0.5/u")).rejects.toThrow("public");
  });
});
