import { like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seal } from "../crypto";
import { db, schema } from "../db";
import type { RemoteMessage } from "./types";

vi.mock("./adapters", () => ({
  withAdapter: async () => {},
  adapterFor: () => ({}),
}));

const { DbSyncSink } = await import("../sync/sink");
const { getThread, listThreads } = await import("./service");

const DOMAIN = "warm-test.invalid";
const ME = `me@${DOMAIN}`;
let userId = "";
let accountId = "";
let n = 0;

const msg = (from: string, over: Partial<RemoteMessage> = {}): RemoteMessage => ({
  providerMessageId: `INBOX:1:${++n}`,
  messageIdHeader: `<w${n}@x>`,
  references: [],
  from: { name: from.split("@")[0], email: from },
  to: [{ name: "Me", email: ME }],
  cc: [],
  bcc: [],
  replyTo: [],
  subject: `Hello ${n}`,
  date: new Date(),
  snippet: "Hi",
  attachments: [],
  unread: true,
  pinned: false,
  role: "inbox",
  labels: [],
  ...over,
});

beforeEach(async () => {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
  const [u] = await db().insert(schema.users).values({ email: ME }).returning();
  userId = u.id;
  const [a] = await db()
    .insert(schema.accounts)
    .values({ userId, provider: "imap", email: ME, name: "Me", hue: 200, credentials: seal({ kind: "password", password: "x" }, "x"), status: "ok" })
    .returning();
  accountId = a.id;
});

afterAll(async () => {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
});

describe("warm letters", () => {
  it("marks mail from people in the address book, not from strangers or the ones put away", async () => {
    await db()
      .insert(schema.contacts)
      .values([
        { userId, name: "Friend", emails: [`friend@${DOMAIN}`] },
        { userId, name: "Gone", emails: [`gone@${DOMAIN}`], hidden: true },
      ]);
    const sink = new DbSyncSink({ id: accountId, userId, email: ME }, false);
    await sink.upsertMessages([msg(`Friend@${DOMAIN}`), msg(`news@${DOMAIN}`), msg(`gone@${DOMAIN}`)]);

    const { threads } = await listThreads(userId, { folder: "inbox" });
    const warm = Object.fromEntries(threads.map((t) => [t.messages[0].from.email.toLowerCase(), !!t.warm]));
    expect(warm).toEqual({ [`friend@${DOMAIN}`]: true, [`news@${DOMAIN}`]: false, [`gone@${DOMAIN}`]: false });

    const friend = threads.find((t) => t.warm)!;
    expect((await getThread(userId, friend.id)).warm).toBe(true);
  });

  it("isn't warm for our own mail to someone we know", async () => {
    await db().insert(schema.contacts).values({ userId, name: "Friend", emails: [`friend@${DOMAIN}`] });
    const sink = new DbSyncSink({ id: accountId, userId, email: ME }, false);
    await sink.upsertMessages([msg(ME, { role: "sent", to: [{ name: "", email: `friend@${DOMAIN}` }] })]);
    const { threads } = await listThreads(userId, { folder: "sent" });
    expect(threads).toHaveLength(1);
    expect(threads[0].warm).toBeUndefined();
  });
});
