"use client";

import { create } from "zustand";
import { t } from "../i18n";
import { api, LIVE } from "../live";
import { useMail } from "../store";
import { track } from "../usage";
import { orderBetween, topOrder, type TaskSection } from "./logic";
import { buildMockTasks } from "./mock";
import { newTaskId, type Task, type TaskPatch, type TaskSort, type TaskView, type TasksPage } from "./types";

/**
 * The tasks' own store, beside the mail's and the calendar's. Every change shows at once and goes
 * to the server behind it; the changes of one task go one after another, so a task can be written
 * in while the server is still saving it.
 */

interface TasksState {
  /** Loaded (the prototype is from the start). */
  ready: boolean;
  tasks: Task[];
  /** Older completed tasks wait on the server. */
  moreCompleted: boolean;
  loadingMore: boolean;
  view: TaskView;
  /** The task open in the details. */
  selectedId: string | null;
  sorts: Partial<Record<TaskView, TaskSort>>;
  /** Sections folded away or opened, by `view:section`; not here means as they start. */
  folded: Record<string, boolean>;
  /** Goes up when "New task" asks the quick-add line to take the keyboard. */
  addFocus: number;

  init: () => Promise<void>;
  /** Again from the server, unless something here is still on its way there. */
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  setView: (view: TaskView) => void;
  select: (id: string | null) => void;
  add: (input: Partial<Omit<Task, "id">> & { title: string }) => Task;
  update: (id: string, patch: TaskPatch) => void;
  complete: (id: string, done: boolean) => void;
  remove: (id: string) => void;
  restore: (id: string) => void;
  destroy: (id: string) => void;
  emptyTrash: () => void;
  /** Dropped into a section, before `beforeId` (or at its end): its place, and what the section gives it (a day, a priority). */
  place: (id: string, section: TaskSection, beforeId: string | null) => void;
  setSort: (view: TaskView, sort: TaskSort) => void;
  setFolded: (key: string, folded: boolean) => void;
  focusAdd: () => void;
}

const VIEW_KEY = "kolbaba.tasks.view";
const SORT_KEY = "kolbaba.tasks.sort";
const FOLD_KEY = "kolbaba.tasks.folded";

const VIEWS: TaskView[] = ["today", "next7", "inbox", "completed", "trash"];

const readJson = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const writeJson = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

export const sortOf = (sorts: Partial<Record<TaskView, TaskSort>>, view: TaskView): TaskSort => sorts[view] ?? "date";

/** Tasks can be put in order by dragging them: in an open section of a list sorted by hand. */
export const canReorder = (sorts: Partial<Record<TaskView, TaskSort>>, view: TaskView, section: TaskSection) =>
  !section.done && sortOf(sorts, view) === "manual" && view !== "completed" && view !== "trash";

/** How a section starts: what's done folds away in the Inbox, and shows in Today and the 7 days. */
export const isFolded = (folded: Record<string, boolean>, view: TaskView, section: TaskSection) => folded[`${view}:${section.key}`] ?? (!!section.done && view === "inbox");

const toast = (message: string, undo?: () => void) => useMail.getState().pushToast({ message, undo });

/** Each task's requests, one after another. */
const queues = new Map<string, Promise<unknown>>();
/** Changes made here since the app started, and how many are still on their way. */
let edits = 0;
let pending = 0;

function send(id: string, request: () => Promise<unknown>, onError: () => void) {
  if (!LIVE) return;
  pending++;
  const next = (queues.get(id) ?? Promise.resolve())
    .then(request)
    .catch((err) => {
      toast((err as Error).message || t("That didn't work. Try again."));
      onError();
    })
    .finally(() => {
      pending--;
      if (queues.get(id) === next) queues.delete(id);
    });
  queues.set(id, next);
}

/** What a change does to the task here, before the server says the same. */
function applied(task: Task, patch: TaskPatch): Task {
  const { completed, deleted, ...rest } = patch;
  const next = { ...task, ...rest };
  if (rest.due === null) next.time = null;
  if (completed !== undefined) next.completedAt = completed ? (task.completedAt ?? Date.now()) : null;
  if (deleted !== undefined) next.deletedAt = deleted ? (task.deletedAt ?? Date.now()) : null;
  return next;
}

