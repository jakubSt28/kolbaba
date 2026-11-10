import { eq, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomToken, seal } from "../crypto";
import { db, schema } from "../db";

vi.mock("./adapters", () => ({ withAdapter: vi.fn(), adapterFor: vi.fn() }));

const { removeAccount } = await import("./service");

const DOMAIN = "disconnect-test.invalid";
let userId = "";
let agentId = "";

async function mailbox(local: string) {
  const [a] = await db()
    .insert(schema.accounts)
    .values({ userId, provider: "imap", email: `${local}@${DOMAIN}`, name: local, hue: 200, credentials: seal({ kind: "password", password: "x" }, "x"), status: "ok" })
    .returning();
  const [t] = await db()
    .insert(schema.threads)
    .values({ userId, accountId: a.id, providerThreadId: `<${randomToken(6)}@x>`, subject: `Hello from ${local}`, lastMessageAt: new Date(), messageCount: 1, folder: "inbox" })
    .returning();
  return { accountId: a.id, threadId: t.id };
}

async function run(title: string, ...accountIds: string[]) {
  const [s] = await db().insert(schema.agentSessions).values({ userId, agentId, title }).returning();
  for (const accountId of accountIds) await db().insert(schema.agentEvents).values({ userId, sessionId: s.id, agentId, accountId, action: "archive", summary: "Archived" });
  return s.id;
}

beforeEach(async () => {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
  const [u] = await db().insert(schema.users).values({ email: `me@${DOMAIN}` }).returning();
  userId = u.id;
  const clientId = `client-${randomToken(6)}`;
  await db().insert(schema.oauthClients).values({ id: clientId, redirectUris: ["https://example.invalid/cb"] });
  const [agent] = await db().insert(schema.agents).values({ userId, clientId, name: "Claude", app: "Claude" }).returning();
  agentId = agent.id;
});
afterAll(async () => {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
});

describe("disconnecting a mailbox", () => {
  it("takes its My history and the agent runs that only touched it", async () => {
    const work = await mailbox("work");
    const home = await mailbox("home");
    await db()
      .insert(schema.history)
      .values([
        { userId, kind: "archived", threadIds: [work.threadId], subject: "Hello from work" },
        { userId, kind: "archived", threadIds: [home.threadId], subject: "Hello from home" },
      ]);
    const onlyWork = await run("Tidy my work mail", work.accountId);
    const both = await run("Tidy everything", work.accountId, home.accountId);

    await removeAccount(userId, work.accountId);

    const history = await db().select({ subject: schema.history.subject }).from(schema.history).where(eq(schema.history.userId, userId));
    expect(history).toEqual([{ subject: "Hello from home" }]);
    const runs = await db().select({ id: schema.agentSessions.id }).from(schema.agentSessions).where(eq(schema.agentSessions.userId, userId));
    expect(runs.map((r) => r.id)).toEqual([both]);
    expect(runs.map((r) => r.id)).not.toContain(onlyWork);
    const events = await db().select({ accountId: schema.agentEvents.accountId }).from(schema.agentEvents).where(eq(schema.agentEvents.userId, userId));
    expect(events).toEqual([{ accountId: home.accountId }]);
  });

  it("takes the folders only it had, and unlinks it from the shared ones", async () => {
    const work = await mailbox("work");
    const home = await mailbox("home");
    await db()
      .insert(schema.mailFolders)
      .values([
        { userId, name: "Kalendář", hue: 1, refs: { [work.accountId]: "Kalendář" } },
        { userId, name: "Newsletters", hue: 2, refs: { [work.accountId]: "newsletters", [home.accountId]: "newsletters" } },
        { userId, name: "Projekty", hue: 3, refs: {} },
      ]);

    await removeAccount(userId, work.accountId);

    const folders = await db().select({ name: schema.mailFolders.name, refs: schema.mailFolders.refs }).from(schema.mailFolders).where(eq(schema.mailFolders.userId, userId));
    expect(folders.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: "Newsletters", refs: { [home.accountId]: "newsletters" } },
      { name: "Projekty", refs: {} },
    ]);
  });
});

describe("deleting the account", () => {
  it("takes the feedback with it", async () => {
    await db().insert(schema.feedback).values({ userId, kind: "idea", text: "More stamps" });
    await db().delete(schema.users).where(eq(schema.users.id, userId));
    expect(await db().select().from(schema.feedback).where(eq(schema.feedback.text, "More stamps"))).toEqual([]);
  });
});
