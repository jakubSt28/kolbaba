"use client";

import { AlignLeft, ArchiveRestore, CalendarDays, Check, ChevronDown, ChevronRight, CircleCheckBig, GripVertical, Inbox, List, Plus, Repeat, Sun, Sunrise, Trash2, Undo2, X, type LucideIcon } from "lucide-react";
import { animate, motion, useMotionValue, useMotionValueEvent, useTransform } from "motion/react";
import { ContextMenu } from "radix-ui";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { create } from "zustand";
import { t } from "@/lib/i18n";
import { dayFrom, dropPlace, droppedInto, dueLabel, isOverdue, parseQuickAdd, priorityLabel, sectionsOf, type TaskSection } from "@/lib/tasks/logic";
import { canReorder, isFolded, sortOf, useTasks } from "@/lib/tasks/store";
import { PRIORITIES, TRASH_DAYS, viewListId, type Priority, type Task, type TaskList as TaskListType, type TaskView } from "@/lib/tasks/types";
import { useNow } from "@/lib/use-now";
import { track } from "@/lib/usage";
import { EDGE } from "@/lib/gestures";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { menuContentClass, menuItemClass, subTriggerClass } from "../ui";
import { DatePicker, PriorityFlag, PriorityMenu, TaskCheck, type DueValue } from "./task-bits";

/** What a dragged task carries (a type of its own, so mail drops ignore it). */
export const TASK_DRAG = "application/x-kolbaba-task";

/** The task being dragged, and where it would land. */
export const useTaskDrag = create<{ id: string | null; over: { section: string; before: string | null } | null }>(() => ({ id: null, over: null }));

export const isTaskDrag = (e: DragEvent) => e.dataTransfer.types.includes(TASK_DRAG);

/** A drop here changes something about the task: its day, priority, done or not. */
export function changesTask(section: TaskSection, task: Task) {
  return (
    (section.drop?.due !== undefined && section.drop.due !== task.due) ||
    (section.drop?.priority !== undefined && section.drop.priority !== task.priority) ||
    !!section.done !== (task.completedAt !== null)
  );
}

/** Where a dragged task may go: a new place in its own section, or a section that gives it something. */
const acceptsDrop = (reorder: boolean, section: TaskSection, task: Task) => (reorder && section.tasks.some((x) => x.id === task.id)) || changesTask(section, task);

export function viewTitle(view: TaskView, lists: TaskListType[]) {
  const list = viewListId(view);
  if (list) return lists.find((l) => l.id === list)?.name ?? t("Inbox@@tasks");
  return view === "today" ? t("Today") : view === "next7" ? t("Next 7 days") : view === "inbox" ? t("Inbox@@tasks") : view === "completed" ? t("Completed") : t("Trash");
}

/** A view's title as it's shown on top, with a list's emoji. */
export function useViewTitle() {
  const view = useTasks((s) => s.view);
  const list = useTasks((s) => s.lists.find((l) => l.id === viewListId(s.view)));
  const lists = useTasks((s) => s.lists);
  return list ? `${list.emoji ? `${list.emoji} ` : ""}${list.name}` : viewTitle(view, lists);
}

/** The sections on screen now, as they're drawn. */
export function useSections() {
  const tasks = useTasks((s) => s.tasks);
  const view = useTasks((s) => s.view);
  const sort = useTasks((s) => sortOf(s.sorts, s.view));
  const now = useNow();
  return useMemo(() => sectionsOf(tasks, view, sort, new Date(now)), [tasks, view, sort, now]);
}

/* ---------------------------------- List ---------------------------------- */

