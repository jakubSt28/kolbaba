import { eq, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { newListId, newTaskId } from "@/lib/tasks/types";
import { db, schema } from "./db";
import { createTask, createTaskList, deleteTask, deleteTaskList, emptyTrash, ListBody, listTasks, TaskBody, TaskPatchBody, updateTask, updateTaskList } from "./tasks";

const DOMAIN = "tasks-test.invalid";
let me = "";
let other = "";

beforeEach(async () => {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
  const rows = await db()
    .insert(schema.users)
    .values([{ email: `me@${DOMAIN}` }, { email: `other@${DOMAIN}` }])
    .returning();
  [me, other] = rows.map((r) => r.id);
});

afterAll(async () => {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
});

const input = (over: Partial<Parameters<typeof createTask>[1]> = {}) => TaskBody.parse({ id: newTaskId(), title: "Water the plants", notes: "", priority: 0, due: null, time: null, order: 0, ...over });

describe("tasks", () => {
  it("are kept with their day, time, priority and description, cleaned of anything unsafe", async () => {
    const task = await createTask(me, input({ title: "  Send   the invoice ", notes: '<p>Hours <img src=x onerror="alert(1)"><script>x()</script></p>', priority: 3, due: "2026-11-20", time: "09:30" }));
    expect(task).toMatchObject({ title: "Send the invoice", priority: 3, due: "2026-11-20", time: "09:30", completedAt: null, deletedAt: null });
    expect(task.notes).not.toMatch(/script|onerror/);
    expect((await listTasks(me)).tasks.map((x) => x.id)).toEqual([task.id]);
    // Someone else's list doesn't have it, and can't change it.
    expect((await listTasks(other)).tasks).toEqual([]);
    await expect(updateTask(other, task.id, { title: "Mine now" })).rejects.toMatchObject({ status: 404 });
  });

  it("are created once when the same one is sent twice", async () => {
    const body = input();
    const first = await createTask(me, body);
    const again = await createTask(me, { ...body, title: "Changed meanwhile" });
    expect(again.title).toBe(first.title);
    // An id another user has isn't theirs to take.
    await expect(createTask(other, body)).rejects.toMatchObject({ status: 409 });
  });

  it("tick off and back, go to Trash and back, keeping when it first happened", async () => {
    const task = await createTask(me, input({ due: "2026-11-20", time: "10:00" }));
    const done = await updateTask(me, task.id, { completed: true });
    expect(done.completedAt).not.toBeNull();
    expect((await updateTask(me, task.id, { completed: true })).completedAt).toBe(done.completedAt);
    expect((await updateTask(me, task.id, { completed: false })).completedAt).toBeNull();
    // No day, no time.
    expect(await updateTask(me, task.id, { due: null })).toMatchObject({ due: null, time: null });
    const trashed = await updateTask(me, task.id, { deleted: true });
    expect(trashed.deletedAt).not.toBeNull();
    expect((await updateTask(me, task.id, { deleted: false })).deletedAt).toBeNull();
  });

  it("checks what's sent", () => {
    expect(TaskPatchBody.safeParse({ due: null, time: "10:00" }).success).toBe(false);
    expect(TaskPatchBody.safeParse({ time: "24:00" }).success).toBe(false);
    expect(TaskPatchBody.safeParse({ priority: 4 }).success).toBe(false);
    expect(TaskBody.safeParse({ ...input(), id: "not-a-task-id" }).success).toBe(false);
  });

  it("list every open task and Trash, and the completed ones a page at a time", async () => {
    const open = await createTask(me, input({ title: "Open" }));
    const done = [];
    for (let i = 0; i < 202; i++) done.push(await createTask(me, input({ title: `Done ${i}` })));
    // Completed a minute apart, oldest first.
    for (const [i, task] of done.entries()) {
      await db().update(schema.tasks).set({ completedAt: new Date(Date.now() - (300 - i) * 60_000) }).where(eq(schema.tasks.id, task.id));
    }
    const first = await listTasks(me);
    expect(first.moreCompleted).toBe(true);
    expect(first.tasks.filter((x) => x.completedAt === null).map((x) => x.id)).toEqual([open.id]);
    const shown = first.tasks.filter((x) => x.completedAt !== null);
    expect(shown).toHaveLength(200);
    expect(shown[0].title).toBe("Done 201");
    const older = await listTasks(me, Math.min(...shown.map((x) => x.completedAt!)));
    expect(older.moreCompleted).toBe(false);
    expect(older.tasks.map((x) => x.title)).toEqual(["Done 1", "Done 0"]);
  });

  it("are gone for good from Trash: one, all of it, or by themselves after 30 days", async () => {
    const a = await createTask(me, input({ title: "A" }));
    const b = await createTask(me, input({ title: "B" }));
    const c = await createTask(me, input({ title: "C" }));
    const old = await createTask(me, input({ title: "Old" }));
    for (const task of [a, b, c]) await updateTask(me, task.id, { deleted: true });
    await db().update(schema.tasks).set({ deletedAt: new Date(Date.now() - 31 * 86_400_000) }).where(eq(schema.tasks.id, old.id));
    await deleteTask(me, a.id);
    expect((await listTasks(me)).tasks.map((x) => x.title).sort()).toEqual(["B", "C"]);
    await emptyTrash(me);
    expect((await listTasks(me)).tasks).toEqual([]);
  });

  it("one time of a repeating task done: a completed copy stays, the task moves on", async () => {
    const task = await createTask(me, input({ title: "Water the plants", due: "2026-11-13", repeat: "FREQ=DAILY" }));
    expect(task.repeat).toBe("FREQ=DAILY;INTERVAL=1");
    const doneId = newTaskId();
    const moved = await updateTask(me, task.id, { due: "2026-11-14", doneId });
    expect(moved).toMatchObject({ due: "2026-11-14", completedAt: null, repeat: "FREQ=DAILY;INTERVAL=1" });
    const copy = (await listTasks(me)).tasks.find((x) => x.id === doneId);
    expect(copy).toMatchObject({ title: "Water the plants", due: "2026-11-13", repeat: null });
    expect(copy?.completedAt).not.toBeNull();
    // A day taken away takes the repeating with it.
    expect(await updateTask(me, task.id, { due: null })).toMatchObject({ due: null, repeat: null });
  });
});

describe("lists", () => {
  const list = (over: Partial<Parameters<typeof createTaskList>[1]> = {}) => ListBody.parse({ id: newListId(), kind: "list", name: "Errands", emoji: null, order: 0, ...over });

  it("hold tasks, sit in folders, and are the user's own", async () => {
    const folder = await createTaskList(me, list({ kind: "folder", name: "Someday", emoji: "🌙" }));
    const garden = await createTaskList(me, list({ name: "Garden", folderId: folder.id }));
    expect(garden.folderId).toBe(folder.id);
    const task = await createTask(me, input({ listId: garden.id }));
    expect(task.listId).toBe(garden.id);
    expect((await listTasks(me)).lists.map((l) => l.name)).toEqual(["Someday", "Garden"]);
    // A folder holds no tasks, and nobody else's list takes any.
    await expect(createTask(me, input({ listId: folder.id }))).rejects.toMatchObject({ status: 404 });
    await expect(createTask(other, input({ listId: garden.id }))).rejects.toMatchObject({ status: 404 });
    await expect(updateTaskList(other, garden.id, { name: "Mine" })).rejects.toMatchObject({ status: 404 });
    // Folders don't go into folders.
    await expect(updateTaskList(me, folder.id, { folderId: folder.id })).rejects.toMatchObject({ status: 400 });
  });

  it("deleted, send their open tasks to Trash; a folder taken apart keeps its lists", async () => {
    const folder = await createTaskList(me, list({ kind: "folder", name: "Someday" }));
    const garden = await createTaskList(me, list({ name: "Garden", folderId: folder.id }));
    const open = await createTask(me, input({ title: "Open", listId: garden.id }));
    const done = await createTask(me, input({ title: "Done", listId: garden.id }));
    await updateTask(me, done.id, { completed: true });
    await deleteTaskList(me, folder.id);
    expect((await listTasks(me)).lists).toEqual([expect.objectContaining({ id: garden.id, folderId: null })]);
    await deleteTaskList(me, garden.id);
    const { tasks, lists } = await listTasks(me);
    expect(lists).toEqual([]);
    expect(tasks.find((x) => x.id === open.id)).toMatchObject({ listId: null, deletedAt: expect.any(Number) });
    expect(tasks.find((x) => x.id === done.id)).toMatchObject({ listId: null, deletedAt: null });
  });
});
