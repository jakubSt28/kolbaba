"use client";

import { create } from "zustand";
import { t } from "../i18n";
import { api, LIVE } from "../live";
import { useMail } from "../store";
import { track } from "../usage";
import { dayFrom, dueLabel, orderBetween, splitEmoji, topOrder, type TaskSection } from "./logic";
import { buildMockLists, buildMockTasks } from "./mock";
import { nextDue } from "./repeat";
import { newListId, newTaskId, viewListId, type Task, type TaskList, type TaskPatch, type TaskSort, type TaskView, type TasksPage } from "./types";

/**
 * The tasks' own store, beside the mail's and the calendar's. Every change shows at once and goes
 * to the server behind it; the changes of one task go one after another, so a task can be written
 * in while the server is still saving it.
 */

interface TasksState {
  /** Loaded (the prototype is from the start). */
  ready: boolean;
  tasks: Task[];
  /** Lists and folders, in their order. */
  lists: TaskList[];
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
  /** A new list or folder at the end ("🏡 Garden": the emoji goes in place of its icon). */
  addList: (kind: TaskList["kind"], name: string, folderId?: string | null) => TaskList;
  renameList: (id: string, name: string) => void;
  /** Into a folder (or out of one, with null), at its end. */
  moveListTo: (id: string, folderId: string | null) => void;
  /** One place up or down among the lists and folders beside it. */
  stepList: (id: string, delta: -1 | 1) => void;
  /** A list's open tasks go to Trash; a folder's lists stay, outside it. */
  deleteList: (id: string) => void;
  /** A TickTick backup: what came over, or an error's message. */
  importTickTick: (csv: string) => Promise<{ tasks: number; lists: number; skipped: number } | string>;
}

const VIEW_KEY = "kolbaba.tasks.view";
const SORT_KEY = "kolbaba.tasks.sort";
const FOLD_KEY = "kolbaba.tasks.folded";

const VIEWS: TaskView[] = ["today", "next7", "inbox", "completed", "trash"];
/** A view saved last time that's still there (a list may have gone since). */
const knownView = (view: TaskView | null, lists: TaskList[]) => !!view && (VIEWS.includes(view) || lists.some((l) => l.kind === "list" && l.id === viewListId(view)));

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
export const isFolded = (folded: Record<string, boolean>, view: TaskView, section: TaskSection) =>
  folded[`${view}:${section.key}`] ?? (!!section.done && (view === "inbox" || viewListId(view) !== null));

