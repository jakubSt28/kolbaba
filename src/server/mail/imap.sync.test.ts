import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FolderRole, SyncState } from "../db/schema";
import { createImapAdapter, forgetRememberedFlags } from "./imap";
import { MailNotFoundError, type AdapterAccount, type FlagChange, type RemoteMessage, type SyncSink } from "./types";

/** In-memory stand-in for imapflow: one INBOX without CONDSTORE, plus empty Sent/Archive. */
const server = vi.hoisted(() => ({
  uidValidity: BigInt(2),
  uidNext: 4,
  messages: [] as { uid: number; flags: string[]; subject: string }[],
  /** RFC 9738 MESSAGELIMIT (Yahoo): answers past it are quietly cut off. */
  limit: undefined as number | undefined,
  /** Every SEARCH asked, in order. */
  searches: [] as { uid?: string; seq?: string }[],
}));

vi.mock("imapflow", async () => {
  const { EventEmitter } = await import("node:events");
  const raw = (subject: string) => Buffer.from(`Subject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nTělo ${subject}`);
  const inRange = (range: string, uid: number) =>
    range.split(",").some((part) => {
      const [a, b] = part.split(":");
      const lo = Number(a);
      const hi = b === undefined ? lo : b === "*" ? Infinity : Number(b);
      return uid >= Math.min(lo, hi) && uid <= Math.max(lo, hi);
    });

  class ImapFlow extends EventEmitter {
    enabled = new Set<string>();
    capabilities = new Map<string, boolean>(server.limit ? [[`MESSAGELIMIT=${server.limit}`, true]] : []);
    mailbox: unknown = false;
    private path = "";
    async connect() {}
    async logout() {}
    close() {}
    async list() {
      const box = (path: string, flags: string[]) => ({ path, name: path, delimiter: "/", flags: new Set(flags) });
      return [box("INBOX", []), box("Sent", ["\\Sent"]), box("Archive", ["\\Archive"])];
    }
    private box() {
      return this.path === "INBOX" ? server.messages : [];
    }
    async getMailboxLock(path: string) {
      this.path = path;
      const inbox = path === "INBOX";
      this.mailbox = { path, uidValidity: inbox ? server.uidValidity : BigInt(1), uidNext: inbox ? server.uidNext : 1, exists: this.box().length };
      return { path, release() {} };
    }
    async search(query: { uid?: string; seq?: string }) {
      server.searches.push(query);
      return this.box()
        .filter((m, i) => (!query.uid || inRange(query.uid, m.uid)) && (!query.seq || inRange(query.seq, i + 1)))
        .map((m) => m.uid)
        .slice(0, server.limit ?? Infinity);
    }
    private row(m: (typeof server.messages)[number], seq: number) {
      return {
        seq,
        uid: m.uid,
        size: 100,
        flags: new Set(m.flags),
        envelope: { subject: m.subject, from: [{ name: "A", address: "a@b.cz" }] },
        internalDate: new Date("2026-10-01T00:00:00Z"),
        bodyStructure: { type: "text/plain", encoding: "8bit" },
        source: raw(m.subject),
      };
    }
    async fetchAll(range: string, _query: unknown, options?: { uid?: boolean }) {
      return this.box()
        .map((m, i) => this.row(m, i + 1))
        .filter((r) => inRange(range, options?.uid ? r.uid : r.seq));
    }
    async fetchOne(uid: string, query: unknown) {
      return (await this.fetchAll(uid, query, { uid: true }))[0] ?? false;
    }
    async *fetch(range: string, query: unknown, options?: { uid?: boolean }) {
      for (const row of await this.fetchAll(range, query, options)) yield row;
    }
  }
  return { ImapFlow };
});

class Sink implements SyncSink {
  upserted: RemoteMessage[] = [];
  flags: FlagChange[] = [];
  removed: string[] = [];
  state: Partial<SyncState> = {};
  folders: Partial<Record<FolderRole, string>> = {};
  async upsertMessages(m: RemoteMessage[]) {
    this.upserted.push(...m);
  }
  async updateFlags(c: FlagChange[]) {
    this.flags.push(...c);
  }
  async removeMessages(ids: string[]) {
    this.removed.push(...ids);
  }
  async saveState(patch: Partial<SyncState>) {
    this.state = { ...this.state, ...patch };
  }
  async saveFolders(f: Partial<Record<FolderRole, string>>) {
    this.folders = f;
  }
}

