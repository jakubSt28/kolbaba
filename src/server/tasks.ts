import { and, count, desc, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { tk } from "@/lib/i18n";
import { cleanRule } from "@/lib/tasks/repeat";
import { LIST_ID, TASK_ID, TRASH_DAYS, type Priority, type Task, type TaskList, type TasksPage } from "@/lib/tasks/types";
import { db, schema } from "./db";
import { HttpError } from "./http-error";
import { cleanSignatureHtml } from "./mail/email-html";

/**
 * Tasks: the user's own to-do list. All of it is here (no provider), so the app gets every open
 * task, what's in Trash and the lists at once, and the completed tasks newest first, a page at a time.
 */

/** Open tasks and Trash together; past this the app asks to clear some first. */
export const MAX_TASKS = 5000;
const MAX_LISTS = 300;
/** Completed tasks per page. */
const DONE_PAGE = 200;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const fields = {
  title: z.string().max(500, { error: tk("That title is a little long") }).transform((s) => s.replace(/\s+/g, " ").trim()),
  notes: z.string().max(200_000),
  priority: z.number().int().min(0).max(3).transform((n) => n as Priority),
  due: day.nullable(),
  time: clock.nullable(),
  order: z.number().finite(),
  listId: z.string().regex(LIST_ID).nullable(),
  repeat: z
    .string()
    .max(200)
    .nullable()
    .transform((r) => cleanRule(r)),
};

export const TaskBody = z.object({ id: z.string().regex(TASK_ID), ...fields, listId: fields.listId.default(null), repeat: fields.repeat.default(null) });

export const TaskPatchBody = z
  .object({ ...fields, completed: z.boolean(), deleted: z.boolean(), doneId: z.string().regex(TASK_ID) })
  .partial()
  // A time belongs to a day.
  .refine((p) => !(p.due === null && p.time), { error: tk("A time needs a day") });

type Row = typeof schema.tasks.$inferSelect;

export const toTask = (r: Row): Task => ({
  id: r.id,
  title: r.title,
  notes: r.notes,
  priority: r.priority,
  due: r.due,
  time: r.due ? r.time : null,
  completedAt: r.completedAt?.getTime() ?? null,
  deletedAt: r.deletedAt?.getTime() ?? null,
  order: r.sortOrder,
  createdAt: r.createdAt.getTime(),
  listId: r.listId,
  repeat: r.repeat,
});

const toList = (r: typeof schema.taskLists.$inferSelect): TaskList => ({ id: r.id, kind: r.kind, name: r.name, emoji: r.emoji, folderId: r.folderId, order: r.sortOrder });

const mine = (userId: string, id: string) => and(eq(schema.tasks.userId, userId), eq(schema.tasks.id, id));

/** Open tasks and Trash: what counts against MAX_TASKS. */
export async function countLiveTasks(userId: string) {
  const t = schema.tasks;
  const [{ n }] = await db()
    .select({ n: count() })
    .from(t)
    .where(and(eq(t.userId, userId), or(isNull(t.completedAt), isNotNull(t.deletedAt))));
  return n;
}

export async function listTaskLists(userId: string): Promise<TaskList[]> {
  const rows = await db().select().from(schema.taskLists).where(eq(schema.taskLists.userId, userId));
  return rows.map(toList).sort((a, b) => a.order - b.order);
}

/** Every open task, what's in Trash and the lists, with the latest completed; or, with `completedBefore` (ms), the completed ones before it. */
export async function listTasks(userId: string, completedBefore?: number): Promise<TasksPage> {
  const t = schema.tasks;
  const done = (before?: Date) =>
    db()
      .select()
      .from(t)
      .where(and(eq(t.userId, userId), isNotNull(t.completedAt), isNull(t.deletedAt), before ? lt(t.completedAt, before) : undefined))
      .orderBy(desc(t.completedAt))
      .limit(DONE_PAGE + 1);

  if (completedBefore !== undefined) {
    const rows = await done(new Date(completedBefore));
    return { tasks: rows.slice(0, DONE_PAGE).map(toTask), lists: [], moreCompleted: rows.length > DONE_PAGE };
  }

  // Trash empties itself after a while.
  await db()
    .delete(t)
    .where(and(eq(t.userId, userId), lt(t.deletedAt, new Date(Date.now() - TRASH_DAYS * 86_400_000))));
  const [rest, completed, lists] = await Promise.all([
    db()
      .select()
      .from(t)
      .where(and(eq(t.userId, userId), or(isNull(t.completedAt), isNotNull(t.deletedAt)))),
    done(),
    listTaskLists(userId),
  ]);
  return { tasks: [...rest, ...completed.slice(0, DONE_PAGE)].map(toTask), lists, moreCompleted: completed.length > DONE_PAGE };
}

/** A list a task can go into: the user's own, and a list rather than a folder. */
async function assertList(userId: string, listId: string | null | undefined) {
  if (!listId) return;
  const [row] = await db()
    .select({ kind: schema.taskLists.kind })
    .from(schema.taskLists)
    .where(and(eq(schema.taskLists.userId, userId), eq(schema.taskLists.id, listId)));
  if (row?.kind !== "list") throw new HttpError(404, "Not found", "not_found");
}

export async function createTask(userId: string, input: z.output<typeof TaskBody>): Promise<Task> {
  const t = schema.tasks;
  if ((await countLiveTasks(userId)) >= MAX_TASKS) throw new HttpError(400, "That's a lot of tasks. Tick some off or empty Trash first.", "too_many");
  await assertList(userId, input.listId);
  const [row] = await db()
    .insert(t)
    .values({
      id: input.id,
      userId,
      title: input.title,
      notes: input.notes ? cleanSignatureHtml(input.notes) : "",
      priority: input.priority,
      due: input.due,
      time: input.due ? input.time : null,
      sortOrder: input.order,
      listId: input.listId,
      repeat: input.repeat,
    })
    .onConflictDoNothing()
    .returning();
  if (row) return toTask(row);
  // Sent twice (a retry): the first one stands.
  const [have] = await db().select().from(t).where(mine(userId, input.id));
  if (!have) throw new HttpError(409, "Not found", "conflict");
  return toTask(have);
}

/**
 * Change a task. With `doneId`, one time of a repeating task is done: a completed copy of the task
 * as it was is kept under that id (it shows in Completed), and the rest of the patch moves the
 * task on to its next day. The app works out that day; it knows what "today" is for the user.
 */
export async function updateTask(userId: string, id: string, patch: z.output<typeof TaskPatchBody>): Promise<Task> {
  const t = schema.tasks;
  if (patch.listId !== undefined) await assertList(userId, patch.listId);
  return db().transaction(async (tx) => {
    if (patch.doneId) {
      const [was] = await tx.select().from(t).where(mine(userId, id));
      if (!was) throw new HttpError(404, "Not found", "not_found");
      await tx
        .insert(t)
        .values({ ...was, id: patch.doneId, repeat: null, completedAt: new Date(), deletedAt: null, createdAt: new Date(), updatedAt: new Date() })
        .onConflictDoNothing();
    }
    const [row] = await tx
      .update(t)
      .set({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes ? cleanSignatureHtml(patch.notes) : "" } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        // No day: no time, and nothing to repeat from.
        ...(patch.due !== undefined ? { due: patch.due, ...(patch.due === null ? { time: null, repeat: null } : {}) } : {}),
        ...(patch.time !== undefined ? { time: patch.time } : {}),
        ...(patch.order !== undefined ? { sortOrder: patch.order } : {}),
        ...(patch.listId !== undefined ? { listId: patch.listId } : {}),
        ...(patch.repeat !== undefined ? { repeat: patch.repeat } : {}),
        // Ticked off again keeps when it was first done.
        ...(patch.completed !== undefined ? { completedAt: patch.completed ? sql`coalesce(${t.completedAt}, now())` : null } : {}),
        ...(patch.deleted !== undefined ? { deletedAt: patch.deleted ? sql`coalesce(${t.deletedAt}, now())` : null } : {}),
        updatedAt: new Date(),
      })
      .where(mine(userId, id))
      .returning();
    if (!row) throw new HttpError(404, "Not found", "not_found");
    return toTask(row);
  });
}

