import { eq, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomToken, seal } from "../crypto";
import { db, schema } from "../db";
import type { MessageRef } from "./types";

const adapter = vi.hoisted(() => ({
  setFlags: vi.fn(async () => {}),
  move: vi.fn<(refs: MessageRef[], to: string) => Promise<void>>(async () => {}),
  labelSnoozed: vi.fn<(refs: MessageRef[], on: boolean, label: { id?: string; name: string }) => Promise<string | undefined>>(async () => "Label_snoozed"),
  close: vi.fn(async () => {}),
}));
vi.mock("./adapters", () => ({
  withAdapter: async (_row: unknown, fn: (a: typeof adapter) => Promise<unknown>) => fn(adapter),
  adapterFor: () => adapter,
}));
vi.mock("../push", () => ({ notifyUser: vi.fn(async () => {}), userLocale: async () => "cs" }));

const { releaseSnooze, snoozeThread } = await import("./service");
const { DbSyncSink } = await import("../sync/sink");

const DOMAIN = "snooze-test.invalid";
let userId = "";

async function account(provider: "imap" | "gmail") {
  const [a] = await db()
    .insert(schema.accounts)
    .values({ userId, provider, email: `${provider}@${DOMAIN}`, name: provider, hue: 200, credentials: seal({ kind: "password", password: "x" }, "x"), status: "ok" })
    .returning();
  return a;
}

async function conversation(accountId: string, gmail: boolean) {
  const [t] = await db()
    .insert(schema.threads)
    .values({ userId, accountId, providerThreadId: `<${randomToken(6)}@x>`, subject: "Nabídka", lastMessageAt: new Date(), messageCount: 1, folder: "inbox" })
    .returning();
  await db()
    .insert(schema.messages)
    .values({
      userId,
      accountId,
      threadId: t.id,
      providerMessageId: gmail ? `g${randomToken(4)}` : `INBOX:1:${randomToken(4)}`,
      from: { name: "Jana", email: `jana@${DOMAIN}` },
      subject: "Nabídka",
      date: new Date(),
      messageIdHeader: `<${randomToken(6)}@x>`,
      labels: gmail ? ["INBOX", "role:inbox"] : ["role:inbox"],
      ...(gmail ? {} : { imapPath: "INBOX", imapUid: 1 }),
    });
  return t.id;
}

const thread = async (id: string) => (await db().select().from(schema.threads).where(eq(schema.threads.id, id)))[0];
const inLater = () => new Date(Date.now() + 3 * 3600_000);

beforeEach(async () => {
  for (const fn of Object.values(adapter)) fn.mockClear();
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
  const [u] = await db().insert(schema.users).values({ email: `me@${DOMAIN}` }).returning();
  userId = u.id;
});

afterAll(async () => {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
});

describe("snooze at the provider", () => {
  it("Gmail: a Snoozed label in the user's language goes on, and comes off when it's over", async () => {
    const gmail = await account("gmail");
    const id = await conversation(gmail.id, true);
    await snoozeThread(userId, id, inLater());
    expect(adapter.labelSnoozed).toHaveBeenCalledWith(expect.any(Array), true, { id: undefined, name: "Odložené" });
    const [acc] = await db().select().from(schema.accounts).where(eq(schema.accounts.id, gmail.id));
    expect(acc.syncState.snoozeLabelId).toBe("Label_snoozed");
    expect((await thread(id)).snoozedAt).not.toBeNull();

    await snoozeThread(userId, id, null);
    expect(adapter.labelSnoozed).toHaveBeenLastCalledWith(expect.any(Array), false, { id: "Label_snoozed", name: "Odložené" });
    expect((await thread(id)).snoozedAt).toBeNull();
  });

  it("IMAP has no label; release still puts the moved mail back", async () => {
    const imap = await account("imap");
    const id = await conversation(imap.id, false);
    await snoozeThread(userId, id, inLater());
    expect(adapter.labelSnoozed).not.toHaveBeenCalled();
    expect(adapter.move).toHaveBeenCalledWith(expect.any(Array), "archive");
    await db().update(schema.threads).set({ snoozedUntil: null }).where(eq(schema.threads.id, id));
    await releaseSnooze(userId, id);
    expect(adapter.move).toHaveBeenLastCalledWith(expect.any(Array), "inbox");
    expect(await thread(id)).toMatchObject({ snoozeMoved: [], snoozedAt: null });
  });

  it("moved back to Inbox in another client: the snooze ends, but not right after snoozing", async () => {
    const imap = await account("imap");
    const id = await conversation(imap.id, false);
    await snoozeThread(userId, id, inLater());
    const sink = new DbSyncSink({ id: imap.id, userId, email: imap.email }, false);
    const backInInbox = () => db().update(schema.messages).set({ labels: ["role:inbox"], imapPath: "INBOX" }).where(eq(schema.messages.threadId, id));

    // The provider hasn't caught up with the move yet: still snoozed.
    await backInInbox();
    await sink.refreshThreads([id]);
    expect((await thread(id)).snoozedUntil).not.toBeNull();

    // Later, the user drags it back into Inbox in Seznam's web.
    await db().update(schema.threads).set({ snoozedAt: new Date(Date.now() - 10 * 60_000) }).where(eq(schema.threads.id, id));
    await backInInbox();
    await sink.refreshThreads([id]);
    expect(await thread(id)).toMatchObject({ snoozedUntil: null, snoozeMoved: [], folder: "inbox" });
  });
});
