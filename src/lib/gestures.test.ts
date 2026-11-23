import { describe, expect, it } from "vitest";
import { isSwipe, swipeGoes } from "./gestures";

describe("isSwipe", () => {
  it("takes a move mostly along the way", () => {
    expect(isSwipe({ dx: 30, dy: 5, way: "right" })).toBe(true);
    expect(isSwipe({ dx: -30, dy: 5, way: "left" })).toBe(true);
    expect(isSwipe({ dx: 4, dy: 30, way: "down" })).toBe(true);
  });

  it("leaves the other way and scrolling alone", () => {
    expect(isSwipe({ dx: -30, dy: 0, way: "right" })).toBe(false);
    expect(isSwipe({ dx: 0, dy: -30, way: "down" })).toBe(false);
    // Diagonal: a scroll as much as a swipe, so it stays a scroll.
    expect(isSwipe({ dx: 20, dy: 20, way: "right" })).toBe(false);
    expect(isSwipe({ dx: 5, dy: 30, way: "right" })).toBe(false);
  });
});

describe("swipeGoes", () => {
  it("goes when pulled far enough", () => {
    expect(swipeGoes({ offset: 130, velocity: 0, size: 390 })).toBe(true);
    expect(swipeGoes({ offset: 60, velocity: 0, size: 390 })).toBe(false);
  });

  it("never needs more than 140px on a big screen", () => {
    expect(swipeGoes({ offset: 141, velocity: 0, size: 1000 })).toBe(true);
  });

  it("goes on a flick, but not on a twitch", () => {
    expect(swipeGoes({ offset: 40, velocity: 0.8, size: 390 })).toBe(true);
    expect(swipeGoes({ offset: 10, velocity: 2, size: 390 })).toBe(false);
  });
});
