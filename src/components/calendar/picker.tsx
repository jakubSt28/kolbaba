"use client";

import { Bell, BellOff, Check, ChevronDown } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type { ReactNode } from "react";
import { reminderOf, useCalendar } from "@/lib/calendar/store";
import { EVENT_REMINDER_CHOICES } from "@/lib/calendar/types";
import { t, tn } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { menuContentClass, menuItemClass } from "../ui";

/** A button that opens a short list to pick from. */
export function Picker({
  icon,
  label,
  options,
  onPick,
  plain,
  row,
}: {
  icon?: ReactNode;
  label: ReactNode;
  options: { id: string; label: ReactNode; selected: boolean }[];
  onPick: (id: string) => void;
  /** No pill around it (the calendar line). */
  plain?: boolean;
  /** A line of an event's details: as wide as its text, the icon where the other lines have theirs. */
  row?: boolean;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={cn(
          "flex h-9 max-w-full items-center gap-1.5 text-ink-2 outline-none transition-colors hover:text-ink data-[state=open]:text-ink",
          row
            ? "-mx-1.5 -my-1 h-8 gap-2.5 rounded-[9px] px-1.5 hover:bg-hover data-[state=open]:bg-hover"
            : plain
              ? "-ml-2 rounded-[10px] px-2 hover:bg-hover data-[state=open]:bg-hover"
              : "rounded-[10px] bg-hover px-2.5 hover:bg-selected",
        )}
      >
        {icon}
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown size={13} className="shrink-0 text-ink-3" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={6} collisionPadding={8} className={cn(menuContentClass, "max-h-[50vh] max-w-[320px] overflow-y-auto")}>
          {options.map((o) => (
            <DropdownMenu.Item key={o.id} className={menuItemClass} onSelect={() => onPick(o.id)}>
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.selected && <Check size={14} className="shrink-0" />}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** "10 minutes before", "1 day before", "When it starts"; `none` is what no reminder is called here. */
export function reminderLabel(minutes: number | null, none = t("No reminder")) {
  if (minutes === null) return none;
  if (minutes === 0) return t("When it starts");
  if (minutes === 1440) return t("1 day before");
  if (minutes >= 60 && minutes % 60 === 0) return tn(minutes / 60, "{n} hour before", "{n} hours before");
  return tn(minutes, "{n} minute before", "{n} minutes before");
}

/**
 * When one event reminds: the usual time (Settings → Notifications) until another is picked for it.
 * `value` is the event's own time; not set means the usual one.
 */
export function ReminderPicker({ value, onChange, row }: { value: number | null | undefined; onChange: (minutes: number | null) => void; row?: boolean }) {
  const usual = useCalendar((s) => reminderOf(s.settings));
  const now = value === undefined ? usual : value;
  const choices: (number | null)[] = [...EVENT_REMINDER_CHOICES, null];
  return (
    <Picker
      icon={now === null ? <BellOff size={row ? 15 : 13} className="shrink-0 text-ink-3" /> : <Bell size={row ? 15 : 13} className={cn("shrink-0", row && "text-ink-3")} />}
      label={reminderLabel(now)}
      options={choices.map((c) => ({ id: String(c), label: reminderLabel(c), selected: c === now }))}
      onPick={(id) => onChange(id === "null" ? null : Number(id))}
      row={row}
    />
  );
}