/** The list of a view: the line to add a task, then its sections. */
export function TaskList({ mobile }: { mobile?: boolean }) {
  const view = useTasks((s) => s.view);
  const ready = useTasks((s) => s.ready);
  const sections = useSections();
  const moreCompleted = useTasks((s) => s.moreCompleted && s.view === "completed");
  const loadingMore = useTasks((s) => s.loadingMore);
  const adds = view !== "completed" && view !== "trash";
  const empty = ready && !sections.some((s) => s.tasks.length);
  const scroller = useRef<HTMLDivElement>(null);
  const overdue = sections[0]?.key === "overdue" ? sections[0].tasks.length : 0;
  const placed = useRef<TaskView | null>(null);

  // Today and the 7 days open at today, not at the top of a long pile of what's overdue: that waits above,
  // a scroll up away. Once each time the view opens, so a scroll of your own stays where you put it.
  useLayoutEffect(() => {
    if (placed.current === view || !ready) return;
    placed.current = view;
    const box = scroller.current;
    if (!box) return;
    box.scrollTop = 0;
    if (!overdue || (view !== "today" && view !== "next7")) return;
    const next = box.querySelector<HTMLElement>('[data-section="overdue"] + [data-section]');
    // A bit of the last overdue task still shows on top, so it's clear there's more above.
    if (next) box.scrollTop = next.getBoundingClientRect().top - box.getBoundingClientRect().top - 28;
  }, [view, ready, overdue]);

  // While a finger holds a task, the list stays still under it: the finger moves the task, not the list.
  useEffect(() => {
    const box = scroller.current;
    if (!mobile || !box) return;
    const still = (e: TouchEvent) => {
      if (holding) e.preventDefault();
    };
    box.addEventListener("touchmove", still, { passive: false });
    return () => box.removeEventListener("touchmove", still);
  }, [mobile]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {adds && <QuickAdd key={view} view={view} mobile={mobile} />}
      {view === "trash" && sections.length > 0 && (
        <p className="shrink-0 px-5 pb-2 text-[12.5px] text-ink-3">{t("Tasks in Trash are deleted for good after {days} days.", { days: TRASH_DAYS })}</p>
      )}
      <div
        ref={scroller}
        data-task-scroller
        className={cn("min-h-0 flex-1 overflow-y-auto pb-24", mobile ? "px-1.5" : "px-3")}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) useTaskDrag.setState({ over: null });
        }}
      >
        {empty ? <Empty view={view} /> : sections.map((s) => <Section key={s.key} section={s} mobile={mobile} />)}
        {moreCompleted && (
          <div className="flex justify-center py-3">
            <button
              onClick={() => void useTasks.getState().loadMore()}
              disabled={loadingMore}
              className="h-8 rounded-[10px] px-3 text-[13px] font-medium text-ink-2 shadow-[inset_0_0_0_0.5px_var(--line)] hover:bg-hover hover:text-ink disabled:opacity-60"
            >
              {loadingMore ? t("Loading…") : t("Show older")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Empty({ view }: { view: TaskView }) {
  const [Icon, title, body]: [typeof Sun, string, string] =
    view === "today"
      ? [Sun, t("Nothing left for today"), t("Add a task above, or enjoy the day.")]
      : view === "next7"
        ? [CalendarDays, t("Nothing in the next 7 days"), t("Tasks with a day this week show up here.")]
        : view === "inbox"
          ? [Inbox, t("No tasks yet"), t("Type one above and press Enter. Words like “tomorrow” or “!high” at its end set its day and priority.")]
          : viewListId(view)
            ? [List, t("Nothing in this list yet"), t("Add a task above, or drag one here from another list.")]
          : view === "completed"
            ? [CircleCheckBig, t("Nothing completed yet"), t("Tasks you tick off wait here.")]
            : [Trash2, t("Trash is empty"), t("Deleted tasks wait here for {days} days.", { days: TRASH_DAYS })];
  return (
    <div className="mx-auto flex max-w-[320px] flex-col items-center px-6 pt-[12vh] text-center">
      <span className="mb-3 flex size-12 items-center justify-center rounded-[16px] bg-accent-soft text-accent-text">
        <Icon size={22} strokeWidth={1.8} />
      </span>
      <div className="text-[15px] font-semibold">{title}</div>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{body}</p>
    </div>
  );
}

/* --------------------------------- Quick add -------------------------------- */

/** "Add a task": Enter or the tick saves it. On a computer the line is then ready for the next; on a phone the keyboard
 *  goes down, so the list it went into shows. Its day and priority can be picked, or typed at its end.
 *  A long title wraps onto more lines rather than sliding out of sight, so all of it can be read and tapped into. */
function QuickAdd({ view, mobile }: { view: TaskView; mobile?: boolean }) {
  const now = new Date(useNow());
  const add = useTasks((s) => s.add);
  const focus = useTasks((s) => s.addFocus);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<{ due?: DueValue; priority?: Priority }>({});
  const listId = viewListId(view);
  const list = useTasks((s) => s.lists.find((l) => l.id === listId));
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focus) input.current?.focus({ preventScroll: true });
  }, [focus]);

  // As tall as what's written.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const parsed = parseQuickAdd(text, now);
  const base: DueValue = picked.due ?? { due: view === "today" || view === "next7" ? dayFrom(now, 0) : null, time: null, repeat: null };
  const due: DueValue = parsed.due !== undefined ? { due: parsed.due, time: parsed.time ?? null, repeat: base.repeat } : base;
  const priority = parsed.priority ?? picked.priority ?? 0;

  const submit = () => {
    const title = parsed.title.trim();
    if (!title) return;
    add({ title, due: due.due, time: due.due ? due.time : null, repeat: due.due ? due.repeat : null, priority, listId });
    if (parsed.due !== undefined || parsed.priority !== undefined) track("taskQuick");
    setText("");
    setPicked({});
    if (mobile) input.current?.blur();
  };
  const ready = !!parsed.title.trim();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className={cn(
        "group/add mb-2 flex shrink-0 items-start gap-2 rounded-[12px] bg-hover pr-1.5 pl-3 transition-shadow focus-within:bg-solid focus-within:shadow-[inset_0_0_0_1.5px_var(--accent)]",
        mobile ? "mx-2 mt-2" : "mx-4",
      )}
    >
      <span className={cn("flex shrink-0 items-center text-ink-3", mobile ? "h-11" : "h-10")}>
        <Plus size={16} />
      </span>
      <textarea
        ref={input}
        rows={1}
        value={text}
        // A title is one line: what's pasted with line breaks joins up.
        onChange={(e) => setText(e.target.value.replace(/[ \t]*[\r\n]+[ \t]*/g, " "))}
        onKeyDown={(e) => {
          if (e.key === "Escape") e.currentTarget.blur();
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        enterKeyHint="done"
        placeholder={list ? t("Add a task to {list}", { list: list.name }) : view === "inbox" ? t("Add a task to the Inbox") : t("Add a task for today")}
        aria-label={t("New task")}
        data-quick-add
        className={cn("block min-w-0 flex-1 resize-none overflow-hidden bg-transparent text-[14px] leading-5 text-ink outline-none placeholder:text-ink-3", mobile ? "py-3" : "py-2.5")}
      />
      <div className={cn("flex shrink-0 items-center gap-0.5 transition-opacity", mobile ? "h-11" : "h-10", !mobile && !text && !picked.due && !picked.priority && "opacity-0 group-focus-within/add:opacity-100 group-hover/add:opacity-100")}>
        <DatePicker value={due} onChange={(v) => setPicked((p) => ({ ...p, due: v }))} align="end">
          <button
            type="button"
            aria-label={t("Date")}
            className={cn(
              "flex h-7 items-center gap-1 rounded-[8px] px-1.5 text-[12.5px] transition-colors hover:bg-selected data-[state=open]:bg-selected",
              due.due ? (isOverdue({ ...due, completedAt: null }, now) ? "text-danger" : "text-accent-text") : "text-ink-3",
            )}
          >
            <CalendarDays size={15} />
            {due.due && <span className="whitespace-nowrap">{dueLabel(due, now)}</span>}
            {due.due && due.repeat && <Repeat size={12} />}
          </button>
        </DatePicker>
        <PriorityMenu value={priority} onChange={(p) => setPicked((x) => ({ ...x, priority: p }))}>
          <button type="button" aria-label={priorityLabel(priority)} className="flex size-7 items-center justify-center rounded-[8px] text-ink-3 transition-colors hover:bg-selected data-[state=open]:bg-selected">
            <PriorityFlag priority={priority} />
          </button>
        </PriorityMenu>
        {ready && (
          <button
            type="submit"
            aria-label={t("Add task")}
            // On a computer the cursor stays in the line, for the next task.
            onMouseDown={(e) => !mobile && e.preventDefault()}
            className={cn(
              "press ml-0.5 flex shrink-0 items-center justify-center rounded-full bg-accent text-on-accent [--press-scale:0.9] hover:bg-accent-hover",
              mobile ? "size-8" : "size-7",
            )}
          >
            <Check size={mobile ? 17 : 15} strokeWidth={2.6} />
          </button>
        )}
      </div>
    </form>
  );
}

/* --------------------------------- Sections --------------------------------- */

function Section({ section, mobile }: { section: TaskSection; mobile?: boolean }) {
  const view = useTasks((s) => s.view);
  const folded = useTasks((s) => isFolded(s.folded, view, section));
  const setFolded = useTasks((s) => s.setFolded);
  const reorder = useTasks((s) => canReorder(s.sorts, view, section));
  const sort = useTasks((s) => sortOf(s.sorts, view));
  const dragId = useTaskDrag((s) => s.id);
  const over = useTaskDrag((s) => (s.over?.section === section.key ? s.over : null));
  const dragged = useTasks((s) => (dragId ? s.tasks.find((x) => x.id === dragId) : undefined));
  const accepts = !!dragged && acceptsDrop(reorder, section, dragged);
  // The line shows where it will really land: sorted by date, a task stays among those of its day and priority.
  const lineAt = over && accepts && reorder ? (dropPlace(section.tasks, droppedInto(section, dragged), sort, over.before)?.before ?? over.before) : undefined;

  const onDragOver = (e: DragEvent, before: string | null) => {
    if (!accepts || !isTaskDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const was = useTaskDrag.getState().over;
    if (was?.section !== section.key || was.before !== before) useTaskDrag.setState({ over: { section: section.key, before } });
  };
  const onDrop = (e: DragEvent) => {
    const { id, over: target } = useTaskDrag.getState();
    useTaskDrag.setState({ id: null, over: null });
    if (!id || !accepts || !isTaskDrag(e)) return;
    e.preventDefault();
    useTasks.getState().place(id, section, target?.section === section.key ? target.before : null);
  };

  return (
    <section
      data-section={section.key}
      onDragOver={(e) => onDragOver(e, useTaskDrag.getState().over?.section === section.key ? (useTaskDrag.getState().over?.before ?? null) : null)}
      onDrop={onDrop}
      className={cn("relative mb-1 rounded-[12px] transition-colors", over && accepts && !reorder && "bg-accent-soft shadow-[inset_0_0_0_1.5px_var(--accent)]")}
    >
      {section.title && (
        <button
          data-section-title
          onClick={() => setFolded(`${view}:${section.key}`, !folded)}
          onDragOver={(e) => onDragOver(e, section.tasks[0]?.id ?? null)}
          aria-expanded={!folded}
          className="flex h-9 w-full items-center gap-1.5 rounded-[10px] px-2 text-left text-[13px] font-semibold text-ink"
        >
          <ChevronDown size={14} className={cn("shrink-0 text-ink-3 transition-transform", folded && "-rotate-90")} />
          <span className="truncate">{section.title}</span>
          {section.hint && <span className="shrink-0 font-normal text-ink-3">{section.hint}</span>}
          <span className="shrink-0 text-[12px] font-normal text-ink-3 tabular-nums">{section.tasks.length}</span>
        </button>
      )}
      {!folded &&
        section.tasks.map((task, i) => (
          <TaskRow
            key={task.id}
            task={task}
            mobile={mobile}
            line={lineAt === task.id}
            onDragOver={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onDragOver(e, e.clientY < r.top + r.height / 2 ? task.id : (section.tasks[i + 1]?.id ?? null));
            }}
          />
        ))}
      {!folded && lineAt === null && section.tasks.length > 0 && <span className="pointer-events-none absolute right-3 bottom-0 left-9 h-[2px] rounded-full bg-accent" />}
    </section>
  );
}

/* ------------------------------------ Row ----------------------------------- */

/** How long a finger rests on a task to pick it (as on a conversation). */
const LONG_PRESS_MS = 420;

/** A finger holds a task down (a long press): the list doesn't scroll under it. */
let holding = false;

/**
 * On a phone a long press picks the task; while any is picked, a tap picks or drops one more.
 * A task that can move is held instead: let go and it's picked, move the finger and the task goes with it.
 */
function useLongPress(id: string, enabled: boolean, movable: boolean) {
  const press = useRef<{ x: number; y: number; pointer: number; row: HTMLElement; held: boolean; timer: ReturnType<typeof setTimeout> } | null>(null);
  const firedRef = useRef(false);
  const [held, setHeld] = useState(false);
  const pick = () => {
    const { checked, toggleChecked } = useTasks.getState();
    if (!checked.includes(id)) toggleChecked(id);
  };
  const cancel = () => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    clearTimeout(p.timer);
    if (p.held) {
      holding = false;
      setHeld(false);
    }
  };
  useEffect(() => cancel, []);
  if (!enabled) return { firedRef, held };
  return {
    firedRef,
    held,
    handlers: {
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        if (e.pointerType === "mouse") return;
        firedRef.current = false;
        cancel();
        const p = {
          x: e.clientX,
          y: e.clientY,
          pointer: e.pointerId,
          row: e.currentTarget,
          held: false,
          timer: setTimeout(() => {
            firedRef.current = true;
            haptic("tick");
            if (!movable) {
              press.current = null;
              return pick();
            }
            p.held = true;
            holding = true;
            setHeld(true);
          }, LONG_PRESS_MS),
        };
        press.current = p;
      },
      onPointerMove: (e: PointerEvent) => {
        const p = press.current;
        if (!p) return;
        const far = Math.hypot(e.clientX - p.x, e.clientY - p.y);
        // Moving before the press is long enough is a scroll.
        if (!p.held) return void (far > 8 && cancel());
        if (far < 6) return;
        press.current = null;
        setHeld(false);
        dragByTouch(id, p.row, p.pointer, p.y, e.clientX, e.clientY);
      },
      onPointerUp: () => {
        if (press.current?.held) pick();
        cancel();
      },
      onPointerCancel: cancel,
      onContextMenu: (e: MouseEvent) => e.preventDefault(),
    },
  };
}

