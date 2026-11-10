"use client";

import { useState } from "react";
import { CrashScreen } from "@/components/crash-screen";
import { BRAND } from "@/lib/brand";
import { getLocale } from "@/lib/i18n";
import "./globals.css";

/**
 * The frame itself (the root layout) threw. This page takes its place, so it brings its own <html>,
 * the styles, and the look the app had a moment ago (light or dark, its colour).
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  // Read before React takes <html> over and drops what the app had set on it.
  const [look] = useState(() => {
    const root = typeof document === "undefined" ? null : document.documentElement;
    return { theme: root?.getAttribute("data-theme") ?? undefined, accent: root?.getAttribute("data-accent") ?? "ink" };
  });
  return (
    <html lang={getLocale()} data-theme={look.theme} data-accent={look.accent} suppressHydrationWarning className="h-full antialiased">
      <body className="h-full font-sans">
        <title>{BRAND.name}</title>
        <CrashScreen error={error} where="root" />
      </body>
    </html>
  );
}
