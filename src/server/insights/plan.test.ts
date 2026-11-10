import { describe, expect, it } from "vitest";
import { costMicros } from "../ai-usage";
import { afterSorting, firstLook, isRecent, RECENT_DAYS, senderLabel } from "./plan";

const DAY = 86_400_000;
const now = Date.parse("2026-10-13T12:00:00Z");

describe("firstLook", () => {
  it("never looks at older mail the rules don't flag", () => {
    expect(firstLook({ recent: false, rule: false, jev: "yes", read: "yes" })).toBe("nothing");
  });

  it("sorts everything else with Jev while it's there", () => {
    expect(firstLook({ recent: true, rule: false, jev: "yes", read: "yes" })).toBe("sort");
    expect(firstLook({ recent: false, rule: true, jev: "yes", read: "yes" })).toBe("sort");
  });

  it("falls back to the rules without Jev: recent flagged mail is read, older mail gets nothing", () => {
    expect(firstLook({ recent: true, rule: true, jev: "off", read: "yes" })).toBe("read");
    expect(firstLook({ recent: true, rule: false, jev: "off", read: "yes" })).toBe("nothing");
    expect(firstLook({ recent: false, rule: true, jev: "off", read: "yes" })).toBe("nothing");
  });

  it("lets mail wait while Jev is down, but reads what the rules flag", () => {
    expect(firstLook({ recent: true, rule: false, jev: "down", read: "yes" })).toBe("wait");
    expect(firstLook({ recent: false, rule: true, jev: "down", read: "yes" })).toBe("wait");
    expect(firstLook({ recent: true, rule: true, jev: "down", read: "yes" })).toBe("read");
  });

  it("waits for tomorrow instead of giving up when today's calls are used up", () => {
    expect(firstLook({ recent: false, rule: true, jev: "capped", read: "yes" })).toBe("wait");
    expect(firstLook({ recent: true, rule: false, jev: "capped", read: "yes" })).toBe("wait");
    expect(firstLook({ recent: true, rule: true, jev: "capped", read: "yes" })).toBe("read");
    expect(firstLook({ recent: true, rule: true, jev: "off", read: "capped" })).toBe("wait");
  });
});

describe("afterSorting", () => {
  const sure = { category: "order" as const, pNone: 0.05, confidence: 0.9, bulk: 0.1 };

  it("drops what Jev is sure is nothing", () => {
    expect(afterSorting({ ...sure, pNone: 0.85 }, { recent: true, replies: true })).toEqual({ kind: "nothing" });
  });

  it("sends recent mail on to be read, even when unsure", () => {
    expect(afterSorting(sure, { recent: true, replies: true })).toEqual({ kind: "read" });
    expect(afterSorting({ ...sure, category: "none", pNone: 0.6 }, { recent: true, replies: true })).toEqual({ kind: "read" });
  });

  it("files older mail it's sure about, without details", () => {
    expect(afterSorting(sure, { recent: false, replies: true })).toEqual({ kind: "sorted", category: "order" });
  });

  it("gives older mail no card when unsure, bulk, or not worth keeping", () => {
    expect(afterSorting({ ...sure, confidence: 0.4 }, { recent: false, replies: true })).toEqual({ kind: "nothing" });
    expect(afterSorting({ ...sure, category: "travel", bulk: 0.8 }, { recent: false, replies: true })).toEqual({ kind: "nothing" });
    expect(afterSorting({ ...sure, category: "security" }, { recent: false, replies: true })).toEqual({ kind: "nothing" });
    expect(afterSorting({ ...sure, category: "reply" }, { recent: false, replies: true })).toEqual({ kind: "nothing" });
  });

  it("ignores asks when Awaiting my reply is off", () => {
    expect(afterSorting({ ...sure, category: "reply" }, { recent: true, replies: false })).toEqual({ kind: "nothing" });
  });
});

describe("isRecent", () => {
  it(`covers the last ${RECENT_DAYS} days`, () => {
    expect(isRecent(new Date(now - (RECENT_DAYS - 1) * DAY), now)).toBe(true);
    expect(isRecent(new Date(now - (RECENT_DAYS + 1) * DAY), now)).toBe(false);
  });
});

describe("senderLabel", () => {
  it("uses the sender's name, or the domain without one", () => {
    expect(senderLabel({ name: "Alza.cz", email: "objednavky@alza.cz" })).toBe("Alza.cz");
    expect(senderLabel({ name: "", email: "noreply@rohlik.cz" })).toBe("rohlik.cz");
    expect(senderLabel({ name: "noreply@ppl.cz", email: "noreply@ppl.cz" })).toBe("ppl.cz");
  });
});

describe("costMicros", () => {
  it("prices Jev by input only and OpenAI's cached input at a tenth", () => {
    expect(costMicros("triage", { input: 1_000_000, cached: 0, output: 0 })).toBe(42_000);
    expect(costMicros("extract", { input: 2_800, cached: 2_000, output: 120 })).toBe(Math.round(800 * 0.1 + 2_000 * 0.01 + 120 * 0.5));
  });
});