/** How close to the list's top or bottom edge a dragged task scrolls it. */
const SCROLL_EDGE = 64;

/**
 * A task moved by a finger: a copy of it follows the finger, the line shows where it will land,
 * the list scrolls near its edges, and letting go puts it there, as a drag with the mouse does.
 */
function dragByTouch(id: string, row: HTMLElement, pointer: number, startY: number, x0: number, y0: number) {
  const scroller = row.closest<HTMLElement>("[data-task-scroller]");
  const rect = row.getBoundingClientRect();
  const ghost = row.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("data-task");
  ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: "0",
    zIndex: "60",
    pointerEvents: "none",
    background: "var(--solid)",
    boxShadow: "var(--shadow-panel)",
  });
  document.body.appendChild(ghost);
  holding = true;
  useTaskDrag.setState({ id, over: null });
  let x = x0;
  let y = y0;
  let frame = 0;

  const aim = () => {
    const el = document.elementFromPoint(x, y);
    const sectionEl = el?.closest<HTMLElement>("[data-section]");
    if (!el || !sectionEl) {
      // Between two sections the last place stands; off the list there's none.
      if (!scroller?.contains(el)) useTaskDrag.setState({ over: null });
      return;
    }
    const key = sectionEl.dataset.section!;
    const rows = [...sectionEl.querySelectorAll<HTMLElement>("[data-task]")];
    const rowEl = el.closest<HTMLElement>("[data-task]");
    const was = useTaskDrag.getState().over;
    let before: string | null;
    if (rowEl) {
      const r = rowEl.getBoundingClientRect();
      before = y < r.top + r.height / 2 ? rowEl.dataset.task! : (rows[rows.indexOf(rowEl) + 1]?.dataset.task ?? null);
    } else if (el.closest("[data-section-title]")) before = rows[0]?.dataset.task ?? null;
    else before = was?.section === key ? was.before : null;
    if (was?.section !== key || was.before !== before) useTaskDrag.setState({ over: { section: key, before } });
  };

  const scroll = () => {
    frame = 0;
    if (!scroller) return;
    const box = scroller.getBoundingClientRect();
    const by = y < box.top + SCROLL_EDGE ? y - box.top - SCROLL_EDGE : y > box.bottom - SCROLL_EDGE ? y - box.bottom + SCROLL_EDGE : 0;
    if (!by) return;
    const was = scroller.scrollTop;
    scroller.scrollTop += Math.max(-16, Math.min(16, by / 4));
    if (scroller.scrollTop === was) return;
    aim();
    frame = requestAnimationFrame(scroll);
  };

  const move = (e: globalThis.PointerEvent) => {
    if (e.pointerId !== pointer) return;
    x = e.clientX;
    y = e.clientY;
    ghost.style.top = `${rect.top + y - startY}px`;
    aim();
    if (!frame) frame = requestAnimationFrame(scroll);
  };

  const end = (e: globalThis.PointerEvent) => {
    if (e.pointerId !== pointer) return;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    cancelAnimationFrame(frame);
    ghost.remove();
    holding = false;
    const { over } = useTaskDrag.getState();
    useTaskDrag.setState({ id: null, over: null });
    if (e.type !== "pointerup" || !over) return;
    const s = useTasks.getState();
    const task = s.tasks.find((t) => t.id === id);
    const section = sectionsOf(s.tasks, s.view, sortOf(s.sorts, s.view), new Date()).find((x) => x.key === over.section);
    if (!task || !section || !acceptsDrop(canReorder(s.sorts, s.view, section), section, task)) return;
    s.place(id, section, over.before);
    haptic("soft");
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
  ghost.style.top = `${rect.top + y - startY}px`;
  aim();
}

