import { describe, expect, it } from "vitest";
import { afterSkip, afterSort, NOTHING_IN_A_ROW, RECHECK_EVERY, senderOf, skipBySender, sortsBeforeKnown, type Memory } from "./memory";

const old = { recent: false, rule: true };
const recent = { recent: true, rule: false };

describe("sender memory", () => {
  it("skips a sender after three emails in a row that were nothing", () => {
    let m: Memory | undefined;
    for (let i = 0; i < NOTHING_IN_A_ROW; i++) {
      expect(skipBySender(m, recent)).toBe(false);
      m = afterSort(m, true);
    }
    expect(skipBySender(m, recent)).toBe(true);
  });

  it("starts over when an email is something", () => {
    const m = afterSort({ nothing: 2, skipped: 0 }, false);
    expect(m).toEqual({ nothing: 0, skipped: 0 });
    expect(skipBySender(afterSort(m, true), recent)).toBe(false);
  });

  it("sorts every tenth email of a skipped sender anyway", () => {
    let m: Memory = { nothing: NOTHING_IN_A_ROW, skipped: 0 };
    let skipped = 0;
    while (skipBySender(m, recent)) {
      m = afterSkip(m);
      skipped++;
    }
    expect(skipped).toBe(RECHECK_EVERY - 1);
    // The tenth goes to sorting; nothing again and the count starts over.
    expect(skipBySender(afterSort(m, true), recent)).toBe(true);
  });

  it("never skips recent mail the rules flag, but does skip such older mail", () => {
    const m = { nothing: 5, skipped: 0 };
    expect(skipBySender(m, { recent: true, rule: true })).toBe(false);
    expect(skipBySender(m, old)).toBe(true);
  });

  it("holds back a sender's emails in a step until it's known whether they're worth it", () => {
    expect(sortsBeforeKnown(undefined)).toBe(NOTHING_IN_A_ROW);
    expect(sortsBeforeKnown({ nothing: 2, skipped: 0 })).toBe(1);
    // A shop whose last email was an order isn't held back.
    expect(sortsBeforeKnown({ nothing: 0, skipped: 0 })).toBe(Infinity);
  });

  it("knows a sender by their address, whatever the case", () => {
    expect(senderOf({ email: " News@Alza.CZ " })).toBe("news@alza.cz");
  });
});