/** Gone for good (from Trash). */
export async function deleteTask(userId: string, id: string) {
  await db().delete(schema.tasks).where(mine(userId, id));
}

export async function emptyTrash(userId: string) {
  await db()
    .delete(schema.tasks)
    .where(and(eq(schema.tasks.userId, userId), isNotNull(schema.tasks.deletedAt)));
}

/* ----------------------------------- Lists ---------------------------------- */

const listFields = {
  name: z.string().trim().min(1, { error: tk("Give it a name") }).max(80, { error: tk("That name is a little long") }),
  emoji: z.string().max(16).nullable(),
  folderId: z.string().regex(LIST_ID).nullable(),
  order: z.number().finite(),
};

export const ListBody = z.object({ id: z.string().regex(LIST_ID), kind: z.enum(["list", "folder"]), ...listFields, folderId: listFields.folderId.default(null) });
export const ListPatchBody = z.object(listFields).partial();

const mineList = (userId: string, id: string) => and(eq(schema.taskLists.userId, userId), eq(schema.taskLists.id, id));

/** A folder a list can go into: the user's own folder. Folders don't go into folders. */
async function assertFolder(userId: string, folderId: string | null | undefined) {
  if (!folderId) return;
  const [row] = await db().select({ kind: schema.taskLists.kind }).from(schema.taskLists).where(mineList(userId, folderId));
  if (row?.kind !== "folder") throw new HttpError(404, "Not found", "not_found");
}