function TaskRow({ task, mobile, line, onDragOver }: { task: Task; mobile?: boolean; line: boolean; onDragOver: (e: DragEvent<HTMLDivElement>) => void }) {
  const now = new Date(useNow());
  const view = useTasks((s) => s.view);
  const selected = useTasks((s) => s.selectedId === task.id);
  const picking = useTasks((s) => !!mobile && s.checked.length > 0);
  const checked = useTasks((s) => !!mobile && s.checked.includes(task.id));
  const { select, complete, update, toggleChecked } = useTasks.getState();
  const trashed = task.deletedAt !== null;
  const { firedRef, held, handlers: pressHandlers } = useLongPress(task.id, !!mobile, !trashed && view !== "completed");
  const dragging = useTaskDrag((s) => s.id === task.id);
  const done = task.completedAt !== null;
  const overdue = isOverdue(task, now);
  const today = task.due === dayFrom(now, 0);
  const label = dueLabel(task, now);
  const editable = !mobile && !trashed;
  /** Where the caret goes in the title being rewritten here, or null when it isn't. */
  const [editing, setEditing] = useState<number | null>(null);
  const draggable = !mobile && !trashed && editing === null;
  // Where it lives, when the view gathers tasks from every list (as TickTick shows "Inbox" there).
  const list = useTasks((s) => (s.lists.length && !viewListId(s.view) && s.view !== "inbox" ? (task.listId ? (s.lists.find((l) => l.id === task.listId) ?? null) : "inbox") : null));

  const row = (
    <div
      data-task={task.id}
      {...pressHandlers}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData(TASK_DRAG, task.id);
        e.dataTransfer.effectAllowed = "move";
        select(task.id);
        useTaskDrag.setState({ id: task.id, over: null });
      }}
      onDragEnd={() => useTaskDrag.setState({ id: null, over: null })}
      onDragOver={onDragOver}
      onClick={() => {
        // The click that ends a long press isn't a tap.
        if (firedRef.current) return void (firedRef.current = false);
        if (picking) toggleChecked(task.id);
        else select(task.id);
      }}
      aria-selected={picking ? checked : selected}
      className={cn(
        "group/task relative flex cursor-default items-center gap-3 rounded-[10px] pr-3 pl-3 transition-[background-color,scale,box-shadow]",
        mobile ? "h-12 [-webkit-touch-callout:none] select-none" : "h-11",
        selected || checked ? "bg-selected" : "hover:bg-hover",
        // Held by a finger: lifted off the list, ready to move.
        held && "z-10 scale-[1.02] bg-solid shadow-[var(--shadow-panel)]",
        dragging && "opacity-40",
      )}
    >
      {line && <span className="pointer-events-none absolute -top-px right-3 left-9 h-[2px] rounded-full bg-accent" />}
      {draggable && view !== "completed" && (
        <GripVertical size={13} className="absolute top-1/2 -left-2.5 -translate-y-1/2 cursor-grab text-ink-3 opacity-0 transition-opacity group-hover/task:opacity-100" />
      )}
      {picking ? (
        <span
          aria-hidden
          className={cn("flex size-[19px] shrink-0 items-center justify-center rounded-full transition-colors", checked ? "bg-accent text-on-accent" : "shadow-[inset_0_0_0_1.5px_var(--ink-3)]")}
        >
          {checked && <Check size={12} strokeWidth={3.2} />}
        </span>
      ) : (
        <TaskCheck task={task} disabled={trashed} onToggle={() => complete(task.id, !done)} />
      )}
      <div className={cn("flex min-w-0 flex-1 items-center gap-2 self-stretch border-b border-line transition-colors group-hover/task:border-transparent", selected && "border-transparent")}>
        {editing !== null ? (
          <TitleInput task={task} caret={editing} onDone={() => setEditing(null)} />
        ) : (
          <span className={cn("min-w-0 flex-1 truncate text-[14px]", done || trashed ? "text-ink-3" : "text-ink", done && "line-through decoration-ink-3/60", !task.title && "text-ink-3 italic")}>
            <span
              // On the computer a click on the words rewrites them right here; the task opens alongside as with any click.
              onClick={editable ? (e) => setEditing(caretAt(e)) : undefined}
              className={cn(editable && "cursor-text")}
            >
              {task.title || t("(No title)")}
            </span>
          </span>
        )}
        {list && !mobile && (
          <span className="max-w-[140px] shrink-0 truncate text-[12px] text-ink-3">{list === "inbox" ? t("Inbox@@tasks") : `${list.emoji ? `${list.emoji} ` : ""}${list.name}`}</span>
        )}
        {task.notes && <AlignLeft size={13} aria-label={t("Has a description")} className="shrink-0 text-ink-3" />}
        {task.repeat && task.due && !done && <Repeat size={12} aria-label={t("Repeats")} className="shrink-0 text-ink-3" />}
        {label &&
          (done || trashed || picking ? (
            <span className={cn("shrink-0 text-[12px] whitespace-nowrap tabular-nums", done || trashed ? "text-ink-3" : overdue ? "text-danger" : today ? "text-accent-text" : "text-ink-3")}>{label}</span>
          ) : (
            // The day changes right here, without opening the task. The picker is portalled, but its clicks
            // still bubble through React to the row, which would open the task: they stop at this span.
            <span className="flex shrink-0 self-stretch" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
              <DatePicker
                align="end"
                value={{ due: task.due, time: task.time, repeat: task.repeat }}
                onChange={(v) => update(task.id, { due: v.due, time: v.due ? v.time : null, repeat: v.due ? v.repeat : null })}
              >
                <button
                  aria-label={t("Change the date: {date}", { date: label })}
                  className={cn(
                    "-mr-1.5 flex items-center self-center rounded-[7px] px-1.5 text-[12px] whitespace-nowrap tabular-nums transition-colors hover:bg-ink/[0.06] data-[state=open]:bg-ink/[0.06]",
                    mobile ? "h-9" : "h-7",
                    overdue ? "text-danger" : today ? "text-accent-text" : "text-ink-3",
                  )}
                >
                  {label}
                </button>
              </DatePicker>
            </span>
          ))}
      </div>
    </div>
  );
  // A phone has the long press and the swipes instead: a right-click menu would open there too, small and in the way.
  return mobile ? (
    <SwipeTask task={task} enabled={!picking && editing === null}>
      {row}
    </SwipeTask>
  ) : (
    <TaskContextMenu task={task}>{row}</TaskContextMenu>
  );
}

