import { eq, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seal } from "../crypto";
import { db, schema } from "../db";
import type { ListedDraft, RemoteDraft } from "../mail/types";

const provider = vi.hoisted(() => ({ drafts: [] as RemoteDraft[] }));
const adapter = vi.hoisted(() => ({
  listDrafts: vi.fn(async (known: Map<string, string>, limit: number) => ({
    drafts: provider.drafts.map(({ ref, version, messageIdHeader }): ListedDraft => ({ ref, version, messageIdHeader })),
    changed: provider.drafts.filter((d) => known.get(d.ref) !== d.version).slice(0, limit),
  })),
  fetchAttachment: vi.fn(async () => ({ name: "nabidka.pdf", mime: "application/pdf", content: Buffer.from("%PDF") })),
  close: vi.fn(async () => {}),
}));
vi.mock("../mail/adapters", () => ({
  withAdapter: async (_row: unknown, fn: (a: typeof adapter) => Promise<unknown>) => fn(adapter),
  adapterFor: () => adapter,
}));

const { draftToEditorHtml, importDrafts } = await import("./draft-import");

const DOMAIN = "draft-import-test.invalid";
let userId = "";
let account: typeof schema.accounts.$inferSelect;

const remote = (over: Partial<RemoteDraft> = {}): RemoteDraft => ({
  ref: "r-1",
  version: "m-1",
  messageIdHeader: "<d1@x>",
  message: { providerMessageId: "m-1" },
  providerThreadId: null,
  inReplyTo: null,
  to: [{ name: "Petr", email: "petr@example.com" }],
  cc: [],
  bcc: [],
  subject: "Nabídka",
  html: '<div dir="ltr">Ahoj Petře,<div><br></div><div>posílám nabídku.</div><div class="gmail_signature">Daniel</div></div>',
  text: null,
  attachments: [],
  ...over,
});

const drafts = () => db().select().from(schema.drafts).where(eq(schema.drafts.accountId, account.id));

beforeEach(async () => {
  provider.drafts = [];
  adapter.fetchAttachment.mockClear();
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
  const [u] = await db().insert(schema.users).values({ email: `me@${DOMAIN}` }).returning();
  userId = u.id;
  [account] = await db()
    .insert(schema.accounts)
    .values({ userId, provider: "gmail", email: `me@${DOMAIN}`, name: "Me", hue: 200, credentials: seal({ kind: "password", password: "x" }, "x"), status: "ok" })
    .returning();
});

afterAll(async () => {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
});

describe("drafts from other clients", () => {
  it("a draft started elsewhere comes in, without the other client's signature, files included", async () => {
    provider.drafts = [remote({ attachments: [{ id: "2", name: "nabidka.pdf", size: 4, mime: "application/pdf" }] })];
    await importDrafts(account);
    const [d] = await drafts();
    expect(d).toMatchObject({ to: "Petr <petr@example.com>", subject: "Nabídka", providerDraftId: "r-1", providerVersion: "m-1" });
    expect(d.html).not.toContain("Daniel");
    expect(d.html).toContain("posílám nabídku.");
    // Already matches the provider: the mirror has nothing to write back.
    expect(d.providerSyncedAt?.getTime()).toBe(d.updatedAt.getTime());
    const files = await db().select().from(schema.draftAttachments).where(eq(schema.draftAttachments.draftId, d.id));
    expect(files.map((f) => f.name)).toEqual(["nabidka.pdf"]);

    // Nothing new: nothing fetched again.
    await importDrafts(account);
    expect(adapter.fetchAttachment).toHaveBeenCalledTimes(1);
    expect(await drafts()).toHaveLength(1);
  });

  it("follows a change made elsewhere, unless it was edited here since", async () => {
    provider.drafts = [remote()];
    await importDrafts(account);
    provider.drafts = [remote({ version: "m-2", subject: "Nabídka v2" })];
    await importDrafts(account);
    expect((await drafts())[0].subject).toBe("Nabídka v2");

    const [d] = await drafts();
    await db().update(schema.drafts).set({ subject: "Moje verze", updatedAt: new Date(Date.now() + 1000) }).where(eq(schema.drafts.id, d.id));
    provider.drafts = [remote({ version: "m-3", subject: "Jejich verze" })];
    await importDrafts(account);
    expect((await drafts())[0].subject).toBe("Moje verze");
  });

  it("sent or discarded elsewhere: it goes here too, but not right after syncing or when edited here", async () => {
    provider.drafts = [remote()];
    await importDrafts(account);
    provider.drafts = [];
    await importDrafts(account);
    expect(await drafts()).toHaveLength(1); // just synced: maybe not listed yet

    const [d] = await drafts();
    const old = new Date(Date.now() - 10 * 60_000);
    await db().update(schema.drafts).set({ updatedAt: old, providerSyncedAt: old }).where(eq(schema.drafts.id, d.id));
    await importDrafts(account);
    expect(await drafts()).toHaveLength(0);
  });

  it("a copy mirrored before versions were kept is only recognised, not overwritten", async () => {
    const old = new Date(Date.now() - 10 * 60_000);
    await db()
      .insert(schema.drafts)
      .values({ userId, accountId: account.id, subject: "Psáno tady", html: "<p>Moje</p>", providerDraftId: "r-1", updatedAt: old, providerSyncedAt: old });
    provider.drafts = [remote({ subject: "Kopie u Googlu" })];
    await importDrafts(account);
    expect((await drafts())[0]).toMatchObject({ subject: "Psáno tady", providerVersion: "m-1" });
  });

  it("turns other clients' HTML into what the editor knows", () => {
    expect(draftToEditorHtml('<div>Ahoj <b>tučně</b> <a href="javascript:alert(1)">x</a><blockquote type="cite">citace</blockquote><script>x</script></div>', null)).toBe(
      "<p>Ahoj <b>tučně</b> <a>x</a></p>",
    );
    expect(draftToEditorHtml(null, "Řádek 1\nřádek 2\n\n<Odstavec>")).toBe("<p>Řádek 1<br>řádek 2</p><p>&lt;Odstavec&gt;</p>");
  });
});
