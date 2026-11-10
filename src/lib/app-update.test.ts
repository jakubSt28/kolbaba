import { describe, expect, it } from "vitest";
import { inProgress, QUIET_AFTER_MS, updateStep, whereYouAre } from "./app-update";
import { composing } from "./store";
import type { Draft, Tab } from "./types";

const NOW = 1_800_000_000_000;
const MIN = 60_000;

const draft = (over: Partial<Draft> = {}): Draft => ({ id: "d1", accountId: "acc", to: "", cc: "", subject: "", html: "", updatedAt: NOW - 10 * MIN, ...over });
const threadTab: Tab = { id: "tab1", kind: "thread", threadId: "t1", preview: false };

const idle = {
  drafts: {} as Record<string, Draft>,
  tabs: [] as Tab[],
  activeTabId: null as string | null,
  query: "",
  checked: [] as string[],
  toasts: [] as { id: string; message: string; duration: number; undo?: () => void; countdown?: boolean }[],
  settingsOpen: false,
  newsOpen: false as const,
  collectionOpen: false as const,
  paletteOpen: false,
  feedback: null,
  drawerOpen: false,
  sidebarEditing: false,
  imagesExplainerOpen: false,
};
const page = { dialog: false, typing: false };

describe("updateStep", () => {
  const step = (o: Partial<Parameters<typeof updateStep>[0]>) => updateStep({ running: "a", deployed: "b", awayMs: null, busy: false, ...o });

  it("does nothing while this is the deployed build, or nobody answered", () => {
    expect(step({ deployed: "a", awayMs: 10 * MIN })).toBe("none");
    expect(step({ deployed: null, awayMs: 10 * MIN })).toBe("none");
  });

  it("loads the new build quietly when the app comes back after a while with nothing in progress", () => {
    expect(step({ awayMs: QUIET_AFTER_MS })).toBe("reload");
    expect(step({ awayMs: 8 * 60 * MIN })).toBe("reload");
  });

  it("only offers it otherwise: on screen, back from a quick glance away, or in the middle of something", () => {
    expect(step({ awayMs: null })).toBe("offer");
    expect(step({ awayMs: 5_000 })).toBe("offer");
    expect(step({ awayMs: 10 * MIN, busy: true })).toBe("offer");
  });
});

describe("inProgress", () => {
  it("is nothing on a quiet inbox, an old closed draft or a toast without Undo", () => {
    expect(inProgress(idle, page, NOW)).toBe(false);
    expect(inProgress({ ...idle, drafts: { d1: draft() } }, page, NOW)).toBe(false);
    expect(inProgress({ ...idle, toasts: [{ id: "x", message: "Kolbaba was updated", duration: 0 }] }, page, NOW)).toBe(false);
  });

  it("is words being written: a draft open, a reply under the open conversation, or one just changed", () => {
    expect(inProgress({ ...idle, drafts: { d1: draft() }, tabs: [{ id: "tab2", kind: "draft", draftId: "d1", preview: false }] }, page, NOW)).toBe(true);
    expect(inProgress({ ...idle, drafts: { d1: draft({ threadId: "t1" }) }, tabs: [threadTab] }, page, NOW)).toBe(true);
    expect(inProgress({ ...idle, drafts: { d1: draft({ updatedAt: NOW - MIN }) } }, page, NOW)).toBe(true);
  });

  it("is a window, a search, a selection, an Undo on offer or the cursor in a field", () => {
    expect(inProgress({ ...idle, settingsOpen: true }, page, NOW)).toBe(true);
    expect(inProgress({ ...idle, query: "invoice" }, page, NOW)).toBe(true);
    expect(inProgress({ ...idle, checked: ["t1"] }, page, NOW)).toBe(true);
    expect(inProgress({ ...idle, toasts: [{ id: "x", message: "Sent", duration: 6000, undo: () => {}, countdown: true }] }, page, NOW)).toBe(true);
    expect(inProgress({ ...idle, tabs: [{ id: "tab3", kind: "add-account", preview: false }] }, page, NOW)).toBe(true);
    expect(inProgress(idle, { dialog: true, typing: false }, NOW)).toBe(true);
    expect(inProgress(idle, { dialog: false, typing: true }, NOW)).toBe(true);
  });
});

describe("whereYouAre", () => {
  it("is plain / in the unified Inbox with nothing open", () => {
    expect(whereYouAre({ scope: "all", openMailbox: "all", folder: "inbox", tabs: [], activeTabId: null })).toBe("/");
  });

  it("keeps the mailbox, the folder and the open conversation", () => {
    const url = whereYouAre({ scope: "acc_personal", openMailbox: "all", folder: "folder:f1", tabs: [threadTab], activeTabId: "tab1" });
    expect(Object.fromEntries(new URL(url, "https://kolbaba.app").searchParams)).toEqual({ mailbox: "acc_personal", folder: "folder:f1", thread: "t1" });
  });

  it("names the mailbox only when it isn't the one the app opens in anyway", () => {
    expect(whereYouAre({ scope: "acc_personal", openMailbox: "acc_personal", folder: "inbox", tabs: [], activeTabId: null })).toBe("/");
    expect(whereYouAre({ scope: "all", openMailbox: "acc_personal", folder: "inbox", tabs: [], activeTabId: null })).toBe("/?mailbox=all");
  });
});

describe("composing", () => {
  it("is a draft's tab, or the open conversation with a reply in it", () => {
    expect(composing({ ...idle, tabs: [{ id: "tab2", kind: "draft", draftId: "d1", preview: false }], activeTabId: "tab2" })).toBe(true);
    expect(composing({ ...idle, drafts: { d1: draft({ threadId: "t1" }) }, tabs: [threadTab], activeTabId: "tab1" })).toBe(true);
    expect(composing({ ...idle, tabs: [threadTab], activeTabId: "tab1" })).toBe(false);
    expect(composing(idle)).toBe(false);
  });
});
