import { addDays, dayKey, parseDay, startOfDay } from "../calendar/dates";
import { intlLocale, t } from "../i18n";
import { viewListId, type Priority, type Task, type TaskSort, type TaskView } from "./types";

/**
 * What the task lists are made of, apart from the screen: which tasks a view holds, the sections
 * they fall into, the order inside them, and what the date next to a task says.
 */

const pad = (n: number) => String(n).padStart(2, "0");
export const clockOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** The day `n` days from `now`, as YYYY-MM-DD. */
export const dayFrom = (now: Date, n: number) => dayKey(addDays(startOfDay(now), n));

/** Whole days from today to the task's day (negative: before today). */
export function daysAway(due: string, now: Date) {
  return Math.round((parseDay(due).getTime() - startOfDay(now).getTime()) / 86_400_000);
}

export const isOpen = (task: Task) => task.completedAt === null && task.deletedAt === null;
const isDone = (task: Task) => task.completedAt !== null && task.deletedAt === null;

/** Late: its day is over, or today's time for it has passed. Drawn in red. */
export function isOverdue(task: Pick<Task, "due" | "time" | "completedAt">, now: Date) {
  if (!task.due || task.completedAt !== null) return false;
  const away = daysAway(task.due, now);
  return away < 0 || (away === 0 && !!task.time && task.time < clockOf(now));
}

/** A list's own view (the Inbox or one of the user's): the tasks in it, done or not. */
const inList = (task: Task, view: TaskView) => (view === "inbox" ? task.listId === null : task.listId === viewListId(view));
const isList = (view: TaskView) => view === "inbox" || viewListId(view) !== null;

/** The open tasks a view lists; "completed" and "trash" list theirs. Today and the 7 days take them from every list. */
export function inView(task: Task, view: TaskView, now: Date) {
  if (view === "trash") return task.deletedAt !== null;
  if (view === "completed") return isDone(task);
  if (!isOpen(task)) return false;
  if (isList(view)) return inList(task, view);
  if (!task.due) return false;
  return daysAway(task.due, now) <= (view === "today" ? 0 : 6);
}

/** The number next to a view in the sidebar: what's still to do there. */
export const viewCount = (tasks: Task[], view: TaskView, now: Date) => tasks.filter((x) => inView(x, view, now)).length;

/** "🌱Garden" → 🌱 and Garden: a list's emoji is drawn in place of its icon. */
export function splitEmoji(text: string): { emoji: string | null; name: string } {
  const m = /^((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:\uFE0F|\u20E3|\p{Emoji_Modifier}|\u200D(?:\p{Extended_Pictographic}|\p{Regional_Indicator})|\p{Regional_Indicator})*)\s*(.*)$/u.exec(text.trim());
  return m && m[2] ? { emoji: m[1], name: m[2] } : { emoji: null, name: text.trim() };
}

/* ---------------------------------- Order ---------------------------------- */

const byDay = (a: Task, b: Task) => {
  if (a.due !== b.due) return !a.due ? 1 : !b.due ? -1 : a.due < b.due ? -1 : 1;
  // A time first, in its order; then the rest of that day.
  if (a.time !== b.time) return !a.time ? 1 : !b.time ? -1 : a.time < b.time ? -1 : 1;
  return 0;
};
const byPriority = (a: Task, b: Task) => b.priority - a.priority;
const byHand = (a: Task, b: Task) => a.order - b.order || b.createdAt - a.createdAt;

export function compareTasks(sort: TaskSort): (a: Task, b: Task) => number {
  if (sort === "manual") return byHand;
  if (sort === "priority") return (a, b) => byPriority(a, b) || byDay(a, b) || byHand(a, b);
  if (sort === "title") {
    const collator = new Intl.Collator(intlLocale(), { sensitivity: "base", numeric: true });
    return (a, b) => collator.compare(a.title, b.title) || byHand(a, b);
  }
  return (a, b) => byDay(a, b) || byPriority(a, b) || byHand(a, b);
}

/** An order that puts a task between these two neighbours (either may be missing). */
export function orderBetween(prev: number | undefined, next: number | undefined) {
  if (prev === undefined && next === undefined) return 0;
  if (prev === undefined) return next! - 1024;
  if (next === undefined) return prev + 1024;
  return prev < next ? (prev + next) / 2 : prev;
}

