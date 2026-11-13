"use client";

import { CalendarRange, CircleCheckBig, Inbox, Plus, Trash2, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { useState, type DragEvent, type ReactNode } from "react";
import { t } from "@/lib/i18n";
import { dayFrom, viewCount } from "@/lib/tasks/logic";
import { useTasks } from "@/lib/tasks/store";
import type { TaskPatch, TaskView } from "@/lib/tasks/types";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { spring, Tooltip } from "../ui";
import { isTaskDrag, useTaskDrag, viewTitle } from "./task-list";

/** Today's date in a little calendar page, as TickTick draws Today. */
function TodayIcon({ day }: { day: number }) {
  return (
    <span className="relative inline-flex size-[16px] items-end justify-center rounded-[4px] border-[1.5px] border-current pb-[1px] text-[8.5px] leading-none font-bold tabular-nums">
      <span className="absolute inset-x-0 top-[2.5px] h-[1.3px] bg-current" />
      {day}
    </span>
  );
}

const ICONS: Partial<Record<TaskView, LucideIcon>> = { next7: CalendarRange, inbox: Inbox, completed: CircleCheckBig, trash: Trash2 };

/** What a task dragged onto a view takes on: Today gives it today, Completed ticks it off, Trash deletes it. */
function dropPatch(view: TaskView): TaskPatch | null {
  if (view === "today") return { due: dayFrom(new Date(), 0) };
  if (view === "completed") return { completed: true };
  if (view === "trash") return { deleted: true };
  return null;
}

/** The sidebar while the tasks are open: a new task, then Today, the next 7 days and the Inbox, and below them what's done and Trash. */
export function TasksSidebar({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const tasks = useTasks((s) => s.tasks);
  const view = useTasks((s) => s.view);
  const { setView, focusAdd } = useTasks.getState();
  const now = new Date(useNow());

  const go = (v: TaskView) => {
    setView(v);
    onNavigate?.();
  };
  const row = (v: TaskView) => {
    const Icon = ICONS[v];
    return (
      <ViewRow
        key={v}
        view={v}
        collapsed={collapsed}
        active={view === v}
        label={viewTitle(v)}
        count={v === "completed" || v === "trash" ? undefined : viewCount(tasks, v, now)}
        icon={v === "today" ? <TodayIcon day={now.getDate()} /> : Icon && <Icon size={15} strokeWidth={1.9} />}
        onClick={() => go(v)}
      />
    );
  };

  return (
    <>
      <Tooltip label={t("New task")} shortcut="N" side="right">
        <button
          onClick={() => {
            // A new task goes where it's seen: the Inbox when nothing that adds is open.
            const v = useTasks.getState().view;
            if (v === "completed" || v === "trash") setView("inbox");
            focusAdd();
            onNavigate?.();
          }}
          aria-label={collapsed ? t("New task") : undefined}
          className={cn(
            "press mb-3 flex h-9 shrink-0 items-center justify-center gap-2 rounded-[11px] bg-accent text-[13px] font-medium text-on-accent shadow-[0_1px_2px_rgb(0_0_0/0.12),inset_0_1px_0_rgb(255_255_255/0.18)] [--press-scale:0.97] hover:bg-accent-hover",
            collapsed ? "size-9" : "w-full",
          )}
        >
          <Plus size={16} strokeWidth={2.2} />
          {!collapsed && t("New task")}
        </button>
      </Tooltip>
      <div className={cn("no-scrollbar -mx-2.5 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2.5", collapsed && "items-center")}>
        {(["today", "next7", "inbox"] as const).map(row)}
        <div className={cn("my-2 h-px bg-line", collapsed ? "w-6" : "mx-2")} />
        {(["completed", "trash"] as const).map(row)}
      </div>
    </>
  );
}

function ViewRow({ view, icon, label, count, active, collapsed, onClick }: { view: TaskView; icon: ReactNode; label: string; count?: number; active: boolean; collapsed?: boolean; onClick: () => void }) {
  const [over, setOver] = useState(false);
  const dropTo = dropPatch(view);
  const accepts = (e: DragEvent) => !!dropTo && isTaskDrag(e) && !!useTaskDrag.getState().id;
  const button = (
    <div
      className="relative"
      onDragEnter={(e) => accepts(e) && setOver(true)}
      onDragOver={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        setOver(false);
        if (!accepts(e) || !dropTo) return;
        e.preventDefault();
        const id = useTaskDrag.getState().id!;
        useTaskDrag.setState({ id: null, over: null });
        const tasks = useTasks.getState();
        if (dropTo.deleted) tasks.remove(id);
        else if (dropTo.completed) tasks.complete(id, true);
        else tasks.update(id, dropTo);
      }}
    >
      {over && <div className="pointer-events-none absolute inset-0 rounded-[10px] bg-accent-soft shadow-[inset_0_0_0_1.5px_var(--accent)]" />}
      {active && <motion.div layoutId="sidebar-active" transition={spring} className="absolute inset-0 rounded-[10px] bg-selected shadow-[inset_0_0_0_0.5px_var(--line)]" />}
      <button
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? label : undefined}
        className={cn(
          "relative flex h-[34px] w-full items-center gap-2.5 rounded-[10px] px-1.5 text-left text-[13.5px] transition-colors hover:bg-hover pointer-coarse:h-10",
          active ? "font-medium text-ink" : "text-ink-2",
          collapsed && "w-9 justify-center px-0",
        )}
      >
        <span className="inline-flex size-[22px] shrink-0 items-center justify-center">{icon}</span>
        {!collapsed && <span className="flex-1 truncate">{label}</span>}
        {!collapsed && !!count && <span className="text-[12px] text-ink-3 tabular-nums">{count}</span>}
        {collapsed && !!count && view === "today" && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-accent" />}
      </button>
    </div>
  );
  return collapsed ? (
    <Tooltip label={label} side="right">
      {button}
    </Tooltip>
  ) : (
    button
  );
}
