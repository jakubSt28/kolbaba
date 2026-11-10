"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { create } from "zustand";
import { t } from "@/lib/i18n";
import { spring } from "./ui";

interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}

/** A question with a few answers, stacked (the first is the suggested one), and a way out. */
interface ChoiceRequest {
  title: string;
  message: string;
  choices: { label: string; run: () => void; tone?: "accent" | "danger" }[];
  cancelLabel: string;
}

const useConfirm = create<{ request: ConfirmRequest | null; choice: ChoiceRequest | null }>(() => ({ request: null, choice: null }));

/**
 * Ask before something that can't be undone (deleting for good). Everything else in the app acts
 * at once and offers Undo instead.
 */
export function confirmAction(request: ConfirmRequest) {
  useConfirm.setState({ request });
}

/** Offer a few ways on (cleaning up after unsubscribing). Nothing happens until one is picked. */
export function confirmChoice(choice: ChoiceRequest) {
  useConfirm.setState({ choice });
}

const close = () => useConfirm.setState({ request: null, choice: null });

export function ConfirmHost() {
  const request = useConfirm((s) => s.request);
  const choice = useConfirm((s) => s.choice);

  useEffect(() => {
    if (!request && !choice) return;
    // The app's shortcuts stand down while this is open (see useShortcuts). Cancel has focus, so Enter is the safe choice.
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [request, choice]);

  return (
    <AnimatePresence>
      {choice && (
        <motion.div
          key="choice"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/25 p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          onClick={close}
        >
          <motion.div
            role="alertdialog"
            aria-labelledby="choice-title"
            aria-describedby="choice-message"
            initial={{ opacity: 0, scale: 0.94, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
            transition={spring}
            onClick={(e) => e.stopPropagation()}
            className="glass-strong w-full max-w-[320px] rounded-[22px] p-4 text-center"
          >
            <h2 id="choice-title" className="text-[15px] font-semibold tracking-[-0.01em]">
              {choice.title}
            </h2>
            <p id="choice-message" className="mt-1 text-[13px] leading-relaxed text-ink-2">
              {choice.message}
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {choice.choices.map((c, i) => (
                <button
                  key={c.label}
                  autoFocus={i === 0}
                  onClick={() => {
                    close();
                    c.run();
                  }}
                  className={
                    c.tone === "danger"
                      ? "h-10 rounded-[12px] bg-danger/10 text-[13.5px] font-medium text-danger transition-colors hover:bg-danger/15"
                      : "h-10 rounded-[12px] bg-accent text-[13.5px] font-medium text-on-accent transition-colors hover:bg-accent-hover"
                  }
                >
                  {c.label}
                </button>
              ))}
              <button onClick={close} className="h-10 rounded-[12px] bg-hover text-[13.5px] font-medium text-ink-2 transition-colors hover:bg-selected">
                {choice.cancelLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
      {request && (
        <motion.div
          key="confirm"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/25 p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          onClick={close}
        >
          <motion.div
            role="alertdialog"
            aria-labelledby="confirm-title"
            aria-describedby="confirm-message"
            initial={{ opacity: 0, scale: 0.94, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
            transition={spring}
            onClick={(e) => e.stopPropagation()}
            className="glass-strong w-full max-w-[300px] rounded-[22px] p-4 text-center"
          >
            <h2 id="confirm-title" className="text-[15px] font-semibold tracking-[-0.01em]">
              {request.title}
            </h2>
            <p id="confirm-message" className="mt-1 text-[13px] leading-relaxed text-ink-2">
              {request.message}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                autoFocus
                onClick={close}
                className="h-10 flex-1 rounded-[12px] bg-hover text-[13.5px] font-medium text-ink-2 transition-colors hover:bg-selected"
              >
                {t("Cancel")}
              </button>
              <button
                onClick={() => {
                  request.onConfirm();
                  close();
                }}
                className="h-10 flex-1 rounded-[12px] bg-danger text-[13.5px] font-medium text-white transition-opacity hover:opacity-90"
              >
                {request.confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
