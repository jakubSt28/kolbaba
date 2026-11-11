"use client";

import { Check, ChevronDown } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useEffect } from "react";
import { reminderOf, useCalendar } from "@/lib/calendar/store";
import { REMINDER_CHOICES } from "@/lib/calendar/types";
import { t } from "@/lib/i18n";
import { Group, Row } from "../settings";
import { menuContentClass, menuItemClass } from "../ui";
import { reminderLabel } from "./picker";

const label = (minutes: number | null) => reminderLabel(minutes, t("No reminders"));

/** Settings → Notifications: how long before an event its reminder comes. Only there once a calendar is. */
export function EventReminderSetting() {
  const ready = useCalendar((s) => s.ready);
  const has = useCalendar((s) => s.calendars.length > 0);
  const settings = useCalendar((s) => s.settings);
  const setReminder = useCalendar((s) => s.setReminder);
  useEffect(() => {
    if (!ready) void useCalendar.getState().init();
  }, [ready]);
  if (!has) return null;
  const value = reminderOf(settings);
  return (
    <Group title={t("Calendar")} footer={t("A notification before an event starts, on devices where notifications are on. All-day events and ones you declined don't remind. One event can have a time of its own: open the event and pick it there.")}>
      <Row label={t("Remind me of events")}>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger className="flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] bg-hover px-2.5 text-[13px] font-medium text-ink outline-none hover:bg-selected">
            {label(value)}
            <ChevronDown size={13} className="text-ink-3" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={6} collisionPadding={8} className={menuContentClass}>
              {[...REMINDER_CHOICES, null].map((choice) => (
                <DropdownMenu.Item key={String(choice)} className={menuItemClass} onSelect={() => setReminder(choice)}>
                  <span className="flex-1">{label(choice)}</span>
                  {choice === value && <Check size={14} />}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </Row>
    </Group>
  );
}
