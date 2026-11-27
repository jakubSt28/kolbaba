import { afterEach, describe, expect, it, vi } from "vitest";
import { createImapAdapter } from "./imap";
import type { AdapterAccount } from "./types";

/** Stand-in for imapflow: a server with or without IDLE, where mail shows up on the next NOOP. */
const server = vi.hoisted(() => ({
  capabilities: [] as string[],
  noops: 0,
  /** Mail that came since the last NOOP: the next one reports it with EXISTS. */
  pending: false,
}));

vi.mock("imapflow", async () => {
  const { EventEmitter } = await import("node:events");
  class ImapFlow extends EventEmitter {
    capabilities = new Map(server.capabilities.map((c) => [c, true]));
    usable = true;
    async connect() {}
    async mailboxOpen() {}
    async noop() {
      server.noops++;
      if (server.pending) {
        server.pending = false;
        this.emit("exists", { path: "INBOX", count: 1, prevCount: 0 });
      }
    }
    async logout() {}
    close() {
      this.usable = false;
      this.emit("close");
    }
  }
  return { ImapFlow };
});

const account: AdapterAccount = {
  id: "acc_1",
  email: "me@example.com",
  fromName: "",
  provider: "imap",
  imap: { host: "imap.example.com", port: 993, secure: true },
  smtp: { host: "smtp.example.com", port: 465, secure: true },
  folders: {},
  credentials: { kind: "password", password: "x" },
  syncState: {},
  saveCredentials: async () => {},
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("ImapAdapter watch", () => {
  afterEach(() => {
    server.capabilities = [];
    server.noops = 0;
    server.pending = false;
  });

  it("asks a server without IDLE for new mail often", async () => {
    let changes = 0;
    const stop = await createImapAdapter(account, { pollEveryMs: 20 }).watch!(() => changes++);
    server.pending = true;
    await wait(1_300);
    expect(server.noops).toBeGreaterThan(1);
    expect(changes).toBe(1);
    await stop();
    const after = server.noops;
    await wait(100);
    expect(server.noops).toBe(after);
  });

  it("leaves a server with IDLE to tell us itself", async () => {
    server.capabilities = ["IDLE"];
    const stop = await createImapAdapter(account, { pollEveryMs: 20 }).watch!(() => {});
    await wait(200);
    expect(server.noops).toBe(0);
    await stop();
  });
});
