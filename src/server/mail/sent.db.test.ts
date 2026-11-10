import { eq, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomToken, seal } from "../crypto";
import { db, schema } from "../db";
import type { RemoteMessage } from "./types";

vi.mock("../push", () => ({ notifyUser: vi.fn(async () => {}), userLocale: async () => "en" }));

const { listThreads } = await import("./service");
const { DbSyncSink } = await import("../sync/sink");

const DOMAIN = "sent-test.invalid";
const ME = `me@${DOMAIN}`;
let userId = "";
let sink: InstanceType<typeof DbSyncSink>;

const at = (day: number) => new Date(Date.UTC(2026, 9, day, 9));

/** One Gmail message in conversation `thread`, from the user (Sent) or from Jana (Inbox). */
function gmail(thread: string, day: number, mine: boolean, labels = mine ? ["SENT"] : ["INBOX"]): RemoteMessage {
  const jana = { name: "Jana", email: `jana@${DOMAIN}` };
  const me = { name: "Me", email: ME };
  return {
    providerMessageId: `g${randomToken(6)}`,
    providerThreadId: thread,
    messageIdHeader: `<${randomToken(6)}@x>`,
    references: [],
    from: mine ? me : jana,
    to: [mine ? jana : me],
    cc: [],
    bcc: [],
    replyTo: [],
    subject: thread,
    date: at(day),
    snippet: "…",
    attachments: [],
    unread: false,
    pinned: false,
    role: labels.includes("TRASH") ? "trash" : labels.includes("INBOX") ? "inbox" : mine ? "sent" : "archive",
    labels,
  };
}

const sent = async (opts: { limit?: number; cursor?: string } = {}) => listThreads(userId, { folder: "sent", ...opts });
const subjects = async () => (await sent()).threads.map((t) => t.subject);

beforeEach(async () => {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
  const [u] = await db().insert(schema.users).values({ email: ME }).returning();
  userId = u.id;
  const [a] = await db()
    .insert(schema.accounts)
    .values({ userId, provider: "gmail", email: ME, name: ME, hue: 200, credentials: seal({ kind: "password", password: "x" }, "x"), status: "ok" })
    .returning();
  sink = new DbSyncSink({ id: a.id, userId, email: ME }, false);
});

afterAll(async () => {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
});

describe("Sent", () => {
  it("lists a reply in a conversation that stays in Inbox or Archive, like Gmail", async () => {
    await sink.upsertMessages([gmail("Smlouva", 1, false), gmail("Smlouva", 2, true)]);
    await sink.upsertMessages([gmail("Archivované", 3, false, []), gmail("Archivované", 4, true)]);
    await sink.upsertMessages([gmail("Jen od Jany", 5, false)]);

    const [thread] = await db().select().from(schema.threads).where(eq(schema.threads.subject, "Smlouva"));
    expect(thread.folder).toBe("inbox");
    expect(await subjects()).toEqual(["Archivované", "Smlouva"]);
    expect((await sent()).threads.find((t) => t.subject === "Smlouva")!.sentAt).toBe(at(2).getTime());
  });

  it("goes by when the user wrote: a later answer doesn't move it up", async () => {
    await sink.upsertMessages([gmail("Starší", 1, true), gmail("Starší", 9, false)]);
    await sink.upsertMessages([gmail("Novější", 2, true)]);
    expect(await subjects()).toEqual(["Novější", "Starší"]);

    // A page ends where the user last wrote, so the next one carries on from there.
    const first = await sent({ limit: 1 });
    expect(first.threads.map((t) => t.subject)).toEqual(["Novější"]);
    expect((await sent({ limit: 1, cursor: first.nextCursor! })).threads.map((t) => t.subject)).toEqual(["Starší"]);
  });

  it("leaves out what the user deleted", async () => {
    await sink.upsertMessages([gmail("Smazaná odpověď", 1, false), gmail("Smazaná odpověď", 2, true, ["SENT", "TRASH"])]);
    await sink.upsertMessages([gmail("Celé v koši", 3, true, ["SENT", "TRASH"])]);
    expect(await subjects()).toEqual([]);
  });
});
