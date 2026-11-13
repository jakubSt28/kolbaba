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
}

/** What can be changed on a task. */
export type TaskPatch = Partial<Pick<Task, "title" | "notes" | "priority" | "due" | "time" | "order">> & {
  completed?: boolean;
  deleted?: boolean;
};

/** A new task: the client picks its id, so it can be changed before the server has answered. */
export type TaskInput = Pick<Task, "id" | "title" | "notes" | "priority" | "due" | "time" | "order">;

export type TaskView = "today" | "next7" | "inbox" | "completed" | "trash";

export type TaskSort = "date" | "priority" | "title" | "manual";

/** What GET /api/tasks answers: open and trashed tasks, and the latest completed ones. */
export interface TasksPage {
  tasks: Task[];
  /** Older completed tasks are on the server (ask with `completedBefore`). */
  moreCompleted: boolean;
}

/** Days in Trash before a task is gone for good. */
export const TRASH_DAYS = 30;

export const TASK_ID = /^tsk_[a-z0-9]{20}$/;

export const newTaskId = () => `tsk_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
