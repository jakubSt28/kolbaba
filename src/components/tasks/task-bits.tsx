"use client";

import { Check, ChevronLeft, ChevronRight, Circle, Clock, Flag, Moon, Sun, Sunrise, X } from "lucide-react";
import { DropdownMenu, Popover } from "radix-ui";
import { useState, type ReactNode } from "react";
import { addMonths, dayKey, formatMonth, monthGrid, parseDay, sameDay, startOfMonth, weekdayShort } from "@/lib/calendar/dates";
import { t } from "@/lib/i18n";
import { clockOf, dayFrom, priorityLabel } from "@/lib/tasks/logic";
import { PRIORITIES, type Priority, type Task } from "@/lib/tasks/types";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { menuContentClass, menuItemClass, Tooltip } from "../ui";

/* -------------------------------- Tick box -------------------------------- */

/** The box a task is ticked off in, in its priority's colour (red, amber, blue, grey). */
export function TaskCheck({ task, onToggle, size = 17, disabled }: { task: Pick<Task, "priority" | "completedAt">; onToggle: () => void; size?: number; disabled?: boolean }) {
  const done = task.completedAt !== null;
  return (
    <button
      role="checkbox"
      aria-checked={done}
      aria-label={done ? t("Mark as not done") : t("Mark as done")}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="press -m-1.5 flex shrink-0 items-center justify-center p-1.5 [--press-scale:0.85] disabled:pointer-events-none pointer-coarse:-m-2.5 pointer-coarse:p-2.5"
    >
      <span data-p={task.priority} data-on={done ? "" : undefined} className="task-check inline-flex items-center justify-center rounded-[5px] transition-colors" style={{ width: size, height: size }}>
        <Check size={size - 5} strokeWidth={3.2} />
      </span>
    </button>
  );
}

/* -------------------------------- Priority -------------------------------- */

/** A priority's flag: filled in its colour, an outline for none. */
export function PriorityFlag({ priority, size = 15 }: { priority: Priority; size?: number }) {
  return <Flag size={size} data-p={priority} className="task-flag shrink-0" strokeWidth={1.9} />;
}

