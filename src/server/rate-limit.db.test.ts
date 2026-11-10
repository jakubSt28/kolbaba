import { like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "./db";
import { HttpError } from "./http-error";
import { hit, limit } from "./rate-limit";

const key = (name: string) => `test:${name}:${Math.random().toString(36).slice(2)}`;

afterAll(async () => {
  await db().delete(schema.rateLimits).where(like(schema.rateLimits.key, "test:%"));
});

describe("rate limits", () => {
  it("count attempts inside a window and start over after it", async () => {
    const k = key("window");
    expect((await hit(k, 60_000)).count).toBe(1);
    expect((await hit(k, 60_000)).count).toBe(2);
    expect((await hit(k, 60_000, 3)).count).toBe(5);
    // A window that already ended restarts the count.
    expect((await hit(k, 0)).count).toBe(1);
  });

  it("refuse the attempt past the limit with 429 and the minutes to wait", async () => {
    const l = { key: key("limit"), max: 2, windowMs: 10 * 60_000 };
    await limit(l);
    await limit(l);
    const err = await limit(l).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(429);
    expect((err as HttpError).vars?.minutes).toBe(10);
  });

  it("count many attempts at once (recipients of one email)", async () => {
    const l = { key: key("cost"), max: 100, windowMs: 60_000 };
    await limit({ ...l, cost: 99 });
    await expect(limit({ ...l, cost: 2 })).rejects.toThrow(/Too many attempts/);
  });
});
