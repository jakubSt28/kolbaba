import { describe, expect, it } from "vitest";
import { splitEmoji } from "./logic";
import { cleanRule, nextDue, repeatChoices, ruleLabel } from "./repeat";

describe("repeating tasks", () => {
  it("move on to their next day after their own", () => {
    expect(nextDue("2026-11-13", "FREQ=DAILY;INTERVAL=1", "2026-11-13")).toBe("2026-11-14");
    expect(nextDue("2026-11-13", "FREQ=DAILY;INTERVAL=3", "2026-11-13")).toBe("2026-11-16");
    // Friday, weekly on Fridays.
    expect(nextDue("2026-11-13", "FREQ=WEEKLY;INTERVAL=1;BYDAY=FR", "2026-11-13")).toBe("2026-11-20");
    // Weekdays: Friday goes to Monday.
    expect(nextDue("2026-11-13", "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR", "2026-11-13")).toBe("2026-11-16");
    expect(nextDue("2026-11-13", "FREQ=WEEKLY;INTERVAL=2;BYDAY=FR", "2026-11-13")).toBe("2026-11-27");
    expect(nextDue("2026-11-25", "FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=25", "2026-11-13")).toBe("2026-12-25");
    expect(nextDue("2026-02-29".replace("2026", "2028"), "FREQ=YEARLY;INTERVAL=1", "2028-02-29")).toBe("2029-02-28");
  });

  it("done late, come back after today rather than on a day that's over", () => {
    expect(nextDue("2026-11-05", "FREQ=DAILY;INTERVAL=1", "2026-11-13")).toBe("2026-11-14");
    expect(nextDue("2026-10-25", "FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=25", "2026-11-13")).toBe("2026-11-25");
  });

  it("keep to the last day of a short month", () => {
    expect(nextDue("2026-01-31", "FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=31", "2026-01-31")).toBe("2026-02-28");
    expect(nextDue("2026-02-28", "FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=31", "2026-02-28")).toBe("2026-03-31");
  });

  it("are said in words, and only rules we understand are kept", () => {
    expect(ruleLabel("FREQ=DAILY;INTERVAL=1", null)).toBe("Daily");
    expect(ruleLabel("FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR", null)).toBe("Every weekday");
    expect(ruleLabel("FREQ=WEEKLY;INTERVAL=1;BYDAY=MO", null)).toBe("Weekly on Monday");
    expect(ruleLabel("FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=25", null)).toBe("Monthly on day 25");
    expect(ruleLabel("FREQ=DAILY;INTERVAL=2", null)).toBe("Every 2 days");
    expect(cleanRule("RRULE:FREQ=MONTHLY;BYMONTHDAY=25")).toBe("FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=25");
    expect(cleanRule("FREQ=HOURLY")).toBeNull();
    expect(cleanRule("")).toBeNull();
    expect(repeatChoices("2026-11-13").map((c) => c.label)).toEqual(["Doesn't repeat", "Daily", "Weekly on Friday", "Every weekday", "Monthly on day 13", "Yearly on 13 November"]);
  });
});

describe("list names", () => {
  it("take an emoji at their start as their icon", () => {
    expect(splitEmoji("🏡Garden")).toEqual({ emoji: "🏡", name: "Garden" });
    expect(splitEmoji("✅ Errands")).toEqual({ emoji: "✅", name: "Errands" });
    expect(splitEmoji("🗒️ Notes")).toEqual({ emoji: "🗒️", name: "Notes" });
    expect(splitEmoji("Groceries")).toEqual({ emoji: null, name: "Groceries" });
    expect(splitEmoji("🚀")).toEqual({ emoji: null, name: "🚀" });
  });
});