/** The order of a new task: above every other. */
export const topOrder = (tasks: Task[]) => (tasks.length ? Math.min(...tasks.map((x) => x.order)) - 1024 : 0);

/* --------------------------------- Sections -------------------------------- */

export interface TaskSection {
  key: string;
  title: string | null;
  /** Small text after the title (a day's date). */
  hint?: string;
  tasks: Task[];
  /** Ticked off: drawn muted, folds away. */
  done?: boolean;
  /** What a task dropped here takes on. */
  drop?: { due?: string | null; priority?: Priority };
}

const capital = (s: string) => s.charAt(0).toLocaleUpperCase(intlLocale()) + s.slice(1);
const weekday = (d: Date) => capital(new Intl.DateTimeFormat(intlLocale(), { weekday: "long" }).format(d));
const shortDate = (d: Date, now: Date) =>
  new Intl.DateTimeFormat(intlLocale(), { day: "numeric", month: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) }).format(d);

export function priorityLabel(p: Priority) {
  return p === 3 ? t("High priority") : p === 2 ? t("Medium priority") : p === 1 ? t("Low priority") : t("No priority");
}

/**
 * A view's tasks in their sections, the way TickTick lays them out: Today has what's late, today
 * and what was ticked off today; the next 7 days one section a day; the Inbox everything, in
 * sections by date or priority as it's sorted.
 */
export function sectionsOf(tasks: Task[], view: TaskView, sort: TaskSort, now: Date): TaskSection[] {
  const cmp = compareTasks(sort);
  const today = dayFrom(now, 0);
  const sections: TaskSection[] = [];
  const add = (s: TaskSection) => s.tasks.length && sections.push({ ...s, tasks: [...s.tasks].sort(cmp) });

  if (view === "trash") {
    return [{ key: "trash", title: null, tasks: tasks.filter((x) => x.deletedAt !== null).sort((a, b) => b.deletedAt! - a.deletedAt!) }].filter((s) => s.tasks.length);
  }

  if (view === "completed") {
    const done = tasks.filter(isDone).sort((a, b) => b.completedAt! - a.completedAt!);
    const days = new Map<string, Task[]>();
    for (const task of done) {
      const key = dayKey(new Date(task.completedAt!));
      days.set(key, [...(days.get(key) ?? []), task]);
    }
    return [...days].map(([key, list]) => {
      const away = daysAway(key, now);
      const title = away === 0 ? t("Today") : away === -1 ? t("Yesterday") : capital(new Intl.DateTimeFormat(intlLocale(), { weekday: "long", day: "numeric", month: "long", ...(parseDay(key).getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) }).format(parseDay(key)));
      return { key: `done-${key}`, title, tasks: list };
    });
  }

  const open = tasks.filter((x) => inView(x, view, now));
  const late = open.filter((x) => x.due && x.due < today);
  const later = open.filter((x) => !late.includes(x));

  if (view === "today" || view === "next7") {
    add({ key: "overdue", title: t("Overdue"), tasks: late });
    const last = view === "today" ? 0 : 6;
    for (let n = 0; n <= last; n++) {
      const day = dayFrom(now, n);
      const date = parseDay(day);
      add({
        key: `day-${day}`,
        title: n === 0 ? t("Today") : n === 1 ? t("Tomorrow") : weekday(date),
        hint: view === "next7" ? shortDate(date, now) : undefined,
        tasks: later.filter((x) => x.due === day),
        drop: { due: day },
      });
    }
  } else if (sort === "date") {
    const away = (x: Task) => (x.due ? daysAway(x.due, now) : null);
    add({ key: "overdue", title: t("Overdue"), tasks: late });
    add({ key: "today", title: t("Today"), tasks: later.filter((x) => away(x) === 0), drop: { due: today } });
    add({ key: "tomorrow", title: t("Tomorrow"), tasks: later.filter((x) => away(x) === 1), drop: { due: dayFrom(now, 1) } });
    add({ key: "week", title: t("Next 7 days"), tasks: later.filter((x) => { const a = away(x); return a !== null && a >= 2 && a <= 6; }) });
    add({ key: "later", title: t("Later"), tasks: later.filter((x) => { const a = away(x); return a !== null && a > 6; }) });
    add({ key: "nodate", title: t("No date"), tasks: later.filter((x) => !x.due), drop: { due: null } });
  } else if (sort === "priority") {
    for (const p of [3, 2, 1, 0] as Priority[]) add({ key: `p${p}`, title: priorityLabel(p), tasks: open.filter((x) => x.priority === p), drop: { priority: p } });
  } else {
    add({ key: "all", title: null, tasks: open });
  }

  // What was ticked off goes last: in Today and the 7 days what was done today of theirs, in a list all of its own.
  const done = tasks
    .filter(isDone)
    .filter((x) => (isList(view) ? inList(x, view) : dayKey(new Date(x.completedAt!)) === today && !!x.due && daysAway(x.due, now) <= (view === "today" ? 0 : 6)))
    .sort((a, b) => b.completedAt! - a.completedAt!);
  if (done.length) sections.push({ key: "done", title: t("Completed"), tasks: done, done: true });
  return sections;
}