/** The lists and folders at the top of the sidebar, or inside one folder, in their order. */
export const siblingsOf = (lists: TaskList[], folderId: string | null) => lists.filter((l) => l.folderId === folderId).sort((a, b) => a.order - b.order);

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
  delete (next as TaskPatch).doneId;
  if (rest.due === null) {
    next.time = null;
    next.repeat = null;
  }
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
    set({ tasks: page.tasks, lists: page.lists, moreCompleted: page.moreCompleted, ready: true });
    if (!knownView(get().view, page.lists)) set({ view: "inbox" });
  };
  const sendList = (id: string, request: () => Promise<unknown>) => send(`list:${id}`, request, resync);

  return {
    ready: !LIVE,
    tasks: LIVE ? [] : buildMockTasks(),
    lists: LIVE ? [] : buildMockLists(),
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
        // A list's view is checked once the lists are here (load).
        set({ sorts: readJson(SORT_KEY, {}), folded: readJson(FOLD_KEY, {}), ...(view && (LIVE || knownView(view, get().lists)) ? { view } : {}) });
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
        listId: null,
        repeat: null,
        ...input,
      };
      edits++;
      set((s) => ({ tasks: [task, ...s.tasks] }));
      track("taskNew");
      send(
        task.id,
        () =>
          api.post("/api/tasks", { id: task.id, title: task.title, notes: task.notes, priority: task.priority, due: task.due, time: task.time, order: task.order, listId: task.listId, repeat: task.repeat }),
        () => set((s) => ({ tasks: s.tasks.filter((x) => x.id !== task.id) })),
      );
      return task;
    },

    update: (id, patch) => {
      if (!get().tasks.some((x) => x.id === id)) return;
      patchLocal(id, patch);
      if (patch.due !== undefined || patch.time !== undefined) track("taskDate");
      if (patch.priority !== undefined) track("taskPriority");
      if (patch.repeat) track("taskRepeat");
      send(id, () => api.patch(`/api/tasks/${id}`, patch), resync);
    },

    complete: (id, done) => {
      const task = get().tasks.find((x) => x.id === id);
      if (!task) return;
      const next = done && task.repeat && task.due && task.completedAt === null ? nextDue(task.due, task.repeat, dayFrom(new Date(), 0)) : null;
      if (!next) {
        get().update(id, { completed: done });
        if (!done) return;
        track("taskDone");
        return toast(t("Task completed"), () => get().update(id, { completed: false }));
      }
      // One time of a repeating task: a completed copy stays in Completed, the task moves on to its next day.
      const copy: Task = { ...task, id: newTaskId(), repeat: null, completedAt: Date.now(), createdAt: Date.now() };
      edits++;
      set((s) => ({ tasks: [copy, ...s.tasks.map((x) => (x.id === id ? { ...x, due: next } : x))] }));
      track("taskDone");
      send(id, () => api.patch(`/api/tasks/${id}`, { due: next, doneId: copy.id }), resync);
      toast(t("Done. Next time: {when}", { when: dueLabel({ due: next, time: task.time }, new Date()) }), () => {
        edits++;
        set((s) => ({ tasks: s.tasks.filter((x) => x.id !== copy.id).map((x) => (x.id === id ? { ...x, due: task.due } : x)) }));
        send(
          id,
          async () => {
            await api.del(`/api/tasks/${copy.id}`);
            await api.patch(`/api/tasks/${id}`, { due: task.due });
          },
          resync,
        );
      });
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

    addList: (kind, full, folderId = null) => {
      const { emoji, name } = splitEmoji(full);
      const siblings = siblingsOf(get().lists, kind === "folder" ? null : folderId);
      const list: TaskList = { id: newListId(), kind, name, emoji, folderId: kind === "folder" ? null : folderId, order: (siblings.at(-1)?.order ?? 0) + 1024 };
      edits++;
      set((s) => ({ lists: [...s.lists, list] }));
      track("taskList");
      sendList(list.id, () => api.post("/api/tasks/lists", list));
      return list;
    },
    renameList: (id, full) => {
      const { emoji, name } = splitEmoji(full);
      if (!name) return;
      edits++;
      set((s) => ({ lists: s.lists.map((l) => (l.id === id ? { ...l, name, emoji } : l)) }));
      sendList(id, () => api.patch(`/api/tasks/lists/${id}`, { name, emoji }));
    },
    moveListTo: (id, folderId) => {
      const order = (siblingsOf(get().lists, folderId).at(-1)?.order ?? 0) + 1024;
      edits++;
      set((s) => ({ lists: s.lists.map((l) => (l.id === id ? { ...l, folderId, order } : l)) }));
      sendList(id, () => api.patch(`/api/tasks/lists/${id}`, { folderId, order }));
    },
    stepList: (id, delta) => {
      const list = get().lists.find((l) => l.id === id);
      if (!list) return;
      const siblings = siblingsOf(get().lists, list.folderId);
      const at = siblings.findIndex((l) => l.id === id);
      const other = siblings[at + delta];
      if (!other) return;
      // The two swap places.
      edits++;
      set((s) => ({ lists: s.lists.map((l) => (l.id === id ? { ...l, order: other.order } : l.id === other.id ? { ...l, order: list.order } : l)) }));
      sendList(id, () => api.patch(`/api/tasks/lists/${id}`, { order: other.order }));
      sendList(other.id, () => api.patch(`/api/tasks/lists/${other.id}`, { order: list.order }));
    },
    deleteList: (id) => {
      const list = get().lists.find((l) => l.id === id);
      if (!list) return;
      edits++;
      const now = Date.now();
      set((s) => ({
        lists: s.lists.filter((l) => l.id !== id).map((l) => (l.folderId === id ? { ...l, folderId: null } : l)),
        tasks:
          list.kind === "list"
            ? s.tasks.map((x) => (x.listId !== id ? x : x.completedAt === null ? { ...x, listId: null, deletedAt: x.deletedAt ?? now } : { ...x, listId: null }))
            : s.tasks,
        view: s.view === `list:${id}` ? "inbox" : s.view,
      }));
      sendList(id, () => api.del(`/api/tasks/lists/${id}`));
    },
    importTickTick: async (csv) => {
      if (!LIVE) return t("The prototype can't import. Sign in to Kolbaba first.");
      try {
        const result = await api.post<{ tasks: number; lists: number; skipped: number }>("/api/tasks/import", { csv, tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
        track("taskImport");
        edits++;
        await load(true);
        return result;
      } catch (err) {
        return (err as Error).message || t("That didn't work. Try again.");
      }
    },
  };
});