export async function createTaskList(userId: string, input: z.output<typeof ListBody>): Promise<TaskList> {
  const [{ n }] = await db().select({ n: count() }).from(schema.taskLists).where(eq(schema.taskLists.userId, userId));
  if (n >= MAX_LISTS) throw new HttpError(400, "That's a lot of lists. Delete some first.", "too_many");
  const folderId = input.kind === "folder" ? null : input.folderId;
  await assertFolder(userId, folderId);
  const [row] = await db()
    .insert(schema.taskLists)
    .values({ id: input.id, userId, kind: input.kind, name: input.name, emoji: input.emoji || null, folderId, sortOrder: input.order })
    .onConflictDoNothing()
    .returning();
  if (row) return toList(row);
  const [have] = await db().select().from(schema.taskLists).where(mineList(userId, input.id));
  if (!have) throw new HttpError(409, "Not found", "conflict");
  return toList(have);
}

export async function updateTaskList(userId: string, id: string, patch: z.output<typeof ListPatchBody>): Promise<TaskList> {
  const [have] = await db().select().from(schema.taskLists).where(mineList(userId, id));
  if (!have) throw new HttpError(404, "Not found", "not_found");
  if (patch.folderId !== undefined && have.kind === "folder" && patch.folderId) throw new HttpError(400, "Invalid request", "bad_request");
  await assertFolder(userId, patch.folderId);
  const [row] = await db()
    .update(schema.taskLists)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.emoji !== undefined ? { emoji: patch.emoji || null } : {}),
      ...(patch.folderId !== undefined ? { folderId: patch.folderId } : {}),
      ...(patch.order !== undefined ? { sortOrder: patch.order } : {}),
    })
    .where(mineList(userId, id))
    .returning();
  return toList(row);
}

/**
 * Delete a list: its tasks go to Trash (as in TickTick), and come back to the Inbox if restored.
 * A folder is only taken apart: its lists stay, outside of it.
 */
export async function deleteTaskList(userId: string, id: string) {
  const [have] = await db().select().from(schema.taskLists).where(mineList(userId, id));
  if (!have) return;
  await db().transaction(async (tx) => {
    if (have.kind === "folder") {
      await tx
        .update(schema.taskLists)
        .set({ folderId: null })
        .where(and(eq(schema.taskLists.userId, userId), eq(schema.taskLists.folderId, id)));
    } else {
      await tx
        .update(schema.tasks)
        .set({ deletedAt: sql`coalesce(${schema.tasks.deletedAt}, now())`, updatedAt: new Date() })
        .where(and(eq(schema.tasks.userId, userId), eq(schema.tasks.listId, id), isNull(schema.tasks.completedAt)));
    }
    await tx.delete(schema.taskLists).where(mineList(userId, id));
  });
}
