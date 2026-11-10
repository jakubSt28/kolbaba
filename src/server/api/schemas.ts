import { z } from "zod";

export const DraftBody = z.object({
  /** Client-generated id, so the UI can keep editing before the first save returns. */
  id: z.string().max(64).optional(),
  accountId: z.string(),
  threadId: z.string().nullable().optional(),
  to: z.string().max(5000).optional(),
  cc: z.string().max(5000).optional(),
  bcc: z.string().max(5000).optional(),
  subject: z.string().max(1000).optional(),
  html: z.string().max(2_000_000).optional(),
});

/** Changes to one conversation (PATCH /api/threads/[id]) or, with ids, to many (PATCH /api/threads). */
export const ThreadPatchBody = z.object({
  unread: z.boolean().optional(),
  pinned: z.boolean().optional(),
  folder: z.enum(["archive", "inbox", "trash", "spam"]).optional(),
  /** Into one of the user's own folders. */
  folderId: z.string().max(64).optional(),
  /** The app's own Undo of a change it just made: no new history line (src/server/history.ts). */
  undo: z.boolean().optional(),
  snoozedUntil: z.number().nullable().optional(),
  followUpAt: z.number().nullable().optional(),
  /** Mute: new replies skip Inbox and don't notify. */
  muted: z.boolean().optional(),
  /** "Not waiting" in No reply yet. */
  noReplyDismissed: z.boolean().optional(),
  /** "Notify me of replies": the next replies notify whatever the mailbox's setting and quiet hours. */
  watched: z.boolean().optional(),
});
export type ThreadPatchInput = z.infer<typeof ThreadPatchBody>;

export const ThreadIdsBody = z.object({
  ids: z.array(z.string().max(64)).min(1).max(500),
});

export const BulkThreadPatchBody = z.object({
  ids: z.array(z.string().max(64)).min(1).max(500),
  patch: ThreadPatchBody,
});

/** A rule for new mail (src/server/mail/rules.ts), as Settings' editor sends it. */
export const RuleBody = z.object({
  accountId: z.string().max(64).nullable().optional(),
  from: z.string().max(320).optional(),
  subject: z.string().max(200).optional(),
  action: z.enum(["folder", "archive", "trash", "inbox"]),
  folderId: z.string().max(64).nullable().optional(),
  markRead: z.boolean().optional(),
});