/* ----------------------------------- Dates ---------------------------------- */

/** "14:30" the way the reader's language writes it. */
export function formatClock(time: string) {
  const [h, m] = time.split(":").map(Number);
  return new Intl.DateTimeFormat(intlLocale(), { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, h, m));
}

/** What the date next to a task says: Yesterday, Today, Tomorrow, a weekday this week, else the date; and the time. */
export function dueLabel(task: Pick<Task, "due" | "time">, now: Date) {
  if (!task.due) return "";
  const away = daysAway(task.due, now);
  const date = parseDay(task.due);
  const day =
    away === 0 ? t("Today") : away === 1 ? t("Tomorrow") : away === -1 ? t("Yesterday") : away > 1 && away <= 6 ? weekday(date) : shortDate(date, now);
  return task.time ? `${day} ${formatClock(task.time)}` : day;
}

/** The day on the date button in a task's details: "Wed, 11 Nov". */
export function longDueLabel(task: Pick<Task, "due" | "time">, now: Date) {
  if (!task.due) return "";
  const date = parseDay(task.due);
  const away = daysAway(task.due, now);
  const day =
    away === 0
      ? t("Today")
      : away === 1
        ? t("Tomorrow")
        : new Intl.DateTimeFormat(intlLocale(), { weekday: "short", day: "numeric", month: "numeric", ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) }).format(date);
  return task.time ? `${day}, ${formatClock(task.time)}` : day;
}

/* --------------------------------- Quick add -------------------------------- */

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

const DAY_WORDS: Record<string, number> = { today: 0, dnes: 0, tomorrow: 1, zitra: 1, pozitri: 2 };
const PRIORITY_WORDS: Record<string, Priority> = { "!high": 3, "!vysoka": 3, "!medium": 2, "!stredni": 2, "!low": 1, "!nizka": 1 };

/**
 * A task typed in one line: words at its end can say when and how important it is, the way
 * TickTick reads them. "Call the plumber tomorrow 9:00 !high" is due tomorrow at nine, high
 * priority. Only the end is read, so "Tell her I'm not coming today, after all" keeps its words.
 */
export function parseQuickAdd(text: string, now: Date): { title: string; due?: string; time?: string; priority?: Priority } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const out: { due?: string; time?: string; priority?: Priority } = {};
  while (words.length > 1) {
    const word = fold(words[words.length - 1]);
    const clock = /^(\d{1,2})[:.](\d{2})$/.exec(word);
    // "at 9:00", "v 9:00": the little word before a time goes with it.
    const before = (word === "at" || word === "v" || word === "ve") && out.time !== undefined && words.length > 2;
    if (word in DAY_WORDS && out.due === undefined) out.due = dayFrom(now, DAY_WORDS[word]);
    else if (word in PRIORITY_WORDS && out.priority === undefined) out.priority = PRIORITY_WORDS[word];
    else if (clock && Number(clock[1]) < 24 && Number(clock[2]) < 60 && out.time === undefined) out.time = `${pad(Number(clock[1]))}:${clock[2]}`;
    else if (!before) break;
    words.pop();
  }
  // A time without a day is today's.
  if (out.time && !out.due) out.due = dayFrom(now, 0);
  return { title: words.join(" "), ...out };
}
