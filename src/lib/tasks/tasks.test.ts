import { describe, expect, it } from "vitest";
import { dayFrom, dueLabel, inView, isOverdue, orderBetween, parseQuickAdd, sectionsOf, viewCount } from "./logic";
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
