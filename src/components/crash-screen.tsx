"use client";

import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import { t } from "@/lib/i18n";
import { reportCrash } from "@/lib/report-crash";
import { Kolbaba } from "./kolbaba";

/**
 * Something threw while drawing the app (src/app/error.tsx) or the frame around it
 * (src/app/global-error.tsx): Kolbaba, a word on what happened and the way back. What crashed goes to
 * the server's log by itself; its text stays small at the bottom, for a screenshot.
 */
export function CrashScreen({ error, where }: { error: Error & { digest?: string }; where: "page" | "root" }) {
  useEffect(() => reportCrash(error, where), [error, where]);
  return (
    <div className="canvas app-height flex items-center justify-center p-6">
      <div role="alert" className="flex max-w-[340px] flex-col items-center gap-5 text-center">
        <Kolbaba size={48} mood="twitch" interactive />
        <div>
          <h1 className="text-[16px] font-semibold tracking-[-0.01em]">{t("Something went wrong")}</h1>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{t("We've noted what happened and we'll fix it. Loading Kolbaba again usually helps.")}</p>
        </div>
        <button
          autoFocus
          onClick={() => window.location.reload()}
          className="h-10 rounded-[12px] bg-accent px-5 text-[13.5px] font-medium text-on-accent transition-colors hover:bg-accent-hover"
        >
          {t("Reload")}
        </button>
        {error?.message && <p className="line-clamp-3 max-w-full font-mono text-[11px] break-words text-ink-3 opacity-70 select-text">{error.message}</p>}
      </div>
    </div>
  );
}

/**
 * Around the app (src/app/client-app.tsx): the same screen, caught here first because only a class
 * boundary gets React's component stack, and that says which component it was (a loop inside React,
 * say, has nothing but React in its JavaScript stack). The report goes before the screen's own.
 */
export class CrashBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportCrash(error, "page", info.componentStack ?? undefined);
  }

  render() {
    return this.state.error ? <CrashScreen error={this.state.error} where="page" /> : this.props.children;
  }
}