/** How far a task is swiped before letting go does its action (as far as a conversation). */
const SWIPE_AT = 88;

interface SwipeAction {
  label: string;
  icon: LucideIcon;
  tone: string;
  run: () => void;
  /** The task leaves the list: it slides out before the action. */
  leaves?: boolean;
}

/**
 * On a phone a task swipes like a conversation: to the right it's done (or not done again, or back
 * from Trash), to the left it goes to Trash. Touch events, so a long press that's holding the task
 * to move it, or a swipe in from the screen's edge to open the drawer, aren't taken for a swipe.
 */
function SwipeTask({ task, enabled, children }: { task: Task; enabled: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const trashed = task.deletedAt !== null;
  const done = task.completedAt !== null;
  const { complete, remove, restore } = useTasks.getState();
  const right: SwipeAction = trashed
    ? { label: t("Restore"), icon: ArchiveRestore, tone: "bg-accent text-on-accent", run: () => restore(task.id), leaves: true }
    : { label: done ? t("Not done") : t("Done"), icon: done ? Undo2 : Check, tone: "bg-success text-white", run: () => complete(task.id, !done) };
  const left: SwipeAction | null = trashed ? null : { label: t("Delete"), icon: Trash2, tone: "bg-danger text-white", run: () => remove(task.id), leaves: true };
  const actions = useRef({ right, left, enabled });
  useEffect(() => {
    actions.current = { right, left, enabled };
  });

  const rightOpacity = useTransform(x, [12, 64], [0, 1]);
  const leftOpacity = useTransform(x, [-64, -12], [1, 0]);
  // Past the threshold the action is armed, and the phone taps.
  const armed = useRef<"left" | "right" | null>(null);
  useMotionValueEvent(x, "change", (v) => {
    const side = v >= SWIPE_AT ? "right" : v <= -SWIPE_AT && actions.current.left ? "left" : null;
    if (side === armed.current) return;
    armed.current = side;
    if (side) haptic("tick");
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let touch: { x: number; y: number; decided: boolean | null } | null = null;
    const start = (e: TouchEvent) => {
      const f = e.touches.length === 1 ? e.touches[0] : null;
      touch = f && actions.current.enabled && f.clientX > EDGE ? { x: f.clientX, y: f.clientY, decided: null } : null;
    };
    const move = (e: TouchEvent) => {
      const f = e.touches[0];
      if (!touch || touch.decided === false || !f) return;
      const dx = f.clientX - touch.x;
      const dy = f.clientY - touch.y;
      if (touch.decided === null) {
        if (Math.hypot(dx, dy) < 10) return;
        // Held to be moved, a task follows the finger up and down instead.
        touch.decided = !holding && Math.abs(dx) > Math.abs(dy) * 1.2;
        if (!touch.decided) return;
        x.stop();
      }
      if (e.cancelable) e.preventDefault();
      const along = dx - Math.sign(dx) * 10;
      x.set(along < 0 && !actions.current.left ? along * 0.15 : along);
    };
    const end = () => {
      const was = touch;
      touch = null;
      if (!was?.decided) return;
      const v = x.get();
      const action = v >= SWIPE_AT ? actions.current.right : v <= -SWIPE_AT ? actions.current.left : null;
      if (!action) return void animate(x, 0, { type: "spring", stiffness: 620, damping: 42 });
      if (!action.leaves) {
        haptic("soft");
        action.run();
        return void animate(x, 0, { type: "spring", stiffness: 620, damping: 42 });
      }
      const out = v < 0 ? -el.offsetWidth : el.offsetWidth;
      void animate(x, out, { duration: 0.18, ease: [0.25, 0.6, 0.4, 1] }).then(() => {
        action.run();
        // Still here a moment later (Undo, or it didn't go): back in place.
        setTimeout(() => x.jump(0), 400);
      });
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end, { passive: true });
    el.addEventListener("touchcancel", end, { passive: true });
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, [x]);

  return (
    <div ref={ref} className="relative">
      <div aria-hidden className="absolute inset-0 flex overflow-hidden rounded-[10px]">
        <motion.div style={{ opacity: rightOpacity }} className={cn("flex flex-1 items-center pl-5", right.tone)}>
          <span className="flex flex-col items-center gap-0.5 text-[11px] font-medium">
            <right.icon size={19} />
            {right.label}
          </span>
        </motion.div>
        {left && (
          <motion.div style={{ opacity: leftOpacity }} className={cn("flex flex-1 items-center justify-end pr-5", left.tone)}>
            <span className="flex flex-col items-center gap-0.5 text-[11px] font-medium">
              <left.icon size={19} />
              {left.label}
            </span>
          </motion.div>
        )}
      </div>
      <motion.div style={{ x }} className="relative rounded-[10px] bg-solid">
        {children}
      </motion.div>
    </div>
  );
}

/** How far into the clicked words the click landed, so the caret goes there. */
function caretAt(e: MouseEvent<HTMLElement>) {
  const el = e.currentTarget;
  const end = el.textContent?.length ?? 0;
  const doc = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
  const pos = document.caretPositionFromPoint?.(e.clientX, e.clientY);
  if (pos && el.contains(pos.offsetNode)) return pos.offset;
  const range = doc.caretRangeFromPoint?.(e.clientX, e.clientY);
  if (range && el.contains(range.startContainer)) return range.startOffset;
  return end;
}

/** A task's title rewritten in its row: Enter or a click away saves it, Escape leaves it as it was. */
function TitleInput({ task, caret, onDone }: { task: Task; caret: number; onDone: () => void }) {
  const [value, setValue] = useState(task.title);
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const at = task.title ? Math.min(caret, task.title.length) : 0;
    el.setSelectionRange(at, at);
    // Only on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const title = value.replace(/\s+/g, " ").trim();
    // An emptied line puts back what was there: a task isn't left without a name by a slip.
    if (save && title && title !== task.title) useTasks.getState().update(task.id, { title });
    onDone();
  };

  return (
    <input
      ref={input}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      }}
      // The row's own clicks would open the task again; a right click gets the usual copy and paste.
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      enterKeyHint="done"
      aria-label={t("Title")}
      className={cn("h-7 min-w-0 flex-1 bg-transparent text-[14px] outline-none", task.completedAt !== null ? "text-ink-3 line-through decoration-ink-3/60" : "text-ink")}
    />
  );
}

