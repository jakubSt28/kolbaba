import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("feature usage in the app", () => {
  it("counts in batches and sends them a minute later, or right away when the app goes to the background", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "live");
    const on: Record<string, () => void> = {};
    const doc = { visibilityState: "visible", addEventListener: (type: string, fn: () => void) => void (on[type] = fn) };
    vi.stubGlobal("document", doc);
    vi.stubGlobal("window", { addEventListener: (type: string, fn: () => void) => void (on[type] = fn) });
    const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    vi.useFakeTimers();
    vi.resetModules();
    const { track } = await import("./usage");

    track("inbox");
    track("inbox");
    track("files");
    expect(fetch).not.toHaveBeenCalled();

    doc.visibilityState = "hidden";
    on.visibilitychange();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("/api/usage");
    expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toEqual({ counts: { inbox: 2, files: 1 } });

    // Nothing new, nothing sent.
    on.pagehide();
    expect(fetch).toHaveBeenCalledTimes(1);

    track("search");
    vi.advanceTimersByTime(60_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1][1].body as string)).toEqual({ counts: { search: 1 } });
  });

  it("does nothing in the prototype", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "mock");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", { addEventListener: vi.fn() });
    vi.useFakeTimers();
    vi.resetModules();
    const { track } = await import("./usage");
    track("inbox");
    vi.advanceTimersByTime(120_000);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("counts the user's own folders as one feature", async () => {
    const { folderFeature } = await import("./usage");
    expect(folderFeature("folder:fld_123")).toBe("folder");
    expect(folderFeature("contacts")).toBe("contacts");
  });
});
