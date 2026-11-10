import { randomUUID } from "node:crypto";
import MailComposer from "nodemailer/lib/mail-composer";
import { tk } from "@/lib/i18n";
import type { FolderRole, Person } from "../db/schema";
import { env } from "../env";
import { chunk, GmailApiError, GmailClient, mapLimit, UNITS, UPLOAD_BASE, type ClientOptions } from "./gmail/client";
import {
  decodeBase64Url,
  decodeMimeWords,
  extractBody,
  findPart,
  flagsFromLabels,
  mapMessage,
  type GmailMessage,
} from "./gmail/parse";
import {
  MailAuthError,
  type AdapterAccount,
  type FlagChange,
  type MailAdapter,
  type MessageRef,
  type OutgoingMessage,
  type RemoteDraft,
  type RemoteMessage,
  type SyncSink,
} from "./types";

/**
 * Gmail adapter over the REST API. Gmail is label-based: "folders" are system labels, archive means
 * "remove INBOX", and a message's role is derived from its full label set (see `roleFromLabels`).
 * Live updates arrive via Pub/Sub push (`watchGmail` + `parsePubsubPush`), not via `MailAdapter.watch`.
 */

/** Label ids for the engine's special folders; archive has no label in Gmail (= All Mail without INBOX). */
export const GMAIL_FOLDERS: Record<FolderRole, string> = {
  inbox: "INBOX",
  sent: "SENT",
  trash: "TRASH",
  spam: "SPAM",
  drafts: "DRAFT",
  archive: "",
};

/** Not imported: drafts belong to our own composer. (Trash and Spam are imported once by `importBins`.) */
const HIDDEN_LABELS = ["DRAFT"];
const CONCURRENCY = 10;
const UPSERT_BATCH = 50;
/** Own folders we take over from the user's labels; more than that is someone's archive scheme, not folders. */
const MAX_OWN_FOLDERS = 50;
/** Gmail's batchModify accepts at most 1000 ids. */
const MODIFY_BATCH = 1000;
/** history.list 404s once a historyId is older than about a week; we then re-import this far back. */
const RESYNC_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** JSON `raw` bodies are capped well below the 35 MB message limit; bigger mail goes through /upload. */
const MAX_JSON_RAW_BYTES = 4 * 1024 * 1024;

type HistoryRecord = {
  messagesAdded?: { message: { id: string } }[];
  messagesDeleted?: { message: { id: string } }[];
  labelsAdded?: { message: { id: string }; labelIds: string[] }[];
  labelsRemoved?: { message: { id: string }; labelIds: string[] }[];
};

const isHidden = (labels: string[] | undefined) => (labels ?? []).some((l) => HIDDEN_LABELS.includes(l));
const isNotFound = (error: unknown) => error instanceof GmailApiError && error.status === 404;

