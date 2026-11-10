import { eq } from "drizzle-orm";
import { ACCOUNT_COLUMNS, db, schema } from "@/server/db";
import { env } from "@/server/env";
import { adapterFor, toAdapterAccount, type AccountRow } from "@/server/mail/adapters";
import { watchGmail } from "@/server/mail/gmail";
import { importHistoryStep, loadAccount, notifyNewMail, syncAccount } from "@/server/sync/engine";
import { processDueOutbox } from "@/server/sync/outbox";
import type { WorkerNudge } from "@/server/worker-client";
import { logWarn } from "@/server/log";

/** Gmail watches expire after 7 days; renew well before. */
const GMAIL_WATCH_RENEW_MS = 24 * 3600 * 1000;
/** Changes usually arrive in bursts (a message + its flags); one sync per burst is enough. */
const DEBOUNCE_MS = 1500;

interface Mailbox {
  id: string;
  /** Stops the IMAP IDLE connection. */
  stopWatch?: () => Promise<void>;
  /** Serialises syncs per mailbox. */
  running: Promise<void>;
  again: boolean;
  timer?: ReturnType<typeof setTimeout>;
  /** All older mail is in (as of the last sync), so the history round skips it without asking the database. */
  historyDone?: boolean;
}

/**
 * Owns one live entry per mailbox and makes sure syncs for the same mailbox never overlap.
 * IMAP mailboxes get an IDLE connection; Gmail relies on Pub/Sub push (or polling without it).
 */
export class Supervisor {
  private boxes = new Map<string, Mailbox>();

  get size() {
    return this.boxes.size;
  }

  /** Mailboxes start side by side, so one long import (a big Gmail) doesn't hold up the others. */
  async start() {
    const rows = await db().select(ACCOUNT_COLUMNS).from(schema.accounts);
    await Promise.all(
      rows.map((row) => this.add(row).catch((err) => logWarn(`[${row.id}] couldn't start`, err))),
    );
  }

  async stop() {
    await Promise.all([...this.boxes.values()].map((b) => b.stopWatch?.().catch(() => {})));
    this.boxes.clear();
  }

  async handleNudge(nudge: WorkerNudge) {
    switch (nudge.kind) {
      case "outbox":
        await processDueOutbox();
        break;
      case "sync":
        this.schedule(nudge.accountId, 0);
        break;
      case "account-added": {
        const row = await loadAccount(nudge.accountId);
        if (row) await this.add(row, { restart: true });
        break;
      }
      case "account-removed":
        await this.remove(nudge.accountId);
        break;
    }
  }

  /** Called by the Gmail webhook (via nudge) and the safety-net poll. */
  schedule(accountId: string, delay = DEBOUNCE_MS) {
    const box = this.boxes.get(accountId);
    if (!box) return;
    clearTimeout(box.timer);
    box.timer = setTimeout(() => void this.sync(box), delay);
  }

  syncAll() {
    for (const id of this.boxes.keys()) this.schedule(id, Math.random() * 30_000);
  }

  private async add(row: AccountRow, opts: { restart?: boolean } = {}) {
    if (this.boxes.has(row.id)) {
      if (!opts.restart) return;
      await this.remove(row.id);
    }
    const box: Mailbox = { id: row.id, running: Promise.resolve(), again: false };
    this.boxes.set(row.id, box);
    // First sync (the import for a new mailbox), then go live.
    await this.sync(box);
    await this.goLive(box);
  }

  private async remove(accountId: string) {
    const box = this.boxes.get(accountId);
    if (!box) return;
    clearTimeout(box.timer);
    this.boxes.delete(accountId);
    await box.stopWatch?.().catch(() => {});
  }

  private async goLive(box: Mailbox) {
    const row = await loadAccount(box.id);
    if (!row || row.status === "auth_error") return;
    try {
      if (row.provider === "imap") {
        const adapter = adapterFor(row);
        box.stopWatch = await adapter.watch!(() => this.schedule(box.id));
      } else {
        await this.ensureGmailWatch(row);
      }
    } catch (err) {
      logWarn(`[${box.id}] couldn't go live`, err);
    }
  }

  async ensureGmailWatch(row: AccountRow) {
    if (row.provider !== "gmail" || !env.googlePubsubTopic) return;
    const expires = row.syncState.watchExpiresAt ?? 0;
    if (expires - Date.now() > 6 * 24 * 3600 * 1000 - GMAIL_WATCH_RENEW_MS) return;
    const { expiration } = await watchGmail(toAdapterAccount(row));
    // Keep the sync cursor: the watch's historyId would skip changes since the last sync.
    await db()
      .update(schema.accounts)
      .set({ syncState: { ...row.syncState, watchExpiresAt: expiration } })
      .where(eq(schema.accounts.id, row.id));
  }

  /**
   * One history step (mail older than the first import) for the first mailbox that still has some,
   * queued behind that mailbox's syncs so the two never overlap and new mail isn't held up.
   */
  async importHistory() {
    for (const box of this.boxes.values()) {
      if (box.historyDone) continue;
      const row = await loadAccount(box.id);
      if (row?.syncState.historyComplete) box.historyDone = true;
      if (!row || row.syncState.historyComplete || !row.syncState.backfilledUntil || row.status === "auth_error") continue;
      const step = box.running.then(async () => {
        const fresh = await loadAccount(box.id);
        if (!fresh) return;
        box.historyDone = await importHistoryStep(fresh).catch((err) => {
          logWarn(`[${box.id}] history import failed`, err);
          return false;
        });
      });
      box.running = step;
      await step;
      return;
    }
  }

  async renewGmailWatches() {
    for (const id of this.boxes.keys()) {
      const row = await loadAccount(id);
      if (row) await this.ensureGmailWatch(row).catch((err) => logWarn(`[${id}] watch renewal failed`, err));
    }
  }

  private sync(box: Mailbox) {
    // A change during a running sync queues exactly one more run afterwards.
    if (box.again) return box.running;
    box.again = true;
    box.running = box.running.then(async () => {
      box.again = false;
      const row = await loadAccount(box.id);
      if (!row) return void this.remove(box.id);
      // A sync can take the history back up (a folder that showed up later), so each one refreshes this.
      box.historyDone = !!row.syncState.historyComplete;
      const wasBroken = row.status === "auth_error";
      try {
        const fresh = await syncAccount(row);
        if (fresh.length) await notifyNewMail(row, fresh);
        // A reconnected mailbox (new credentials) gets its live connection back.
        if (wasBroken && !box.stopWatch) await this.goLive(box);
      } catch (err) {
        logWarn(`[${box.id}] sync failed`, err);
      }
    });
    return box.running;
  }
}
