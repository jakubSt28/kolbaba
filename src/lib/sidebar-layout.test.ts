import { describe, expect, it } from "vitest";
import { arrange, ordered, reorderSection, reorderSections, toggleHidden, type SidebarLayout } from "./sidebar-layout";

const FOLDERS = ["inbox", "pinned", "snoozed", "scheduled", "drafts", "sent", "archive", "spam", "trash"];
const available = { folders: FOLDERS, categories: ["orders", "travel"], mine: [], agents: ["activity"] };
const away = (layout: SidebarLayout, counts = {}) =>
  arrange(layout, available, counts)
    .flatMap((s) => s.items)
    .filter((i) => i.away)
    .map((i) => i.id);

describe("sidebar layout", () => {
  it("puts Spam and Trash away by default, and empty Drafts, Snoozed and Scheduled step aside", () => {
    expect(away({})).toEqual(["snoozed", "scheduled", "drafts", "spam", "trash"]);
    expect(away({}, { drafts: 2, snoozed: 1 })).toEqual(["scheduled", "spam", "trash"]);
  });

  it("keeps the user's order and adds what's new in its default place at the end", () => {
    expect(ordered(["sent", "inbox", "gone"], ["inbox", "pinned", "sent"])).toEqual(["sent", "inbox", "pinned"]);
    const layout = reorderSection({}, "categories", ["travel", "orders"]);
    expect(arrange(layout, available, {})[1].items.map((i) => i.id)).toEqual(["travel", "orders"]);
  });

  it("orders sections, with any it doesn't mention after them", () => {
    const layout = reorderSections({}, ["agents", "folders"]);
    expect(arrange(layout, available, {}).map((s) => s.id)).toEqual(["agents", "folders", "categories", "mine"]);
  });

  it("shows and puts away items, but never Inbox", () => {
    let layout = toggleHidden({}, "trash");
    expect(away(layout)).not.toContain("trash");
    layout = toggleHidden(layout, "sent");
    expect(away(layout)).toContain("sent");
    expect(toggleHidden(layout, "inbox")).toBe(layout);
    expect(away({ hidden: ["inbox"] })).not.toContain("inbox");
  });
});