export function createGmailAdapter(account: AdapterAccount, options: ClientOptions = {}): MailAdapter {
  const client = new GmailClient(account, options);

  const getProfile = () =>
    client.request<{ emailAddress: string; historyId: string }>("/profile", { units: UNITS.getProfile });

  /** null when the message is gone (deleted between listing and fetching). */
  async function getMessage(id: string, format: "full" | "minimal"): Promise<GmailMessage | null> {
    try {
      return await client.request<GmailMessage>(`/messages/${id}`, { query: { format }, units: UNITS.messagesGet });
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  /** `format=full` costs the same quota as `metadata` and lets small messages open instantly. */
  async function fetchFull(ids: string[]): Promise<GmailMessage[]> {
    const messages = await mapLimit(ids, CONCURRENCY, (id) => getMessage(id, "full"));
    return messages.filter((m): m is GmailMessage => m !== null);
  }

  async function upsert(sink: SyncSink, messages: RemoteMessage[]) {
    for (const batch of chunk(messages, UPSERT_BATCH)) await sink.upsertMessages(batch);
  }

  /**
   * Imports everything newer than `since` (newest first, as Gmail lists it), page by page. With `before`
   * it continues an interrupted import; `onProgress` gets the oldest date reached after each batch.
   */
  async function importSince(sink: SyncSink, since: Date, opts: { before?: number; onProgress?: (oldest: number) => Promise<void> } = {}) {
    // before: is exclusive and second-precise, so a resumed import re-reads the last second (upserts are idempotent).
    const q = `after:${Math.floor(since.getTime() / 1000)}${opts.before ? ` before:${Math.floor(opts.before / 1000) + 1}` : ""}`;
    let pageToken: string | undefined;
    do {
      const page = await client.request<{ messages?: { id: string }[]; nextPageToken?: string }>("/messages", {
        query: { q, maxResults: 500, pageToken },
        units: UNITS.messagesList,
      });
      for (const ids of chunk((page.messages ?? []).map((m) => m.id), UPSERT_BATCH)) {
        const messages = await fetchFull(ids);
        await sink.upsertMessages(messages.filter((m) => !isHidden(m.labelIds)).map(mapMessage));
        const dates = messages.map((m) => Number(m.internalDate)).filter((d) => d > 0);
        if (dates.length && opts.onProgress) await opts.onProgress(Math.min(...dates));
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  }

  /** Trash and Spam: messages.list skips them unless asked, and Gmail empties both after 30 days, so they stay small. */
  async function importBins(sink: SyncSink) {
    let pageToken: string | undefined;
    do {
      const page = await client.request<{ messages?: { id: string }[]; nextPageToken?: string }>("/messages", {
        query: { q: "in:trash OR in:spam", includeSpamTrash: true, maxResults: 500, pageToken },
        units: UNITS.messagesList,
      });
      for (const ids of chunk((page.messages ?? []).map((m) => m.id), UPSERT_BATCH)) {
        const messages = await fetchFull(ids);
        await sink.upsertMessages(messages.filter((m) => !isHidden(m.labelIds)).map(mapMessage));
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    await sink.saveState({ binsImported: true });
  }

  /** Full re-import used when there's no usable history cursor. Deletions inside the gap are missed. */
  async function resync(sink: SyncSink) {
    const { historyId } = await getProfile();
    await importSince(sink, new Date(Date.now() - RESYNC_WINDOW_MS));
    await sink.saveState({ historyId });
  }

  type GmailLabel = { id: string; name: string; type: "system" | "user"; labelListVisibility?: string };

  /** The user's labels are their own folders: report them, so the app's folders match. */
  async function syncLabels(sink: SyncSink) {
    if (!sink.syncOwnFolders) return;
    const { labels = [] } = await client.request<{ labels?: GmailLabel[] }>("/labels", { units: UNITS.labelsList });
    const own = labels
      // "[Imap]/…" are other clients' stand-ins for system folders; hidden labels aren't meant as folders.
      // The app's own "Snoozed" label isn't a folder either.
      .filter((l) => l.type === "user" && !l.name.startsWith("[") && l.labelListVisibility !== "labelHide" && l.id !== account.syncState.snoozeLabelId)
      .slice(0, MAX_OWN_FOLDERS);
    await sink.syncOwnFolders(own.map((l) => ({ ref: l.id, name: l.name })));
  }

  /** A label by name: made now, or the one that's already there (made in Gmail, or a retry). */
  async function createLabel(name: string): Promise<string> {
    try {
      const label = await client.request<GmailLabel>("/labels", {
        method: "POST",
        json: { name, labelListVisibility: "labelShow", messageListVisibility: "show" },
        units: UNITS.labelsCreate,
      });
      return label.id;
    } catch (err) {
      if (!(err instanceof GmailApiError) || err.status !== 409) throw err;
      const { labels = [] } = await client.request<{ labels?: GmailLabel[] }>("/labels", { units: UNITS.labelsList });
      const found = labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
      if (!found) throw err;
      return found.id;
    }
  }

  async function modify(refs: MessageRef[], add: string[], remove: string[]) {
    if (!add.length && !remove.length) return;
    for (const ids of chunk(refs.map((r) => r.providerMessageId), MODIFY_BATCH)) {
      await client.request("/messages/batchModify", {
        method: "POST",
        json: { ids, addLabelIds: add, removeLabelIds: remove },
        units: UNITS.batchModify,
      });
    }
  }

  return {
    async verify() {
      const profile = await getProfile();
      if (profile.emailAddress.toLowerCase() !== account.email.toLowerCase()) {
        throw new MailAuthError(tk("Signed in to Google as {actual}, expected {expected}"), "invalid_credentials", {
          actual: profile.emailAddress,
          expected: account.email,
        });
      }
    },

    async initialSync(sink, { since }) {
      // Taken before listing (and kept across restarts) so anything that changes during the import is
      // replayed by incrementalSync.
      const resumeFrom = account.syncState.importedUntil;
      let loggedDay = "";
      const historyId = (resumeFrom && account.syncState.historyId) || (await getProfile()).historyId;
      if (!resumeFrom) await sink.saveState({ historyId });
      await sink.saveFolders?.(GMAIL_FOLDERS);
      await syncLabels(sink);
      await importSince(sink, since, {
        before: resumeFrom,
        onProgress: (oldest) => {
          const day = new Date(oldest).toISOString().slice(0, 10);
          if (day !== loggedDay) console.log(`[${account.id}] imported back to ${(loggedDay = day)}`);
          return sink.saveState({ importedUntil: oldest });
        },
      });
      await sink.saveState({ historyId, backfilledUntil: since.getTime(), importedUntil: undefined });
      await importBins(sink);
    },

    async incrementalSync(sink) {
      const startHistoryId = account.syncState.historyId;
      if (!startHistoryId) return resync(sink);
      // Labels first, so mail that just got one lands in that folder.
      await syncLabels(sink);

      const added = new Set<string>();
      const changed = new Set<string>();
      const deleted = new Set<string>();
      let latestHistoryId = startHistoryId;
      let pageToken: string | undefined;
      try {
        do {
          const page = await client.request<{ history?: HistoryRecord[]; nextPageToken?: string; historyId: string }>(
            "/history",
            {
              query: {
                startHistoryId,
                historyTypes: ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"],
                maxResults: 500,
                pageToken,
              },
              units: UNITS.historyList,
            },
          );
          for (const record of page.history ?? []) {
            for (const { message } of record.messagesAdded ?? []) added.add(message.id);
            for (const { message } of record.labelsAdded ?? []) changed.add(message.id);
            for (const { message, labelIds } of record.labelsRemoved ?? []) {
              // Leaving DRAFT can surface a message we never imported (a sent draft).
              if (isHidden(labelIds)) added.add(message.id);
              else changed.add(message.id);
            }
            for (const { message } of record.messagesDeleted ?? []) deleted.add(message.id);
          }
          latestHistoryId = page.historyId;
          pageToken = page.nextPageToken;
        } while (pageToken);
      } catch (error) {
        if (isNotFound(error)) return resync(sink);
        throw error;
      }

      // Re-read current labels instead of replaying deltas: order-independent and self-healing.
      const flagChanges: FlagChange[] = [];
      const toAdd = [...added].filter((id) => !deleted.has(id));
      const fetched = await fetchFull(toAdd);
      const fetchedIds = new Set(fetched.map((m) => m.id));
      toAdd.filter((id) => !fetchedIds.has(id)).forEach((id) => deleted.add(id));
      for (const message of fetched) {
        // Still a draft: it may already be stored (it was sent, then edited again), so update instead of import.
        if (isHidden(message.labelIds)) {
          flagChanges.push({ providerMessageId: message.id, ...flagsFromLabels(message.labelIds ?? []) });
        }
      }
      await upsert(sink, fetched.filter((m) => !isHidden(m.labelIds)).map(mapMessage));

      const toUpdate = [...changed].filter((id) => !deleted.has(id) && !added.has(id));
      const minimal = await mapLimit(toUpdate, CONCURRENCY, (id) => getMessage(id, "minimal"));
      minimal.forEach((message, i) => {
        if (!message) deleted.add(toUpdate[i]);
        else flagChanges.push({ providerMessageId: message.id, ...flagsFromLabels(message.labelIds ?? []) });
      });
      for (const batch of chunk(flagChanges, UPSERT_BATCH)) await sink.updateFlags(batch);
      if (deleted.size) await sink.removeMessages([...deleted]);
      await sink.saveState({ historyId: latestHistoryId });
      // Mailboxes connected before Trash and Spam showed up in the app.
      if (!account.syncState.binsImported && account.syncState.backfilledUntil) await importBins(sink);
    },

    async importOlder(sink, { limit }) {
      const cursor = account.syncState.olderBefore ?? account.syncState.backfilledUntil;
      if (!cursor) return false;
      // before: is exclusive and second-precise; re-reading the cursor's second keeps ties (upserts are idempotent).
      const second = Math.floor(cursor / 1000);
      const page = await client.request<{ messages?: { id: string }[] }>("/messages", {
        query: { q: `before:${second + 1} -in:drafts`, maxResults: Math.min(limit, 500) },
        units: UNITS.messagesList,
      });
      const ids = (page.messages ?? []).map((m) => m.id);
      if (!ids.length) return true;
      let oldest = cursor;
      for (const batch of chunk(ids, UPSERT_BATCH)) {
        const messages = await fetchFull(batch);
        await sink.upsertMessages(messages.filter((m) => !isHidden(m.labelIds)).map(mapMessage));
        for (const m of messages) oldest = Math.min(oldest, Number(m.internalDate) || oldest);
        await sink.saveState({ olderBefore: oldest });
      }
      // A whole page within the cursor's second would come back forever: step past that second.
      if (Math.floor(oldest / 1000) >= second) {
        if (ids.length < Math.min(limit, 500)) return true;
        await sink.saveState({ olderBefore: second * 1000 - 1 });
      }
      return false;
    },

    async fetchBody(ref) {
      const message = await client.request<GmailMessage>(`/messages/${ref.providerMessageId}`, {
        query: { format: "full" },
        units: UNITS.messagesGet,
      });
      return extractBody(message.payload);
    },

    async fetchAttachment(ref, attachmentId) {
      // Our attachment id is the MIME partId; Gmail's own attachmentId changes between fetches.
      const message = await client.request<GmailMessage>(`/messages/${ref.providerMessageId}`, {
        query: { format: "full" },
        units: UNITS.messagesGet,
      });
      const part = findPart(message.payload, attachmentId);
      if (!part) throw new GmailApiError(404, `Attachment ${attachmentId} not found in ${ref.providerMessageId}`);
      let data = part.body?.data ?? "";
      if (part.body?.attachmentId) {
        const res = await client.request<{ data: string }>(
          `/messages/${ref.providerMessageId}/attachments/${part.body.attachmentId}`,
          { units: UNITS.attachmentsGet },
        );
        data = res.data;
      }
      return {
        name: decodeMimeWords(part.filename ?? "") || "attachment",
        mime: part.mimeType || "application/octet-stream",
        content: decodeBase64Url(data),
      };
    },

    async setFlags(refs, { unread, pinned }) {
      const add: string[] = [];
      const remove: string[] = [];
      if (unread !== undefined) (unread ? add : remove).push("UNREAD");
      // Pinning a thread passes every message ref; Gmail shows the thread starred if any message is.
      if (pinned !== undefined) (pinned ? add : remove).push("STARRED");
      await modify(refs, add, remove);
    },

    async move(refs, to) {
      switch (to) {
        case "archive":
          // Also lifts SPAM/TRASH so "archive" from those folders lands in All Mail.
          return modify(refs, [], ["INBOX", "SPAM", "TRASH"]);
        case "inbox":
          return modify(refs, ["INBOX"], ["SPAM", "TRASH"]);
        case "spam":
          return modify(refs, ["SPAM"], ["INBOX"]);
        case "trash":
          // messages.trash (not a TRASH label) so Gmail applies its own trash semantics and 30-day purge.
          await mapLimit(refs, CONCURRENCY, (ref) =>
            client.request(`/messages/${ref.providerMessageId}/trash`, { method: "POST", units: UNITS.trash }),
          );
          return;
        default:
          throw new Error(`Gmail can't move messages to ${to}`);
      }
    },

    async createFolder(name) {
      return { ref: await createLabel(name) };
    },

    async labelSnoozed(refs, on, label) {
      let id = label.id;
      if (!id) {
        if (!on) return undefined;
        id = await createLabel(label.name);
      }
      try {
        await modify(refs, on ? [id] : [], on ? [] : [id]);
      } catch (err) {
        // Deleted in Gmail meanwhile: make it again (taking it off a label that's gone needs nothing).
        if (!(err instanceof GmailApiError) || err.status !== 400 || !on) {
          if (on) throw err;
          return id;
        }
        id = await createLabel(label.name);
        await modify(refs, [id], []);
      }
      return id;
    },

    async renameFolder(ref, name) {
      await client.request(`/labels/${ref}`, { method: "PATCH", json: { name }, units: UNITS.labelsPatch });
      return ref;
    },

    async deleteFolder(ref) {
      try {
        await client.request(`/labels/${ref}`, { method: "DELETE", units: UNITS.labelsDelete });
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
    },

    async moveToFolder(refs, ref, leave) {
      // A folder, not a tag: out of Inbox (and Spam, Trash, the other own folders) at the same time.
      await modify(refs, [ref], ["INBOX", "SPAM", "TRASH", ...leave.filter((l) => l !== ref)]);
    },

    async leaveFolders(refs, folderRefs) {
      await modify(refs, [], folderRefs);
    },

    async saveDraft(message, previous) {
      const { raw } = await buildMime(message);
      const threadId = message.providerThreadId ?? undefined;
      const write = (id: string | null) =>
        client.request<{ id: string; message: { id: string } }>(id ? `/drafts/${id}` : "/drafts", {
          method: id ? "PUT" : "POST",
          ...uploadOrJson({ ...(id ? { id } : {}), message: { threadId } }, raw, "message"),
          units: id ? UNITS.draftsUpdate : UNITS.draftsCreate,
        });
      let saved;
      try {
        saved = await write(previous ?? null);
      } catch (err) {
        // Deleted in Gmail meanwhile: start a new one.
        if (!(previous && err instanceof GmailApiError && err.status === 404)) throw err;
        saved = await write(null);
      }
      // Every edit is a new message under the same draft: its id is the version.
      return { ref: saved.id, version: saved.message.id };
    },

    async searchOlder(sink, query, limit) {
      // Gmail's own search, in the words the user typed; drafts stay out like everywhere else.
      const page = await client.request<{ messages?: { id: string }[] }>("/messages", {
        query: { q: `${query} -in:drafts`, maxResults: Math.min(limit, 100) },
        units: UNITS.messagesList,
      });
      const ids = (page.messages ?? []).map((m) => m.id);
      const known = sink.knownMessages ? await sink.knownMessages(ids) : new Set<string>();
      const fresh = ids.filter((id) => !known.has(id));
      if (!fresh.length) return 0;
      const messages = (await fetchFull(fresh)).filter((m) => !isHidden(m.labelIds));
      await upsert(sink, messages.map(mapMessage));
      return messages.length;
    },

    async listDrafts(known, limit) {
      const all: { id: string; message: { id: string; threadId: string } }[] = [];
      let pageToken: string | undefined;
      do {
        const page = await client.request<{ drafts?: typeof all; nextPageToken?: string }>("/drafts", {
          query: { maxResults: 100, pageToken },
          units: UNITS.draftsList,
        });
        all.push(...(page.drafts ?? []));
        pageToken = page.nextPageToken;
      } while (pageToken && all.length < 1000);
      const drafts = all.map((d) => ({ ref: d.id, version: d.message.id, messageIdHeader: null }));
      const changed: RemoteDraft[] = [];
      for (const d of all) {
        if (changed.length >= limit) break;
        if (known.get(d.id) === d.message.id) continue;
        const full = await client.request<{ id: string; message: GmailMessage }>(`/drafts/${d.id}`, {
          query: { format: "full" },
          units: UNITS.draftsGet,
        });
        const m = mapMessage(full.message);
        const body = extractBody(full.message.payload);
        changed.push({
          ref: d.id,
          version: d.message.id,
          messageIdHeader: m.messageIdHeader ?? null,
          message: { providerMessageId: d.message.id },
          providerThreadId: d.message.threadId,
          inReplyTo: m.inReplyTo ?? null,
          to: m.to,
          cc: m.cc,
          bcc: m.bcc,
          subject: m.subject,
          html: body.html,
          text: body.text,
          attachments: body.attachments.filter((a) => !a.inline),
        });
      }
      return { drafts, changed };
    },

    async deleteDraft(ref) {
      try {
        await client.request(`/drafts/${ref}`, { method: "DELETE", units: UNITS.draftsDelete });
      } catch (err) {
        if (!(err instanceof GmailApiError && err.status === 404)) throw err;
      }
    },

    async send(message) {
      const { raw, messageId } = await buildMime(message);
      const threadId = message.providerThreadId ?? undefined;
      let sent: { id: string; threadId: string };
      if (raw.length <= MAX_JSON_RAW_BYTES) {
        sent = await client.request("/messages/send", {
          method: "POST",
          json: { raw: raw.toString("base64url"), threadId },
          units: UNITS.send,
        });
      } else {
        const boundary = `kolbaba-${randomUUID()}`;
        const data = Buffer.concat([
          Buffer.from(
            `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ threadId })}\r\n` +
              `--${boundary}\r\nContent-Type: message/rfc822\r\n\r\n`,
          ),
          raw,
          Buffer.from(`\r\n--${boundary}--`),
        ]);
        sent = await client.request("/messages/send", {
          method: "POST",
          base: UPLOAD_BASE,
          query: { uploadType: "multipart" },
          body: { contentType: `multipart/related; boundary=${boundary}`, data },
          units: UNITS.send,
        });
      }
      return { messageIdHeader: messageId, providerMessageId: sent.id, providerThreadId: sent.threadId };
    },

    async signature() {
      const { sendAs = [] } = await client.request<{ sendAs?: { sendAsEmail: string; isPrimary?: boolean; isDefault?: boolean; signature?: string }[] }>(
        "/settings/sendAs",
        { units: UNITS.sendAsList },
      );
      const own = account.email.toLowerCase();
      const pick = sendAs.find((s) => s.sendAsEmail.toLowerCase() === own) ?? sendAs.find((s) => s.isDefault) ?? sendAs.find((s) => s.isPrimary);
      return pick?.signature?.trim() || null;
    },

    async close() {},
  };
}

/**
 * A message body for Gmail: `raw` inside the JSON while it's small, a multipart upload otherwise (the
 * JSON route is capped well below Gmail's 35 MB). `at` is where the raw message goes in the JSON:
 * top level for messages.send, under `message` for drafts.
 */
function uploadOrJson(meta: Record<string, unknown>, raw: Buffer, at: "message" | "top") {
  if (raw.length <= MAX_JSON_RAW_BYTES) {
    const encoded = raw.toString("base64url");
    return { json: at === "top" ? { ...meta, raw: encoded } : { ...meta, message: { ...(meta.message as object), raw: encoded } } };
  }
  const boundary = `kolbaba-${randomUUID()}`;
  const data = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` + `--${boundary}\r\nContent-Type: message/rfc822\r\n\r\n`,
    ),
    raw,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  return { base: UPLOAD_BASE, query: { uploadType: "multipart" }, body: { contentType: `multipart/related; boundary=${boundary}`, data } };
}

const toAddress = (p: Person) => ({ name: p.name, address: p.email });

/**
 * RFC 822 message for users.messages.send. Bcc stays in the headers on purpose: Gmail reads it to
 * deliver and strips it from what recipients see. Gmail files the result in Sent itself.
 */
export async function buildMime(message: OutgoingMessage): Promise<{ raw: Buffer; messageId: string }> {
  const domain = message.from.email.split("@")[1] || "localhost";
  const messageId = `<${randomUUID()}@${domain}>`;
  const node = new MailComposer({
    from: toAddress(message.from),
    to: message.to.map(toAddress),
    cc: message.cc.map(toAddress),
    bcc: message.bcc.map(toAddress),
    subject: message.subject,
    html: message.html,
    text: message.text,
    inReplyTo: message.inReplyTo ?? undefined,
    references: message.references?.length ? message.references : undefined,
    messageId,
    headers: message.headers,
    attachments: message.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
      cid: a.cid,
    })),
    ...(message.icalEvent ? { icalEvent: { method: message.icalEvent.method, content: message.icalEvent.content, filename: "invite.ics" } } : {}),
  }).compile();
  node.keepBcc = true;
  return { raw: await node.build(), messageId };
}

/**
 * Registers Pub/Sub push for the whole mailbox. No label filter: archive/read/star changes made in other
 * clients must reach us too, not just new INBOX mail. A watch expires after 7 days, so the worker renews
 * it daily and stores `expiration` as `syncState.watchExpiresAt`. The returned historyId is informational —
 * don't overwrite the sync cursor with it or changes since the last sync would be skipped.
 */
export async function watchGmail(account: AdapterAccount, options: ClientOptions = {}) {
  const topicName = env.googlePubsubTopic;
  if (!topicName) throw new Error("GOOGLE_PUBSUB_TOPIC is not set");
  const res = await new GmailClient(account, options).request<{ historyId: string; expiration: string }>("/watch", {
    method: "POST",
    json: { topicName },
    units: UNITS.watch,
  });
  return { historyId: res.historyId, expiration: Number(res.expiration) };
}

/** Stops push notifications (when the account is removed). */
export async function stopGmailWatch(account: AdapterAccount, options: ClientOptions = {}) {
  await new GmailClient(account, options).request("/stop", { method: "POST", units: UNITS.stop });
}

/**
 * Decodes a Pub/Sub push body (`{ message: { data: base64(JSON) }, subscription }`). Returns null for
 * anything malformed so the webhook can still answer 2xx — Pub/Sub would otherwise redeliver it forever.
 */
export function parsePubsubPush(body: unknown): { emailAddress: string; historyId: string } | null {
  const data = (body as { message?: { data?: unknown } } | null)?.message?.data;
  if (typeof data !== "string") return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64").toString("utf8")) as {
      emailAddress?: unknown;
      historyId?: unknown;
    };
    if (typeof payload.emailAddress !== "string") return null;
    if (typeof payload.historyId !== "string" && typeof payload.historyId !== "number") return null;
    return { emailAddress: payload.emailAddress.toLowerCase(), historyId: String(payload.historyId) };
  } catch {
    return null;
  }
}
