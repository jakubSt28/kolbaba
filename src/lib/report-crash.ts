"use client";

import { BUILD_ID } from "./build";
import { isStandalone } from "./install";

const sent = new WeakSet<object>();

/**
 * What crashed the screen goes to the server's log (src/app/api/client-error/route.ts), once per
 * error: a crash in the installed app on someone's computer can't be seen any other way.
 */
export function reportCrash(error: Error & { digest?: string }, where: "page" | "root", componentStack?: string) {
  if (error && typeof error === "object") {
    if (sent.has(error)) return;
    sent.add(error);
  }
  const body = {
    where,
    name: String(error?.name ?? "Error").slice(0, 100),
    message: String(error?.message ?? error).slice(0, 2000),
    stack: typeof error?.stack === "string" ? error.stack.slice(0, 8000) : undefined,
    componentStack: componentStack?.slice(0, 8000),
    digest: typeof error?.digest === "string" ? error.digest.slice(0, 100) : undefined,
    path: location.pathname.slice(0, 300),
    build: BUILD_ID,
    app: isStandalone(),
    viewport: `${window.innerWidth}x${window.innerHeight}`,
  };
  // keepalive: Reload can follow right away, and the report still goes.
  void fetch("/api/client-error", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => {});
}
