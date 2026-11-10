import { describe, expect, it } from "vitest";
import { parseColor, pinColorScheme, unreadable } from "./mail-contrast";

const DARK = "#15181e";
const LIGHT = "#ffffff";

describe("parseColor", () => {
  it("reads the theme's hex and the browser's computed colours", () => {
    expect(parseColor("#15181e")).toEqual({ r: 21, g: 24, b: 30, a: 1 });
    expect(parseColor("rgb(34, 34, 34)")).toEqual({ r: 34, g: 34, b: 34, a: 1 });
    expect(parseColor("rgba(0, 0, 0, 0)")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseColor("rgb(1 2 3 / 50%)")).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
  });

  it("gives up on anything else", () => {
    expect(parseColor("oklch(0.6 0.2 25)")).toBeNull();
    expect(parseColor("windowtext")).toBeNull();
  });
});

describe("unreadable", () => {
  it("catches black and near-black text in dark mode", () => {
    expect(unreadable("rgb(0, 0, 0)", DARK)).toBe(true);
    expect(unreadable("rgb(34, 34, 34)", DARK)).toBe(true);
    expect(unreadable("rgb(0, 0, 139)", DARK)).toBe(true);
  });

  it("catches white text in light mode", () => {
    expect(unreadable("rgb(255, 255, 255)", LIGHT)).toBe(true);
  });

  it("leaves readable colours as the sender wrote them", () => {
    expect(unreadable("rgb(236, 239, 244)", DARK)).toBe(false);
    expect(unreadable("rgb(255, 80, 80)", DARK)).toBe(false);
    expect(unreadable("rgb(0, 0, 0)", LIGHT)).toBe(false);
    expect(unreadable("rgb(200, 0, 0)", LIGHT)).toBe(false);
  });

  it("leaves text hidden on purpose and colours it can't parse", () => {
    expect(unreadable("rgba(0, 0, 0, 0)", DARK)).toBe(false);
    expect(unreadable("oklch(0.2 0.1 25)", DARK)).toBe(false);
  });
});

describe("pinColorScheme", () => {
  // Revolut's new-device mail, cut down.
  const revolut =
    '<style>a{color:#6FA0FF}@media (prefers-color-scheme: dark){.text p{color:#FFFFFF !important}}</style>' +
    '<style media="(prefers-color-scheme:dark)">h1{color:#fff}</style>' +
    '<style>@media (prefers-color-scheme: light){h1{color:#191C1F}}</style>' +
    "<p>On a dark screen (prefers-color-scheme: dark) …</p>";

  it("turns the sender's dark mode off on a light sheet", () => {
    const out = pinColorScheme(revolut, "light");
    expect(out).toContain("@media (not (min-width:0)){.text p");
    expect(out).toContain('<style media="(not (min-width:0))">');
    expect(out).toContain("@media (min-width:0){h1{color:#191C1F}}");
  });

  it("turns it on when plain mail sits on the dark app", () => {
    const out = pinColorScheme(revolut, "dark");
    expect(out).toContain("@media (min-width:0){.text p");
    expect(out).toContain("@media (not (min-width:0)){h1{color:#191C1F}}");
  });

  it("leaves the text of the mail alone", () => {
    expect(pinColorScheme(revolut, "light")).toContain("<p>On a dark screen (prefers-color-scheme: dark) …</p>");
  });
});
