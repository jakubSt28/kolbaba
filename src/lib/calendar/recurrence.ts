import { tk } from "../i18n";

/**
 * How an event repeats. The editor offers a handful of ways; anything else a calendar came with
 * ("the last Friday of every second month") is kept as it is and shown as "Custom".
 */

export type RepeatPreset = "none" | "daily" | "weekdays" | "weekly" | "biweekly" | "monthly" | "yearly" | "custom";

export const REPEAT_PRESETS: Exclude<RepeatPreset, "custom">[] = ["none", "daily", "weekdays", "weekly", "biweekly", "monthly", "yearly"];

/** English; shown with t(). */
export const REPEAT_LABELS: Record<RepeatPreset, string> = {
  none: tk("Doesn't repeat"),
  daily: tk("Every day"),
  weekdays: tk("Every weekday"),
  weekly: tk("Every week"),
  biweekly: tk("Every 2 weeks"),
  monthly: tk("Every month"),
  yearly: tk("Every year"),
  custom: tk("Custom"),
};

const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** The rule for a preset, spelled out for the day the event starts on (every calendar reads it the same way). */
export function ruleFor(preset: RepeatPreset, start: Date): string | null {
  const day = BYDAY[start.getDay()];
  switch (preset) {
    case "daily":
      return "FREQ=DAILY";
    case "weekdays":
      return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
    case "weekly":
      return `FREQ=WEEKLY;BYDAY=${day}`;
    case "biweekly":
      return `FREQ=WEEKLY;INTERVAL=2;BYDAY=${day}`;
    case "monthly":
      return `FREQ=MONTHLY;BYMONTHDAY=${start.getDate()}`;
    case "yearly":
      return `FREQ=YEARLY;BYMONTH=${start.getMonth() + 1};BYMONTHDAY=${start.getDate()}`;
    default:
      return null;
  }
}

function parts(rule: string) {
  const out: Record<string, string> = {};
  for (const part of rule.replace(/^RRULE:/i, "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) out[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).toUpperCase();
  }
  return out;
}

/** Which preset a rule is, or "custom" for one the editor can't make. */
export function presetOf(rule: string | null | undefined): RepeatPreset {
  if (!rule) return "none";
  const p = parts(rule);
  const interval = Number(p.INTERVAL ?? 1);
  // An end (a date or a count) or a pick of positions isn't something the presets say.
  if (p.COUNT || p.UNTIL || p.BYSETPOS) return "custom";
  const days = (p.BYDAY ?? "").split(",").filter(Boolean);
  switch (p.FREQ) {
    case "DAILY":
      return interval === 1 && !days.length ? "daily" : "custom";
    case "WEEKLY":
      if (days.some((d) => d.length !== 2)) return "custom";
      if (interval === 1 && days.length === 5 && ["MO", "TU", "WE", "TH", "FR"].every((d) => days.includes(d))) return "weekdays";
      if (days.length > 1) return "custom";
      return interval === 1 ? "weekly" : interval === 2 ? "biweekly" : "custom";
    case "MONTHLY":
      return interval === 1 && !days.length && !(p.BYMONTHDAY ?? "").includes(",") ? "monthly" : "custom";
    case "YEARLY":
      return interval === 1 && !days.length ? "yearly" : "custom";
    default:
      return "custom";
  }
}

/** What to say about a repeating event: the preset's name, or just that it repeats. English; show with t(). */
export function describeRule(rule: string | null | undefined, recurring: boolean): string | null {
  const preset = presetOf(rule);
  if (preset === "none") return recurring ? tk("Repeats") : null;
  return preset === "custom" ? tk("Repeats") : REPEAT_LABELS[preset];
}
