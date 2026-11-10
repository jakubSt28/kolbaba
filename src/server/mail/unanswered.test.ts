import { describe, expect, it } from "vitest";
import { asksQuestion, isPersonAddress, ownText, workingDaysAgo } from "./unanswered";

describe("No reply yet", () => {
  it("counts working days only", () => {
    // Monday 19 Oct 2026, noon: three working days back is Wednesday the 14th.
    const d = workingDaysAgo(3, new Date(2026, 9, 19, 12));
    expect(d.getDate()).toBe(14);
    expect(d.getHours()).toBe(12);
  });

  it("looks only at what the user wrote", () => {
    const reply = "Díky, beru.\n\nDne 12. 10. 2026 v 9:00 Petr <petr@x.cz> napsal(a):\n> Přijdeš v sobotu?";
    expect(ownText(reply).trim()).toBe("Díky, beru.");
    expect(asksQuestion(reply)).toBe(false);
    expect(asksQuestion("Hi Jana, could you send the contract by Friday?\n\nOn Mon, Jana wrote:\n> Hi")).toBe(true);
    expect(asksQuestion("See https://example.com/page?x=1 for details.")).toBe(false);
  });

  it("knows addresses nobody reads", () => {
    expect(isPersonAddress("noreply@shop.cz")).toBe(false);
    expect(isPersonAddress("no-reply@accounts.google.com")).toBe(false);
    expect(isPersonAddress("notifications@github.com")).toBe(false);
    expect(isPersonAddress("petr.novak@firma.cz")).toBe(true);
  });
});
