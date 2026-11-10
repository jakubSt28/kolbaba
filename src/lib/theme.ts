"use client";

import { useSyncExternalStore } from "react";
import type { Theme } from "./types";

/**
 * Light or dark: <html data-theme> says which, and globals.css (plus Tailwind's `dark:`) follows it.
 * The choice in Settings → Appearance ("auto" follows the system) sits in `data-theme-setting`.
 */

/** The canvas behind everything, for the browser's own bars (meta theme-color). */
const CANVAS = { light: "#e9edf3", dark: "#090b0f" } as const;

const resolve = (theme: Theme) => (theme === "dark" || (theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light");

/** Apply a choice from Settings (or one that came from the server) right away. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.setAttribute("data-theme-setting", theme);
  const resolved = resolve(theme);
  root.setAttribute("data-theme", resolved);
  // The browser's bars: one colour for the picked look, instead of the two that follow the system.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    if (theme === "auto") meta.content = meta.media.includes("dark") ? CANVAS.dark : CANVAS.light;
    else meta.content = CANVAS[resolved];
  }
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

/** Whether the app looks dark right now (Settings or the system). */
export function useDarkTheme() {
  return useSyncExternalStore(
    subscribe,
    () => document.documentElement.getAttribute("data-theme") === "dark",
    () => false,
  );
}
