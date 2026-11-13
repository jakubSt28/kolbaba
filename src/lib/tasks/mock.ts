import { dayFrom } from "./logic";
import type { Priority, Task } from "./types";

/** The prototype's tasks (no backend): a few late, a few for today and the week, some done. */
export function buildMockTasks(now = new Date()): Task[] {
  const at = (days: number, hours = 9) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hours).getTime();
  let order = 0;
  const task = (title: string, opts: { due?: number | null; time?: string; priority?: Priority; notes?: string; done?: number; deleted?: number } = {}): Task => ({
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
  });
  return [
    task("Send the invoice to Northwind", { due: -2, priority: 3, notes: "<p>Hours from October, the rate agreed in the last email.</p>" }),
    task("Book a check-up at the dentist", { due: -1, notes: "<ul data-type=\"taskList\"><li data-type=\"taskItem\" data-checked=\"false\"><p>Ask about Thursday mornings</p></li></ul>" }),
    task("Move the haircut, it clashes with the talk", { due: 0, priority: 2 }),
    task("Pick up the jacket from the tailor", { due: 0, time: "17:30" }),
    task("Update the slides for Monday", { due: 0, priority: 1, notes: "<h2>What changed</h2><ul><li><p>New numbers for Q3</p></li><li><p>One slide about the pilot</p></li></ul>" }),
    task("Call Mia about the weekend", { due: 1 }),
    task("Renew the domain", { due: 3, priority: 3 }),
    task("Write the newsletter", { due: 5, priority: 1 }),
    task("Return the library books", { due: 12 }),
    task("Read “The Design of Everyday Things”"),
    task("Ideas for the garden"),
    task("Order washing gel", { due: -1, done: 0 }),
    task("Water the plants", { due: 0, done: 0 }),
    task("Reply to the landlord", { done: -1 }),
    task("Old shopping list", { deleted: -2 }),
  ];
}
