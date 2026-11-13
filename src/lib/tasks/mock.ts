import { dayFrom } from "./logic";
import type { Priority, Task, TaskList } from "./types";

/** The prototype's lists: two on their own and a folder with two inside. */
export function buildMockLists(): TaskList[] {
  const list = (n: number, name: string, emoji: string | null, folderId: string | null = null, kind: TaskList["kind"] = "list"): TaskList => ({
    id: `lst_mock${String(n).padStart(16, "0")}`,
    kind,
    name,
    emoji,
    folderId,
    order: n * 1024,
  });
  const folder = list(3, "Someday", "🌙", null, "folder");
  return [list(1, "Errands", "🛒"), list(2, "Reading", "📚"), folder, list(4, "Garden", "🌱", folder.id), list(5, "Side project", null, folder.id), list(6, "Habits", "🔁")];
}

const LIST = (n: number) => `lst_mock${String(n).padStart(16, "0")}`;

/** The prototype's tasks (no backend): a few late, a few for today and the week, some done. */
export function buildMockTasks(now = new Date()): Task[] {
  const at = (days: number, hours = 9) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hours).getTime();
  let order = 0;
  const task = (title: string, opts: { due?: number | null; time?: string; priority?: Priority; notes?: string; done?: number; deleted?: number; list?: number; repeat?: string } = {}): Task => ({
    id: `tsk_mock${String(++order).padStart(16, "0")}`,
    title,
    notes: opts.notes ?? "",
    priority: opts.priority ?? 0,
    due: opts.due === undefined || opts.due === null ? null : dayFrom(now, opts.due),
    time: opts.time ?? null,
    completedAt: opts.done === undefined ? null : at(opts.done, 11),
    deletedAt: opts.deleted === undefined ? null : at(opts.deleted, 15),
    order: order * 1024,
    createdAt: at(-5),
    listId: opts.list ? LIST(opts.list) : null,
    repeat: opts.repeat ?? null,
  });
  return [
    task("Send the invoice to Northwind", { due: -2, priority: 3, notes: "<p>Hours from October, the rate agreed in the last email.</p>" }),
    task("Book a check-up at the dentist", { due: -1, notes: "<ul data-type=\"taskList\"><li data-type=\"taskItem\" data-checked=\"false\"><p>Ask about Thursday mornings</p></li></ul>" }),
    task("Move the haircut, it clashes with the talk", { due: 0, priority: 2 }),
    task("Pick up the jacket from the tailor", { due: 0, time: "17:30", list: 1 }),
    task("Water the plants", { due: 0, list: 6, repeat: "FREQ=DAILY;INTERVAL=1" }),
    task("Pay the rent", { due: 4, list: 6, priority: 3, repeat: "FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=" + new Date(now.getFullYear(), now.getMonth(), now.getDate() + 4).getDate() }),
    task("Buy seeds for spring", { list: 4 }),
    task("Sketch the landing page", { list: 5, priority: 2 }),
    task("Update the slides for Monday", { due: 0, priority: 1, notes: "<h2>What changed</h2><ul><li><p>New numbers for Q3</p></li><li><p>One slide about the pilot</p></li></ul>" }),
    task("Call Mia about the weekend", { due: 1 }),
    task("Renew the domain", { due: 3, priority: 3 }),
    task("Write the newsletter", { due: 5, priority: 1 }),
    task("Return the library books", { due: 12 }),
    task("Read “The Design of Everyday Things”", { list: 2 }),
    task("Ideas for the garden"),
    task("Order washing gel", { due: -1, done: 0 }),
    task("Water the plants", { due: -1, done: -1, list: 6 }),
    task("Reply to the landlord", { done: -1 }),
    task("Old shopping list", { deleted: -2 }),
  ];
}
