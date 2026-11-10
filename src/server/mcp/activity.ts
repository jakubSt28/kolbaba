import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import type { Agent, AgentAction as ClientAction, AgentEvent, AgentSession, AgentStep, Draft } from "@/lib/types";
import { db, schema } from "../db";
import type { AgentAction, ThreadFolder } from "../db/schema";
import { HttpError } from "../http-error";
import { cancelSend, deleteDraft, moveThread, moveToOwnFolder, saveDraft, setFollowUp, setNote, setPinned, setUnread, snoozeThread } from "../mail/service";

/**
 * AI activity: every MCP tool call becomes an `agent_events` row inside a run (`agent_sessions`).
 * Runs are keyed by the Mcp-Session-Id when the client keeps one, and otherwise by agent and a
 * 30-minute quiet gap. A new `intent` starts a new run once the current one already has a title of
 * its own, so one long Claude Code session doing several tasks still reads as several runs.
 */

const RUN_GAP_MS = 30 * 60_000;
/** All of what's kept (worker/jobs.ts deletes older steps); the timeline says so at the top. */
const HISTORY_DAYS = 30;

/** Titles used until (unless) the agent tells us its intent. */
const GENERIC_TITLES: Record<AgentAction, string> = {
  search: "Searching mail",
  list: "Looking through mail",
  read: "Reading mail",
  draft: "Drafting mail",
  send: "Sending mail",
  schedule: "Scheduling mail",
  archive: "Inbox triage",
  move: "Inbox triage",
  mark_read: "Inbox triage",
  mark_unread: "Inbox triage",
  pin: "Inbox triage",
  snooze: "Inbox triage",
  label: "Inbox triage",
  trash: "Inbox triage",
  unsubscribe: "Inbox triage",
  remind: "Inbox triage",
  screen: "Inbox triage",
  note: "Taking notes",
};
const GENERIC = new Set(Object.values(GENERIC_TITLES));

