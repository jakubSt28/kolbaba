"use client";

import { create } from "zustand";
import { isIos, isStandalone } from "./install";
import { api } from "./live";

export type PushState = "unsupported" | "install-first" | "denied" | "off" | "on";

/** This device's notifications: one answer for the offer in the inbox and the switch in Settings. */
export const usePush = create<{ state: PushState | null }>(() => ({ state: null }));

function publish(state: PushState) {
  usePush.setState({ state });
  return state;
}

/** Resolves once the worker is registered (never in development, where there's none). */
export function registerServiceWorker(): Promise<unknown> {
  if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return Promise.resolve();
  return navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
}

let serverKey: Promise<string | null> | null = null;

/**
 * The public key notifications are signed with: baked in at build time here, and asked of the server on a
 * self-hosted copy, whose image is built once for everyone while each server has its own key.
 */
function vapidKey(): Promise<string | null> {
  if (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return Promise.resolve(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
  serverKey ??= api
    .get<{ key: string | null }>("/api/push")
    .then((res) => res.key)
    .catch(() => {
      serverKey = null;
      return null;
    });
  return serverKey;
}

/**
 * What this device chose: the subscription it turned on with and when the server last heard of it, or
 * "off". Nothing for a device that turned them on before this was kept: the offer asks it once more.
 */
const KEY = "kolbaba:push";
type Choice = { endpoint: string; savedAt: number } | "off" | null;

function choice(): Choice {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === "off" ? "off" : raw ? (JSON.parse(raw) as Choice) : null;
  } catch {
    return null;
  }
}

function remember(value: Exclude<Choice, null>) {
  try {
    localStorage.setItem(KEY, typeof value === "string" ? value : JSON.stringify(value));
  } catch {
    // No storage: a lost subscription waits for a tap on the offer.
  }
}

const DAY = 24 * 60 * 60 * 1000;

/** Tells the server where to send, in place of the one this device had before. */
async function save(sub: PushSubscription, previous: string | undefined, turningOn = false) {
  await api.post("/api/push", { ...sub.toJSON(), replaces: previous !== sub.endpoint ? previous : undefined });
  // Turned off meanwhile (another account signed in here): that stands.
  if (turningOn || choice() !== "off") remember({ endpoint: sub.endpoint, savedAt: Date.now() });
}

/**
 * Safari drops a device's subscription by itself now and then (a Mac and an iPhone, every few days in
 * Oct 2026), and the switch then read off though nobody turned it off. While the permission stands and this
 * device turned them on, a new one is taken without asking. Once a day the server hears it again, so a
 * subscription it dropped comes back.
 */
async function keepOn(reg: ServiceWorkerRegistration) {
  const chosen = choice();
  let sub = await reg.pushManager.getSubscription();
  if (chosen === "off" || (!sub && !chosen)) return sub;
  if (!sub) {
    const key = await vapidKey();
    if (!key) return null;
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }).catch(() => null);
    if (!sub) return null;
  }
  if (chosen?.endpoint !== sub.endpoint || Date.now() - chosen.savedAt > DAY) await save(sub, chosen?.endpoint).catch(() => {});
  return sub;
}

async function readState(): Promise<PushState> {
  if (typeof window === "undefined") return "unsupported";
  if (isIos() && !isStandalone()) return "install-first";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !(await vapidKey())) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "off";
  const reg = await navigator.serviceWorker.getRegistration();
  return reg && (await keepOn(reg)) ? "on" : "off";
}

let reading: Promise<PushState> | null = null;

/**
 * iPhone only allows web push for apps added to the Home Screen, so we say that instead of failing. Asked
 * on opening Kolbaba and on coming back to it, which is also when a dropped subscription is renewed.
 */
export function pushState(): Promise<PushState> {
  reading ??= readState()
    .catch((): PushState => "off")
    .then(publish)
    .finally(() => (reading = null));
  return reading;
}

function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** Must run from a tap/click (browsers only show the permission prompt for a user gesture). */
export async function enablePush(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  const key = await vapidKey();
  if (!key) return publish("unsupported");
  if (permission !== "granted") return publish(permission === "denied" ? "denied" : "off");
  // iOS shows the icon's number only once notifications are allowed: put it there now, not at the next
  // refresh. The store comes in lazily so sign-in, which only needs disablePush, doesn't load it.
  const { badgeTotal, useMail } = await import("./store");
  const { threads, badgeMode } = useMail.getState();
  setBadge(badgeTotal(threads, badgeMode));
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    }));
  const chosen = choice();
  await save(sub, chosen === "off" ? undefined : chosen?.endpoint, true);
  return publish("on");
}

export async function disablePush(): Promise<PushState> {
  remember("off");
  // A check under way may be telling the server about this subscription: it's removed after that.
  await reading;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api.del("/api/push", { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  }
  return publish("off");
}

/** Keep the Home Screen badge in step with unread mail while the app is open. */
export function setBadge(count: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  (count > 0 ? nav.setAppBadge?.(count) : nav.clearAppBadge?.())?.catch(() => {});
}
