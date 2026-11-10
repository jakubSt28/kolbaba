import { describe, expect, it } from "vitest";
import { inQuietHours, mayNotify, minutesIn, minutesOf, type NewMailFacts } from "./quiet-hours";

const at = (iso: string) => new Date(iso);
const quiet = { on: true, from: "22:00", to: "07:00", tz: "Europe/Prague" };

describe("quiet hours", () => {
  it("reads times of day", () => {
    expect(minutesOf("22:30")).toBe(22 * 60 + 30);
    expect(minutesOf("7:05")).toBe(7 * 60 + 5);
    expect(minutesOf("24:00")).toBeNull();
    expect(minutesOf("noon")).toBeNull();
  });

  it("knows the time in the user's zone, not the server's", () => {
    // 21:30 UTC in October is 23:30 in Prague (summer time).
    expect(minutesIn("Europe/Prague", at("2026-10-19T21:30:00Z"))).toBe(23 * 60 + 30);
    expect(minutesIn("Nowhere/Fake", at("2026-10-19T21:30:00Z"))).toBe(21 * 60 + 30);
  });

  it("run over midnight", () => {
    expect(inQuietHours(quiet, at("2026-10-19T21:30:00Z"))).toBe(true); // 23:30
    expect(inQuietHours(quiet, at("2026-10-20T04:00:00Z"))).toBe(true); // 06:00
    expect(inQuietHours(quiet, at("2026-10-20T05:00:00Z"))).toBe(false); // 07:00 sharp: over
    expect(inQuietHours(quiet, at("2026-10-19T12:00:00Z"))).toBe(false); // 14:00
  });

  it("can be a stretch inside one day, and off", () => {
    const lunch = { on: true, from: "12:00", to: "13:00", tz: "UTC" };
    expect(inQuietHours(lunch, at("2026-10-19T12:30:00Z"))).toBe(true);
    expect(inQuietHours(lunch, at("2026-10-19T13:30:00Z"))).toBe(false);
    expect(inQuietHours({ ...quiet, on: false }, at("2026-10-19T21:30:00Z"))).toBe(false);
    expect(inQuietHours(undefined, at("2026-10-19T21:30:00Z"))).toBe(false);
  });
});

describe("what may notify", () => {
  const mail = (facts: Partial<NewMailFacts> = {}): NewMailFacts => ({ kind: "person", code: false, vip: false, watched: false, ruled: false, ...facts });

  it("everything, people only, VIPs only, nothing", () => {
    expect(mayNotify("all", false, mail({ kind: "newsletter" }))).toBe(true);
    expect(mayNotify("people", false, mail({ kind: "newsletter" }))).toBe(false);
    expect(mayNotify("people", false, mail({ kind: "notification" }))).toBe(false);
    expect(mayNotify("people", false, mail())).toBe(true);
    expect(mayNotify("vip", false, mail())).toBe(false);
    expect(mayNotify("vip", false, mail({ vip: true }))).toBe(true);
    expect(mayNotify("none", false, mail({ vip: true }))).toBe(false);
  });

  it("lets sign-in codes through, except with Nothing", () => {
    expect(mayNotify("people", false, mail({ kind: "notification", code: true }))).toBe(true);
    expect(mayNotify("vip", true, mail({ kind: "notification", code: true }))).toBe(true);
    expect(mayNotify("none", false, mail({ code: true }))).toBe(false);
  });

  it("keeps quiet hours quiet, VIPs aside", () => {
    expect(mayNotify("all", true, mail())).toBe(false);
    expect(mayNotify("all", true, mail({ vip: true }))).toBe(true);
  });

  it("never buzzes for what a rule files away, and always for a watched conversation", () => {
    expect(mayNotify("all", false, mail({ ruled: true }))).toBe(false);
    expect(mayNotify("none", true, mail({ watched: true, kind: "newsletter" }))).toBe(true);
  });
});
