import { eq, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomToken, seal } from "../crypto";
import { db, schema } from "../db";
import type { MessageRef, RemoteMessage } from "./types";

const adapter = vi.hoisted(() => ({
  setFlags: vi.fn(async () => {}),
  move: vi.fn<(refs: MessageRef[], to: string) => Promise<void>>(async () => {}),
  createFolder: vi.fn<(name: string) => Promise<{ ref: string; state?: { uidValidity: string; uidNext: number } }>>(async (name) => ({
    ref: `INBOX.${name}`,
    state: { uidValidity: "77", uidNext: 1 },
  })),
  renameFolder: vi.fn<(ref: string, name: string) => Promise<string>>(async (_ref, name) => `INBOX.${name}`),
  deleteFolder: vi.fn<(ref: string) => Promise<void>>(async () => {}),
  moveToFolder: vi.fn<(refs: MessageRef[], ref: string, leave: string[]) => Promise<void>>(async () => {}),
  leaveFolders: vi.fn<(refs: MessageRef[], refs2: string[]) => Promise<void>>(async () => {}),
  close: vi.fn(async () => {}),
}));
vi.mock("./adapters", () => ({
  withAdapter: async (_row: unknown, fn: (a: typeof adapter) => Promise<unknown>) => fn(adapter),
  adapterFor: () => adapter,
}));
vi.mock("../push", () => ({ notifyUser: vi.fn(async () => {}), userLocale: async () => "en" }));

const { createFolder, deleteFolder, listFolders, syncOwnFolders, updateFolder } = await import("./folders");
const { listThreads, moveThread, moveToOwnFolder, snoozeThread } = await import("./service");
const { DbSyncSink } = await import("../sync/sink");

const DOMAIN = "folders-test.invalid";
let userId = "";
let imapId = "";
let gmailId = "";

const account = async (provider: "imap" | "gmail", email: string) => {
  const [a] = await db()
    .insert(schema.accounts)
    .values({ userId, provider, email, name: email, hue: 200, credentials: seal({ kind: "password", password: "x" }, "x"), status: "ok" })
    .returning();
  return a.id;
};

/** A conversation with one incoming message in Inbox and our own reply in Sent. */
async function conversation(accountId: string, gmail = false) {
  const [t] = await db()
    .insert(schema.threads)
    .values({ userId, accountId, providerThreadId: `<${randomToken(6)}@x>`, subject: "Faktura", lastMessageAt: new Date(), messageCount: 2, folder: "inbox" })
    .returning();
  const base = { userId, accountId, threadId: t.id, subject: "Faktura", date: new Date() };
  await db()
    .insert(schema.messages)
    .values([
      {
        ...base,
        providerMessageId: gmail ? `g${randomToken(4)}` : `INBOX:1:${randomToken(4)}`,
        from: { name: "Jana", email: `jana@${DOMAIN}` },
        messageIdHeader: `<${randomToken(6)}@x>`,
        labels: gmail ? ["INBOX", "role:inbox"] : ["role:inbox"],
        ...(gmail ? {} : { imapPath: "INBOX", imapUid: 1 }),
      },
      {
        ...base,
        providerMessageId: gmail ? `g${randomToken(4)}` : `Sent:1:${randomToken(4)}`,
        from: { name: "Me", email: `me@${DOMAIN}` },
        messageIdHeader: `<${randomToken(6)}@x>`,
        labels: gmail ? ["SENT", "role:sent"] : ["role:sent"],
        isOutgoing: true,
        ...(gmail ? {} : { imapPath: "Sent", imapUid: 1 }),
      },
    ]);
  return t.id;
}

const ids = async (folder: string) => (await listThreads(userId, { folder: folder as never })).threads.map((t) => t.id);

beforeEach(async () => {
  for (const fn of Object.values(adapter)) fn.mockClear();
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
  const [u] = await db().insert(schema.users).values({ email: `me@${DOMAIN}` }).returning();
  userId = u.id;
  imapId = await account("imap", `me@${DOMAIN}`);
  gmailId = await account("gmail", `me2@${DOMAIN}`);
});

afterAll(async () => {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
});

