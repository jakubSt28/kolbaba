import { eq, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, schema } from "./db";

const mail = vi.hoisted(() => [] as { to: string; subject: string; replyTo?: string }[]);
vi.mock("./system-mail", () => ({ sendSystemEmail: vi.fn(async (m: { to: string; subject: string; replyTo?: string }) => void mail.push(m)) }));

const { askNps, saveFeedback } = await import("./feedback");

const DOMAIN = "feedback-test.invalid";
let user = { id: "", email: `me@${DOMAIN}`, name: "Daniel" };

beforeEach(async () => {
  mail.length = 0;
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
  const [u] = await db().insert(schema.users).values({ email: user.email, name: "Daniel", createdAt: new Date(Date.now() - 10 * 24 * 3600_000) }).returning();
  user = { ...user, id: u.id };
});
afterAll(async () => {
  await db().delete(schema.feedback).where(eq(schema.feedback.text, "Chci tmavý režim"));
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
});

describe("feedback", () => {
  it("asks the 0–10 question after a week, then not again for months", async () => {
    expect(await askNps(user.id)).toBe(true);
    await saveFeedback(user, { kind: "nps", score: 9, text: "", contact: false }, { locale: "cs", userAgent: "Mozilla/5.0 (iPhone) Safari/604.1" });
    expect(await askNps(user.id)).toBe(false);
    expect(mail[0].subject).toBe("[Kolbaba] NPS 9");
    expect(mail[0].replyTo).toBeUndefined();
  });

  it("keeps ideas and lets the team reply when the user agreed", async () => {
    await saveFeedback(user, { kind: "idea", text: "Chci tmavý režim", contact: true }, { locale: "cs", userAgent: null });
    const [row] = await db().select().from(schema.feedback).where(eq(schema.feedback.userId, user.id));
    expect(row).toMatchObject({ kind: "idea", text: "Chci tmavý režim", contact: true });
    expect(mail[0].replyTo).toBe(user.email);
    await expect(saveFeedback(user, { kind: "idea", text: "", contact: false }, { locale: "cs", userAgent: null })).rejects.toMatchObject({ status: 400 });
  });

  it("not for someone who just signed up", async () => {
    await db().update(schema.users).set({ createdAt: new Date() }).where(eq(schema.users.id, user.id));
    expect(await askNps(user.id)).toBe(false);
  });
});
