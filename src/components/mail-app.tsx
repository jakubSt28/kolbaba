"use client";

import { MotionConfig } from "motion/react";
import { Tooltip } from "radix-ui";
import { useEffect, useSyncExternalStore } from "react";
import { watchForUpdates } from "@/lib/app-update";
import { watchForCodes } from "@/lib/codes";
import { getLocale, resolveLocale, setLocale, t } from "@/lib/i18n";
import { fetchThread, LIVE } from "@/lib/live";
import { pushState, registerServiceWorker, setBadge } from "@/lib/push-client";
import { badgeTotal, isFolderId, useMail } from "@/lib/store";
import { useShortcuts } from "@/lib/use-shortcuts";
import { applyTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { ShortcutsHost } from "./shortcuts-help";
import { CommandPalette } from "./command-palette";
import { ConfirmHost } from "./confirm";
import { closeSnoozeSheet, SnoozeSheetHost } from "./swipe-row";
import { MessageList } from "./message-list";
import { MobileShell } from "./mobile-shell";
import { Reader } from "./reader";
import { watchShortViewport } from "@/lib/standalone-viewport";
import { watchKeyboard } from "@/lib/keyboard";
import { FeedbackHost } from "./feedback";
import { InstallGuideHost } from "./install-guide";
import { SettingsHost } from "./settings";
import { closeFolderDialog, FolderDialogHost } from "./folders";
import { NewsHost } from "./news";
import { CollectionHost } from "./collection";
import { Sidebar } from "./sidebar";
import { Toaster } from "./toaster";
import { WelcomeHost } from "./welcome";
import { ImagesExplainerHost } from "./images-explainer";
import { openCalendarLink, restoreMode, useCalendar } from "@/lib/calendar/store";
import { useTasks } from "@/lib/tasks/store";
import { CalendarHosts, CalendarMain, MobileCalendar } from "./calendar/calendar-app";
import { MobileTasks, TasksDetailsPane, TasksMain } from "./tasks/tasks-app";

/** No click, key, wheel, touch or mouse movement for this long: nobody's looking, so the minute's refresh rests. */
const IDLE_AFTER_MS = 5 * 60_000;
const ACTIVITY = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

function useMedia(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * Links into the app: notifications open `/?thread=…`, `/?activity` (an agent's action), `/?settings` or
 * `/?calendar=2026-11-12&event=…` (a reminder), `/?tasks`,
 * the Gmail connect flow comes back with `?connected=…` or `?connect_error=…`, and a new version loads
 * where you were with `?mailbox=…&folder=…&thread=…` (src/lib/app-update.ts). Handle them once, then
 * clean the address bar.
 */
/** A notification or a link takes you somewhere: whatever window or sheet was open steps aside first. */
function closeOverlays() {
  useMail.setState({ newsOpen: false, collectionOpen: false, settingsOpen: false, paletteOpen: false, feedback: null, drawerOpen: false, sidebarEditing: false });
  closeFolderDialog();
  closeSnoozeSheet();
}

async function handleDeepLink(url: URL) {
  const p = url.searchParams;
  const { openThread, pushToast, setFolder, setScope } = useMail.getState();
  const raw = p.get("thread");
  // Ids only: a link must not steer the app's requests to some other API path.
  const thread = raw && /^[\w-]{1,64}$/.test(raw) ? raw : null;
  if (thread || p.has("folder") || p.has("activity")) closeOverlays();
  // The mailbox and folder first: switching them clears the selection, which would hide the conversation.
  const mailbox = p.get("mailbox");
  if (mailbox && (mailbox === "all" || useMail.getState().accounts.some((a) => a.id === mailbox))) setScope(mailbox);
  const folder = p.get("folder");
  if (folder && isFolderId(folder)) setFolder(folder);
  if (thread) {
    if (LIVE && !useMail.getState().threads[thread]) {
      const full = await fetchThread(thread).catch(() => null);
      if (full) useMail.setState((s) => ({ threads: { ...s.threads, [thread]: full } }));
    }
    openThread(thread);
  }
  // An agent sent or scheduled something: its notification opens AI activity, where it can be undone.
  if (p.has("activity")) useMail.getState().openActivity("agents");
  // "?settings=agents" opens that section (the website's recipes link there).
  if (p.has("settings")) useMail.getState().setSettingsOpen(true, p.get("settings") || undefined);
  // The calendar: a reminder's day and event, or the way back from Google's or Microsoft's permission page.
  if (p.has("tasks")) {
    closeOverlays();
    useCalendar.getState().setMode("tasks");
  }
  if (p.has("calendar")) {
    closeOverlays();
    openCalendarLink(p.get("calendar"), p.get("event"));
    const added = p.get("calendar_connected");
    if (added) pushToast({ message: t("The calendars of {name} are here", { name: added }) });
  }
  const connected = p.get("connected");
  if (connected) {
    const account = useMail.getState().accounts.find((a) => a.id === connected);
    pushToast({ message: `${account?.name ?? "Mailbox"} connected · importing your mail` });
  }
  const error = p.get("connect_error");
  if (error) pushToast({ message: error, duration: 8000 });
  const notice = p.get("connect_notice");
  if (notice) pushToast({ message: notice, duration: 8000 });
  // A Microsoft 365 organisation has to approve Kolbaba once: the link for its IT admin.
  const admin = p.get("connect_admin");
  if (admin?.startsWith("https://login.microsoftonline.com/")) {
    pushToast({
      message: t("Your organisation's IT admin has to allow Kolbaba first."),
      duration: 20_000,
      action: { label: t("Copy link for IT"), run: () => void navigator.clipboard?.writeText(admin).then(() => pushToast({ message: t("Link copied. Send it to your IT admin.") })) },
    });
  }
  if ([...p.keys()].length && url.href === window.location.href) window.history.replaceState(null, "", "/");
}

export function MailApp() {
  const isMobile = useMedia("(max-width: 767px)");
  // A narrow window shows the sidebar as icons, except while it's being rearranged.
  const editingSidebar = useMail((s) => s.sidebarEditing);
  const narrow = useMedia("(max-width: 1180px)") && !editingSidebar;
  const accent = useMail((s) => s.accent);
  // The language is read during render (t()), so a change re-renders the app below in the new one.
  // Not a re-mount: that would replay every opening animation and reset scroll, Settings included.
  const locale = resolveLocale(useMail((s) => s.language));
  if (getLocale() !== locale) setLocale(locale);
  // Mail, calendar or tasks: the others stay as they were, out of sight, for the way back.
  const mode = useCalendar((s) => s.mode);
  const calendar = mode === "calendar";
  const tasks = mode === "tasks";
  const away = mode !== "mail";
  useShortcuts(!isMobile && !away);

  useEffect(() => {
    document.documentElement.dataset.accent = accent;
  }, [accent]);
  const theme = useMail((s) => s.theme);
  useEffect(() => applyTheme(theme), [theme]);

  useEffect(() => {
    const registered = registerServiceWorker();
    if (!LIVE) {
      // The prototype has its mail from the start; links into it land right away.
      restoreMode();
      void handleDeepLink(new URL(window.location.href));
      return;
    }
    const { init, refresh } = useMail.getState();
    const started = init();
    // A reload while the calendar was open comes back to it; a link that opens mail then wins.
    void started.then(() => {
      restoreMode();
      return handleDeepLink(new URL(window.location.href));
    });
    // Notifications Safari dropped come back on opening and on every return (src/lib/push-client.ts), once
    // it's settled whose device this is.
    void Promise.all([registered, started]).then(() => pushState());
    // Keep the open folder fresh: on coming back, when the service worker says mail arrived, and every minute as a safety net
    // while someone's using it. A window left on screen (overnight, say) stops asking; the first touch brings fresh mail at once.
    // Coming back from another tab makes the page visible again; from another app (⌘Tab to a chat that just
    // drafted something) the page stayed visible, and only the window's focus says so. Clicking into an
    // email and out again (its own frame) isn't leaving.
    let away = false;
    let returnedAt = 0;
    let activeAt = Date.now();
    const onReturn = () => {
      if (document.visibilityState !== "visible" || Date.now() - returnedAt < 2000) return;
      returnedAt = activeAt = Date.now();
      void refresh();
      void pushState();
      void useMail.getState().flushOffline();
    };
    // Back at a window that stayed on screen (the computer woke up, the phone was picked up): that's a return too.
    const onActivity = () => {
      const idle = Date.now() - activeAt > IDLE_AFTER_MS;
      activeAt = Date.now();
      if (idle) onReturn();
    };
    // A pointer that didn't move (the page changed under it) isn't someone there.
    const onPointerMove = (e: PointerEvent) => {
      if (e.movementX || e.movementY) onActivity();
    };
    // Scrolling an email (its own frame) reaches us only as the conversation scrolling. Other scrolls can be
    // the page's own, a list keeping its place as new mail lands above, so they don't count.
    const onScroll = (e: Event) => {
      if (Date.now() - activeAt > 10_000 && e.target instanceof Element && e.target.querySelector("iframe")) onActivity();
    };
    const listen = { capture: true, passive: true };
    const onBlur = () => setTimeout(() => (away = !document.hasFocus()));
    const onFocus = () => {
      if (!away) return;
      away = false;
      onReturn();
    };
    const onWorkerMessage = (e: MessageEvent) => {
      if (e.data?.type === "mail-changed") void refresh();
      if (e.data?.type === "open-url") void refresh().then(() => handleDeepLink(new URL(e.data.url)));
    };
    const unsubscribeBadge = useMail.subscribe((s, prev) => {
      if (s.threads !== prev.threads || s.badgeMode !== prev.badgeMode) setBadge(badgeTotal(s.threads, s.badgeMode));
    });
    // Emails written without a signal go the moment there's one (iPhone web apps can't do it in the background).
    const onOnline = () => void useMail.getState().flushOffline();
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    navigator.serviceWorker?.addEventListener("message", onWorkerMessage);
    for (const type of ACTIVITY) window.addEventListener(type, onActivity, listen);
    window.addEventListener("pointermove", onPointerMove, listen);
    document.addEventListener("scroll", onScroll, listen);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - activeAt < IDLE_AFTER_MS) void refresh();
    }, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      navigator.serviceWorker?.removeEventListener("message", onWorkerMessage);
      window.removeEventListener("online", onOnline);
      for (const type of ACTIVITY) window.removeEventListener(type, onActivity, listen);
      window.removeEventListener("pointermove", onPointerMove, listen);
      document.removeEventListener("scroll", onScroll, listen);
      clearInterval(timer);
      unsubscribeBadge();
    };
  }, []);

  // A mailbox fills up during its first import: show mail as it lands instead of after a reload (on screen only;
  // coming back refreshes anyway).
  const importing = useMail((s) => LIVE && s.accounts.some((a) => a.status === "syncing"));
  useEffect(() => {
    if (!importing) return;
    const timer = setInterval(() => {
      const { refresh, refreshAccounts } = useMail.getState();
      if (document.visibilityState === "visible") void Promise.all([refresh(), refreshAccounts()]).catch(() => {});
    }, 15_000);
    return () => {
      clearInterval(timer);
      void useMail.getState().refresh().catch(() => {});
    };
  }, [importing]);

  // A verification code that just arrived pops up with Copy.
  useEffect(() => watchForCodes(), []);
  // A new version while the app stays open: loaded when it comes back, or offered with Reload.
  useEffect(() => watchForUpdates(), []);
  // Home Screen app on iOS 26: no second bottom inset when WebKit cuts the page short.
  useEffect(() => watchShortViewport(), []);
  // Phone: while the on-screen keyboard is up, the shell is the area above it (src/lib/keyboard.ts).
  useEffect(() => watchKeyboard(), []);

  useEffect(() => {
    // Handy for poking at the prototype from devtools.
    if (process.env.NODE_ENV !== "production") Object.assign(window, { __mail: useMail, __calendar: useCalendar, __tasks: useTasks });
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <Tooltip.Provider delayDuration={500} skipDelayDuration={200}>
        <>
          {isMobile ? (
            <>
              {/* The mail stays mounted under the calendar and the tasks: its place in the list is there on the way back. */}
              <div className={away ? "hidden" : "contents"}>
                <MobileShell />
              </div>
              {calendar && <MobileCalendar />}
              {tasks && <MobileTasks />}
              <Toaster className="fixed bottom-[calc(84px+var(--safe-bottom))]" />
            </>
          ) : (
            <>
              <div className="canvas app-height desktop-shell flex gap-2 p-2">
                <aside className={narrow ? "w-[60px] shrink-0" : "w-[232px] shrink-0"}>
                  <div className="glass h-full rounded-[18px]">
                    <Sidebar collapsed={narrow} />
                  </div>
                </aside>
                {/* The mail's two panes stay mounted (hidden) while the calendar or the tasks are open: the open email and the list keep their place. */}
                <section className={cn("panel w-[360px] shrink-0 overflow-hidden rounded-[18px] lg:w-[390px]", away && "hidden")}>
                  <MessageList />
                </section>
                <main className={cn("panel relative min-w-0 flex-1 overflow-hidden rounded-[18px]", away && "hidden")}>
                  <Reader />
                  {/* Centred in the reader so toasts sit right above the floating action bar. */}
                  {!away && <Toaster className="absolute bottom-[84px]" />}
                </main>
                {calendar && (
                  <main className="panel relative min-w-0 flex-1 overflow-hidden rounded-[18px]">
                    <CalendarMain />
                    <Toaster className="absolute bottom-6" />
                  </main>
                )}
                {/* Tasks: the list wide, the open task beside it. */}
                {tasks && (
                  <>
                    <section className="panel relative min-w-0 flex-1 overflow-hidden rounded-[18px]">
                      <TasksMain />
                      <Toaster className="absolute bottom-6" />
                    </section>
                    <main className="panel relative w-[380px] shrink-0 overflow-hidden rounded-[18px] xl:w-[460px]">
                      <TasksDetailsPane />
                    </main>
                  </>
                )}
              </div>
              <CommandPalette />
            </>
          )}
          <CalendarHosts mobile={isMobile} />
          <ConfirmHost />
          <CollectionHost />
          <SnoozeSheetHost />
          <InstallGuideHost mobile={isMobile} />
          <SettingsHost mobile={isMobile} />
          <FolderDialogHost />
          <NewsHost mobile={isMobile} />
          <FeedbackHost mobile={isMobile} />
          <WelcomeHost />
          <ImagesExplainerHost />
          {!isMobile && <ShortcutsHost />}
        </>
      </Tooltip.Provider>
    </MotionConfig>
  );
}