/* -------------------------------- Right click -------------------------------- */

const iconItem = "flex h-9 flex-1 cursor-pointer items-center justify-center rounded-lg text-ink-2 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-on-accent";

/** A task's quick changes on a right click: its day, its priority, Trash. */
function TaskContextMenu({ task, children }: { task: Task; children: ReactNode }) {
  const { update, complete, remove, restore, destroy } = useTasks.getState();
  const lists = useTasks((s) => s.lists);
  const now = new Date();
  const trashed = task.deletedAt !== null;
  const days: { label: string; icon: ReactNode; due: string | null }[] = [
    { label: t("Today"), icon: <Sun size={17} />, due: dayFrom(now, 0) },
    { label: t("Tomorrow"), icon: <Sunrise size={17} />, due: dayFrom(now, 1) },
    { label: t("Next week"), icon: <CalendarDays size={17} />, due: dayFrom(now, 7) },
    { label: t("No date"), icon: <X size={17} />, due: null },
  ];
  return (
    <ContextMenu.Root modal={false}>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content collisionPadding={8} className={cn(menuContentClass, "w-[220px]")}>
          {trashed ? (
            <>
              <ContextMenu.Item className={menuItemClass} onSelect={() => restore(task.id)}>
                <ArchiveRestore size={14} /> {t("Restore")}
              </ContextMenu.Item>
              <ContextMenu.Item className={menuItemClass} onSelect={() => destroy(task.id)}>
                <Trash2 size={14} /> {t("Delete forever")}
              </ContextMenu.Item>
            </>
          ) : (
            <>
              <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-ink-3">{t("Date")}</div>
              <div className="flex gap-0.5">
                {days.map((d) => (
                  <ContextMenu.Item key={d.label} aria-label={d.label} title={d.label} className={iconItem} onSelect={() => update(task.id, { due: d.due })}>
                    {d.icon}
                  </ContextMenu.Item>
                ))}
              </div>
              <div className="px-2.5 pt-2 pb-1 text-[11px] font-medium text-ink-3">{t("Priority")}</div>
              <div className="flex gap-0.5">
                {PRIORITIES.map((p) => (
                  <ContextMenu.Item key={p} aria-label={priorityLabel(p)} title={priorityLabel(p)} className={cn(iconItem, "group relative")} onSelect={() => update(task.id, { priority: p })}>
                    <span className="group-data-[highlighted]:[&_.task-flag]:[--c:var(--on-accent)]">
                      <PriorityFlag priority={p} size={16} />
                    </span>
                    {task.priority === p && <span className="absolute bottom-1 size-1 rounded-full bg-current" />}
                  </ContextMenu.Item>
                ))}
              </div>
              <ContextMenu.Separator className="my-1 h-px bg-line" />
              {lists.some((l) => l.kind === "list") && (
                <ContextMenu.Sub>
                  <ContextMenu.SubTrigger className={subTriggerClass}>
                    <List size={14} /> <span className="flex-1">{t("Move to list")}</span>
                    <ChevronRight size={14} />
                  </ContextMenu.SubTrigger>
                  <ContextMenu.Portal>
                    <ContextMenu.SubContent sideOffset={4} collisionPadding={8} className={cn(menuContentClass, "max-h-[60vh] w-[220px] overflow-y-auto")}>
                      <ListChoices current={task.listId} onPick={(listId) => update(task.id, { listId })} Item={ContextMenu.Item} />
                    </ContextMenu.SubContent>
                  </ContextMenu.Portal>
                </ContextMenu.Sub>
              )}
              <ContextMenu.Item className={menuItemClass} onSelect={() => complete(task.id, task.completedAt === null)}>
                <Check size={14} /> {task.completedAt === null ? t("Mark as done") : t("Mark as not done")}
              </ContextMenu.Item>
              <ContextMenu.Item className={menuItemClass} onSelect={() => remove(task.id)}>
                <Trash2 size={14} /> {t("Delete")}
              </ContextMenu.Item>
            </>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/** The Inbox and every list, folders' lists under their folder: where a task can go. */
export function ListChoices({
  current,
  onPick,
  Item,
}: {
  current: string | null;
  onPick: (listId: string | null) => void;
  /** The menu's own item (a right-click menu's or a dropdown's). */
  Item: React.ComponentType<{ className?: string; onSelect?: () => void; children?: ReactNode }>;
}) {
  const lists = useTasks((s) => s.lists);
  const ordered = [...lists].sort((a, b) => a.order - b.order);
  const top = ordered.filter((l) => !l.folderId);
  const row = (l: { id: string | null; name: string; emoji: string | null }, indent = false) => (
    <Item key={l.id ?? "inbox"} className={cn(menuItemClass, indent && "pl-6")} onSelect={() => onPick(l.id)}>
      <span className="inline-flex w-4 justify-center">{l.id === null ? <Inbox size={14} /> : l.emoji ? <span className="text-[13px] leading-none">{l.emoji}</span> : <List size={14} />}</span>
      <span className="min-w-0 flex-1 truncate">{l.name}</span>
      {current === l.id && <Check size={14} />}
    </Item>
  );
  return (
    <>
      {row({ id: null, name: t("Inbox@@tasks"), emoji: null })}
      {top.map((l) =>
        l.kind === "folder" ? (
          <div key={l.id}>
            <div className="px-2.5 pt-1.5 pb-0.5 text-[11px] font-medium text-ink-3">{`${l.emoji ? `${l.emoji} ` : ""}${l.name}`}</div>
            {ordered.filter((x) => x.folderId === l.id).map((x) => row(x, true))}
          </div>
        ) : (
          row(l)
        ),
      )}
    </>
  );
}
