import { describe, expect, it } from "vitest";
import { describeStep, type StepFormat } from "./agent-steps";
import { translate, translateCount, type Locale } from "./i18n";

const format = (locale: Locale): StepFormat => ({
  t: (text, vars) => translate(locale, text, vars),
  tn: (n, one, other, vars) => translateCount(locale, n, one, other, vars),
  when: (iso) => `<${iso}>`,
  folder: (id) => id.toUpperCase(),
});

describe("describeStep", () => {
  it("phrases a step in the reader's language", () => {
    const step = { kind: "scheduled", subject: "Nabídka", to: "Petr", more: 2, at: "2026-10-12T09:00:00+02:00" } as const;
    expect(describeStep(step, format("en"))).toBe("Scheduled **Nabídka** to Petr and 2 more for <2026-10-12T09:00:00+02:00>");
    expect(describeStep(step, format("cs"))).not.toContain("Scheduled");
  });

  it("keeps asterisks in subjects from breaking the bold markers", () => {
    expect(describeStep({ kind: "archived", subject: "**Sale** now" }, format("en"))).toBe("Archived **Sale now**");
    expect(describeStep({ kind: "read", subject: "" }, format("en"))).toBe("Read **(no subject)**");
  });

  it("names folders with the app's own labels", () => {
    expect(describeStep({ kind: "listed", folder: "inbox" }, format("en"))).toBe("Listed **INBOX**");
  });
});
