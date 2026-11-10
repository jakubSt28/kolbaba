"use client";

import { Bell, Check, Compass, Copy, Dock, EllipsisVertical, Info, MonitorDown, Settings, Share, SlidersHorizontal, Smartphone, SquarePlus, Trash, X, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { create } from "zustand";
import { t } from "@/lib/i18n";
import { browserGuide, canPromptInstall, installGuide, installOffer, isMac, isStandalone, onInstallChange, promptInstall, type InstallGuide, type InstallOffer } from "@/lib/install";
import { enablePush, type PushState } from "@/lib/push-client";
import { useMail } from "@/lib/store";
import { cn } from "@/lib/utils";
import { spring } from "./ui";

type Guide = InstallGuide | "reinstall" | "notifications";

/** Which steps are open, if any (the phone layout dims the status bar strip while they are). */
export const useInstallGuide = create<{ open: Guide | null }>(() => ({ open: null }));
export const openInstallGuide = (guide: Guide) => useInstallGuide.setState({ open: guide });
const closeGuide = () => useInstallGuide.setState({ open: null });

/** The browser's own install dialog, one tap, where it has one; the steps for this browser everywhere else. */
export async function startInstall(guide: Guide) {
  if (canPromptInstall()) await promptInstall();
  else openInstallGuide(guide);
}

/**
 * Where notifications are allowed again once they were refused. No page may ask twice, so then it's
 * the system's own switch (the Mac's web app, iPhone) or the browser's.
 */
type AllowPlace = "mac-app" | "safari" | "ios" | "android" | "chromium" | "firefox";

function allowPlace(): AllowPlace {
  const browser = browserGuide();
  if (browser === "safari") return isStandalone() ? "mac-app" : "safari";
  // Dia and Arc are Chromium too.
  if (browser === "elsewhere") return /Firefox\//.test(navigator.userAgent) ? "firefox" : "chromium";
  return browser;
}

/** The permission question, and on a Mac where to find it: a small banner at the top right, easy to miss. */
async function askForPush(): Promise<PushState> {
  const { pushToast, dismissToast } = useMail.getState();
  const hint =
    allowPlace() === "mac-app" && Notification.permission === "default"
      ? pushToast({ message: t("Your Mac is asking at the top right of the screen. Choose Allow, it may be under Options."), duration: 15_000 })
      : null;
  try {
    return await enablePush();
  } finally {
    if (hint) dismissToast(hint);
  }
}

/**
 * Turn notifications on from a tap, as on iPhone: the system asks while it still may. Once the answer
 * was no it can't ask again, so the steps to allow them open instead.
 */
export async function turnOnNotifications(): Promise<PushState> {
  const state = await askForPush();
  if (state === "denied") openInstallGuide("notifications");
  return state;
}

/** What installing Kolbaba takes in this browser; null in the installed app. */
export const useInstall = () => useSyncExternalStore(onInstallChange, installGuide, () => null);

/** On a phone or tablet: the Home Screen, in its words. */
export const homeScreen = (guide: Guide) => guide === "ios" || guide === "android";
/** The Install button, and what it promises. */
export const installLabel = (guide: InstallGuide) => (homeScreen(guide) ? t("Add to Home Screen") : t("Install Kolbaba"));
export const installHint = (guide: InstallGuide) =>
  homeScreen(guide) ? t("It opens like an app and can let you know about new mail.") : t("Its own window and icon, like any other app.");

const DAY = 24 * 60 * 60 * 1000;
/** "Not now" puts the offer away for a while; adding the icon again matters more, so it's back sooner. */
type Offer = NonNullable<InstallOffer>;
const LATER_DAYS: Record<Offer, number> = { ios: 14, android: 14, reinstall: 3 };
const laterKey = (offer: Offer) => `kolbaba:install-later:${offer}`;

/** The offer was put off with "Not now" a short while ago (the notifications offer waits behind it). */
export function putOff(guide: Offer) {
  try {
    const at = Number(localStorage.getItem(laterKey(guide)));
    return !!at && Date.now() - at < LATER_DAYS[guide] * DAY;
  } catch {
    return false;
  }
}

/** In Inbox on a phone or tablet: add Kolbaba to the Home Screen, or add an outdated icon again. */
export function InstallBanner({ mobile = false }: { mobile?: boolean }) {
  const offer = useSyncExternalStore(onInstallChange, installOffer, () => null);
  const hasMailbox = useMail((s) => s.accounts.length > 0);
  const [later, setLater] = useState<Offer | null>(null);
  if (!offer || !hasMailbox || later === offer || putOff(offer)) return null;
  const again = offer === "reinstall";

  const dismiss = () => {
    setLater(offer);
    try {
      localStorage.setItem(laterKey(offer), String(Date.now()));
    } catch {
      // No storage: it's just offered again next time.
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      className={cn("flex items-center rounded-[14px] bg-accent-soft", mobile ? "mx-2.5 mb-2 rounded-[18px]" : "mt-1 mb-1")}
    >
      <button onClick={() => void startInstall(offer)} className={cn("flex min-w-0 flex-1 items-center gap-3 pl-3.5 text-left", mobile ? "py-3" : "py-2.5")}>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/60 text-accent-text dark:bg-white/10">
          <Smartphone size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-ink">{again ? t("Add the Kolbaba icon again") : t("Add Kolbaba to your Home Screen")}</span>
          <span className="block text-[12px] leading-snug text-ink-3">
            {again ? t("An update only reaches a freshly added icon. It takes half a minute.") : t("It opens like an app and can let you know about new mail.")}
          </span>
        </span>
      </button>
      <button
        aria-label={t("Not now")}
        onClick={dismiss}
        className="mx-1.5 flex size-8 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-white/50 active:bg-white/50 dark:hover:bg-white/10"
      >
        <X size={16} />
      </button>
    </motion.div>
  );
}

interface Step {
  icon: LucideIcon;
  text: string;
  /** Something to copy along with the step (the address to open). */
  copy?: string;
}

function allowSteps(place: AllowPlace): Step[] {
  switch (place) {
    case "mac-app":
      return [
        { icon: Settings, text: t("Open System Settings → Notifications.") },
        { icon: Bell, text: t("Click Kolbaba and turn on Allow notifications.") },
      ];
    case "safari":
      return [
        { icon: Settings, text: t("In the menu bar, choose Safari → Settings → Websites.") },
        { icon: Bell, text: t("Under Notifications, set {address} to Allow.", { address: location.host }) },
      ];
    case "ios":
      return [
        { icon: Settings, text: t("Open Settings → Notifications.") },
        { icon: Bell, text: t("Tap Kolbaba and turn on Allow Notifications.") },
      ];
    case "android":
      return [
        { icon: Info, text: t("Hold the Kolbaba icon and tap App info. In the browser, tap the icon left of the address.") },
        { icon: Bell, text: t("Allow notifications.") },
      ];
    case "chromium":
      return [
        { icon: SlidersHorizontal, text: t("Click the icon left of the address. In Kolbaba's own window, open the ⋮ or ⋯ menu and choose App info.") },
        { icon: Bell, text: t("Set Notifications to Allow.") },
      ];
    case "firefox":
      return [
        { icon: SlidersHorizontal, text: t("Click the icon left of the address.") },
        { icon: Bell, text: t("Next to Send notifications, remove Blocked.") },
      ];
  }
}

function guideSteps(guide: Guide): Step[] {
  const address = location.host;
  const add: Step[] = [
    { icon: Share, text: t("Tap Share. In Safari it's in the ⋯ menu.") },
    { icon: SquarePlus, text: t("Choose Add to Home Screen. Not there? Tap View More.") },
    { icon: Check, text: t("Leave Open as Web App on and tap Add.") },
  ];
  const dock: Step[] = [
    { icon: Dock, text: t("In the menu bar, choose File → Add to Dock.") },
    { icon: Check, text: t("Keep the name and click Add.") },
  ];
  switch (guide) {
    case "notifications":
      return allowSteps(allowPlace());
    case "ios":
      return add;
    case "android":
      return [
        { icon: EllipsisVertical, text: t("Tap ⋮ in the corner of the browser.") },
        { icon: SquarePlus, text: t("Choose Add to Home screen or Install app.") },
        { icon: Check, text: t("Confirm, then open Kolbaba from your Home Screen.") },
      ];
    case "reinstall":
      return [
        { icon: Trash, text: t("Hold the Kolbaba icon on your Home Screen and remove it.") },
        { icon: Compass, text: t("Open {address} in Safari.", { address }), copy: address },
        ...add,
      ];
    case "safari":
      return dock;
    case "chromium":
      return [
        { icon: EllipsisVertical, text: t("Open the browser menu, ⋮ or ⋯ by the address bar.") },
        { icon: MonitorDown, text: t("Choose Install Kolbaba. In Chrome it's under Cast, save and share, in Edge under Apps.") },
        { icon: Check, text: t("Click Install, and Kolbaba opens in its own window.") },
      ];
    case "elsewhere":
      // Every Mac has Safari, and Safari installs.
      return isMac()
        ? [{ icon: Compass, text: t("Open {address} in Safari.", { address }), copy: address }, ...dock]
        : [
            { icon: Compass, text: t("Open {address} in Chrome or Edge.", { address }), copy: address },
            { icon: MonitorDown, text: t("Choose Install Kolbaba in its ⋮ or ⋯ menu.") },
          ];
  }
}

function guideTitle(guide: Guide) {
  if (guide === "notifications") return t("Allow notifications");
  if (guide === "reinstall") return t("Add the icon again");
  if (guide === "safari") return t("Add to Dock");
  return homeScreen(guide) ? t("Add to Home Screen") : t("Install Kolbaba");
}

function guideLead(guide: Guide) {
  switch (guide) {
    case "notifications":
      return t("Kolbaba may ask only once, and that time the answer was no. To allow them now:");
    case "reinstall":
      return t("iOS reads a few things only when an icon is added, so this update needs a new one. Your mail stays as it is.");
    case "ios":
      return t("Kolbaba then opens full screen, like an app. On iPhone and iPad, notifications only work from there.");
    case "android":
      return t("Kolbaba then opens full screen, like an app.");
    case "elsewhere":
      return isMac()
        ? t("This browser can't install apps, but Safari can. You'll only need it for this.")
        : t("This browser can't install apps, but Chrome and Edge can. You'll only need them for this.");
    default:
      return t("Kolbaba then opens in its own window, like any other app.");
  }
}

/**
 * The steps, in the words iOS or the browser uses: a sheet from the bottom on the phone, a small
 * window on the computer.
 */
export function InstallGuideHost({ mobile }: { mobile: boolean }) {
  const guide = useInstallGuide((s) => s.open);
  const pushToast = useMail((s) => s.pushToast);

  useEffect(() => {
    // On the computer, Settings is a modal window that would leave the steps unclickable: it steps aside.
    if (guide && !mobile) useMail.getState().setSettingsOpen(false);
  }, [guide, mobile]);

  useEffect(() => {
    if (!guide) return;
    // The steps hold the keyboard: Escape closes them, and the app's shortcuts wait.
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") closeGuide();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [guide]);

  useEffect(() => {
    const onInstalled = () => {
      closeGuide();
      pushToast({ message: t("Kolbaba is installed") });
    };
    window.addEventListener("appinstalled", onInstalled);
    return () => window.removeEventListener("appinstalled", onInstalled);
  }, [pushToast]);

  if (!mobile) {
    return (
      <AnimatePresence>
        {guide && (
          <motion.div
            key="install-scrim"
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/25 p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            onClick={closeGuide}
          >
            <motion.div
              role="dialog"
              aria-modal
              aria-labelledby="install-guide-title"
              initial={{ opacity: 0, scale: 0.94, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
              transition={spring}
              onClick={(e) => e.stopPropagation()}
              className="glass-strong w-full max-w-[400px] rounded-[22px] p-5"
            >
              <GuideBody guide={guide} onDone={closeGuide} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      {guide && (
        <>
          <motion.div
            key="install-scrim"
            className="fixed inset-0 z-[60] bg-black/25"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeGuide}
          />
          <motion.div
            key="install-sheet"
            role="dialog"
            aria-modal
            aria-labelledby="install-guide-title"
            className="glass-strong fixed inset-x-2 bottom-2 z-[60] mx-auto max-w-[420px] rounded-[26px] px-5 pt-5 pb-[max(16px,var(--safe-bottom))]"
            initial={{ y: "110%" }}
            animate={{ y: 0 }}
            exit={{ y: "110%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38, mass: 0.9 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.7 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 80 || info.velocity.y > 500) closeGuide();
            }}
          >
            <GuideBody guide={guide} onDone={closeGuide} mobile />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function GuideBody({ guide, onDone, mobile = false }: { guide: Guide; onDone: () => void; mobile?: boolean }) {
  const pushToast = useMail((s) => s.pushToast);
  const copy = (value: string) => {
    void navigator.clipboard?.writeText(value).then(
      () => pushToast({ message: t("Copied {value}", { value }) }),
      () => {},
    );
  };
  return (
    <>
      <h2 id="install-guide-title" className={cn("font-semibold tracking-[-0.02em]", mobile ? "text-[19px]" : "text-[17px]")}>
        {guideTitle(guide)}
      </h2>
      <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">{guideLead(guide)}</p>
      <ol className="mt-4 flex flex-col gap-3">
        {guideSteps(guide).map((step, i) => (
          <li key={i} className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-hover text-ink-2">
              <step.icon size={17} />
            </span>
            <span className="min-w-0 flex-1 text-[14px] leading-snug text-ink">{step.text}</span>
            {step.copy && (
              <button
                onClick={() => copy(step.copy!)}
                aria-label={t("Copy")}
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-hover hover:text-ink-2 active:bg-hover"
              >
                <Copy size={15} />
              </button>
            )}
          </li>
        ))}
      </ol>
      {guide === "reinstall" && <p className="mt-4 text-[12.5px] leading-relaxed text-ink-3">{t("Then sign in again and turn notifications back on in Settings.")}</p>}
      {guide === "chromium" && (
        // Dia and Arc look like Chrome to the page, but their menus have no Install.
        <p className="mt-4 text-[12.5px] leading-relaxed text-ink-3">
          {t("Not in the menu? Dia and Arc can't install apps.")}{" "}
          <button onClick={() => openInstallGuide("elsewhere")} className="font-medium text-accent-text">
            {t("Show me another way")}
          </button>
        </p>
      )}
      {guide === "notifications" ? (
        <AllowFooter onDone={onDone} mobile={mobile} />
      ) : (
        <button
          autoFocus={!mobile}
          onClick={onDone}
          className={cn(
            "mt-5 w-full rounded-[14px] bg-hover font-medium text-ink transition-colors hover:bg-selected active:bg-selected",
            mobile ? "h-12 text-[15px]" : "h-10 text-[13.5px]",
          )}
        >
          {t("Done")}
        </button>
      )}
    </>
  );
}

/** Back from the system's or the browser's settings: one tap finishes it. */
function AllowFooter({ onDone, mobile }: { onDone: () => void; mobile: boolean }) {
  const pushToast = useMail((s) => s.pushToast);
  const [busy, setBusy] = useState(false);
  const [stillBlocked, setStillBlocked] = useState(false);
  const turnOn = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const state = await askForPush();
      if (state === "on") {
        onDone();
        pushToast({ message: t("Notifications are on. Who may notify you is in Settings → Notifications.") });
      }
      setStillBlocked(state === "denied");
    } catch {
      pushToast({ message: t("Couldn't turn on notifications. Try again.") });
    } finally {
      setBusy(false);
    }
  };
  const size = mobile ? "h-12 text-[15px]" : "h-10 text-[13.5px]";
  return (
    <>
      {stillBlocked && (
        // Some browsers, Safari's web apps among them, only see the new setting after a fresh start.
        <p className="mt-4 text-[12.5px] leading-relaxed text-ink-3">
          {allowPlace() === "mac-app" ? (
            t("Still blocked? Quit Kolbaba with ⌘Q, open it again and turn them on.")
          ) : (
            <>
              {t("Still blocked? Load Kolbaba again and turn them on.")}{" "}
              <button onClick={() => location.reload()} className="font-medium text-accent-text">
                {t("Reload")}
              </button>
            </>
          )}
        </p>
      )}
      <button
        autoFocus={!mobile}
        onClick={() => void turnOn()}
        disabled={busy}
        className={cn("mt-5 w-full rounded-[14px] bg-accent font-semibold text-on-accent transition-opacity disabled:opacity-60", size)}
      >
        {t("Turn on")}
      </button>
      <button onClick={onDone} className={cn("mt-1.5 w-full rounded-[14px] font-medium text-ink-2 transition-colors hover:bg-hover active:bg-hover", size)}>
        {t("Not now")}
      </button>
    </>
  );
}