export const useTasks = create<TasksState>()((set, get) => {
  const patchLocal = (id: string, patch: TaskPatch) => {
    edits++;
    set((s) => ({ tasks: s.tasks.map((x) => (x.id === id ? applied(x, patch) : x)) }));
  };
  // Something didn't save: what the server has is what's true.
  const resync = () => {
    edits++;
    void load(true);
  };
  const load = async (force = false) => {
    if (!LIVE) return;
    const started = edits;
    const page = await api.get<TasksPage>("/api/tasks");
    // A change made meanwhile isn't in this answer yet: the next one will have it.
    if (!force && (edits !== started || pending > 0)) return;
    set({ tasks: page.tasks, moreCompleted: page.moreCompleted, ready: true });
  };

  return {
    ready: !LIVE,
    tasks: LIVE ? [] : buildMockTasks(),
    moreCompleted: false,
    loadingMore: false,
    view: "today",
    selectedId: null,
    sorts: {},
    folded: {},
    addFocus: 0,

    init: async () => {
      if (typeof window !== "undefined" && !get().ready) {
        const view = readJson<TaskView | null>(VIEW_KEY, null);
        set({ sorts: readJson(SORT_KEY, {}), folded: readJson(FOLD_KEY, {}), ...(view && VIEWS.includes(view) ? { view } : {}) });
      }
      if (!LIVE || get().ready) return;
      try {
        await load(true);
      } catch (err) {
        toast((err as Error).message);
      }
    },
    refresh: async () => {
      if (!get().ready) return;
      await load().catch(() => {});
    },
    loadMore: async () => {
      const done = get().tasks.filter((x) => x.completedAt !== null && x.deletedAt === null);
      if (!LIVE || !get().moreCompleted || get().loadingMore || !done.length) return;
      set({ loadingMore: true });
      try {
        const oldest = Math.min(...done.map((x) => x.completedAt!));
        const page = await api.get<TasksPage>(`/api/tasks?completedBefore=${oldest}`);
        const have = new Set(get().tasks.map((x) => x.id));
        set((s) => ({ tasks: [...s.tasks, ...page.tasks.filter((x) => !have.has(x.id))], moreCompleted: page.moreCompleted }));
      } catch (err) {
        toast((err as Error).message);
      } finally {
        set({ loadingMore: false });
      }
    },

    setView: (view) => {
      if (get().view === view) return;
      set({ view, selectedId: null });
      writeJson(VIEW_KEY, view);
    },
    select: (selectedId) => set({ selectedId }),

    add: (input) => {
      const task: Task = {
        id: newTaskId(),
        notes: "",
        priority: 0,
        due: null,
        time: null,
        completedAt: null,
        deletedAt: null,
        order: topOrder(get().tasks),
        createdAt: Date.now(),
        ...input,
      };
      edits++;
      set((s) => ({ tasks: [task, ...s.tasks] }));
      track("taskNew");
      send(
        task.id,
        () => api.post("/api/tasks", { id: task.id, title: task.title, notes: task.notes, priority: task.priority, due: task.due, time: task.time, order: task.order }),
        () => set((s) => ({ tasks: s.tasks.filter((x) => x.id !== task.id) })),
      );
      return task;
    },

    update: (id, patch) => {
      if (!get().tasks.some((x) => x.id === id)) return;
      patchLocal(id, patch);
      if (patch.due !== undefined || patch.time !== undefined) track("taskDate");
      if (patch.priority !== undefined) track("taskPriority");
      send(id, () => api.patch(`/api/tasks/${id}`, patch), resync);
    },

    complete: (id, done) => {
      get().update(id, { completed: done });
      if (!done) return;
      track("taskDone");
      toast(t("Task completed"), () => get().update(id, { completed: false }));
    },
    remove: (id) => {
      get().update(id, { deleted: true });
      if (get().selectedId === id) set({ selectedId: null });
      toast(t("Moved to Trash"), () => get().restore(id));
    },
    restore: (id) => get().update(id, { deleted: false }),
    destroy: (id) => {
      edits++;
      set((s) => ({ tasks: s.tasks.filter((x) => x.id !== id), selectedId: s.selectedId === id ? null : s.selectedId }));
      send(id, () => api.del(`/api/tasks/${id}`), resync);
    },
    emptyTrash: () => {
      edits++;
      set((s) => ({ tasks: s.tasks.filter((x) => x.deletedAt === null), selectedId: null }));
      send("trash", () => api.del("/api/tasks/trash"), resync);
    },

    place: (id, section, beforeId) => {
      const task = get().tasks.find((x) => x.id === id);
      if (!task) return;
      const patch: TaskPatch = {};
      // A place among the others only means something when the list is in the order set by hand.
      if (canReorder(get().sorts, get().view, section)) {
        const rest = section.tasks.filter((x) => x.id !== id);
        const at = beforeId ? rest.findIndex((x) => x.id === beforeId) : rest.length;
        const index = at < 0 ? rest.length : at;
        const order = orderBetween(rest[index - 1]?.order, rest[index]?.order);
        if (order !== task.order) patch.order = order;
      }
      if (section.drop?.due !== undefined && section.drop.due !== task.due) patch.due = section.drop.due;
      if (section.drop?.priority !== undefined && section.drop.priority !== task.priority) patch.priority = section.drop.priority;
      if (!!section.done !== (task.completedAt !== null)) patch.completed = !!section.done;
      if (!Object.keys(patch).length) return;
      track("taskDrag");
      get().update(id, patch);
    },

    setSort: (view, sort) => {
      const sorts = { ...get().sorts, [view]: sort };
      set({ sorts });
      writeJson(SORT_KEY, sorts);
    },
    setFolded: (key, value) => {
      const folded = { ...get().folded, [key]: value };
      set({ folded });
      writeJson(FOLD_KEY, folded);
    },
    focusAdd: () => set((s) => ({ addFocus: s.addFocus + 1 })),
  };
});
