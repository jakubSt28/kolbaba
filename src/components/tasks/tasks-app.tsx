"use client";

import { ArrowUpDown, Check, Ellipsis, Eye, EyeOff, Menu, Trash2, Upload } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { DropdownMenu } from "radix-ui";
import { useEffect } from "react";
import { useCalendar } from "@/lib/calendar/store";
import { t } from "@/lib/i18n";
import { LIVE } from "@/lib/live";
import { sectionsOf } from "@/lib/tasks/logic";
import { isFolded, sortOf, useTasks } from "@/lib/tasks/store";
import type { TaskSort, TaskView } from "@/lib/tasks/types";
import { useMail } from "@/lib/store";
import { cn, isTypingTarget } from "@/lib/utils";
import { ModeSwitch } from "../calendar/calendar-sidebar";
import { confirmAction } from "../confirm";
import { Drawer } from "../mobile-shell";
import { menuContentClass, menuItemClass, Tooltip } from "../ui";
import { TaskDetails } from "./task-details";
import { TaskList, useSections, useViewTitle } from "./task-list";
import { openTickTickImport, TickTickImportHost } from "./ticktick-import";

/** Loaded when the tasks open, and fresh again on coming back to the window (another device may have changed them). */
function useTasksData() {
  const open = useCalendar((s) => s.mode === "tasks");
  useEffect(() => {
    if (!open) return;
    void useTasks.getState().init();
    if (!LIVE) return;
    let last = Date.now();
    const again = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 15_000) return;
      last = Date.now();
      void useTasks.getState().refresh();
    };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [open]);
}

/** The tasks on screen from top to bottom, folded sections left out: what J and K step through. */
function shownIds() {
  const s = useTasks.getState();
  return sectionsOf(s.tasks, s.view, sortOf(s.sorts, s.view), new Date())
    .filter((sec) => !isFolded(s.folded, s.view, sec))
    .flatMap((sec) => sec.tasks.map((x) => x.id));
}

/** Single keys, as in the mail: N a new task, J/K to move, X to tick off, Delete to Trash. Keep in step with the Tasks group in shortcuts-help.tsx. */
function useTasksShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const mail = useMail.getState();
      const s = useTasks.getState();
      if (document.querySelector("[role=alertdialog], [role=dialog], [role=menu]") || mail.newsOpen || mail.collectionOpen || mail.feedback) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        return mail.setPaletteOpen(!mail.paletteOpen);
      }
      if (mod && e.key === ",") {
        e.preventDefault();
        return mail.setSettingsOpen(true);
      }
      if (mod || e.altKey || mail.paletteOpen || mail.settingsOpen || mail.shortcutsOpen || isTypingTarget(e.target)) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const selected = s.tasks.find((x) => x.id === s.selectedId);
      if (key === "n" || key === "c") {
        if (s.view === "completed" || s.view === "trash") s.setView("inbox");
        s.focusAdd();
      } else if (key === "j" || key === "k" || key === "ArrowDown" || key === "ArrowUp") {
        const ids = shownIds();
        if (!ids.length) return;
        const at = selected ? ids.indexOf(selected.id) : -1;
        const down = key === "j" || key === "ArrowDown";
        const next = at < 0 ? (down ? 0 : ids.length - 1) : Math.max(0, Math.min(ids.length - 1, at + (down ? 1 : -1)));
        s.select(ids[next]);
        document.querySelector(`[data-task="${CSS.escape(ids[next])}"]`)?.scrollIntoView({ block: "nearest" });
      } else if (key === "x" && selected && selected.deletedAt === null) s.complete(selected.id, selected.completedAt === null);
      else if ((key === "Backspace" || key === "Delete") && selected) {
        if (selected.deletedAt === null) s.remove(selected.id);
      } else if (key === "Escape" && selected) s.select(null);
      else if (key === "?") mail.setShortcutsOpen(true);
      else return;
      e.preventDefault();
    };
    // Before the page's own handlers: Escape that closes a menu or the date picker must still find it open here.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [enabled]);
}

/* ---------------------------------- Menus ---------------------------------- */

const SORTS: { id: TaskSort; label: () => string }[] = [
  { id: "date", label: () => t("By date") },
  { id: "priority", label: () => t("By priority") },
  { id: "title", label: () => t("By title") },
  { id: "manual", label: () => t("Custom order") },
];

const iconButton = "flex size-8 shrink-0 items-center justify-center rounded-[9px] text-ink-3 outline-none transition-colors hover:bg-hover hover:text-ink data-[state=open]:bg-hover data-[state=open]:text-ink";

