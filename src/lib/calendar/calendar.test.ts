import { describe, expect, it } from "vitest";
import { addMonths, dayKey, eventSpan, monthGrid, onDay, parseDay, spansDays, startOfWeek, stepAnchor, visibleDays, weekNumber } from "./dates";
import { eventsOn, hiddenPerDay, layoutBars, layoutDay } from "./layout";
import { describeRule, presetOf, ruleFor } from "./recurrence";
import type { CalEvent } from "./types";

const base = { calendarId: "cal", location: "", description: "", recurring: false, recurrence: null, organizer: null, attendees: [], myStatus: null, joinUrl: null, url: null, canEdit: true, canRespond: false };
const at = (day: string, h: number, m = 0) => new Date(parseDay(day).getFullYear(), parseDay(day).getMonth(), parseDay(day).getDate(), h, m);
const timed = (id: string, day: string, from: [number, number], to: [number, number], endDay = day): CalEvent => ({ ...base, id, title: id, start: at(day, ...from).toISOString(), end: at(endDay, ...to).toISOString(), allDay: false });
const allDay = (id: string, from: string, to: string): CalEvent => ({ ...base, id, title: id, start: from, end: to, allDay: true });
const week = (monday: string) => Array.from({ length: 7 }, (_, i) => new Date(parseDay(monday).getFullYear(), parseDay(monday).getMonth(), parseDay(monday).getDate() + i));

