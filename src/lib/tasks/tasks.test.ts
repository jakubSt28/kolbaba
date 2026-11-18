import { describe, expect, it } from "vitest";
import { compareTasks, dayFrom, dropPlace, droppedInto, dueLabel, inView, isOverdue, orderBetween, parseQuickAdd, sectionsOf, viewCount } from "./logic";
import type { Task } from "./types";

// A Friday afternoon.
const NOW = new Date(2026, 10, 13, 15, 0);

let n = 0;
const task = (over: Partial<Task> = {}): Task => ({
  id: `tsk_test${String(++n).padStart(16, "0")}`,
  title: `Task ${n}`,
  notes: "",
  priority: 0,
  due: null,
  time: null,
  completedAt: null,
  deletedAt: null,
  order: n,
  createdAt: 0,
  listId: null,
  repeat: null,
  ...over,
});

const titles = (list: Task[]) => list.map((x) => x.title);

describe("which view holds a task", () => {
  const late = task({ due: dayFrom(NOW, -2) });
  const today = task({ due: dayFrom(NOW, 0) });
  const friday = task({ due: dayFrom(NOW, 6) });
  const later = task({ due: dayFrom(NOW, 7) });
  const none = task();
  const done = task({ due: dayFrom(NOW, 0), completedAt: NOW.getTime() });
  const trashed = task({ due: dayFrom(NOW, 0), deletedAt: NOW.getTime() });
  const all = [late, today, friday, later, none, done, trashed];

  it("Today has what's late and today's; the 7 days a week of it; the Inbox every open task", () => {
    expect(all.filter((x) => inView(x, "today", NOW))).toEqual([late, today]);
    expect(all.filter((x) => inView(x, "next7", NOW))).toEqual([late, today, friday]);
    expect(all.filter((x) => inView(x, "inbox", NOW))).toEqual([late, today, friday, later, none]);
    expect(all.filter((x) => inView(x, "completed", NOW))).toEqual([done]);
    expect(all.filter((x) => inView(x, "trash", NOW))).toEqual([trashed]);
    expect(viewCount(all, "today", NOW)).toBe(2);
  });

  it("is late once its day is over, or today's time for it has passed", () => {
    expect(isOverdue(late, NOW)).toBe(true);
    expect(isOverdue(today, NOW)).toBe(false);
    expect(isOverdue({ ...today, time: "14:00" }, NOW)).toBe(true);
    expect(isOverdue({ ...today, time: "16:00" }, NOW)).toBe(false);
    expect(isOverdue({ ...late, completedAt: 1 }, NOW)).toBe(false);
  });
});

