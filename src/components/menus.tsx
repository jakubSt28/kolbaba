"use client";

import { BellOff, BellRing, CalendarDays, ChevronRight, Clock, Coffee, Moon, Sun, Sunrise } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useState, type ReactElement } from "react";
import { t } from "@/lib/i18n";
import { keepTypingMenu } from "@/lib/keyboard";
import { at, formatFuture, nextWeekday, snoozePresets } from "@/lib/utils";
import { useNow } from "@/lib/use-now";
import { Tooltip, menuContentClass, menuItemClass, subTriggerClass } from "./ui";

const PRESET_ICONS = { later: Coffee, tomorrow: Sunrise, weekend: Sun, "next-week": CalendarDays } as const;

function toLocalInput(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function CustomTime({ onPick, cta }: { onPick: (ts: number) => void; cta: string }) {
  const [value, setValue] = useState(() => toLocalInput(at(1, 9)));
  return (
    <div className="flex items-center gap-1.5 px-1.5 pt-1 pb-1.5" onKeyDown={(e) => e.stopPropagation()}>
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-8 min-w-0 flex-1 rounded-lg bg-hover px-2 text-[12.5px] text-ink outline-none focus:shadow-[0_0_0_1px_var(--accent)]"
      />
      <DropdownMenu.Item asChild onSelect={() => value && onPick(new Date(value).getTime())}>
        <button className="h-8 rounded-lg bg-accent px-3 text-[12.5px] font-medium text-on-accent outline-none data-[highlighted]:bg-accent-hover">
          {cta}
        </button>
      </DropdownMenu.Item>
    </div>
  );
}

export function SnoozeMenu({
  onPick,
  children,
  tooltip,
  side = "bottom",
  align = "end",
}: {
  onPick: (ts: number) => void;
  children: ReactElement;
  tooltip?: { label: string; shortcut?: string };
  side?: "top" | "bottom";
  align?: "start" | "end" | "center";
}) {
  const trigger = <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>;
  return (
    <DropdownMenu.Root modal={false}>
      {tooltip ? (
        <Tooltip label={tooltip.label} shortcut={tooltip.shortcut} side="top">
          {trigger}
        </Tooltip>
      ) : (
        trigger
      )}
      <DropdownMenu.Portal>
        <DropdownMenu.Content side={side} align={align} sideOffset={6} className={menuContentClass} onClick={(e) => e.stopPropagation()}>
          <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-ink-3">{t("Snooze until…")}</div>
          {snoozePresets().map((p) => {
            const Icon = PRESET_ICONS[p.id as keyof typeof PRESET_ICONS] ?? Clock;
            return (
              <DropdownMenu.Item key={p.id} className={menuItemClass} onSelect={() => onPick(p.at)}>
                <Icon size={14} />
                <span className="flex-1">{p.label}</span>
                <span className="text-[12px] opacity-60">{formatFuture(p.at)}</span>
              </DropdownMenu.Item>
            );
          })}
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <CustomTime onPick={onPick} cta={t("Snooze")} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function ScheduleMenu({
  onPick,
  children,
}: {
  onPick: (ts: number) => void;
  children: ReactElement;
}) {
  const now = useNow();
  const presets = [
    { id: "tomorrow-morning", label: t("Tomorrow morning"), at: at(1, 8), icon: Sunrise },
    { id: "tomorrow-afternoon", label: t("Tomorrow afternoon"), at: at(1, 13), icon: Sun },
    { id: "monday", label: t("Monday morning"), at: nextWeekday(1, 8), icon: CalendarDays },
    { id: "tonight", label: t("Tonight"), at: at(0, 20), icon: Moon },
  ].filter((p) => p.at > now + 15 * 60_000);
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="end"
          sideOffset={8}
          // Opened while typing on a phone: the keyboard stays up.
          {...keepTypingMenu}
          className={menuContentClass}
        >
          <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-ink-3">{t("Schedule send")}</div>
          {presets.map((p) => (
            <DropdownMenu.Item key={p.id} className={menuItemClass} onSelect={() => onPick(p.at)}>
              <p.icon size={14} />
              <span className="flex-1">{p.label}</span>
              <span className="text-[12px] opacity-60">{formatFuture(p.at)}</span>
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <CustomTime onPick={onPick} cta={t("Schedule")} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** When to be reminded if nobody replies: in the morning, a day, three days or a week from now. */
export function remindPresets(now = Date.now()) {
  return [
    { id: "1", label: t("Tomorrow"), at: at(1, 9, 0, now) },
    { id: "3", label: t("In 3 days"), at: at(3, 9, 0, now) },
    { id: "7", label: t("In a week"), at: at(7, 9, 0, now) },
  ];
}

function RemindItems({ onPick, current, Item }: { onPick: (ts: number | null) => void; current?: number; Item: typeof DropdownMenu.Item }) {
  return (
    <>
      <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-ink-3">{t("Remind me if nobody replies…")}</div>
      {remindPresets().map((p) => (
        <Item key={p.id} className={menuItemClass} onSelect={() => onPick(p.at)}>
          <BellRing size={14} />
          <span className="flex-1">{p.label}</span>
          <span className="text-[12px] opacity-60">{formatFuture(p.at)}</span>
        </Item>
      ))}
      <DropdownMenu.Separator className="my-1 h-px bg-line" />
      <CustomTime onPick={onPick} cta={t("Remind")} />
      {current && (
        <>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <Item className={menuItemClass} onSelect={() => onPick(null)}>
            <BellOff size={14} /> {t("No reminder")}
          </Item>
        </>
      )}
    </>
  );
}

/** "Remind me if nobody replies" as a button's menu (No reply yet, a sent conversation's banner). */
export function RemindMenu({ onPick, current, children, side = "bottom", align = "end" }: { onPick: (ts: number | null) => void; current?: number; children: ReactElement; side?: "top" | "bottom"; align?: "start" | "end" | "center" }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side={side} align={align} sideOffset={6} collisionPadding={8} className={menuContentClass} onClick={(e) => e.stopPropagation()}>
          <RemindItems onPick={onPick} current={current} Item={DropdownMenu.Item} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** The same inside another menu (the reader's More). */
export function RemindSub({ onPick, current }: { onPick: (ts: number | null) => void; current?: number }) {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger className={subTriggerClass}>
        <BellRing size={14} /> <span className="flex-1">{current ? t("Reminder · {time}", { time: formatFuture(current) }) : t("Remind me if no reply")}</span>
        <ChevronRight size={14} className="opacity-60" />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent sideOffset={6} collisionPadding={8} className={menuContentClass}>
          <RemindItems onPick={onPick} current={current} Item={DropdownMenu.Item} />
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}
