import { describe, expect, it } from "vitest";
import { inboxZeroStamps, sendStamps, STAMPS, yearAndADay } from "./stamps";

const at = (iso: string) => new Date(iso);
const DAY = 24 * 3600_000;

describe("stamp album", () => {
  it("has sixteen stamps, numbered in order, counted ones with a goal", () => {
    expect(STAMPS.map((s) => s.no)).toEqual(STAMPS.map((_, i) => i + 1));
    expect(new Set(STAMPS.map((s) => s.id)).size).toBe(STAMPS.length);
    expect(STAMPS.filter((s) => s.counter).every((s) => s.goal)).toBe(true);
  });

  it("an empty Inbox: Clean Desk always, Padla on workday afternoons, Early Bird before eight", () => {
    expect(inboxZeroStamps(at("2026-10-13T11:00:00"), []).earn).toEqual(["clean-desk"]);
    expect(inboxZeroStamps(at("2026-10-13T16:00:00"), []).earn).toContain("padla");
    expect(inboxZeroStamps(at("2026-10-17T16:00:00"), []).earn).not.toContain("padla");
    expect(inboxZeroStamps(at("2026-10-13T07:15:00"), []).earn).toContain("early-bird");
  });

  it("Clean Week takes five days within the last seven, and forgets older ones", () => {
    const days = ["2026-10-01", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12"];
    const { earn, zeroDays } = inboxZeroStamps(at("2026-10-13T11:00:00"), days);
    expect(zeroDays).toEqual(["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"]);
    expect(earn).toContain("clean-week");
    expect(inboxZeroStamps(at("2026-10-13T11:00:00"), days.slice(0, 3)).earn).not.toContain("clean-week");
  });

  it("sending: the first letter, Christmas post, long and old conversations", () => {
    expect(sendStamps(at("2026-10-13T11:00:00"))).toEqual(["first-letter"]);
    expect(sendStamps(at("2026-12-24T11:00:00"))).toContain("christmas");
    expect(sendStamps(at("2026-12-27T11:00:00"))).not.toContain("christmas");
    expect(sendStamps(at("2026-10-13T11:00:00"), { messages: 12 })).toContain("pen-pal");
    const now = at("2026-10-13T11:00:00");
    expect(sendStamps(now, { messages: 2, lastFromOthers: now.getTime() - 400 * DAY })).toContain("archaeologist");
    expect(sendStamps(now, { messages: 2, lastFromOthers: now.getTime() - 100 * DAY })).not.toContain("archaeologist");
  });

  it("a year and a day", () => {
    const now = Date.now();
    expect(yearAndADay(now - 366 * DAY, now)).toBe(true);
    expect(yearAndADay(now - 365 * DAY, now)).toBe(false);
  });
});