describe("sections", () => {
  it("Today: late, today, then what of it was done today", () => {
    const tasks = [
      task({ title: "late", due: dayFrom(NOW, -1) }),
      task({ title: "later today", due: dayFrom(NOW, 0) }),
      task({ title: "at nine", due: dayFrom(NOW, 0), time: "09:00" }),
      task({ title: "urgent", due: dayFrom(NOW, 0), priority: 3 }),
      task({ title: "done today", due: dayFrom(NOW, -3), completedAt: NOW.getTime() - 3600_000 }),
      task({ title: "done yesterday", due: dayFrom(NOW, -1), completedAt: NOW.getTime() - 86_400_000 }),
      task({ title: "done, no date", completedAt: NOW.getTime() }),
    ];
    const sections = sectionsOf(tasks, "today", "date", NOW);
    expect(sections.map((s) => s.key)).toEqual(["overdue", `day-${dayFrom(NOW, 0)}`, "done"]);
    // A time first, then by priority, then the order by hand.
    expect(titles(sections[1].tasks)).toEqual(["at nine", "urgent", "later today"]);
    expect(titles(sections[2].tasks)).toEqual(["done today"]);
    expect(sections[1].drop).toEqual({ due: dayFrom(NOW, 0) });
    expect(sections[0].drop).toBeUndefined();
  });

  it("the next 7 days: a section for each day that has something", () => {
    const tasks = [task({ due: dayFrom(NOW, 1) }), task({ due: dayFrom(NOW, 3) }), task({ due: dayFrom(NOW, 9) })];
    const sections = sectionsOf(tasks, "next7", "date", NOW);
    expect(sections.map((s) => s.key)).toEqual([`day-${dayFrom(NOW, 1)}`, `day-${dayFrom(NOW, 3)}`]);
    expect(sections[0].title).toBe("Tomorrow");
    expect(sections[1].title).toBe("Monday");
    expect(sections[1].hint).toBe("16/11");
  });

  it("the Inbox by date, by priority, and in one list sorted by hand", () => {
    const tasks = [
      task({ title: "a", due: dayFrom(NOW, 0), priority: 1, order: 3 }),
      task({ title: "b", due: dayFrom(NOW, 4), priority: 3, order: 1 }),
      task({ title: "c", priority: 3, order: 2 }),
      task({ title: "d", due: dayFrom(NOW, 30), order: 0 }),
    ];
    expect(sectionsOf(tasks, "inbox", "date", NOW).map((s) => [s.key, titles(s.tasks)])).toEqual([
      ["today", ["a"]],
      ["week", ["b"]],
      ["later", ["d"]],
      ["nodate", ["c"]],
    ]);
    const byPriority = sectionsOf(tasks, "inbox", "priority", NOW);
    expect(byPriority.map((s) => [s.key, titles(s.tasks)])).toEqual([
      ["p3", ["b", "c"]],
      ["p1", ["a"]],
      ["p0", ["d"]],
    ]);
    expect(byPriority[0].drop).toEqual({ priority: 3 });
    expect(sectionsOf(tasks, "inbox", "manual", NOW).map((s) => titles(s.tasks))).toEqual([["d", "b", "c", "a"]]);
  });

  it("Completed: by the day it was done, newest first", () => {
    const tasks = [
      task({ title: "yesterday", completedAt: NOW.getTime() - 86_400_000 }),
      task({ title: "today", completedAt: NOW.getTime() - 60_000 }),
      task({ title: "deleted", completedAt: NOW.getTime(), deletedAt: NOW.getTime() }),
    ];
    const sections = sectionsOf(tasks, "completed", "date", NOW);
    expect(sections.map((s) => [s.title, titles(s.tasks)])).toEqual([
      ["Today", ["today"]],
      ["Yesterday", ["yesterday"]],
    ]);
  });
});

describe("the date next to a task", () => {
  it("says yesterday, today or tomorrow, a weekday this week, else the date", () => {
    expect(dueLabel({ due: dayFrom(NOW, -1), time: null }, NOW)).toBe("Yesterday");
    expect(dueLabel({ due: dayFrom(NOW, 0), time: "09:30" }, NOW)).toBe("Today 9:30");
    expect(dueLabel({ due: dayFrom(NOW, 1), time: null }, NOW)).toBe("Tomorrow");
    expect(dueLabel({ due: dayFrom(NOW, 4), time: null }, NOW)).toBe("Tuesday");
    expect(dueLabel({ due: dayFrom(NOW, 10), time: null }, NOW)).toBe("23/11");
    expect(dueLabel({ due: "2027-01-05", time: null }, NOW)).toBe("05/01/2027");
    expect(dueLabel({ due: null, time: null }, NOW)).toBe("");
  });
});

describe("quick add", () => {
  it("reads the day, time and priority at the end of the line", () => {
    expect(parseQuickAdd("Call the plumber tomorrow 9:00 !high", NOW)).toEqual({ title: "Call the plumber", due: dayFrom(NOW, 1), time: "09:00", priority: 3 });
    expect(parseQuickAdd("Koupit mléko zítra", NOW)).toEqual({ title: "Koupit mléko", due: dayFrom(NOW, 1) });
    expect(parseQuickAdd("Zavolat mámě v 18:30", NOW)).toEqual({ title: "Zavolat mámě", due: dayFrom(NOW, 0), time: "18:30" });
    expect(parseQuickAdd("Report !nízká", NOW)).toEqual({ title: "Report", priority: 1 });
  });

  it("leaves words in the middle, and a line that is only such a word, alone", () => {
    expect(parseQuickAdd("Tell her I'm not coming today, after all", NOW)).toEqual({ title: "Tell her I'm not coming today, after all" });
    expect(parseQuickAdd("tomorrow", NOW)).toEqual({ title: "tomorrow" });
    expect(parseQuickAdd("Meeting 25:00", NOW)).toEqual({ title: "Meeting 25:00" });
  });
});