/** Sort, and the view's other things: showing what's done, emptying Trash. */
function ViewMenus({ view, round }: { view: TaskView; round?: boolean }) {
  const sort = useTasks((s) => sortOf(s.sorts, view));
  const sections = useSections();
  const done = sections.find((x) => x.done);
  const doneFolded = useTasks((s) => (done ? isFolded(s.folded, view, done) : false));
  const { setSort, setFolded, emptyTrash } = useTasks.getState();
  const button = round ? "glass press flex size-10 shrink-0 items-center justify-center rounded-full text-ink outline-none" : iconButton;

  if (view === "trash") {
    if (!sections.length) return null;
    return (
      <button
        onClick={() =>
          confirmAction({
            title: t("Empty Trash?"),
            message: t("The tasks in Trash are deleted for good."),
            confirmLabel: t("Empty Trash"),
            onConfirm: emptyTrash,
          })
        }
        className={cn("flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-ink-2 hover:text-ink", round ? "glass press h-10 rounded-full px-4" : "h-8 rounded-[9px] px-2.5 hover:bg-hover")}
      >
        <Trash2 size={14} /> {t("Empty Trash")}
      </button>
    );
  }
  if (view === "completed") return null;

  return (
    <>
      <DropdownMenu.Root modal={false}>
        <Tooltip label={t("Sort")} side="bottom">
          <DropdownMenu.Trigger aria-label={t("Sort")} className={button}>
            <ArrowUpDown size={16} />
          </DropdownMenu.Trigger>
        </Tooltip>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={6} collisionPadding={8} className={cn(menuContentClass, "w-[200px]")}>
            <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-ink-3">{t("Sort")}</div>
            {SORTS.map((s) => (
              <DropdownMenu.Item key={s.id} className={menuItemClass} onSelect={() => setSort(view, s.id)}>
                <span className="flex-1">{s.label()}</span>
                {sort === s.id && <Check size={14} />}
              </DropdownMenu.Item>
            ))}
            {sort === "manual" && <p className="px-2.5 pt-1 pb-1.5 text-[11.5px] leading-snug text-ink-3">{t("Drag tasks to put them in order.")}</p>}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger aria-label={t("More")} className={button}>
          <Ellipsis size={17} />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={6} collisionPadding={8} className={menuContentClass}>
            {done && (
              <DropdownMenu.Item className={menuItemClass} onSelect={() => setFolded(`${view}:${done.key}`, !doneFolded)}>
                {doneFolded ? <Eye size={14} /> : <EyeOff size={14} />} {doneFolded ? t("Show completed") : t("Hide completed")}
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item className={menuItemClass} onSelect={() => openTickTickImport()}>
              <Upload size={14} /> {t("Import from TickTick")}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </>
  );
}

/* --------------------------------- Computer --------------------------------- */

/** The list of tasks in the wide pane. */
export function TasksMain() {
  useTasksData();
  const open = useCalendar((s) => s.mode === "tasks");
  useTasksShortcuts(open);
  const view = useTasks((s) => s.view);
  const title = useViewTitle();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <TickTickImportHost />
      <header className="flex h-14 shrink-0 items-center gap-1 pr-3 pl-5">
        <h1 className="min-w-0 flex-1 truncate text-[19px] font-semibold tracking-[-0.02em]">{title}</h1>
        <ViewMenus view={view} />
      </header>
      <div className="min-h-0 flex-1">
        <TaskList />
      </div>
    </div>
  );
}

/** The open task, beside the list. */
export function TasksDetailsPane() {
  return <TaskDetails />;
}

/* ----------------------------------- Phone ---------------------------------- */

/** The tasks on a phone: the list, the drawer for the views, and a task's details over the list. */
export function MobileTasks() {
  useTasksData();
  const view = useTasks((s) => s.view);
  const title = useViewTitle();
  const selected = useTasks((s) => !!s.selectedId && s.tasks.some((x) => x.id === s.selectedId));
  const setDrawerOpen = useMail((s) => s.setDrawerOpen);
  const close = () => useTasks.getState().select(null);

  return (
    <div className="app-shell flex flex-col overflow-hidden bg-canvas">
      <div className="flex shrink-0 items-center gap-2 px-3 pt-[max(14px,env(safe-area-inset-top))] pb-2">
        <button aria-label={t("Lists")} onClick={() => setDrawerOpen(true)} className="glass press flex size-10 shrink-0 items-center justify-center rounded-full text-ink">
          <Menu size={19} />
        </button>
        <ModeSwitch phone />
        <span className="flex-1" />
        <ViewMenus view={view} round />
      </div>
      <h1 className="shrink-0 truncate px-4 pb-2 text-[28px] leading-tight font-bold tracking-[-0.03em]">{title}</h1>
      <div className="mx-2 mb-[max(8px,var(--safe-bottom))] min-h-0 flex-1 overflow-hidden rounded-[20px] bg-solid pt-1 shadow-[var(--shadow-panel)]">
        <TaskList mobile />
      </div>
      <AnimatePresence>
        {selected && (
          <motion.div
            className="absolute inset-0 z-30 bg-solid"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 420, damping: 40 }}
          >
            <TaskDetails mobile onBack={close} />
          </motion.div>
        )}
      </AnimatePresence>
      <Drawer />
      <TickTickImportHost />
    </div>
  );
}
