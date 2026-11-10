import { afterEach, describe, expect, it, vi } from "vitest";
import { checkForUpdate, newerVersion } from "./selfhost-update";

describe("newerVersion", () => {
  it("finds the highest plain version above the current one", () => {
    expect(newerVersion("1.2.0", ["1", "1.2", "latest", "1.2.0", "1.10.0", "1.3.5"])).toBe("1.10.0");
    expect(newerVersion("1.10.0", ["1.3.5", "1.10.0"])).toBeNull();
  });

  it("stays quiet on a build without a version", () => {
    expect(newerVersion("dev", ["1.0.0"])).toBeNull();
  });
});

describe("checkForUpdate", () => {
  afterEach(() => {
    delete process.env.SELF_HOSTED;
    delete process.env.UPDATE_CHECK;
  });

  it("asks nobody when it's turned off, or on kolbaba.app", async () => {
    const fetchFn = vi.fn();
    expect(await checkForUpdate("1.0.0", fetchFn)).toBeNull();
    process.env.SELF_HOSTED = "1";
    process.env.UPDATE_CHECK = "off";
    expect(await checkForUpdate("1.0.0", fetchFn)).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("reads the tags from the public registry", async () => {
    process.env.SELF_HOSTED = "1";
    const fetchFn = vi.fn(async (url: string) =>
      Response.json(url.includes("/token") ? { token: "anon" } : { tags: ["1", "1.0.0", "1.1.0"] }),
    ) as unknown as typeof fetch;
    expect(await checkForUpdate("1.0.0", fetchFn)).toBe("1.1.0");
    // Asked once, then remembered for hours.
    expect(await checkForUpdate("1.0.0", fetchFn)).toBe("1.1.0");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
