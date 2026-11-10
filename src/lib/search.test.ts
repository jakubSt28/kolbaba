import { describe, expect, it } from "vitest";
import { hasOperator, parseDay, parseSearch, searchFrom, toggleOperator } from "./search";

describe("search operators", () => {
  it("splits words from operators, in English and Czech", () => {
    const p = parseSearch('faktura from:vodafone komu:"Jana Nováková" has:attachment je:nepřečtené after:2026-09-01 in:all');
    expect(p.text).toBe("faktura");
    expect(p.from).toEqual(["vodafone"]);
    expect(p.to).toEqual(["jana nováková"]);
    expect(p.hasAttachment).toBe(true);
    expect(p.unread).toBe(true);
    expect(p.after?.getFullYear()).toBe(2026);
    expect(p.everywhere).toBe(true);
  });

  it("keeps what it doesn't understand as words", () => {
    const p = parseSearch("https://example.com is:weird before:someday re:hello");
    expect(p.text).toBe("https://example.com is:weird before:someday re:hello");
    expect(p.before).toBeNull();
  });

  it("reads Czech dates too", () => {
    expect(parseDay("1.9.2026")?.getMonth()).toBe(8);
    expect(parseDay("2026-02-30")).toBeNull();
  });

  it("toggles chips in the query", () => {
    expect(toggleOperator("faktura", "has:attachment")).toBe("faktura has:attachment");
    expect(toggleOperator("faktura has:attachment", "has:attachment")).toBe("faktura");
    expect(hasOperator("x IN:ALL", "in:all")).toBe(true);
  });

  it("searches every folder from Inbox, and the open folder elsewhere", () => {
    expect(searchFrom("nasereality", "inbox")).toBe("nasereality in:all");
    expect(searchFrom("nasereality v:vše", "inbox")).toBe("nasereality v:vše");
    expect(searchFrom("nasereality", "archive")).toBe("nasereality");
  });
});
