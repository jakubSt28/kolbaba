import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = { get: vi.fn(), post: vi.fn(async () => ({ ok: true })), del: vi.fn(async () => ({ ok: true })) };
vi.mock("./live", () => ({ api }));
vi.mock("./install", () => ({ isIos: () => false, isStandalone: () => true }));

const subscription = (endpoint: string) => ({
  endpoint,
  toJSON: () => ({ endpoint, keys: { p256dh: "k", auth: "a" } }),
  unsubscribe: vi.fn(async () => true),
});
type Sub = ReturnType<typeof subscription>;

let current: Sub | null;
const subscribe = vi.fn(async () => (current = subscription("https://web.push.apple.com/new")));
const storage = new Map<string, string>();

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "BAAA");
  vi.stubGlobal("window", { PushManager: class {} });
  vi.stubGlobal("Notification", { permission: "granted" });
  vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v) });
  vi.stubGlobal("navigator", {
    serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => current, subscribe } }) },
  });
  current = null;
  storage.clear();
  api.post.mockClear();
  api.del.mockClear();
  subscribe.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const load = async () => {
  vi.resetModules();
  return import("./push-client");
};

describe("notifications on this device", () => {
  it("takes a new subscription without asking when Safari dropped the one this device turned on", async () => {
    storage.set("kolbaba:push", JSON.stringify({ endpoint: "https://web.push.apple.com/old", savedAt: Date.now() }));
    const { pushState, usePush } = await load();

    expect(await pushState()).toBe("on");
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith("/api/push", expect.objectContaining({ endpoint: "https://web.push.apple.com/new", replaces: "https://web.push.apple.com/old" }));
    expect(usePush.getState().state).toBe("on");
  });

  it("leaves a device that turned them off alone, though the permission still stands", async () => {
    const { disablePush, pushState } = await load();
    current = subscription("https://web.push.apple.com/one");
    await disablePush();
    current = null;

    expect(await pushState()).toBe("off");
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("keeps them off when another account signs in while a check is still saving", async () => {
    storage.set("kolbaba:push", JSON.stringify({ endpoint: "https://web.push.apple.com/old", savedAt: Date.now() }));
    const { disablePush, pushState } = await load();
    let saved = () => {};
    api.post.mockImplementationOnce(() => new Promise((resolve) => (saved = () => resolve({ ok: true }))));
    const checking = pushState();
    await vi.waitFor(() => expect(api.post).toHaveBeenCalled());
    const disabling = disablePush();
    saved();
    await Promise.all([checking, disabling]);

    expect(storage.get("kolbaba:push")).toBe("off");
    expect(current?.unsubscribe).toHaveBeenCalled();
    expect(api.del).toHaveBeenCalledWith("/api/push", { endpoint: "https://web.push.apple.com/new" });
  });

  it("asks again (one tap) when nothing says this device turned them on", async () => {
    const { pushState } = await load();
    expect(await pushState()).toBe("off");
    expect(subscribe).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("tells the server about a subscription once a day, so one it dropped comes back", async () => {
    vi.useFakeTimers();
    current = subscription("https://web.push.apple.com/one");
    const { pushState } = await load();

    expect(await pushState()).toBe("on");
    expect(await pushState()).toBe("on");
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith("/api/push", expect.not.objectContaining({ replaces: expect.anything() }));

    vi.advanceTimersByTime(25 * 60 * 60 * 1000);
    await pushState();
    expect(api.post).toHaveBeenCalledTimes(2);
  });
});