describe("own folders", () => {
  it("takes over what the providers have, one folder per name across mailboxes", async () => {
    await syncOwnFolders({ id: imapId, userId }, [{ ref: "INBOX.Projekty", name: "Projekty" }]);
    await syncOwnFolders({ id: gmailId, userId }, [
      { ref: "Label_1", name: "projekty" },
      { ref: "Label_2", name: "Podcast" },
    ]);
    const folders = await listFolders(userId);
    expect(folders.map((f) => f.name).sort()).toEqual(["Podcast", "Projekty"]);
    expect(folders.find((f) => f.name === "Projekty")!.accountIds.sort()).toEqual([gmailId, imapId].sort());

    // Gone at Gmail: unlinked there, but the folder stays.
    await syncOwnFolders({ id: gmailId, userId }, [{ ref: "Label_2", name: "Podcast" }]);
    expect((await listFolders(userId)).find((f) => f.name === "Projekty")!.accountIds).toEqual([imapId]);
  });

  it("files an IMAP conversation: the folder is made at the provider, our sent copy stays in Sent", async () => {
    const folder = await createFolder(userId, { name: "Faktury" });
    await expect(createFolder(userId, { name: "faktury" })).rejects.toMatchObject({ status: 409 });
    const threadId = await conversation(imapId);

    await moveToOwnFolder(userId, threadId, folder.id);
    expect(adapter.createFolder).toHaveBeenCalledWith("Faktury");
    const [refs] = adapter.moveToFolder.mock.calls[0];
    expect(refs.map((r) => r.imapPath)).toEqual(["INBOX"]);
    expect(adapter.moveToFolder.mock.calls[0][1]).toBe("INBOX.Faktury");
    // A brand-new folder is synced from its first message.
    const [acc] = await db().select().from(schema.accounts).where(eq(schema.accounts.id, imapId));
    expect(acc.syncState.folders?.["INBOX.Faktury"]).toEqual({ uidValidity: "77", uidNext: 1 });

    expect(await ids(`folder:${folder.id}`)).toEqual([threadId]);
    expect(await ids("inbox")).not.toContain(threadId);
    expect(await ids("archive")).not.toContain(threadId);

    // Second time the folder is already there.
    await moveToOwnFolder(userId, await conversation(imapId), folder.id);
    expect(adapter.createFolder).toHaveBeenCalledTimes(1);

    // Archiving it takes the copies in the folder (no role) along.
    await db().update(schema.messages).set({ labels: ["role:"], imapPath: "INBOX.Faktury" }).where(eq(schema.messages.threadId, threadId));
    await db().update(schema.messages).set({ labels: ["role:sent"], imapPath: "Sent" }).where(eq(schema.messages.isOutgoing, true));
    await moveThread(userId, threadId, "archive");
    expect(adapter.move.mock.calls.at(-1)![0].map((r) => r.imapPath)).toEqual(["INBOX.Faktury"]);
    expect(await ids("archive")).toContain(threadId);
    expect(await ids(`folder:${folder.id}`)).not.toContain(threadId);
  });

  it("labels a Gmail conversation, and takes the label off when it leaves", async () => {
    await syncOwnFolders({ id: gmailId, userId }, [{ ref: "Label_9", name: "Projekty" }]);
    const [folder] = await listFolders(userId);
    const threadId = await conversation(gmailId, true);

    await moveToOwnFolder(userId, threadId, folder.id);
    expect(adapter.createFolder).not.toHaveBeenCalled();
    expect(adapter.moveToFolder.mock.calls[0][0]).toHaveLength(2);
    expect(adapter.moveToFolder.mock.calls[0][1]).toBe("Label_9");
    const msgs = await db().select().from(schema.messages).where(eq(schema.messages.threadId, threadId));
    expect(msgs.every((m) => m.labels.includes("Label_9") && !m.labels.includes("INBOX"))).toBe(true);

    await moveThread(userId, threadId, "inbox");
    expect(adapter.leaveFolders).toHaveBeenCalledWith(expect.anything(), ["Label_9"]);
    expect(await ids("inbox")).toContain(threadId);
  });

  it("snoozed filed mail waits, then comes back in its folder (not Inbox), and counts as unread there", async () => {
    const folder = await createFolder(userId, { name: "Projekty" });
    const threadId = await conversation(imapId);
    await moveToOwnFolder(userId, threadId, folder.id);
    await db().update(schema.threads).set({ unread: true }).where(eq(schema.threads.id, threadId));
    expect((await listFolders(userId))[0].unread).toEqual({ [imapId]: 1 });
    // Read or not, it holds mail: its icon has papers in it.
    expect((await listFolders(userId))[0].count).toEqual({ [imapId]: 1 });

    adapter.move.mockClear();
    await snoozeThread(userId, threadId, new Date(Date.now() + 3600_000));
    expect(adapter.move).not.toHaveBeenCalled();
    expect(await ids(`folder:${folder.id}`)).toEqual([]);
    expect(await ids("snoozed")).toEqual([threadId]);
    expect(await ids("inbox")).not.toContain(threadId);
    expect((await listFolders(userId))[0].unread).toEqual({});
    expect((await listFolders(userId))[0].count).toEqual({});

    // Time's up (what the worker's wake-up does).
    await db().update(schema.threads).set({ snoozedUntil: null, wokeAt: new Date() }).where(eq(schema.threads.id, threadId));
    expect(await ids(`folder:${folder.id}`)).toEqual([threadId]);
    expect(await ids("inbox")).not.toContain(threadId);
  });

  it("a folder the provider fills itself gets a readable name, and renaming it stays in the app", async () => {
    // Taken over before such folders got a name of their own.
    await db().insert(schema.mailFolders).values({ userId, name: "newsletters", hue: 262, refs: { [imapId]: "newsletters" } });
    await syncOwnFolders({ id: imapId, userId }, [{ ref: "newsletters", name: "newsletters" }]);
    const [folder] = await listFolders(userId);
    expect(folder.name).toBe("Newsletters");

    await updateFolder(userId, folder.id, { name: "Hromadné" });
    expect(adapter.renameFolder).not.toHaveBeenCalled();
    await syncOwnFolders({ id: imapId, userId }, [{ ref: "newsletters", name: "newsletters" }]);
    expect((await listFolders(userId))[0].name).toBe("Hromadné");
  });

  it("made with one mailbox picked, it's made there right away", async () => {
    const folder = await createFolder(userId, { name: "Klienti", accountId: imapId });
    expect(adapter.createFolder).toHaveBeenCalledWith("Klienti");
    expect(folder.accountIds).toEqual([imapId]);
    // Someone else's mailbox id does nothing.
    const other = await createFolder(userId, { name: "Jinde", accountId: "acc_not_mine" });
    expect(other.accountIds).toEqual([]);
  });

  it("renames at the providers, and deleting puts its mail in Archive", async () => {
    const folder = await createFolder(userId, { name: "Staré" });
    const threadId = await conversation(imapId);
    await moveToOwnFolder(userId, threadId, folder.id);

    const renamed = await updateFolder(userId, folder.id, { name: "Starší", hue: 30 });
    expect(adapter.renameFolder).toHaveBeenCalledWith("INBOX.Staré", "Starší");
    expect(renamed).toMatchObject({ name: "Starší", hue: 30 });

    await deleteFolder(userId, folder.id);
    expect(adapter.deleteFolder).toHaveBeenCalledWith("INBOX.Starší");
    expect(await listFolders(userId)).toEqual([]);
    expect(await ids("archive")).toContain(threadId);
  });

  it("the sync files conversations by where their messages are", async () => {
    await syncOwnFolders({ id: imapId, userId }, [{ ref: "INBOX.Klienti", name: "Klienti" }]);
    const [folder] = await listFolders(userId);
    const sink = new DbSyncSink({ id: imapId, userId, email: `me@${DOMAIN}` }, false);
    const m: RemoteMessage = {
      providerMessageId: "INBOX.Klienti:5:1",
      imapPath: "INBOX.Klienti",
      imapUid: 1,
      messageIdHeader: `<${randomToken(6)}@x>`,
      references: [],
      from: { name: "Klient", email: `klient@${DOMAIN}` },
      to: [{ name: "Me", email: `me@${DOMAIN}` }],
      cc: [],
      bcc: [],
      replyTo: [],
      subject: "Nabídka",
      date: new Date(),
      snippet: "…",
      attachments: [],
      unread: true,
      pinned: false,
      role: null,
      labels: [],
    };
    await sink.upsertMessages([m]);
    const [thread] = await db().select().from(schema.threads).where(eq(schema.threads.subject, "Nabídka"));
    expect(thread.folderId).toBe(folder.id);
    expect(thread.folder).toBe("archive");
    expect(await ids(`folder:${folder.id}`)).toEqual([thread.id]);
  });

  it("mail that was here before its label was known moves into the folder, and out when the label goes", async () => {
    const threadId = await conversation(gmailId, true);
    await db()
      .update(schema.messages)
      .set({ labels: ["INBOX", "role:inbox", "Label_7"] })
      .where(eq(schema.messages.threadId, threadId));
    const sink = new DbSyncSink({ id: gmailId, userId, email: `me2@${DOMAIN}` }, false);

    await sink.syncOwnFolders([{ ref: "Label_7", name: "Letenky" }]);
    const [folder] = await listFolders(userId);
    expect(await ids(`folder:${folder.id}`)).toEqual([threadId]);
    const [acc] = await db().select().from(schema.accounts).where(eq(schema.accounts.id, gmailId));
    expect(acc.syncState.foldersFiled).toBe(true);

    await sink.syncOwnFolders([]);
    expect(await ids(`folder:${folder.id}`)).toEqual([]);
  });

  it("mailboxes connected before own folders file what's already there, once", async () => {
    await syncOwnFolders({ id: gmailId, userId }, [{ ref: "Label_8", name: "Porto" }]);
    const threadId = await conversation(gmailId, true);
    await db()
      .update(schema.messages)
      .set({ labels: ["role:archive", "Label_8"] })
      .where(eq(schema.messages.threadId, threadId));
    const [folder] = await listFolders(userId);
    expect(await ids(`folder:${folder.id}`)).toEqual([]);

    await new DbSyncSink({ id: gmailId, userId, email: `me2@${DOMAIN}` }, false).syncOwnFolders([{ ref: "Label_8", name: "Porto" }]);
    expect(await ids(`folder:${folder.id}`)).toEqual([threadId]);
  });

  it("an IMAP folder found after the history import has its older mail fetched too", async () => {
    await db().update(schema.accounts).set({ syncState: { historyComplete: true, foldersFiled: true } }).where(eq(schema.accounts.id, imapId));
    await new DbSyncSink({ id: imapId, userId, email: `me@${DOMAIN}` }, false).syncOwnFolders([{ ref: "Zakázky", name: "Zakázky" }]);
    const [acc] = await db().select().from(schema.accounts).where(eq(schema.accounts.id, imapId));
    expect(acc.syncState.historyComplete).toBe(false);
  });
});