export function cleanIntent(intent: string | null | undefined) {
  const s = (intent ?? "").replace(/[\u0000-\u001f\u007f*]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > 120 ? `${s.slice(0, 119).trimEnd()}…` : s;
}

/** Bold markers in summaries are `**…**`; asterisks inside the object would break the UI's split. */
export const bold = (s: string) => `**${s.replace(/\*/g, "").replace(/\s+/g, " ").trim() || "(no subject)"}**`;

export interface RunContext {
  userId: string;
  agentId: string;
  mcpSessionId: string | null;
}

async function resolveRun(ctx: RunContext, action: AgentAction, intent: string | null, now: Date) {
  const s = schema.agentSessions;
  const [last] = await db()
    .select()
    .from(s)
    .where(and(eq(s.agentId, ctx.agentId), ctx.mcpSessionId ? eq(s.mcpSessionId, ctx.mcpSessionId) : isNull(s.mcpSessionId)))
    .orderBy(desc(s.lastAt))
    .limit(1);

  const fresh = last && now.getTime() - last.lastAt.getTime() < RUN_GAP_MS;
  const newTask = last && intent && !GENERIC.has(last.title) && intent !== last.title;
  if (last && fresh && !newTask) {
    await db()
      .update(s)
      .set({ lastAt: now, ...(intent && GENERIC.has(last.title) ? { title: intent } : {}) })
      .where(eq(s.id, last.id));
    return last.id;
  }
  const [created] = await db()
    .insert(s)
    .values({ userId: ctx.userId, agentId: ctx.agentId, mcpSessionId: ctx.mcpSessionId, title: intent ?? GENERIC_TITLES[action], startedAt: now, lastAt: now })
    .returning({ id: s.id });
  return created.id;
}

export interface EventInput {
  action: AgentAction;
  summary: string;
  step?: AgentStep;
  accountId?: string | null;
  threadId?: string | null;
  /** What Undo needs; omit for read-only or irreversible steps. */
  undo?: UndoData | null;
}

export type UndoData =
  | {
      kind: "thread";
      folder?: ThreadFolder;
      /** The own folder it was in (filed mail goes back there). */
      folderId?: string | null;
      unread?: boolean;
      pinned?: boolean;
      snoozedUntil?: string | null;
      followUpAt?: string | null;
    }
  | { kind: "draft_created"; draftId: string }
  | { kind: "draft_updated"; draftId: string; previous: { to: string; cc: string; bcc: string; subject: string; html: string } }
  | { kind: "draft_deleted"; draft: { id: string; accountId: string; threadId: string | null; to: string; cc: string; bcc: string; subject: string; html: string } }
  | { kind: "outbox"; outboxId: string }
  | { kind: "note"; previous: string }
  /** A screener answer: what it was before (null: no decision yet), and the conversations it moved. */
  | { kind: "screen"; email: string; status: "allowed" | "blocked"; previous: "allowed" | "blocked" | null; threads: string[] };

export async function logEvent(ctx: RunContext, intent: string | null | undefined, e: EventInput) {
  const now = new Date();
  const sessionId = await resolveRun(ctx, e.action, cleanIntent(intent), now);
  const [row] = await db()
    .insert(schema.agentEvents)
    .values({
      userId: ctx.userId,
      sessionId,
      agentId: ctx.agentId,
      at: now,
      action: e.action,
      summary: e.summary.slice(0, 500),
      step: e.step ?? null,
      accountId: e.accountId ?? null,
      threadId: e.threadId ?? null,
      undo: (e.undo as Record<string, unknown> | null | undefined) ?? null,
    })
    .returning();
  await db().update(schema.agents).set({ lastActiveAt: now }).where(eq(schema.agents.id, ctx.agentId));
  return row;
}

/* ------------------------------- Client shapes ------------------------------ */

type AgentRow = typeof schema.agents.$inferSelect;
type EventRow = typeof schema.agentEvents.$inferSelect;

export function agentDto(a: AgentRow): Agent {
  return {
    id: a.id,
    name: a.name,
    app: a.app,
    logo: a.logo ?? "",
    permission: a.permission,
    accountIds: a.accountIds,
    enabled: a.enabled,
    lastActiveAt: (a.lastActiveAt ?? a.createdAt).getTime(),
  };
}

/** The activity UI knows fewer icons than we log actions; map the extras onto the closest one. */
const CLIENT_ACTION: Record<AgentAction, ClientAction> = {
  search: "search",
  list: "list",
  read: "read",
  draft: "draft",
  send: "send",
  schedule: "schedule",
  archive: "archive",
  move: "archive",
  label: "archive",
  mark_read: "mark_read",
  mark_unread: "mark_read",
  pin: "pin",
  snooze: "snooze",
  trash: "trash",
  unsubscribe: "unsubscribe",
  note: "note",
  remind: "snooze",
  screen: "screen",
};

function eventDto(e: EventRow, pendingOutbox: Set<string>): AgentEvent {
  const undo = e.undo as UndoData | null;
  const undoable = !!undo && (undo.kind !== "outbox" || pendingOutbox.has(undo.outboxId));
  return {
    id: e.id,
    sessionId: e.sessionId,
    at: e.at.getTime(),
    action: CLIENT_ACTION[e.action] ?? "read",
    summary: e.summary,
    ...(e.step ? { step: e.step } : {}),
    accountId: e.accountId ?? undefined,
    threadId: e.threadId ?? undefined,
    undoable: undoable || undefined,
    undone: e.undone || undefined,
  };
}

async function pendingOutboxIds(userId: string, events: EventRow[]) {
  const ids = events.map((e) => (e.undo as UndoData | null)).flatMap((u) => (u?.kind === "outbox" ? [u.outboxId] : []));
  if (!ids.length) return new Set<string>();
  const rows = await db()
    .select({ id: schema.outbox.id })
    .from(schema.outbox)
    .where(and(eq(schema.outbox.userId, userId), inArray(schema.outbox.id, ids), inArray(schema.outbox.status, ["pending", "failed"])));
  return new Set(rows.map((r) => r.id));
}

export async function activityFor(userId: string): Promise<{ agents: Agent[]; sessions: AgentSession[]; events: AgentEvent[] }> {
  const since = new Date(Date.now() - HISTORY_DAYS * 24 * 3600_000);
  const [agents, events] = await Promise.all([
    db().select().from(schema.agents).where(eq(schema.agents.userId, userId)).orderBy(desc(schema.agents.lastActiveAt)),
    db()
      .select()
      .from(schema.agentEvents)
      .where(and(eq(schema.agentEvents.userId, userId), gt(schema.agentEvents.at, since)))
      .orderBy(desc(schema.agentEvents.at))
      .limit(1000),
  ]);
  const sessionIds = [...new Set(events.map((e) => e.sessionId))];
  const sessions = sessionIds.length
    ? await db().select().from(schema.agentSessions).where(inArray(schema.agentSessions.id, sessionIds))
    : [];
  const pending = await pendingOutboxIds(userId, events);
  return {
    agents: agents.map(agentDto),
    sessions: sessions.map((s) => ({ id: s.id, agentId: s.agentId, title: s.title })),
    events: events.map((e) => eventDto(e, pending)),
  };
}

/* ----------------------------------- Undo ----------------------------------- */

export interface UndoResult {
  event: AgentEvent;
  /** Draft changes the client store should mirror. */
  draft?: { removed?: string; restored?: Draft };
}

const date = (iso: string | null | undefined) => (iso ? new Date(iso) : null);

/** Reverse one agent step through the normal data layer, so provider write-through applies as usual. */
export async function undoEvent(userId: string, eventId: string): Promise<UndoResult> {
  const ev = schema.agentEvents;
  const [row] = await db().select().from(ev).where(and(eq(ev.id, eventId), eq(ev.userId, userId)));
  if (!row) throw new HttpError(404, "That step no longer exists", "not_found");
  const undo = row.undo as UndoData | null;
  if (!undo) throw new HttpError(400, "This step can't be undone", "not_undoable");

  // Claim first so a double click can't run the reversal twice.
  const [claimed] = await db().update(ev).set({ undone: true }).where(and(eq(ev.id, eventId), eq(ev.undone, false))).returning();
  if (!claimed) throw new HttpError(409, "Already undone", "already_undone");

  let draft: UndoResult["draft"];
  try {
    draft = await reverse(userId, row, undo);
  } catch (err) {
    await db().update(ev).set({ undone: false }).where(eq(ev.id, eventId));
    throw err;
  }
  return { event: eventDto(claimed, new Set()), draft };
}

async function reverse(userId: string, row: EventRow, undo: UndoData): Promise<UndoResult["draft"]> {
  switch (undo.kind) {
    case "thread": {
      const id = row.threadId;
      if (!id) return;
      if (undo.folderId) {
        await moveToOwnFolder(userId, id, undo.folderId);
      } else if (undo.folder === "inbox" || undo.folder === "archive" || undo.folder === "trash" || undo.folder === "spam") {
        await moveThread(userId, id, undo.folder);
      }
      if (undo.unread !== undefined) await setUnread(userId, id, undo.unread);
      if (undo.pinned !== undefined) await setPinned(userId, id, undo.pinned);
      // Moving out of Inbox clears snooze and follow-up, so restore them after the move.
      if (undo.snoozedUntil !== undefined) await snoozeThread(userId, id, date(undo.snoozedUntil));
      if (undo.followUpAt !== undefined) await setFollowUp(userId, id, date(undo.followUpAt));
      return;
    }
    case "draft_created": {
      const removed = await deleteDraft(userId, undo.draftId);
      return removed ? { removed: removed.id } : undefined;
    }
    case "draft_updated": {
      const [d] = await db().select().from(schema.drafts).where(and(eq(schema.drafts.id, undo.draftId), eq(schema.drafts.userId, userId)));
      if (!d) throw new HttpError(409, "That draft is gone (sent or deleted)", "gone");
      const restored = await saveDraft(userId, { id: d.id, accountId: d.accountId, threadId: d.threadId, ...undo.previous });
      return { restored };
    }
    case "draft_deleted": {
      const restored = await saveDraft(userId, { ...undo.draft, agentId: row.agentId });
      return { restored };
    }
    case "outbox": {
      const restored = await cancelSend(userId, undo.outboxId);
      if (!restored) throw new HttpError(409, "Too late, it's already on its way", "already_sent");
      return { restored };
    }
    case "note": {
      if (row.threadId) await setNote(userId, row.threadId, undo.previous);
      return;
    }
    case "screen": {
      const where = and(eq(schema.senders.userId, userId), eq(schema.senders.email, undo.email));
      if (undo.previous) await db().update(schema.senders).set({ status: undo.previous }).where(where);
      else await db().delete(schema.senders).where(where);
      // Back to waiting for the user's own yes or no.
      for (const id of undo.threads) {
        if (undo.status === "blocked") await moveThread(userId, id, "inbox").catch(() => {});
        await db().update(schema.threads).set({ screening: !undo.previous }).where(and(eq(schema.threads.id, id), eq(schema.threads.userId, userId)));
      }
      return;
    }
  }
}
