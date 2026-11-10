import { withUser } from "@/server/auth/session";
import { BulkThreadPatchBody, ThreadIdsBody } from "@/server/api/schemas";
import { parseBody } from "@/server/api/validate";
import { HttpError } from "@/server/http-error";
import { patchWithHistory, recordHistory, snapshotThreads } from "@/server/history";
import { deleteThreadsForever, emptyBin, listThreads, type ListFolder } from "@/server/mail/service";
import { noteFiling } from "@/server/mail/rules";
import { logWarn } from "@/server/log";

/** A bulk change works through the selection one conversation at a time. */
export const maxDuration = 300;

const FOLDERS: ListFolder[] = ["inbox", "pinned", "snoozed", "scheduled", "sent", "archive", "trash", "spam", "drafts", "orders", "travel", "invoices", "subscriptions", "security", "replies", "screener", "unanswered"];

export const GET = withUser(async (user, req) => {
  const p = new URL(req.url).searchParams;
  const asked = p.get("folder") ?? "";
  // One of the user's own folders ("folder:fld_…"), or a built-in view.
  const folder = /^folder:[\w-]{1,64}$/.test(asked) ? (asked as ListFolder) : (FOLDERS.find((f) => f === asked) ?? "inbox");
  const result = await listThreads(user.id, {
    folder,
    // A category view groups emails into cards, so it needs more of them at once.
    ...(["orders", "travel", "invoices", "subscriptions", "security", "replies"].includes(folder) && !p.get("limit") ? { limit: 200 } : {}),
    scope: p.get("scope") ?? "all",
    query: p.get("q") ?? undefined,
    unreadOnly: p.get("unread") === "1",
    cursor: p.get("cursor") ?? undefined,
    limit: Number(p.get("limit")) || undefined,
  });
  return Response.json(result);
});

/**
 * Multi-select (and every move into a folder): the same change for many conversations. `failed` lists
 * the ones to revert; filing the same sender's mail by hand a few times brings a `suggestion` for a rule.
 */
export const PATCH = withUser(async (user, req) => {
  const { ids, patch } = await parseBody(req, BulkThreadPatchBody);
  const failed = await patchWithHistory(user.id, ids, patch);
  const filed = patch.folderId && !patch.undo ? ids.filter((id) => !failed.includes(id)) : [];
  const suggestion = filed.length ? await noteFiling(user.id, filed, patch.folderId!).catch((err) => (logWarn("[rules] hint", err), null)) : null;
  return Response.json({ ok: failed.length === 0, failed, ...(suggestion ? { suggestion } : {}) });
});

/**
 * Delete for good. `?folder=trash|spam&scope=…` empties that folder (Gmail mailboxes are skipped: Gmail
 * empties them itself); a body `{ ids }` deletes those conversations (multi-select).
 */
export const DELETE = withUser(async (user, req) => {
  const p = new URL(req.url).searchParams;
  const folder = p.get("folder");
  if (folder !== null) {
    if (folder !== "trash" && folder !== "spam") throw new HttpError(400, "Only Trash and Spam can be emptied", "invalid_folder");
    const deleted = await emptyBin(user.id, folder, p.get("scope") ?? "all");
    await recordHistory(user.id, { kind: "emptied", data: { bin: folder } }, [], { undoable: false, count: deleted });
    return Response.json({ ok: true, deleted });
  }
  const { ids } = await parseBody(req, ThreadIdsBody);
  const before = await snapshotThreads(user.id, ids);
  const failed = await deleteThreadsForever(user.id, ids);
  await recordHistory(user.id, { kind: "deleted_forever" }, before.filter((s) => !failed.includes(s.id)), { undoable: false });
  return Response.json({ ok: failed.length === 0, failed });
});