describe("order by hand", () => {
  it("puts a task between its neighbours, above the first or below the last", () => {
    expect(orderBetween(1, 3)).toBe(2);
    expect(orderBetween(undefined, 0)).toBe(-1024);
    expect(orderBetween(5, undefined)).toBe(1029);
    expect(orderBetween(undefined, undefined)).toBe(0);
  });
});

describe("dragging a task into place", () => {
  /** Where the tasks end up once the orders are applied, sorted as the list sorts them. */
  const after = (list: Task[], moved: Task, sort: Parameters<typeof dropPlace>[2], beforeId: string | null) => {
    const place = dropPlace(list, moved, sort, beforeId)!;
    const all = [...list.filter((x) => x.id !== moved.id), moved].map((x) => ({ ...x, order: place.orders[x.id] ?? x.order }));
    return { place, titles: titles(all.sort(compareTasks(sort))) };
  };

  it("goes where it's dropped in a list in its own order", () => {
    const [a, b, c] = [task({ title: "A", order: 0 }), task({ title: "B", order: 1024 }), task({ title: "C", order: 2048 })];
    expect(after([a, b, c], c, "manual", a.id).titles).toEqual(["C", "A", "B"]);
    expect(after([a, b, c], a, "manual", null).titles).toEqual(["B", "C", "A"]);
    expect(after([a, b, c], a, "manual", c.id).titles).toEqual(["B", "A", "C"]);
  });

  it("changes nothing dropped back where it was", () => {
    const [a, b] = [task({ order: 0 }), task({ order: 1024 })];
    expect(dropPlace([a, b], a, "manual", b.id)).toEqual({ before: b.id, orders: {} });
    expect(dropPlace([a, b], a, "manual", a.id)).toEqual({ before: b.id, orders: {} });
  });

  it("sorted by date, moves among the tasks of its day and priority, and no further", () => {
    const day = dayFrom(NOW, 0);
    const high = task({ title: "High", due: day, priority: 3, order: 5000 });
    const early = task({ title: "At nine", due: day, time: "09:00", order: 9000 });
    const [a, b] = [task({ title: "A", due: day, order: 0 }), task({ title: "B", due: day, order: 1024 })];
    const list = [early, high, a, b].sort(compareTasks("date"));
    expect(titles(list)).toEqual(["At nine", "High", "A", "B"]);
    // Dropped above the high-priority task, it stays below it, at the top of its own.
    const top = after(list, b, "date", early.id);
    expect(top.titles).toEqual(["At nine", "High", "B", "A"]);
    expect(top.place.before).toBe(a.id);
    expect(after(list, a, "date", null).titles).toEqual(["At nine", "High", "B", "A"]);
  });

  it("sorted by priority, takes the priority of the section it's dropped into", () => {
    const [p3, p0a, p0b] = [task({ title: "Urgent", priority: 3, order: 0 }), task({ title: "A", order: 0 }), task({ title: "B", order: 1024 })];
    const section = sectionsOf([p3, p0a, p0b], "inbox", "priority", NOW).find((s) => s.key === "p0")!;
    const moved = droppedInto(section, p3);
    expect(moved.priority).toBe(0);
    expect(after(section.tasks, moved, "priority", p0b.id).titles).toEqual(["A", "Urgent", "B"]);
  });

  it("makes room between tasks with the same order", () => {
    const [a, b, c] = [task({ title: "A", order: 0, createdAt: 3 }), task({ title: "B", order: 0, createdAt: 2 }), task({ title: "C", order: 0, createdAt: 1 })];
    const { place, titles: got } = after([a, b, c], c, "manual", b.id);
    expect(got).toEqual(["A", "C", "B"]);
    expect(Object.keys(place.orders).length).toBeGreaterThan(1);
  });

  it("can't be put in order of its own by title", () => {
    expect(dropPlace([task()], task(), "title", null)).toBeNull();
  });
});
