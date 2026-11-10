import { describe, expect, it } from "vitest";
import { mergeThread, sameData } from "./live";
import type { Thread } from "./types";

const thread = (over: Partial<Thread> = {}): Thread => ({
  id: "t1",
  accountId: "a1",
  subject: "Hello",
  unread: true,
  pinned: false,
  folder: "inbox",
  messages: [{ id: "m1", from: { name: "Ann", email: "ann@example.com" }, to: [], date: 1, html: "", snippet: "Hi" }],
  ...over,
});

describe("mergeThread", () => {
  it("keeps the same object when the server says nothing new", () => {
    const prev = thread();
    expect(mergeThread(prev, thread())).toBe(prev);
  });

  it("keeps the same object for a body loaded here that the list doesn't carry", () => {
    const prev = thread({ messages: [{ ...thread().messages[0], html: "<p>Hi</p>", bodyLoaded: true, blockedImages: 0, trackers: [] }] });
    expect(mergeThread(prev, thread())).toBe(prev);
  });

  it("takes the server's copy when something changed", () => {
    const prev = thread();
    const next = mergeThread(prev, thread({ unread: false }));
    expect(next).not.toBe(prev);
    expect(next.unread).toBe(false);
  });
});

describe("sameData", () => {
  it("treats a missing key and an undefined one alike", () => {
    expect(sameData({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(sameData({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    expect(sameData({ a: 1 }, { a: 1, b: null })).toBe(false);
  });

  it("compares arrays by their items", () => {
    expect(sameData([1, { x: 2 }], [1, { x: 2 }])).toBe(true);
    expect(sameData([1, 2], [1, 2, 3])).toBe(false);
    expect(sameData([], {})).toBe(false);
  });
});