/** The DB sink's shape: can drop a folder and list cached UIDs. */
class CacheSink extends Sink {
  forgotten: string[] = [];
  /** Folders whose UIDs were asked for. */
  asked: string[] = [];
  constructor(private known: Record<string, number[]>) {
    super();
  }
  async forgetFolder(path: string) {
    this.forgotten.push(path);
  }
  async knownUids(path: string) {
    this.asked.push(path);
    return this.known[path] ?? [];
  }
}

const account = (syncState: SyncState): AdapterAccount => ({
  id: "acc_1",
  email: "me@email.cz",
  fromName: "",
  provider: "imap",
  imap: { host: "imap.seznam.cz", port: 993, secure: true },
  smtp: { host: "smtp.seznam.cz", port: 465, secure: true },
  folders: {},
  credentials: { kind: "password", password: "x" },
  syncState,
  saveCredentials: async () => {},
});

describe("ImapAdapter incrementalSync (mocked server)", () => {
  beforeEach(() => {
    forgetRememberedFlags();
    server.uidValidity = BigInt(2);
    server.uidNext = 4;
    server.limit = undefined;
    server.searches = [];
    server.messages = [
      { uid: 1, flags: ["\\Seen"], subject: "jedna" },
      { uid: 3, flags: [], subject: "tři" },
    ];
  });

  it("drops old ids and re-imports when UIDVALIDITY changed", async () => {
    const sink = new Sink();
    await createImapAdapter(account({ folders: { INBOX: { uidValidity: "1", uidNext: 3 } } })).incrementalSync(sink);
    expect(sink.removed).toEqual(["INBOX:1:2", "INBOX:1:1"]);
    expect(sink.upserted.map((m) => m.providerMessageId)).toEqual(["INBOX:2:3", "INBOX:2:1"]);
    expect(sink.upserted[0]).toMatchObject({ text: "Tělo tři", snippet: "Tělo tři", unread: true, role: "inbox" });
    expect(sink.state.folders?.INBOX).toEqual({ uidValidity: "2", uidNext: 4, exists: 2 });
    expect(sink.folders).toEqual({ inbox: "INBOX", sent: "Sent", archive: "Archive" });
  });

  it("asks the sink to forget the folder when it can", async () => {
    const sink = new CacheSink({});
    await createImapAdapter(account({ folders: { INBOX: { uidValidity: "1", uidNext: 3 } } })).incrementalSync(sink);
    expect(sink.forgotten).toEqual(["INBOX"]);
    expect(sink.removed).toEqual([]);
    expect(sink.upserted.map((m) => m.providerMessageId)).toEqual(["INBOX:2:3", "INBOX:2:1"]);
  });

  it("without QRESYNC: detects deletions exactly from the sink's cached UIDs", async () => {
    // UID 2 is gone; UID 3 is new (≥ the saved UIDNEXT) and must not count as deleted.
    const sink = new CacheSink({ INBOX: [1, 2] });
    await createImapAdapter(account({ folders: { INBOX: { uidValidity: "2", uidNext: 3 } } })).incrementalSync(sink);
    expect(sink.removed).toEqual(["INBOX:2:2"]);
    expect(sink.upserted.map((m) => m.providerMessageId)).toEqual(["INBOX:2:3"]);

    server.messages = [];
    const emptied = new CacheSink({ INBOX: [1, 3] });
    await createImapAdapter(account({ folders: { INBOX: { uidValidity: "2", uidNext: 4 } } })).incrementalSync(emptied);
    expect(emptied.removed.sort()).toEqual(["INBOX:2:1", "INBOX:2:3"]);
  });

  it("a server that cuts answers off at its message limit doesn't make older mail look deleted", async () => {
    server.limit = 2;
    server.uidNext = 7;
    server.messages = [1, 2, 3, 4, 5, 6].map((uid) => ({ uid, flags: ["\\Seen"], subject: `m${uid}` }));
    const sink = new CacheSink({ INBOX: [1, 2, 3, 4, 5] });
    await createImapAdapter(account({ folders: { INBOX: { uidValidity: "2", uidNext: 6 } } })).incrementalSync(sink);
    expect(sink.removed).toEqual([]);
    expect(sink.upserted.map((m) => m.providerMessageId)).toEqual(["INBOX:2:6"]);
  });

  it("under a message limit, sparse UIDs are asked about per window of messages, not per window of UIDs", async () => {
    server.limit = 2;
    server.uidNext = 1_000_002;
    server.messages = [10, 500, 90_000, 1_000_000, 1_000_001].map((uid) => ({ uid, flags: [], subject: `m${uid}` }));
    const sink = new Sink();
    await createImapAdapter(account({})).initialSync(sink, { since: new Date("2026-09-01") });
    expect(sink.upserted.map((m) => m.imapUid)).toEqual([1_000_001, 1_000_000, 90_000, 500, 10]);
    expect(server.searches.map((q) => q.seq)).toEqual(["4:5", "2:3", "1:1"]);
  });

  it("throws MailNotFoundError for a vanished UID or a stale UIDVALIDITY", async () => {
    const adapter = createImapAdapter(account({}));
    await expect(adapter.fetchBody({ providerMessageId: "INBOX:2:2" })).rejects.toBeInstanceOf(MailNotFoundError);
    await expect(adapter.fetchBody({ providerMessageId: "INBOX:1:1" })).rejects.toBeInstanceOf(MailNotFoundError);
    await expect(adapter.fetchAttachment({ providerMessageId: "INBOX:2:2" }, "2")).rejects.toBeInstanceOf(MailNotFoundError);
    await expect(adapter.fetchBody({ providerMessageId: "INBOX:2:1" })).resolves.toMatchObject({ text: "Tělo jedna" });
  });

  it("without CONDSTORE: imports new UIDs, re-checks flags and detects expunges", async () => {
    const sink = new Sink();
    await createImapAdapter(account({ folders: { INBOX: { uidValidity: "2", uidNext: 3 } } })).incrementalSync(sink);
    expect(sink.upserted.map((m) => m.providerMessageId)).toEqual(["INBOX:2:3"]);
    expect(sink.flags).toEqual([{ providerMessageId: "INBOX:2:1", imapPath: "INBOX", imapUid: 1, unread: false, pinned: false }]);
    expect(sink.removed).toEqual(["INBOX:2:2"]);
    expect(sink.state.folders?.INBOX).toMatchObject({ uidValidity: "2", uidNext: 4, exists: 2 });
  });

  it("without QRESYNC: asks which messages are left only when the count says something went", async () => {
    const sync = async (known: number[], folders: SyncState["folders"]) => {
      const sink = new CacheSink({ INBOX: known });
      await createImapAdapter(account({ folders })).incrementalSync(sink);
      return sink;
    };
    // No count kept yet: asked once, and the count is kept.
    const first = await sync([1, 3], { INBOX: { uidValidity: "2", uidNext: 4 } });
    expect(first.asked).toContain("INBOX");
    expect(first.state.folders?.INBOX).toMatchObject({ exists: 2 });

    // Same count, then new mail on top: nothing to ask.
    const same = await sync([1, 3], first.state.folders);
    expect(same.asked).not.toContain("INBOX");
    server.messages.push({ uid: 4, flags: [], subject: "čtyři" });
    server.uidNext = 5;
    const arrived = await sync([1, 3], same.state.folders);
    expect(arrived.asked).not.toContain("INBOX");
    expect(arrived.upserted.map((m) => m.providerMessageId)).toEqual(["INBOX:2:4"]);

    // One went away: the count gives it away, and it's found.
    server.messages = server.messages.filter((m) => m.uid !== 1);
    const deleted = await sync([1, 3, 4], arrived.state.folders);
    expect(deleted.asked).toContain("INBOX");
    expect(deleted.removed).toEqual(["INBOX:2:1"]);

    // A day later it's asked even when the count adds up.
    const stale = { INBOX: { ...deleted.state.folders!.INBOX, expungeCheckedAt: Date.now() - 25 * 3600_000 } };
    expect((await sync([3, 4], stale)).asked).toContain("INBOX");
  });

  it("without CONDSTORE: only flags that changed go to the database, and all of them again after an hour", async () => {
    let folders: SyncState["folders"] = { INBOX: { uidValidity: "2", uidNext: 4 } };
    const sync = async () => {
      const sink = new Sink();
      await createImapAdapter(account({ folders })).incrementalSync(sink);
      folders = sink.state.folders;
      return sink.flags.map((f) => `${f.imapUid}:${f.unread ? "unread" : "read"}`);
    };
    expect(await sync()).toEqual(["1:read", "3:unread"]);
    expect(await sync()).toEqual([]);
    server.messages[1].flags = ["\\Seen"];
    expect(await sync()).toEqual(["3:read"]);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 3600_000 + 1);
      expect(await sync()).toEqual(["1:read", "3:read"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
