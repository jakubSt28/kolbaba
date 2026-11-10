import { describe, expect, it } from "vitest";
import { buildScene, dayKey, isPadla, phaseOf, pickLine, PLACES, POSTCARD_TOTAL, postcardDate, postcardKey, seasonOf } from "./postcard";

const at = (iso: string) => new Date(iso);

describe("Kolbaba's postcard", () => {
  it("draws the same card all day, and a different one the next", () => {
    const morning = buildScene(at("2026-10-13T09:00:00"));
    const noon = buildScene(at("2026-10-13T12:30:00"));
    const tomorrow = buildScene(at("2026-10-14T12:30:00"));
    expect(noon.far.d).toBe(morning.far.d);
    expect(noon.place).toEqual(morning.place);
    expect(tomorrow.far.d).not.toBe(noon.far.d);
  });

  it("follows the season and the hour", () => {
    expect(seasonOf(at("2026-01-10T12:00:00"))).toBe("winter");
    expect(seasonOf(at("2026-04-10T12:00:00"))).toBe("spring");
    expect(seasonOf(at("2026-07-10T12:00:00"))).toBe("summer");
    expect(seasonOf(at("2026-10-10T12:00:00"))).toBe("autumn");
    expect(phaseOf(at("2026-10-13T02:00:00"))).toBe("night");
    expect(phaseOf(at("2026-10-13T07:30:00"))).toBe("dawn");
    expect(phaseOf(at("2026-10-13T13:00:00"))).toBe("day");
    expect(phaseOf(at("2026-10-13T17:30:00"))).toBe("dusk");
    // Summer evenings stay light longer than autumn ones.
    expect(phaseOf(at("2026-07-13T19:00:00"))).toBe("day");
  });

  it("lights the windows in the evening, snows in winter, shows the moon at night", () => {
    const night = buildScene(at("2026-12-21T23:00:00"));
    expect(night.windowsLit).toBe(true);
    expect(night.moon).toBeDefined();
    expect(night.sun).toBeUndefined();
    expect(night.stars.length).toBeGreaterThan(0);
    expect(night.snow.length).toBeGreaterThan(0);
    const summer = buildScene(at("2026-07-15T14:00:00"));
    expect(summer.windowsLit).toBe(false);
    expect(summer.sun).toBeDefined();
    expect(summer.snow).toEqual([]);
    expect(summer.trees.every((t) => t.y > 0 && t.y <= 200)).toBe(true);
  });

  it("says Padla on workday afternoons only", () => {
    expect(isPadla(at("2026-10-13T16:00:00"))).toBe(true);
    expect(isPadla(at("2026-10-13T11:00:00"))).toBe(false);
    expect(isPadla(at("2026-10-17T16:00:00"))).toBe(false);
  });

  it("picks a place and a line by the day", () => {
    expect(PLACES).toContainEqual(buildScene(at("2026-10-13T12:00:00")).place);
    const lines = ["a", "b", "c"];
    expect(pickLine(dayKey(at("2026-10-13T08:00:00")), lines)).toBe(pickLine("2026-10-13", lines));
  });

  it("collects each village once per season, and draws a collected card the same way again", () => {
    expect(POSTCARD_TOTAL).toBe(64);
    const at = at_("2026-12-21T16:10:00");
    const card = postcardKey(at);
    expect(card.key).toBe(`${buildScene(at).place.name}|winter`);
    expect(card.at).toBe("2026-12-21T16");
    const again = buildScene(postcardDate(card.at));
    expect(again.far.d).toBe(buildScene(at).far.d);
    expect(again.phase).toBe(buildScene(at).phase);
  });
});

const at_ = (iso: string) => new Date(iso);
