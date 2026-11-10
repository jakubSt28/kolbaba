import { describe, expect, it } from "vitest";
import { areaAboveKeyboard, settling } from "./keyboard";

// iPhone 16 in the Home Screen app: 852pt tall, the keyboard with its suggestions bar ~ 360pt.
const phone = { fullHeight: 852, height: 852, offsetTop: 0, scale: 1, typing: false };

describe("areaAboveKeyboard", () => {
  it("is nothing without a keyboard", () => {
    expect(areaAboveKeyboard(phone)).toBeNull();
    expect(areaAboveKeyboard({ ...phone, typing: true })).toBeNull();
  });

  it("is the area above the keyboard, where iOS slid the screen to", () => {
    expect(areaAboveKeyboard({ ...phone, height: 490, offsetTop: 0, typing: true })).toEqual({ top: 0, height: 490 });
    // The new email focused mid-slide: iOS pushed the screen up by the whole keyboard.
    expect(areaAboveKeyboard({ ...phone, height: 490.4, offsetTop: 361.6, typing: true })).toEqual({ top: 362, height: 490 });
  });

  it("stays up while the focus moves from one field to the next", () => {
    expect(areaAboveKeyboard({ ...phone, height: 490, wasUp: true })).toEqual({ top: 0, height: 490 });
    // The keyboard went down after all.
    expect(areaAboveKeyboard({ ...phone, wasUp: true })).toBeNull();
  });

  it("waits for the keyboard to settle right after the focus moved to another field", () => {
    const was = { top: 0, height: 490 };
    // iOS reloading the keyboard for the text: it drops away, or changes height, for a moment.
    expect(settling({ was, next: null, sinceFocus: 40, typing: true })).toBe(true);
    expect(settling({ was, next: { top: 0, height: 534 }, sinceFocus: 40, typing: true })).toBe(true);
    // Settled, or nothing changed: follow it.
    expect(settling({ was, next: null, sinceFocus: 400, typing: true })).toBe(false);
    expect(settling({ was, next: { top: 30, height: 490 }, sinceFocus: 40, typing: true })).toBe(false);
    // The keyboard coming up, or going away because nothing is typed into any more: right away.
    expect(settling({ was: null, next: was, sinceFocus: 40, typing: true })).toBe(false);
    expect(settling({ was, next: null, sinceFocus: 40, typing: false })).toBe(false);
  });

  it("is nothing when the smaller area isn't a keyboard", () => {
    // Nothing being typed into: the focus left, the keyboard is on its way down.
    expect(areaAboveKeyboard({ ...phone, height: 490 })).toBeNull();
    // Safari's toolbar showing and hiding.
    expect(areaAboveKeyboard({ ...phone, height: 790, typing: true })).toBeNull();
    // Zoomed in with two fingers.
    expect(areaAboveKeyboard({ ...phone, height: 426, scale: 2, typing: true })).toBeNull();
  });
});