describe("calendar dates", () => {
  it("starts weeks on Monday", () => {
    expect(dayKey(startOfWeek(parseDay("2026-11-11")))).toBe("2026-11-09");
    expect(dayKey(startOfWeek(parseDay("2026-11-15")))).toBe("2026-11-09");
    expect(dayKey(startOfWeek(parseDay("2026-11-09")))).toBe("2026-11-09");
  });

  it("shows a month as whole weeks, as many as it needs", () => {
    const november = monthGrid(parseDay("2026-11-11"));
    expect(november).toHaveLength(42);
    expect(dayKey(november[0])).toBe("2026-10-26");
    expect(dayKey(november[41])).toBe("2026-12-06");
    // February 2027 starts on a Monday and fits four rows.
    expect(monthGrid(parseDay("2027-02-10"))).toHaveLength(28);
  });

  it("steps by the view: a month, a week, three days on a phone, a day", () => {
    const d = parseDay("2026-01-31");
    expect(dayKey(stepAnchor("month", d, 1))).toBe("2026-02-01");
    expect(dayKey(stepAnchor("week", d, 1))).toBe("2026-02-07");
    expect(dayKey(stepAnchor("week", d, -1, 3))).toBe("2026-01-28");
    expect(dayKey(stepAnchor("day", d, 1))).toBe("2026-02-01");
    expect(dayKey(addMonths(d, 1))).toBe("2026-02-28");
  });

  it("lists the days a view shows", () => {
    expect(visibleDays("week", parseDay("2026-11-11")).map(dayKey)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
    expect(visibleDays("week", parseDay("2026-11-11"), 3).map(dayKey)).toEqual(["2026-11-11", "2026-11-12", "2026-11-13"]);
    expect(visibleDays("day", parseDay("2026-11-11")).map(dayKey)).toEqual(["2026-11-11"]);
  });

  it("keeps all-day events on their dates and off the day after", () => {
    const e = allDay("trip", "2026-11-14", "2026-11-16");
    expect(onDay(eventSpan(e), parseDay("2026-11-13"))).toBe(false);
    expect(onDay(eventSpan(e), parseDay("2026-11-14"))).toBe(true);
    expect(onDay(eventSpan(e), parseDay("2026-11-15"))).toBe(true);
    expect(onDay(eventSpan(e), parseDay("2026-11-16"))).toBe(false);
  });

  it("an event that ends at midnight doesn't reach into the next day", () => {
    const e = timed("late", "2026-11-11", [22, 0], [0, 0], "2026-11-12");
    expect(onDay(eventSpan(e), parseDay("2026-11-12"))).toBe(false);
    expect(spansDays(e)).toBe(false);
    expect(spansDays(timed("long", "2026-11-11", [9, 0], [9, 0], "2026-11-12"))).toBe(true);
  });

  it("numbers weeks the ISO way", () => {
    expect(weekNumber(parseDay("2026-11-11"))).toBe(46);
    expect(weekNumber(parseDay("2027-01-01"))).toBe(53);
  });
});

describe("calendar layout", () => {
  it("puts overlapping events side by side and leaves the others full width", () => {
    const day = parseDay("2026-11-11");
    const boxes = layoutDay([timed("a", "2026-11-11", [10, 0], [11, 0]), timed("b", "2026-11-11", [10, 30], [12, 0]), timed("c", "2026-11-11", [14, 0], [15, 0])], day);
    const by = Object.fromEntries(boxes.map((b) => [b.event.id, b]));
    expect([by.a.column, by.a.columns]).toEqual([0, 2]);
    expect([by.b.column, by.b.columns]).toEqual([1, 2]);
    expect([by.c.column, by.c.columns]).toEqual([0, 1]);
    expect(by.a.top).toBe(600);
    expect(by.a.bottom).toBe(660);
  });

  it("reuses a column once the event in it is over", () => {
    const day = parseDay("2026-11-11");
    const boxes = layoutDay([timed("a", "2026-11-11", [9, 0], [10, 0]), timed("b", "2026-11-11", [9, 30], [11, 0]), timed("c", "2026-11-11", [10, 15], [11, 0])], day);
    const by = Object.fromEntries(boxes.map((b) => [b.event.id, b]));
    expect(by.c.column).toBe(0);
    expect(by.c.columns).toBe(2);
  });

  it("clips an event that runs past midnight to each day", () => {
    const e = timed("train", "2026-11-13", [22, 0], [1, 30], "2026-11-14");
    const [first] = layoutDay([e], parseDay("2026-11-13"));
    const [second] = layoutDay([e], parseDay("2026-11-14"));
    expect([first.top, first.bottom, first.toAfter]).toEqual([1320, 1440, true]);
    expect([second.top, second.bottom, second.fromBefore]).toEqual([0, 90, true]);
  });

  it("gives a short event room for its title", () => {
    const [box] = layoutDay([timed("ping", "2026-11-11", [9, 0], [9, 5])], parseDay("2026-11-11"));
    expect(box.bottom - box.top).toBeGreaterThanOrEqual(20);
  });

  it("lays bars across the days they cover, long ones first", () => {
    const days = week("2026-11-09");
    const bars = layoutBars([allDay("trip", "2026-11-14", "2026-11-17"), allDay("holiday", "2026-11-12", "2026-11-14"), timed("lunch", "2026-11-12", [12, 0], [13, 0])], days);
    const by = Object.fromEntries(bars.map((b) => [b.event.id, b]));
    expect([by.holiday.column, by.holiday.span, by.holiday.line]).toEqual([3, 2, 0]);
    // It goes on into next week: the bar is cut at Sunday.
    expect([by.trip.column, by.trip.span, by.trip.toAfter]).toEqual([5, 2, true]);
    expect([by.lunch.column, by.lunch.span, by.lunch.line, by.lunch.timed]).toEqual([3, 1, 1, true]);
  });

  it("counts what doesn't fit, per day", () => {
    const days = week("2026-11-09");
    const events = ["a", "b", "c", "d"].map((id, i) => timed(id, "2026-11-10", [9 + i, 0], [10 + i, 0]));
    expect(hiddenPerDay(layoutBars(events, days), 7, 2)).toEqual([0, 2, 0, 0, 0, 0, 0]);
  });

  it("lists a day's events, all-day ones first", () => {
    const list = eventsOn([timed("b", "2026-11-11", [15, 0], [16, 0]), allDay("day", "2026-11-11", "2026-11-12"), timed("a", "2026-11-11", [9, 0], [10, 0]), timed("other", "2026-11-12", [9, 0], [10, 0])], parseDay("2026-11-11"));
    expect(list.map((e) => e.id)).toEqual(["day", "a", "b"]);
  });
});

describe("repeating events", () => {
  const wednesday = parseDay("2026-11-11");

  it("spells a preset out for the day the event starts on", () => {
    expect(ruleFor("none", wednesday)).toBeNull();
    expect(ruleFor("daily", wednesday)).toBe("FREQ=DAILY");
    expect(ruleFor("weekly", wednesday)).toBe("FREQ=WEEKLY;BYDAY=WE");
    expect(ruleFor("biweekly", wednesday)).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=WE");
    expect(ruleFor("monthly", wednesday)).toBe("FREQ=MONTHLY;BYMONTHDAY=11");
    expect(ruleFor("yearly", wednesday)).toBe("FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=11");
  });

  it("recognises its own rules and the plain ones other calendars write", () => {
    for (const preset of ["daily", "weekdays", "weekly", "biweekly", "monthly", "yearly"] as const) expect(presetOf(ruleFor(preset, wednesday))).toBe(preset);
    expect(presetOf("RRULE:FREQ=WEEKLY")).toBe("weekly");
    expect(presetOf("FREQ=YEARLY")).toBe("yearly");
    expect(presetOf(null)).toBe("none");
  });

  it("calls anything else custom, and keeps it", () => {
    expect(presetOf("FREQ=MONTHLY;BYDAY=-1FR")).toBe("custom");
    expect(presetOf("FREQ=WEEKLY;BYDAY=MO,WE")).toBe("custom");
    expect(presetOf("FREQ=DAILY;COUNT=5")).toBe("custom");
    expect(presetOf("FREQ=WEEKLY;INTERVAL=3;BYDAY=WE")).toBe("custom");
    expect(describeRule("FREQ=MONTHLY;BYDAY=-1FR", true)).toBe("Repeats");
    expect(describeRule(null, true)).toBe("Repeats");
    expect(describeRule(null, false)).toBeNull();
    expect(describeRule("FREQ=WEEKLY;BYDAY=WE", true)).toBe("Every week");
  });
});
