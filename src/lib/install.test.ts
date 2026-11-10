import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { APPLE_WEB_APP, guideFor, INSTALL_VERSION, MIN_INSTALL_VERSION } from "./install";

/**
 * What iOS froze for icons added with each install version. If this test fails, you changed something
 * that existing icons will never see: raise INSTALL_VERSION and add what it freezes below. If the old
 * icons now misbehave, raise MIN_INSTALL_VERSION as well, so the app asks those people to re-add theirs.
 */
const FROZEN: Record<number, unknown> = {
  1: {
    manifest: {
      id: "/",
      name: "Kolbaba",
      short_name: "Kolbaba",
      description: "All the good stuff. None of the fluff.",
      start_url: "/?install=1",
      display: "standalone",
      background_color: "#e9edf3",
      theme_color: "#e9edf3",
      icons: [
        { src: "/pwa-icon/192", sizes: "192x192", type: "image/png" },
        { src: "/pwa-icon/512", sizes: "512x512", type: "image/png" },
        { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    appleWebApp: { capable: true, statusBarStyle: "default" },
  },
};

describe("Home Screen install", () => {
  it("changes what iOS freezes only together with INSTALL_VERSION", () => {
    expect({ manifest: manifest(), appleWebApp: APPLE_WEB_APP }).toEqual(FROZEN[INSTALL_VERSION]);
  });

  it("never asks to re-add an icon that's already current", () => {
    expect(MIN_INSTALL_VERSION).toBeLessThanOrEqual(INSTALL_VERSION);
  });
});

const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const brands = (...names: string[]) => [...names, "Chromium", "Not=A?Brand"];

describe("the install steps for a browser", () => {
  it("opens the menu of a Chromium browser that installs apps", () => {
    expect(guideFor(MAC_CHROME, brands("Google Chrome"))).toBe("chromium");
    expect(guideFor(`${MAC_CHROME} Edg/141.0.0.0`, brands("Microsoft Edge"))).toBe("chromium");
    expect(guideFor(MAC_CHROME, brands("Brave"))).toBe("chromium");
    // No brands to go by (an older Chromium): its menu is the best bet.
    expect(guideFor(MAC_CHROME, null)).toBe("chromium");
  });

  it("sends Dia, Arc and Firefox to a browser that can", () => {
    expect(guideFor(MAC_CHROME, brands())).toBe("elsewhere");
    expect(guideFor("Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0", null)).toBe("elsewhere");
  });

  it("adds Safari on the Mac to the Dock", () => {
    expect(guideFor("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15", null)).toBe("safari");
  });

  it("goes to the Home Screen on phones and tablets, in any browser", () => {
    expect(guideFor("Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1", null)).toBe("ios");
    // iPadOS Safari says it's a Mac; touch gives it away.
    expect(guideFor("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15", null, true)).toBe("ios");
    expect(guideFor("Mozilla/5.0 (Android 15; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0", null)).toBe("android");
    expect(guideFor("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36", brands("Google Chrome"))).toBe("android");
    // Touch alone isn't an iPad: only a touch device that calls itself a Mac.
    expect(guideFor("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36", null, true)).toBe("android");
  });
});