export function PriorityMenu({ value, onChange, children, align = "end" }: { value: Priority; onChange: (p: Priority) => void; children: ReactNode; align?: "start" | "end" }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align={align} sideOffset={6} collisionPadding={8} onCloseAutoFocus={(e) => e.preventDefault()} className={cn(menuContentClass, "w-[200px]")}>
          {PRIORITIES.map((p) => (
            <DropdownMenu.Item key={p} className={cn(menuItemClass, "group")} onSelect={() => onChange(p)}>
              <span className="group-data-[highlighted]:[&_.task-flag]:[--c:var(--on-accent)]">
                <PriorityFlag priority={p} />
              </span>
              <span className="flex-1">{priorityLabel(p)}</span>
              {value === p && <Check size={14} />}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/* ----------------------------------- Date ---------------------------------- */

export interface DueValue {
  due: string | null;
  time: string | null;
}

/** "+7": next week, the way TickTick draws it. */
function NextWeekIcon() {
  return (
    <span className="relative inline-flex size-[19px] items-center justify-center rounded-[5px] border-[1.6px] border-current pt-[2px] text-[8.5px] leading-none font-bold tracking-[-0.04em]">
      <span className="absolute inset-x-0 top-[2.5px] h-[1.4px] bg-current" />
      +7
    </span>
  );
}

/**
 * The day (and a time) of a task, the way TickTick picks it: Today, Tomorrow, next week and next
 * month at the top, a month to pick from, a time, then Clear or OK.
 */
export function DatePicker({ value, onChange, children, align = "start" }: { value: DueValue; onChange: (v: DueValue) => void; children: ReactNode; align?: "start" | "center" | "end" }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={align}
          sideOffset={6}
          collisionPadding={10}
          onCloseAutoFocus={(e) => e.preventDefault()}
          // The window itself takes the keyboard (Enter is OK), not Today: that would pop its tooltip up at once.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).focus();
          }}
          tabIndex={-1}
          className="glass-strong z-50 w-[292px] outline-none origin-[var(--radix-popover-content-transform-origin)] rounded-2xl p-3 text-ink shadow-[var(--shadow-float)] data-[state=open]:animate-[menu-in_140ms_ease-out]"
        >
          {open && (
            <DatePanel
              value={value}
              onDone={(v) => {
                setOpen(false);
                if (v) onChange(v);
              }}
            />
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function DatePanel({ value, onDone }: { value: DueValue; onDone: (v: DueValue | null) => void }) {
  const now = new Date(useNow());
  const [draft, setDraft] = useState<DueValue>(value);
  const [month, setMonth] = useState(() => startOfMonth(value.due ? parseDay(value.due) : now));
  const [timeOpen, setTimeOpen] = useState(!!value.time);
  const days = monthGrid(month);
  const picked = draft.due ? parseDay(draft.due) : null;
  const quick: { label: string; icon: ReactNode; due: string }[] = [
    { label: t("Today"), icon: <Sun size={19} strokeWidth={1.8} />, due: dayFrom(now, 0) },
    { label: t("Tomorrow"), icon: <Sunrise size={19} strokeWidth={1.8} />, due: dayFrom(now, 1) },
    { label: t("Next week"), icon: <NextWeekIcon />, due: dayFrom(now, 7) },
    { label: t("Next month@@due"), icon: <Moon size={18} strokeWidth={1.8} />, due: dayKey(addMonths(now, 1)) },
  ];
  const pick = (due: string) => setDraft((d) => ({ ...d, due }));

  return (
    <div
      onKeyDown={(e) => {
        if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
          e.preventDefault();
          onDone(draft);
        }
      }}
    >
      <div className="mb-2 grid grid-cols-4 gap-1">
        {quick.map((q) => (
          <Tooltip key={q.label} label={q.label} side="top">
            <button
              aria-label={q.label}
              onClick={() => onDone({ due: q.due, time: draft.time })}
              className={cn("flex h-10 items-center justify-center rounded-[10px] text-ink-2 transition-colors hover:bg-hover hover:text-ink", draft.due === q.due && "text-accent-text")}
            >
              {q.icon}
            </button>
          </Tooltip>
        ))}
      </div>

      <div className="mb-1 flex items-center gap-0.5 pl-1.5">
        <span className="flex-1 text-[14px] font-semibold first-letter:uppercase">{formatMonth(month)}</span>
        <button onClick={() => setMonth(addMonths(month, -1))} aria-label={t("Previous month")} className="flex size-7 items-center justify-center rounded-[8px] text-ink-3 transition-colors hover:bg-hover hover:text-ink">
          <ChevronLeft size={16} />
        </button>
        <Tooltip label={t("This month")} side="top">
          <button onClick={() => setMonth(startOfMonth(now))} aria-label={t("This month")} className="flex size-7 items-center justify-center rounded-[8px] text-ink-3 transition-colors hover:bg-hover hover:text-ink">
            <Circle size={10} strokeWidth={2.4} />
          </button>
        </Tooltip>
        <button onClick={() => setMonth(addMonths(month, 1))} aria-label={t("Next month")} className="flex size-7 items-center justify-center rounded-[8px] text-ink-3 transition-colors hover:bg-hover hover:text-ink">
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center">
        {days.slice(0, 7).map((d) => (
          <span key={d.getDay()} className="pb-1 text-[11px] font-medium text-ink-3">
            {weekdayShort(d).slice(0, 2)}
          </span>
        ))}
        {days.map((d) => {
          const key = dayKey(d);
          const selected = !!picked && sameDay(d, picked);
          const today = sameDay(d, now);
          return (
            <button
              key={key}
              onClick={() => pick(key)}
              onDoubleClick={() => onDone({ ...draft, due: key })}
              className={cn(
                "mx-auto flex size-9 items-center justify-center rounded-full text-[13.5px] tabular-nums transition-colors",
                selected
                  ? "bg-accent font-semibold text-on-accent"
                  : today
                    ? "bg-accent-soft font-medium text-accent-text"
                    : d.getMonth() === month.getMonth()
                      ? "text-ink hover:bg-hover"
                      : "text-ink-3/70 hover:bg-hover",
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>

      <div className="mt-2 border-t border-line pt-2">
        <div className="flex h-9 items-center gap-2.5 rounded-[10px] px-1.5">
          <Clock size={16} className="shrink-0 text-ink-3" />
          <span className="flex-1 text-[13.5px] text-ink-2">{t("Time")}</span>
          {timeOpen || draft.time ? (
            <>
              <input
                type="time"
                autoFocus={!value.time}
                value={draft.time ?? ""}
                onChange={(e) => setDraft((d) => ({ due: d.due ?? dayFrom(now, 0), time: e.target.value || null }))}
                className="h-8 rounded-[8px] bg-hover px-2 text-[13.5px] text-ink tabular-nums outline-none focus:shadow-[inset_0_0_0_1px_var(--accent)]"
              />
              <button
                onClick={() => {
                  setTimeOpen(false);
                  setDraft((d) => ({ ...d, time: null }));
                }}
                aria-label={t("No time")}
                className="flex size-7 items-center justify-center rounded-[8px] text-ink-3 hover:bg-hover hover:text-ink"
              >
                <X size={14} />
              </button>
            </>
          ) : (
            <button
              onClick={() => {
                setTimeOpen(true);
                // A time is on a day: today, unless one is picked.
                setDraft((d) => ({ due: d.due ?? dayFrom(now, 0), time: nextHour(now) }));
              }}
              className="flex h-8 items-center gap-1 rounded-[8px] px-2 text-[13px] text-ink-3 transition-colors hover:bg-hover hover:text-ink"
            >
              {t("Add")}
              <ChevronRight size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          onClick={() => onDone({ due: null, time: null })}
          className="press h-9 rounded-[10px] text-[13.5px] font-medium text-ink-2 shadow-[inset_0_0_0_1px_var(--line)] [--press-scale:0.97] hover:bg-hover hover:text-ink"
        >
          {t("Clear")}
        </button>
        <button
          onClick={() => onDone(draft)}
          className="press h-9 rounded-[10px] bg-accent text-[13.5px] font-medium text-on-accent [--press-scale:0.97] hover:bg-accent-hover"
        >
          {t("OK")}
        </button>
      </div>
    </div>
  );
}

/** The next full hour: where a new time starts. */
function nextHour(now: Date) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.min(23, now.getHours() + 1));
  return clockOf(next);
}
