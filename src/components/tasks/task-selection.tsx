"use client";

import { ArchiveRestore, CalendarDays, Check, Flag, List, Sun, Sunrise, Trash2, Undo2, X, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSwipe } from "@/lib/gestures";
import { t } from "@/lib/i18n";
import { dayFrom, priorityLabel } from "@/lib/tasks/logic";
import { useTasks } from "@/lib/tasks/store";
import { PRIORITIES } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";
import { spring } from "../ui";
import { PriorityFlag } from "./task-bits";
import { ListChoices, useSections } from "./task-list";

/** The tasks picked on a phone that are still on screen. */
export function useChecked() {
  const sections = useSections();
  return useTasks(useShallow((s) => s.checked.filter((id) => sections.some((x) => x.tasks.some((task) => task.id === id)))));
}

/** In place of the header while tasks are picked: a way out, how many, and all of them at once. */
export function TaskSelectionTop({ count }: { count: number }) {
  const sections = useSections();
  const setChecked = useTasks((s) => s.setChecked);
  const all = sections.flatMap((s) => s.tasks.map((x) => x.id));
  const everything = count >= all.length;
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 px-3 pt-[max(14px,env(safe-area-inset-top))] pb-2">
      <button onClick={() => setChecked([])} className="glass press h-10 rounded-full px-4 text-[15px] font-medium text-accent-text">
        {t("Cancel")}
      </button>
      <span className="text-[15px] font-semibold tabular-nums">{t("{n} selected", { n: count })}</span>
      <button onClick={() => setChecked(everything ? [] : all)} className="glass press h-10 rounded-full px-4 text-[15px] font-medium text-accent-text">
        {everything ? t("Deselect") : t("Select all")}
      </button>
    </div>
  );
}

type SheetKind = "date" | "priority" | "list";

/** What can be done with the picked tasks, at the bottom of the screen like mail's: a tap, or a sheet with the choices. */
export function TaskSelectionBar({ ids }: { ids: string[] }) {
  const view = useTasks((s) => s.view);
  const hasLists = useTasks((s) => s.lists.some((l) => l.kind === "list"));
  const allDone = useTasks((s) => ids.every((id) => s.tasks.find((x) => x.id === id)?.completedAt != null));
  const { update, completeMany, removeMany, restore, destroy, setChecked } = useTasks.getState();
  const [sheet, setSheet] = useState<SheetKind | null>(null);

  const finish = (run: () => void) => {
    run();
    setSheet(null);
    setChecked([]);
  };
  const each = (patch: Parameters<typeof update>[1]) => finish(() => ids.forEach((id) => update(id, patch)));

  const actions: { label: string; icon: LucideIcon; run: () => void }[] =
    view === "trash"
      ? [
          { label: t("Restore"), icon: ArchiveRestore, run: () => finish(() => ids.forEach(restore)) },
          { label: t("Delete forever"), icon: Trash2, run: () => finish(() => ids.forEach(destroy)) },
        ]
      : [
          { label: t("Date"), icon: CalendarDays, run: () => setSheet("date") },
          { label: t("Priority"), icon: Flag, run: () => setSheet("priority") },
          ...(hasLists ? [{ label: t("List"), icon: List, run: () => setSheet("list") }] : []),
          allDone
            ? { label: t("Not done"), icon: Undo2, run: () => finish(() => completeMany(ids, false)) }
            : { label: t("Done"), icon: Check, run: () => finish(() => completeMany(ids, true)) },
          { label: t("Delete"), icon: Trash2, run: () => finish(() => removeMany(ids)) },
        ];

  const now = new Date();
  const days: { label: string; icon: ReactNode; due: string | null }[] = [
    { label: t("Today"), icon: <Sun size={18} />, due: dayFrom(now, 0) },
    { label: t("Tomorrow"), icon: <Sunrise size={18} />, due: dayFrom(now, 1) },
    { label: t("Next week"), icon: <CalendarDays size={18} />, due: dayFrom(now, 7) },
    { label: t("No date"), icon: <X size={18} />, due: null },
  ];

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-3 pt-3 pb-[max(14px,var(--safe-bottom))]">
        <motion.div
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={spring}
          className="action-bar pointer-events-auto flex items-center justify-around gap-1 rounded-[26px] px-2 py-1.5"
        >
          {actions.map((a) => (
            <button
              key={a.label}
              onClick={a.run}
              className="press flex h-14 min-w-14 flex-col items-center justify-center gap-0.5 rounded-[18px] px-2 text-ink [--press-scale:0.92] active:bg-hover"
            >
              <a.icon size={20} />
              <span className="text-[10.5px] font-medium text-ink-2">{a.label}</span>
            </button>
          ))}
        </motion.div>
      </div>
      <Sheet open={sheet !== null} title={sheet === "date" ? t("Date") : sheet === "priority" ? t("Priority") : t("Move to list")} onClose={() => setSheet(null)}>
        {sheet === "date" &&
          days.map((d) => (
            <SheetRow key={d.label} onClick={() => each({ due: d.due, ...(d.due ? {} : { time: null, repeat: null }) })}>
              <span className="text-ink-2">{d.icon}</span>
              {d.label}
            </SheetRow>
          ))}
        {sheet === "priority" &&
          PRIORITIES.map((p) => (
            <SheetRow key={p} onClick={() => each({ priority: p })}>
              <PriorityFlag priority={p} size={17} />
              {priorityLabel(p)}
            </SheetRow>
          ))}
        {sheet === "list" && (
          <div className="max-h-[50vh] overflow-y-auto">
            <ListChoices current={null} onPick={(listId) => each({ listId })} Item={SheetItem} />
          </div>
        )}
      </Sheet>
    </>
  );
}

function SheetRow({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className="press flex h-12 w-full items-center gap-3 rounded-[14px] px-3 text-left text-[15px] [--press-scale:0.98] active:bg-hover">
      {children}
    </button>
  );
}

/** A list in the sheet: a row as big as the sheet's others. */
function SheetItem({ className, onSelect, children }: { className?: string; onSelect?: () => void; children?: ReactNode }) {
  return (
    <button onClick={onSelect} className={cn(className, "h-12 w-full gap-3 rounded-[14px] text-left text-[15px] active:bg-hover")}>
      {children}
    </button>
  );
}

/** A sheet from the bottom of the screen, like the one for snoozing mail. */
function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const [ref, y] = useSwipe({ way: "down", onSwipe: onClose, enabled: open });
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="scrim" className="top-dim fixed inset-0 z-50 bg-black/25" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            key="sheet"
            ref={ref}
            role="dialog"
            aria-label={title}
            className="glass-strong fixed inset-x-2 bottom-2 z-50 mx-auto max-w-[420px] rounded-[26px] p-2 pb-[max(8px,var(--safe-bottom))]"
            initial={{ y: "110%" }}
            animate={{ y: 0 }}
            exit={{ y: "110%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38, mass: 0.9 }}
            style={{ y }}
          >
            <div className="px-3 pt-1 pb-2 text-[12.5px] font-semibold text-ink-3">{title}</div>
            {children}
            <button onClick={onClose} className="press mt-1 h-12 w-full rounded-[14px] bg-hover text-[15px] font-medium text-ink-2 [--press-scale:0.98] active:bg-selected">
              {t("Cancel")}
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
