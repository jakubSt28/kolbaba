/**
 * Tasks: a to-do list of the user's own, kept in Kolbaba (no provider behind it). A task has a
 * title, notes written in the same editor as an email, a priority and a day it's due, with a time
 * when it matters.
 */

/** 0 none, 1 low, 2 medium, 3 high. */
export type Priority = 0 | 1 | 2 | 3;

export const PRIORITIES: Priority[] = [3, 2, 1, 0];

export interface Task {
  id: string;
  title: string;
  /** Editor HTML; "" when there's none. */
  notes: string;
  priority: Priority;
  /** The day it's due, YYYY-MM-DD in the user's own days; null: no date. */
  due: string | null;
  /** "HH:MM" on that day; null: any time that day. */
  time: string | null;
  /** When it was ticked off (ms). */
  completedAt: number | null;
  /** When it went to Trash (ms). */
  deletedAt: number | null;
  /** Order by hand, smallest first: new tasks go on top. */
  order: number;
  createdAt: number;
  /** The list it's in; null: the Inbox. */
  listId: string | null;
  /** How it repeats, as an iCalendar RRULE (FREQ=WEEKLY;BYDAY=MO); null: once. See ./repeat.ts. */
  repeat: string | null;
}

/** A list of tasks in the sidebar, or a folder that holds lists (one level, as in TickTick). */
export interface TaskList {
  id: string;
  kind: "list" | "folder";
  name: string;
  /** An emoji in place of the icon ("🏡"), or null. */
  emoji: string | null;
  /** A list's folder. */
  folderId: string | null;
  order: number;
}

/** What can be changed on a task. */
export type TaskPatch = Partial<Pick<Task, "title" | "notes" | "priority" | "due" | "time" | "order" | "listId" | "repeat">> & {
  completed?: boolean;
  deleted?: boolean;
  /** One time of a repeating task done: a completed copy of it as it was is kept under this id, and the rest of the patch moves it on (its next day). */
  doneId?: string;
};

/** A new task: the client picks its id, so it can be changed before the server has answered. */
export type TaskInput = Pick<Task, "id" | "title" | "notes" | "priority" | "due" | "time" | "order" | "listId" | "repeat">;

/** The fixed views, or one of the user's lists (`list:<id>`). */
export type TaskView = "today" | "next7" | "inbox" | "completed" | "trash" | `list:${string}`;

export const listView = (id: string): TaskView => `list:${id}`;
export const viewListId = (view: TaskView) => (view.startsWith("list:") ? view.slice(5) : null);

export type TaskSort = "date" | "priority" | "title" | "manual";

/** What GET /api/tasks answers: open and trashed tasks, and the latest completed ones. */
export interface TasksPage {
  tasks: Task[];
  lists: TaskList[];
  /** Older completed tasks are on the server (ask with `completedBefore`). */
  moreCompleted: boolean;
}

/** Days in Trash before a task is gone for good. */
export const TRASH_DAYS = 30;

export const TASK_ID = /^tsk_[a-z0-9]{20}$/;

export const LIST_ID = /^lst_[a-z0-9]{20}$/;

const random = () => crypto.randomUUID().replace(/-/g, "").slice(0, 20);
export const newTaskId = () => `tsk_${random()}`;
export const newListId = () => `lst_${random()}`;
