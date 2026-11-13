import { addDays, dayKey, parseDay, startOfWeek } from "../calendar/dates";
import { intlLocale, t, tn } from "../i18n";

/**
 * Repeating tasks. A rule is the part of an iCalendar RRULE TickTick writes and its repeat menu
 * offers: FREQ (DAILY, WEEKLY, MONTHLY, YEARLY), INTERVAL, BYDAY for weekly and BYMONTHDAY for
 * monthly. Ticking a repeating task off keeps a completed copy and moves the task to its next day.
 */

export type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export interface Rule {
  freq: Freq;
  interval: number;
  /** Weekdays, 0 Sunday … 6 Saturday. */
  byDay?: number[];
  byMonthDay?: number;
}

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const FREQS: Freq[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];

export function parseRule(text: string | null | undefined): Rule | null {
  if (!text) return null;
  const parts = new Map(
    text
      .replace(/^RRULE:/i, "")
      .split(";")
      .map((p) => p.split("=") as [string, string])
      .map(([k, v]) => [k?.toUpperCase(), (v ?? "").toUpperCase()]),
  );
  const freq = parts.get("FREQ") as Freq;
  if (!FREQS.includes(freq)) return null;
  const interval = Math.max(1, Math.min(999, Number(parts.get("INTERVAL")) || 1));
  const byDay = parts
    .get("BYDAY")
    ?.split(",")
    .map((d) => DAYS.indexOf(d.replace(/^[+-]?\d+/, "")))
    .filter((d) => d >= 0);
  const monthDay = Number(parts.get("BYMONTHDAY"));
  return {
    freq,
    interval,
    ...(freq === "WEEKLY" && byDay?.length ? { byDay: [...new Set(byDay)].sort() } : {}),
    ...(freq === "MONTHLY" && monthDay >= 1 && monthDay <= 31 ? { byMonthDay: monthDay } : {}),
  };
}

export function formatRule(rule: Rule): string {
  return [
    `FREQ=${rule.freq}`,
    `INTERVAL=${rule.interval}`,
    ...(rule.byDay?.length ? [`BYDAY=${rule.byDay.map((d) => DAYS[d]).join(",")}`] : []),
    ...(rule.byMonthDay ? [`BYMONTHDAY=${rule.byMonthDay}`] : []),
  ].join(";");
}

/** A valid rule as it's stored, or null. */
export const cleanRule = (text: string | null | undefined) => {
  const rule = parseRule(text);
  return rule ? formatRule(rule) : null;
};

const lastDay = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
/** That day of the month, or the month's last day when it has fewer (the 31st in April is the 30th). */
const onMonthDay = (year: number, month: number, day: number) => new Date(year, month, Math.min(day, lastDay(year, month)));

/** The rule's next day after `from` (YYYY-MM-DD), counting from the task's own day `due`. */
function stepAfter(rule: Rule, due: Date, from: Date): Date {
  const n = rule.interval;
  if (rule.freq === "DAILY") {
    const gap = Math.floor((from.getTime() - due.getTime()) / 86_400_000);
    return addDays(due, (Math.floor(Math.max(0, gap) / n) + 1) * n);
  }
  if (rule.freq === "WEEKLY") {
    const days = rule.byDay?.length ? rule.byDay : [due.getDay()];
    const week0 = startOfWeek(due).getTime();
    for (let d = addDays(from, 1), i = 0; i < 7 * n + 7; d = addDays(d, 1), i++) {
      const weeks = Math.round((startOfWeek(d).getTime() - week0) / (7 * 86_400_000));
      if (weeks % n === 0 && days.includes(d.getDay())) return d;
    }
    return addDays(from, 7 * n);
  }
  if (rule.freq === "MONTHLY") {
    const day = rule.byMonthDay ?? due.getDate();
    let months = (from.getFullYear() - due.getFullYear()) * 12 + from.getMonth() - due.getMonth();
    months = Math.max(0, Math.floor(months / n) * n);
    for (;;) {
      const d = onMonthDay(due.getFullYear(), due.getMonth() + months, day);
      if (d > from) return d;
      months += n;
    }
  }
  let years = Math.max(0, Math.floor((from.getFullYear() - due.getFullYear()) / n) * n);
  for (;;) {
    const d = onMonthDay(due.getFullYear() + years, due.getMonth(), due.getDate());
    if (d > from) return d;
    years += n;
  }
}

/**
 * Where a repeating task goes once ticked off: its next day after its own, and after today too, so
 * a daily task done late comes back tomorrow rather than on a day that's already over.
 */
export function nextDue(due: string, rule: string, today: string): string | null {
  const parsed = parseRule(rule);
  if (!parsed) return null;
  const from = due > today ? due : today;
  return dayKey(stepAfter(parsed, parseDay(due), parseDay(from)));
}

/* ---------------------------------- Words ---------------------------------- */

const weekdayName = (d: number) => new Intl.DateTimeFormat(intlLocale(), { weekday: "long" }).format(new Date(2024, 0, 7 + d));
const WORKDAYS = [1, 2, 3, 4, 5];

/** "Daily", "Weekly on Monday", "Every weekday", "Monthly on the 25th", "Every 2 weeks"… */
export function ruleLabel(text: string | null, due: string | null): string {
  const rule = parseRule(text);
  if (!rule) return t("Doesn't repeat");
  const n = rule.interval;
  const date = due ? parseDay(due) : new Date();
  if (rule.freq === "DAILY") return n === 1 ? t("Daily") : tn(n, "Every {n} day", "Every {n} days");
  if (rule.freq === "WEEKLY") {
    const days = rule.byDay ?? [date.getDay()];
    if (n === 1 && days.join() === WORKDAYS.join()) return t("Every weekday");
    const names = days.map(weekdayName).join(", ");
    return n === 1 ? t("Weekly on {days}", { days: names }) : tn(n, "Every {n} week on {days}", "Every {n} weeks on {days}", { days: names });
  }
  if (rule.freq === "MONTHLY") {
    const day = rule.byMonthDay ?? date.getDate();
    return n === 1 ? t("Monthly on day {day}", { day }) : tn(n, "Every {n} month on day {day}", "Every {n} months on day {day}", { day });
  }
  const on = new Intl.DateTimeFormat(intlLocale(), { day: "numeric", month: "long" }).format(date);
  return n === 1 ? t("Yearly on {date}", { date: on }) : tn(n, "Every {n} year on {date}", "Every {n} years on {date}", { date: on });
}

/** The choices of the repeat menu for a task on this day, as TickTick offers them. */
export function repeatChoices(due: string | null): { rule: string | null; label: string }[] {
  const date = due ? parseDay(due) : new Date();
  const rules = [
    formatRule({ freq: "DAILY", interval: 1 }),
    formatRule({ freq: "WEEKLY", interval: 1, byDay: [date.getDay()] }),
    formatRule({ freq: "WEEKLY", interval: 1, byDay: WORKDAYS }),
    formatRule({ freq: "MONTHLY", interval: 1, byMonthDay: date.getDate() }),
    formatRule({ freq: "YEARLY", interval: 1 }),
  ];
  return [{ rule: null, label: t("Doesn't repeat") }, ...rules.map((rule) => ({ rule, label: ruleLabel(rule, due) }))];
}
