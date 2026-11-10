import { describe, expect, it } from "vitest";
import { LATEST_NOTE, openTips, RELEASE_NOTES, type TipContext } from "./whats-new";

const base: TipContext = { tried: [], folders: 0, snippets: 0, agents: 0, screener: false, smartCategories: false, summaries: true, sidebarArranged: false, mobile: false };

describe("what's new and tips", () => {
  it("has the newest note first, each with its own id", () => {
    expect(LATEST_NOTE).toBe(RELEASE_NOTES[0].id);
    expect(new Set(RELEASE_NOTES.map((n) => n.id)).size).toBe(RELEASE_NOTES.length);
    expect([...RELEASE_NOTES].sort((a, b) => b.date.localeCompare(a.date))).toEqual(RELEASE_NOTES);
  });

  it("offers only what fits the device and isn't done yet", () => {
    const desktop = openTips(base).map((t) => t.id);
    expect(desktop).toContain("palette");
    expect(desktop).not.toContain("swipe");
    expect(openTips({ ...base, mobile: true }).map((t) => t.id)).toContain("swipe");

    const later = openTips({ ...base, tried: ["palette", "snooze"], folders: 2, smartCategories: true }).map((t) => t.id);
    expect(later).not.toContain("palette");
    expect(later).not.toContain("snooze");
    expect(later).not.toContain("folder");
    expect(later).not.toContain("smart");
    expect(later).toContain("template");
    // Summaries turned off: no tip for a button that isn't there.
    expect(openTips({ ...base, summaries: false }).map((t) => t.id)).not.toContain("summary");
  });
});
