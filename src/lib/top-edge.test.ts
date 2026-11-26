import { describe, expect, it } from "vitest";
import { composite, parseColour } from "./top-edge";

describe("parseColour", () => {
  it("reads the forms browsers compute", () => {
    expect(parseColour("rgb(233, 237, 243)")).toEqual([233, 237, 243, 1]);
    expect(parseColour("rgba(0, 0, 0, 0.25)")).toEqual([0, 0, 0, 0.25]);
    expect(parseColour("rgb(0 0 0 / 0.2)")).toEqual([0, 0, 0, 0.2]);
    expect(parseColour("color(srgb 1 1 1 / 0.5)")).toEqual([255, 255, 255, 0.5]);
    expect(parseColour("transparent")).toBeNull();
  });
  it("turns oklab black and white into sRGB", () => {
    const black = parseColour("oklab(0 0 0 / 0.2)")!;
    expect(black.map((v) => Math.round(v))).toEqual([0, 0, 0, 0]);
    expect(black[3]).toBeCloseTo(0.2);
    expect(parseColour("oklch(1 0 0)")!.map((v) => Math.round(v))).toEqual([255, 255, 255, 1]);
  });
});

describe("composite", () => {
  it("mixes a backdrop over the strip at its opacity", () => {
    expect(composite([255, 255, 255, 1], [])).toBe("rgb(255, 255, 255)");
    expect(composite([255, 255, 255, 1], [[0, 0, 0, 0.25]])).toBe("rgb(191, 191, 191)");
    expect(composite([233, 237, 243, 1], [[11, 11, 12, 1]])).toBe("rgb(11, 11, 12)");
  });
});
