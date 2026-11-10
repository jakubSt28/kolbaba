import { simpleParser } from "mailparser";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seal } from "../crypto";
import { db, schema } from "../db";
import { buildMessage } from "./imap/compose";
import type { OutgoingMessage } from "./types";

const ICS = [
  "BEGIN:VCALENDAR",
  "METHOD:REQUEST",
  "BEGIN:VEVENT",
  "UID:evt-1@example.cz",
  "SEQUENCE:0",
  "DTSTART:20261015T080000Z",
  "DTEND:20261015T090000Z",
  "SUMMARY:Plánování",
  "ORGANIZER;CN=Jana:mailto:jana@example.cz",
  "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:me@invite-test.invalid",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const sent = vi.hoisted(() => [] as OutgoingMessage[]);
const fetched = vi.hoisted(() => [] as string[]);
vi.mock("./adapters", () => ({
  withAdapter: async (_row: unknown, fn: (a: unknown) => Promise<unknown>) =>
    fn({
      fetchAttachment: async (_ref: unknown, id: string) => {
        fetched.push(id);
        return { name: "invite.ics", mime: "text/calendar", content: Buffer.from(ICS) };
      },
      send: async (m: OutgoingMessage) => {
        sent.push(m);
        return { messageIdHeader: "<r@x>" };
      },
    }),
  adapterFor: () => ({}),
}));

const { inviteFor, respondToInvite } = await import("./invites");

const DOMAIN = "invite-test.invalid";
let userId = "";
let messageId = "";

beforeEach(async () => {
  sent.length = 0;
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
  const [u] = await db().insert(schema.users).values({ email: `me@${DOMAIN}`, name: "Daniel" }).returning();
  userId = u.id;
  const [a] = await db()
    .insert(schema.accounts)
    .values({ userId, provider: "imap", email: `me@${DOMAIN}`, name: "Me", hue: 200, credentials: seal({ kind: "password", password: "x" }, "x"), status: "ok" })
    .returning();
  const [t] = await db()
    .insert(schema.threads)
    .values({ userId, accountId: a.id, providerThreadId: "<inv@x>", subject: "Pozvánka", lastMessageAt: new Date(), messageCount: 1 })
    .returning();
  const [m] = await db()
    .insert(schema.messages)
    .values({
      userId,
      accountId: a.id,
      threadId: t.id,
      providerMessageId: "INBOX:1:7",
      messageIdHeader: "<inv@x>",
      from: { name: "Jana", email: "jana@example.cz" },
      subject: "Pozvánka: Plánování",
      date: new Date(),
      attachments: [{ id: "2", name: "invite.ics", size: ICS.length, mime: "text/calendar" }],
      labels: ["role:inbox"],
    })
    .returning();
  messageId = m.id;
});

afterAll(async () => {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
});

describe("calendar invitations", () => {
  it("show what and when, and answer the organizer with an iTIP REPLY", async () => {
    const before = await inviteFor(userId, messageId);
    expect(before).toMatchObject({ method: "REQUEST", summary: "Plánování", start: "2026-10-15T08:00:00.000Z", canReply: true, status: null });

    const after = await respondToInvite(userId, messageId, "ACCEPTED", "cs");
    expect(after.status).toBe("ACCEPTED");
    expect(sent[0].to).toEqual([{ name: "Jana", email: "jana@example.cz" }]);
    expect(sent[0].subject).toBe("Přijato: Plánování");
    expect(sent[0].inReplyTo).toBe("<inv@x>");
    expect(sent[0].icalEvent?.method).toBe("REPLY");
    expect(sent[0].icalEvent?.content).toContain("ATTENDEE;PARTSTAT=ACCEPTED");
    // Remembered, so the card shows it next time.
    expect((await inviteFor(userId, messageId)).status).toBe("ACCEPTED");
  });

  it("are read from the mail server once, then kept for the list and the next open", async () => {
    const [before] = await db().select({ invite: schema.messages.invite }).from(schema.messages).where(eq(schema.messages.id, messageId));
    expect(before.invite).toBeNull();
    await inviteFor(userId, messageId);
    const [after] = await db().select({ invite: schema.messages.invite }).from(schema.messages).where(eq(schema.messages.id, messageId));
    expect(after.invite).toMatchObject({ uid: "evt-1@example.cz", summary: "Plánování", start: "2026-10-15T08:00:00.000Z" });
    fetched.length = 0;
    expect(await inviteFor(userId, messageId)).toMatchObject({ summary: "Plánování", joinUrl: null });
    expect(fetched).toHaveLength(0);
  });

  it("go out as a proper calendar part that mail apps recognise", async () => {
    await respondToInvite(userId, messageId, "DECLINED", "en");
    const built = await buildMessage(sent[0]);
    const raw = built.raw.toString();
    expect(raw).toMatch(/Content-Type: text\/calendar; charset=utf-8; method=REPLY/i);
    const parsed = await simpleParser(built.raw);
    expect(parsed.subject).toBe("Declined: Plánování");
  });
});
