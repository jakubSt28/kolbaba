"use client";

import { BUILD_ID } from "./build";
import { t } from "./i18n";
import { flushDrafts } from "./live";
import { draftInUse, useMail } from "./store";

/*
 * A new version for an app that stays open. The installed app (the Home Screen app on iPhone, its own
 * window on the computer) can run for days, and a page only runs new code when it loads again. Mail
 * refreshes by itself; this does the same for the app: when it comes back to the foreground, and every
 * few minutes while it's on screen, it asks which build is deployed. When that isn't the one running here:
 * - back after a while with nothing in progress, it loads again right away, where you were, so it's
 *   simply new;
 * - otherwise a small toast offers Reload (out of sight while you write), and the next such return
 *   loads it anyway.
 * Unsent words are saved before the page goes. Not to be confused with adding the icon again
 * (src/lib/install.ts): that's only for what iOS froze when the icon was added.
 */

/** Away at least this long, coming back is a fresh start: the reload goes unnoticed. A quick glance away isn't. */
export const QUIET_AFTER_MS = 30_000;

/** On screen, ask this often. Deploys are rare, and coming back asks anyway. */
const CHECK_EVERY_MS = 5 * 60_000;

type State = ReturnType<typeof useMail.getState>;
type Busy = Pick<
  State,
  | "drafts"
  | "tabs"
  | "query"
  | "checked"
  | "toasts"
  | "settingsOpen"
  | "newsOpen"
  | "collectionOpen"
  | "paletteOpen"
  | "feedback"
  | "drawerOpen"
  | "sidebarEditing"
  | "imagesExplainerOpen"
>;

/**
 * Something a reload would lose: words being written, a mailbox being added, a window or sheet that's
 * open, a search, a selection, an Undo still on offer, or a field with the cursor in it.
 */
export function inProgress(s: Busy, page: { dialog: boolean; typing: boolean }, now = Date.now()) {
  return (
    page.dialog ||
    page.typing ||
    Object.values(s.drafts).some((d) => draftInUse(s, d, now)) ||
    s.tabs.some((tab) => tab.kind === "draft" || tab.kind === "add-account") ||
    !!s.query ||
    s.checked.length > 0 ||
    s.toasts.some((x) => !!x.undo || !!x.countdown) ||
    s.settingsOpen ||
    !!s.newsOpen ||
    !!s.collectionOpen ||
    s.paletteOpen ||
    !!s.feedback ||
    s.drawerOpen ||
    s.sidebarEditing ||
    s.imagesExplainerOpen
  );
}

/**
 * What to do about the deployed build: nothing (it's this one, or there was no answer), load it now
 * (back from the background after a while, nothing in progress), or offer it. `awayMs` is null when
 * the app didn't just come back.
 */
export function updateStep(o: { running: string; deployed: string | null; awayMs: number | null; busy: boolean }) {
  if (!o.deployed || o.deployed === o.running) return "none";
  return o.awayMs !== null && o.awayMs >= QUIET_AFTER_MS && !o.busy ? "reload" : "offer";
}

/** The address of where you are, so loading it again lands there (read like any link into the app, mail-app.tsx). */
export function whereYouAre(s: Pick<State, "scope" | "openMailbox" | "folder" | "tabs" | "activeTabId">) {
  const params = new URLSearchParams();
  if (s.scope !== s.openMailbox) params.set("mailbox", s.scope);
  if (s.folder !== "inbox") params.set("folder", s.folder);
  const tab = s.tabs.find((x) => x.id === s.activeTabId);
  if (tab?.kind === "thread") params.set("thread", tab.threadId);
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

async function deployedBuild() {
  try {
    const res = await fetch("/api/version", { cache: "no-store" });
    if (!res.ok) return null;
    const { build } = (await res.json()) as { build?: unknown };
    return typeof build === "string" && build ? build : null;
  } catch {
    return null;
  }
}

/** A dialog is open, or the cursor is in a field: the page's side of `inProgress`. */
function page() {
  const el = document.activeElement as HTMLElement | null;
  return {
    dialog: !!document.querySelector('[role="dialog"], [role="alertdialog"]'),
    typing: !!el && (el.isContentEditable || el.matches("input, textarea, select")),
  };
}

/** Load the new version at `to`. Unsent words are saved first; if they can't be, the page stays. */
async function reload(to: string) {
  try {
    await flushDrafts();
  } catch {
    return;
  }
  if (to === location.pathname + location.search) location.reload();
  else location.replace(to);
}

/** The deployed build, once it's a different one from this. */
let newer: string | null = null;
let offered: string | null = null;
let checking = false;

/** One small toast, sticky until Reload; the toaster keeps it out of sight while a composer is open. */
function offer() {
  const { toasts, pushToast } = useMail.getState();
  if (offered && toasts.some((x) => x.id === offered)) return;
  offered = pushToast({
    message: t("Kolbaba was updated"),
    icon: "new",
    duration: 0,
    notWhileWriting: true,
    action: { label: t("Reload"), run: () => void reload(whereYouAre(useMail.getState())) },
  });
}

/** Ask on every return to the foreground and every few minutes on screen; returns the cleanup. */
export function watchForUpdates() {
  let hiddenAt = document.visibilityState === "hidden" ? Date.now() : null;
  // A notification tapped while the app was in the background: if it reloads, it reloads there.
  let link: { to: string; at: number } | null = null;

  const check = async (awayMs: number | null) => {
    if (checking) return;
    checking = true;
    try {
      if (!newer) {
        const deployed = await deployedBuild();
        if (deployed && deployed !== BUILD_ID) newer = deployed;
      }
      const s = useMail.getState();
      const step = updateStep({ running: BUILD_ID, deployed: newer, awayMs, busy: newer ? inProgress(s, page()) : false });
      if (step === "reload") await reload(link && Date.now() - link.at < 10_000 ? link.to : whereYouAre(s));
      else if (step === "offer") offer();
    } finally {
      checking = false;
    }
  };

  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      return;
    }
    const awayMs = hiddenAt === null ? null : Date.now() - hiddenAt;
    hiddenAt = null;
    void check(awayMs);
  };
  const onWorkerMessage = (e: MessageEvent) => {
    if (e.data?.type !== "open-url" || typeof e.data.url !== "string") return;
    const url = new URL(e.data.url, location.origin);
    if (url.origin === location.origin) link = { to: url.pathname + url.search, at: Date.now() };
  };

  document.addEventListener("visibilitychange", onVisibility);
  navigator.serviceWorker?.addEventListener("message", onWorkerMessage);
  // Hidden, it doesn't ask: coming back does (above).
  const timer = setInterval(() => document.visibilityState === "visible" && void check(null), CHECK_EVERY_MS);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    navigator.serviceWorker?.removeEventListener("message", onWorkerMessage);
    clearInterval(timer);
  };
}
