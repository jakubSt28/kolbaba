import { and, count, desc, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { tk } from "@/lib/i18n";
import { TASK_ID, TRASH_DAYS, type Priority, type Task, type TasksPage } from "@/lib/tasks/types";
import { db, schema } from "./db";
import { HttpError } from "./http-error";
import { cleanSignatureHtml } from "./mail/email-html";

/**
 * Tasks: the user's own to-do list. All of it is here (no provider), so the app gets every open
 * task and what's in Trash at once, and the completed ones newest first, a page at a time.
 */

/** Open tasks and Trash together; past this the app asks to clear some first. */
const MAX_TASKS = 5000;
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
};

export const TaskBody = z.object({ id: z.string().regex(TASK_ID), ...fields });

export const TaskPatchBody = z
  .object({ ...fields, completed: z.boolean(), deleted: z.boolean() })
  .partial()
  // A time belongs to a day.
  .refine((p) => !(p.due === null && p.time), { error: tk("A time needs a day") });

type Row = typeof schema.tasks.$inferSelect;

const dto = (r: Row): Task => ({
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
});

const mine = (userId: string, id: string) => and(eq(schema.tasks.userId, userId), eq(schema.tasks.id, id));

/** Every open task and what's in Trash, with the latest completed; or, with `completedBefore` (ms), the completed ones before it. */
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
    return { tasks: rows.slice(0, DONE_PAGE).map(dto), moreCompleted: rows.length > DONE_PAGE };
  }

  // Trash empties itself after a while.
  await db()
    .delete(t)
    .where(and(eq(t.userId, userId), lt(t.deletedAt, new Date(Date.now() - TRASH_DAYS * 86_400_000))));
  const [rest, completed] = await Promise.all([
    db()
      .select()
      .from(t)
      .where(and(eq(t.userId, userId), or(isNull(t.completedAt), isNotNull(t.deletedAt)))),
    done(),
  ]);
  return { tasks: [...rest, ...completed.slice(0, DONE_PAGE)].map(dto), moreCompleted: completed.length > DONE_PAGE };
}

export async function createTask(userId: string, input: z.output<typeof TaskBody>): Promise<Task> {
  const t = schema.tasks;
  const [{ n }] = await db()
    .select({ n: count() })
    .from(t)
    .where(and(eq(t.userId, userId), or(isNull(t.completedAt), isNotNull(t.deletedAt))));
  if (n >= MAX_TASKS) throw new HttpError(400, "That's a lot of tasks. Tick some off or empty Trash first.", "too_many");
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
    })
    .onConflictDoNothing()
    .returning();
  if (row) return dto(row);
  // Sent twice (a retry): the first one stands.
  const [have] = await db().select().from(t).where(mine(userId, input.id));
  if (!have) throw new HttpError(409, "Not found", "conflict");
  return dto(have);
}

export async function updateTask(userId: string, id: string, patch: z.output<typeof TaskPatchBody>): Promise<Task> {
  const t = schema.tasks;
  const [row] = await db()
    .update(t)
    .set({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes ? cleanSignatureHtml(patch.notes) : "" } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      // No day: no time either.
      ...(patch.due !== undefined ? { due: patch.due, ...(patch.due === null ? { time: null } : {}) } : {}),
      ...(patch.time !== undefined ? { time: patch.time } : {}),
      ...(patch.order !== undefined ? { sortOrder: patch.order } : {}),
      // Ticked off again keeps when it was first done.
      ...(patch.completed !== undefined ? { completedAt: patch.completed ? sql`coalesce(${t.completedAt}, now())` : null } : {}),
      ...(patch.deleted !== undefined ? { deletedAt: patch.deleted ? sql`coalesce(${t.deletedAt}, now())` : null } : {}),
      updatedAt: new Date(),
    })
    .where(mine(userId, id))
    .returning();
  if (!row) throw new HttpError(404, "Not found", "not_found");
  return dto(row);
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
