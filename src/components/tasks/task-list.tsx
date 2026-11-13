"use client";

import { AlignLeft, ArchiveRestore, CalendarDays, Check, ChevronDown, CircleCheckBig, GripVertical, Inbox, Plus, Sun, Sunrise, Trash2, X } from "lucide-react";
import { ContextMenu } from "radix-ui";
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { create } from "zustand";
import { t } from "@/lib/i18n";
import { dayFrom, dueLabel, isOverdue, parseQuickAdd, priorityLabel, sectionsOf, type TaskSection } from "@/lib/tasks/logic";
import { canReorder, isFolded, sortOf, useTasks } from "@/lib/tasks/store";
import { PRIORITIES, TRASH_DAYS, type Priority, type Task, type TaskView } from "@/lib/tasks/types";
import { useNow } from "@/lib/use-now";
import { track } from "@/lib/usage";
import { cn } from "@/lib/utils";
import { menuContentClass, menuItemClass } from "../ui";
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

export function viewTitle(view: TaskView) {
  return view === "today" ? t("Today") : view === "next7" ? t("Next 7 days") : view === "inbox" ? t("Inbox@@tasks") : view === "completed" ? t("Completed") : t("Trash");
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
  const adds = view === "today" || view === "next7" || view === "inbox";
  const empty = ready && !sections.some((s) => s.tasks.length);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {adds && <QuickAdd key={view} view={view} mobile={mobile} />}
      {view === "trash" && sections.length > 0 && (
        <p className="shrink-0 px-5 pb-2 text-[12.5px] text-ink-3">{t("Tasks in Trash are deleted for good after {days} days.", { days: TRASH_DAYS })}</p>
      )}
      <div
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

/** "Add a task": Enter saves it and the line is ready for the next. Its day and priority can be picked, or typed at its end. */
function QuickAdd({ view, mobile }: { view: TaskView; mobile?: boolean }) {
  const now = new Date(useNow());
  const add = useTasks((s) => s.add);
  const focus = useTasks((s) => s.addFocus);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<{ due?: DueValue; priority?: Priority }>({});
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focus) input.current?.focus({ preventScroll: true });
  }, [focus]);

  const parsed = parseQuickAdd(text, now);
  const base: DueValue = picked.due ?? { due: view === "inbox" ? null : dayFrom(now, 0), time: null };
  const due: DueValue = parsed.due !== undefined ? { due: parsed.due, time: parsed.time ?? null } : base;
  const priority = parsed.priority ?? picked.priority ?? 0;

  const submit = () => {
    const title = parsed.title.trim();
    if (!title) return;
    add({ title, due: due.due, time: due.due ? due.time : null, priority });
    if (parsed.due !== undefined || parsed.priority !== undefined) track("taskQuick");
    setText("");
    setPicked({});
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className={cn(
        "group/add mb-2 flex shrink-0 items-center gap-2 rounded-[12px] bg-hover pr-1.5 pl-3 transition-shadow focus-within:bg-solid focus-within:shadow-[inset_0_0_0_1.5px_var(--accent)]",
        mobile ? "mx-2 mt-2 h-11" : "mx-4 h-10",
      )}
    >
      <Plus size={16} className="shrink-0 text-ink-3" />
      <input
        ref={input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}
        enterKeyHint="done"
        placeholder={view === "inbox" ? t("Add a task to the Inbox") : t("Add a task for today")}
        aria-label={t("New task")}
        className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3"
      />
      <div className={cn("flex shrink-0 items-center gap-0.5 transition-opacity", !mobile && !text && !picked.due && !picked.priority && "opacity-0 group-focus-within/add:opacity-100 group-hover/add:opacity-100")}>
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
          </button>
        </DatePicker>
        <PriorityMenu value={priority} onChange={(p) => setPicked((x) => ({ ...x, priority: p }))}>
          <button type="button" aria-label={priorityLabel(priority)} className="flex size-7 items-center justify-center rounded-[8px] text-ink-3 transition-colors hover:bg-selected data-[state=open]:bg-selected">
            <PriorityFlag priority={priority} />
          </button>
        </PriorityMenu>
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
  const dragId = useTaskDrag((s) => s.id);
  const over = useTaskDrag((s) => (s.over?.section === section.key ? s.over : null));
  const dragged = useTasks((s) => (dragId ? s.tasks.find((x) => x.id === dragId) : undefined));
  const inHere = !!dragged && section.tasks.some((x) => x.id === dragged.id);
  // Where a dragged task may go: a place in a list sorted by hand, or a section that gives it something.
  const accepts = !!dragged && ((reorder && inHere) || changesTask(section, dragged));
  const lineAt = over && accepts && reorder ? over.before : undefined;

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
      onDragOver={(e) => onDragOver(e, useTaskDrag.getState().over?.section === section.key ? (useTaskDrag.getState().over?.before ?? null) : null)}
      onDrop={onDrop}
      className={cn("relative mb-1 rounded-[12px] transition-colors", over && accepts && !reorder && "bg-accent-soft shadow-[inset_0_0_0_1.5px_var(--accent)]")}
    >
      {section.title && (
        <button
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

function TaskRow({ task, mobile, line, onDragOver }: { task: Task; mobile?: boolean; line: boolean; onDragOver: (e: DragEvent<HTMLDivElement>) => void }) {
  const now = new Date(useNow());
  const view = useTasks((s) => s.view);
  const selected = useTasks((s) => s.selectedId === task.id);
  const { select, complete } = useTasks.getState();
  const dragging = useTaskDrag((s) => s.id === task.id);
  const trashed = task.deletedAt !== null;
  const done = task.completedAt !== null;
  const overdue = isOverdue(task, now);
  const today = task.due === dayFrom(now, 0);
  const label = dueLabel(task, now);
  const draggable = !mobile && !trashed;

  return (
    <TaskContextMenu task={task}>
      <div
        data-task={task.id}
        draggable={draggable}
        onDragStart={(e) => {
          e.dataTransfer.setData(TASK_DRAG, task.id);
          e.dataTransfer.effectAllowed = "move";
          select(task.id);
          useTaskDrag.setState({ id: task.id, over: null });
        }}
        onDragEnd={() => useTaskDrag.setState({ id: null, over: null })}
        onDragOver={onDragOver}
        onClick={() => select(task.id)}
        aria-selected={selected}
        className={cn(
          "group/task relative flex cursor-default items-center gap-3 rounded-[10px] pr-3 pl-3 transition-colors",
          mobile ? "h-12" : "h-11",
          selected ? "bg-selected" : "hover:bg-hover",
          dragging && "opacity-40",
        )}
      >
        {line && <span className="pointer-events-none absolute -top-px right-3 left-9 h-[2px] rounded-full bg-accent" />}
        {draggable && view !== "completed" && (
          <GripVertical size={13} className="absolute top-1/2 -left-2.5 -translate-y-1/2 cursor-grab text-ink-3 opacity-0 transition-opacity group-hover/task:opacity-100" />
        )}
        <TaskCheck task={task} disabled={trashed} onToggle={() => complete(task.id, !done)} />
        <div className={cn("flex min-w-0 flex-1 items-center gap-2 self-stretch border-b border-line transition-colors group-hover/task:border-transparent", selected && "border-transparent")}>
          <span className={cn("min-w-0 flex-1 truncate text-[14px]", done || trashed ? "text-ink-3" : "text-ink", done && "line-through decoration-ink-3/60", !task.title && "text-ink-3 italic")}>
            {task.title || t("(No title)")}
          </span>
          {task.notes && <AlignLeft size={13} aria-label={t("Has a description")} className="shrink-0 text-ink-3" />}
          {label && (
            <span className={cn("shrink-0 text-[12px] whitespace-nowrap tabular-nums", done || trashed ? "text-ink-3" : overdue ? "text-danger" : today ? "text-accent-text" : "text-ink-3")}>{label}</span>
          )}
        </div>
      </div>
    </TaskContextMenu>
  );
}

/* -------------------------------- Right click -------------------------------- */

const iconItem = "flex h-9 flex-1 cursor-pointer items-center justify-center rounded-lg text-ink-2 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-on-accent";

/** A task's quick changes on a right click: its day, its priority, Trash. */
function TaskContextMenu({ task, children }: { task: Task; children: ReactNode }) {
  const { update, complete, remove, restore, destroy } = useTasks.getState();
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
