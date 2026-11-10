import { describe, expect, it } from "vitest";
import { firstMatch, fromMatches, normalizeFrom, ruleMatches, senderKey, subjectMatches } from "./rules";

describe("rules", () => {
  it("understand who a rule is about however it's typed", () => {
    expect(normalizeFrom("Petr@Firma.cz ")).toBe("petr@firma.cz");
    expect(normalizeFrom("alza.cz")).toBe("@alza.cz");
    expect(normalizeFrom("@Alza.CZ")).toBe("@alza.cz");
    expect(normalizeFrom("")).toBe("");
    expect(normalizeFrom("alza")).toBeNull();
  });

  it("learn companies by domain and people by address", () => {
    expect(senderKey("objednavky@alza.cz")).toBe("@alza.cz");
    expect(senderKey("Petra.Novakova@seznam.cz")).toBe("petra.novakova@seznam.cz");
    expect(senderKey("someone@gmail.com")).toBe("someone@gmail.com");
  });

  it("match the address, or anyone at the domain and its subdomains", () => {
    expect(fromMatches("@alza.cz", "info@alza.cz")).toBe(true);
    expect(fromMatches("@alza.cz", "news@mail.alza.cz")).toBe(true);
    expect(fromMatches("@alza.cz", "info@notalza.cz")).toBe(false);
    expect(fromMatches("petr@firma.cz", "PETR@firma.cz")).toBe(true);
    expect(fromMatches("petr@firma.cz", "jana@firma.cz")).toBe(false);
  });

  it("match subject words in any order, with or without accents", () => {
    expect(subjectMatches("faktura září", "Vaše FAKTURA za zari 2026")).toBe(true);
    expect(subjectMatches("faktura dobropis", "Faktura č. 12")).toBe(false);
    expect(subjectMatches("", "anything")).toBe(true);
  });

  it("apply to their mailbox only, and an empty rule to nothing", () => {
    const rule = { accountId: "acc_1", from: "@alza.cz", subject: "" };
    expect(ruleMatches(rule, { accountId: "acc_1", from: "info@alza.cz", subject: "x" })).toBe(true);
    expect(ruleMatches(rule, { accountId: "acc_2", from: "info@alza.cz", subject: "x" })).toBe(false);
    expect(ruleMatches({ accountId: null, from: "", subject: " " }, { accountId: "acc_1", from: "a@b.cz", subject: "x" })).toBe(false);
  });

  it("let the oldest matching rule win", () => {
    const rules = [
      { id: "1", accountId: null, from: "@alza.cz", subject: "faktura" },
      { id: "2", accountId: null, from: "@alza.cz", subject: "" },
    ];
    expect(firstMatch(rules, { accountId: "a", from: "x@alza.cz", subject: "Faktura 7" })?.id).toBe("1");
    expect(firstMatch(rules, { accountId: "a", from: "x@alza.cz", subject: "Akce" })?.id).toBe("2");
    expect(firstMatch(rules, { accountId: "a", from: "x@mall.cz", subject: "Akce" })).toBeNull();
  });
});
