/**
 * The Home Screen app. iOS reads a few things only when someone adds the icon (the name, the icon,
 * the status bar style and the web app manifest) and never again, so a change to them reaches only
 * icons added after it. The others keep the old behaviour until they're removed and added again.
 *
 * INSTALL_VERSION rides along in the manifest's start_url, which iOS also keeps from that moment, so
 * the app knows which version its icon was added with. Change anything frozen (src/lib/install.test.ts
 * fails until you do) → raise INSTALL_VERSION; if old icons now misbehave, raise MIN_INSTALL_VERSION
 * too, and the app asks just those people to add the icon again (src/components/install-guide.tsx).
 */
export const INSTALL_VERSION = 1;
/** Icons added before this version get asked to re-add theirs. Icons from before the stamp count as 0. */
export const MIN_INSTALL_VERSION = 0;

/** Frozen at install on iOS: the root layout's `appleWebApp` metadata. */
export const APPLE_WEB_APP = {
  capable: true,
  // An opaque status bar in the canvas colour. "black-translucent" draws white status text over the
  // light canvas and, in a Home Screen app, shifts the page up and leaves an empty strip at the bottom.
  statusBarStyle: "default",
} as const;

const KEY = "kolbaba:install";

export const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

/**
 * The version in this page's address. Every launch from the icon opens start_url; the very first one
 * may land on sign-in, with start_url inside `next`.
 */
function stampInUrl() {
  const params = new URLSearchParams(location.search);
  const next = params.get("next");
  const stamp = params.get("install") ?? (next?.startsWith("/") ? new URL(next, location.origin).searchParams.get("install") : null);
  const version = Number(stamp);
  return Number.isInteger(version) && version > 0 ? version : 0;
}

function storedVersion() {
  try {
    return Number(localStorage.getItem(KEY)) || 0;
  } catch {
    return 0;
  }
}

/** Remember which version this icon was added with: the address loses it on the first tap elsewhere. */
export function noteInstall() {
  if (typeof window === "undefined" || !isStandalone()) return;
  const version = stampInUrl();
  try {
    if (version > storedVersion()) localStorage.setItem(KEY, String(version));
  } catch {
    // No storage: the stamp is read again from the next launch's address.
  }
}

/** The version this Home Screen icon was added with; 0 for icons from before the stamp. */
export const installedVersion = () => Math.max(storedVersion(), stampInUrl());

/**
 * What to offer on this device: add the app to the Home Screen (a phone or tablet in the browser),
 * add it again (an iOS icon older than MIN_INSTALL_VERSION), or nothing.
 */
export type InstallOffer = "ios" | "android" | "reinstall" | null;

export function installOffer(): InstallOffer {
  if (typeof window === "undefined") return null;
  if (isStandalone()) return isIos() && installedVersion() < MIN_INSTALL_VERSION ? "reinstall" : null;
  if (!window.matchMedia("(pointer: coarse)").matches) return null;
  const guide = installGuide();
  return guide === "ios" || guide === "android" ? guide : null;
}

/* ---------------------- Installing from any browser ---------------------- */

/**
 * The steps for this browser, for when it has no install dialog to open: Share → Add to Home Screen
 * on iOS, the ⋮ menu on Android, File → Add to Dock in Safari on the Mac, the menu of a Chromium
 * browser on the computer, or, where the browser can't install apps at all (Firefox, Dia, Arc),
 * another browser that can.
 */
export type InstallGuide = "ios" | "android" | "safari" | "chromium" | "elsewhere";

/** Chromium browsers known to install apps. Dia and Arc are Chromium too and can't. */
const INSTALLS = /^(Google Chrome|Microsoft Edge|Brave|Opera|Vivaldi)$/;

/** Which steps fit a browser, by its user agent and brands (navigator.userAgentData, Chromium only). */
export function guideFor(ua: string, brands: readonly string[] | null, touchMac = false): InstallGuide {
  // iPadOS Safari says it's a Mac; touch gives it away.
  if (/iPhone|iPad|iPod/.test(ua) || (touchMac && /Macintosh/.test(ua))) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Firefox\//.test(ua)) return "elsewhere";
  // A brand list without any of the browsers that install is one of those that don't.
  if (/Chrome\//.test(ua)) return !brands || brands.some((b) => INSTALLS.test(b)) ? "chromium" : "elsewhere";
  if (/Macintosh/.test(ua) && /Version\/[\d.]+.*Safari\//.test(ua)) return "safari";
  return "elsewhere";
}

export const isMac = () => /Macintosh/.test(navigator.userAgent) && !isIos();

/**
 * What installing Kolbaba takes here, or null when it's already an app: this page runs in its
 * window, or the browser stopped offering to install it after its app opened here. A Chromium
 * browser shares storage with the apps it installs, so their visit (noteInstall) is seen in its tabs.
 */
export function installGuide(): InstallGuide | null {
  if (typeof window === "undefined" || isStandalone()) return null;
  if (!deferred && storedVersion() > 0) return null;
  return browserGuide();
}

/** This browser in installGuide's terms, also inside the installed app (whose window is the same browser). */
export function browserGuide(): InstallGuide {
  const brands = (navigator as { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands?.map((b) => b.brand) ?? null;
  return guideFor(navigator.userAgent, brands, isIos());
}

/* ------------------------- The browser's install dialog ------------------------ */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

/** Called when the browser starts offering its install dialog, or Kolbaba gets installed. */
export function onInstallChange(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

// Chromium browsers (Chrome, Edge, Brave, Chrome on Android) offer their own install dialog once
// the page qualifies: keep the event from the moment this module loads, so a tap can open it later.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    changed();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    // Added just now, with this version; the browser's tabs share this storage with the app.
    try {
      if (storedVersion() < INSTALL_VERSION) localStorage.setItem(KEY, String(INSTALL_VERSION));
    } catch {
      // No storage: the button stays until the app's own first launch notes it.
    }
    changed();
  });
}

export const canPromptInstall = () => deferred !== null;

/** Open the browser's own install dialog; false if there's none (then show the steps instead). */
export async function promptInstall() {
  const event = deferred;
  if (!event) return false;
  deferred = null;
  changed();
  await event.prompt();
  return (await event.userChoice).outcome === "accepted";
}
