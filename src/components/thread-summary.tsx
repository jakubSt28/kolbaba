"use client";

import { LoaderCircle, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { t } from "@/lib/i18n";
import { api, LIVE, type ApiError } from "@/lib/live";
import { TRIAL_DAYS } from "@/lib/plus";
import { useMail } from "@/lib/store";
import type { Thread, ThreadSummary } from "@/lib/types";
import { track } from "@/lib/usage";
import { softSpring } from "./ui";

/** Long conversations are worth a summary; three messages is where scrolling starts to hurt. */
export const canSummarize = (thread: Thread) => LIVE && thread.messages.length >= 3 && thread.folder !== "scheduled";

/** "Summarize": a button under the subject, then the summary in its place. Only ever on request. */
export function ThreadSummaryBlock({ thread }: { thread: Thread }) {
  const [state, setState] = useState<{ status: "idle" | "loading" | "done" | "error"; data?: ThreadSummary; error?: string }>({ status: "idle" });
  const on = useMail((s) => s.summaries && s.aiAvailable);
  if (!on || !canSummarize(thread)) return null;

  const run = async () => {
    const { plus, askForPlus, refreshPlus, pushToast } = useMail.getState();
    // Part of Plus: after the trial, the button says so instead of failing.
    if (plus && plus.level === "none" && plus.trialUsed) return askForPlus();
    const startsTrial = !!plus && plus.level === "none";
    track("summary");
    setState({ status: "loading" });
    try {
      setState({ status: "done", data: await api.post<ThreadSummary>(`/api/threads/${encodeURIComponent(thread.id)}/summary`) });
      useMail.getState().markTried("summary");
      if (startsTrial) {
        await refreshPlus();
        pushToast({ message: t("Kolbaba Plus is yours for {n} days, free. No card needed.", { n: TRIAL_DAYS }), duration: 6000 });
      }
    } catch (err) {
      if ((err as ApiError).code === "plus") {
        setState({ status: "idle" });
        return askForPlus();
      }
      setState({ status: "error", error: (err as Error).message });
    }
  };

  return (
    <AnimatePresence initial={false} mode="popLayout">
      {state.status === "done" && state.data ? (
        <motion.section
          key="summary"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={softSpring}
          className="relative mb-4 rounded-xl bg-accent-soft px-4 py-3.5 text-[13.5px] leading-relaxed text-ink"
        >
          <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-accent-text">
            <Sparkles size={13} /> {t("Summary")}
          </div>
          <button
            onClick={() => setState({ status: "idle" })}
            aria-label={t("Close")}
            className="absolute top-2.5 right-2.5 flex size-7 items-center justify-center rounded-lg text-ink-3 hover:bg-white/40 hover:text-ink dark:hover:bg-white/10"
          >
            <X size={14} />
          </button>
          <p className="pr-6">{state.data.summary}</p>
          {state.data.points.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-ink-2 marker:text-ink-3">
              {state.data.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {state.data.asks.length > 0 && (
            <div className="mt-2.5">
              <div className="text-[12px] font-medium text-ink-2">{t("Waiting for you")}</div>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-5 marker:text-accent-text">
                {state.data.asks.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-2.5 text-[11.5px] text-ink-3">{t("Written by AI from this conversation, so check anything important.")}</p>
        </motion.section>
      ) : (
        <motion.div key="button" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="-mt-2 mb-4 flex items-center gap-2">
          <button
            onClick={() => void run()}
            disabled={state.status === "loading"}
            className="flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium text-accent-text shadow-[inset_0_0_0_0.5px_var(--line)] transition-colors hover:bg-accent-soft disabled:opacity-70"
          >
            {state.status === "loading" ? <LoaderCircle size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {state.status === "loading" ? t("Summarizing…") : t("Summarize")}
          </button>
          {state.status === "error" && <span className="text-[12px] text-danger">{state.error}</span>}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
