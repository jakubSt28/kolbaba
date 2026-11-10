"use client";

import { Lightbulb, LoaderCircle, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Dialog } from "radix-ui";
import { useState } from "react";
import { BRAND } from "@/lib/brand";
import { t } from "@/lib/i18n";
import { api, LIVE } from "@/lib/live";
import { useMail } from "@/lib/store";
import { cn } from "@/lib/utils";
import { softSpring, spring } from "./ui";

async function send(body: { kind: "nps" | "idea"; score?: number; text?: string; contact?: boolean }) {
  if (LIVE) await api.post("/api/feedback", body);
}

/**
 * "How likely are you to recommend Kolbaba?": a small card, now and then (after a week, then at most
 * every three months), never a modal. A score first, then an optional sentence.
 */
function NpsCard({ mobile }: { mobile: boolean }) {
  const dismiss = useMail((s) => s.dismissNps);
  const pushToast = useMail((s) => s.pushToast);
  const [score, setScore] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (score === null) return;
    setBusy(true);
    try {
      await send({ kind: "nps", score, text: text.trim(), contact: !!text.trim() });
      pushToast({ message: t("Thank you! It really helps.") });
      dismiss(false);
    } catch (err) {
      pushToast({ message: (err as Error).message });
      setBusy(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12 }}
      transition={softSpring}
      role="dialog"
      aria-label={t("How likely are you to recommend {app} to a friend?", { app: BRAND.name })}
      className={cn(
        "glass-strong fixed z-40 rounded-[20px] p-4",
        mobile ? "inset-x-2.5 bottom-[calc(88px+var(--safe-bottom))]" : "right-5 bottom-5 w-[380px]",
      )}
    >
      <button onClick={() => dismiss(true)} aria-label={t("Not now")} className="absolute top-3 right-3 flex size-7 items-center justify-center rounded-lg text-ink-3 hover:bg-hover hover:text-ink">
        <X size={14} />
      </button>
      <div className="pr-8 text-[14px] font-semibold text-ink">{t("How likely are you to recommend {app} to a friend?", { app: BRAND.name })}</div>
      <div className="mt-3 grid grid-cols-11 gap-1">
        {Array.from({ length: 11 }, (_, n) => (
          <button
            key={n}
            onClick={() => setScore(n)}
            aria-pressed={score === n}
            className={cn(
              "h-8 rounded-[8px] text-[13px] font-medium tabular-nums transition-colors",
              score === n ? "bg-accent text-on-accent" : "bg-hover text-ink-2 hover:bg-selected hover:text-ink",
            )}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-ink-3">
        <span>{t("Not at all")}</span>
        <span>{t("Absolutely")}</span>
      </div>
      <AnimatePresence initial={false}>
        {score !== null && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} transition={spring} className="overflow-hidden">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoFocus
              rows={2}
              maxLength={2000}
              placeholder={score >= 9 ? t("What do you like most? (optional)") : t("What would make it better? (optional)")}
              className="mt-3 w-full resize-none rounded-[12px] bg-canvas px-3 py-2 text-[13.5px] shadow-[inset_0_0_0_1px_var(--line)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--accent)]"
            />
            <div className="mt-2 flex justify-end">
              <button
                onClick={() => void submit()}
                disabled={busy}
                className="flex h-8 items-center gap-1.5 rounded-full bg-accent px-4 text-[13px] font-medium text-on-accent hover:bg-accent-hover disabled:opacity-60"
              >
                {busy && <LoaderCircle size={13} className="animate-spin" />}
                {t("Send")}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/** "Suggest a feature": what would help, and whether we may reply. */
function IdeaDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pushToast = useMail((s) => s.pushToast);
  const [text, setText] = useState("");
  const [contact, setContact] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!text.trim()) {
      setError(t("Write what would help you"));
      return;
    }
    setBusy(true);
    try {
      await send({ kind: "idea", text: text.trim(), contact });
      pushToast({ message: t("Thanks! We read every one.") });
      setText("");
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/20 data-[state=open]:animate-[fade-in_140ms_ease-out] dark:bg-black/45" />
        <Dialog.Content
          aria-describedby={undefined}
          className="glass-strong fixed top-1/2 left-1/2 z-50 w-[min(440px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 rounded-[22px] p-5 outline-none data-[state=open]:animate-[dialog-in_180ms_cubic-bezier(0.32,0.72,0,1)]"
        >
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-text">
              <Lightbulb size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-[15.5px] font-semibold tracking-[-0.01em]">{t("Suggest an improvement")}</Dialog.Title>
              <p className="mt-0.5 text-[13px] leading-relaxed text-ink-3">{t("What's missing, what's in the way, what would you add? A sentence is plenty.")}</p>
            </div>
          </div>
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && void submit()}
            autoFocus
            rows={5}
            maxLength={5000}
            placeholder={t("I'd love it if Kolbaba could…")}
            className="mt-4 w-full resize-none rounded-[12px] bg-canvas px-3 py-2.5 text-[14px] leading-relaxed shadow-[inset_0_0_0_1px_var(--line)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--accent)]"
          />
          {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" checked={contact} onChange={(e) => setContact(e.target.checked)} className="size-4 accent-[var(--accent)]" />
            {t("You can reply to me by email")}
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={onClose} className="h-9 rounded-[11px] bg-hover px-3.5 text-[13px] font-medium text-ink-2 hover:bg-selected">
              {t("Cancel")}
            </button>
            <button
              onClick={() => void submit()}
              disabled={busy}
              className="flex h-9 items-center gap-1.5 rounded-[11px] bg-accent px-4 text-[13px] font-medium text-on-accent hover:bg-accent-hover disabled:opacity-60"
            >
              {busy && <LoaderCircle size={13} className="animate-spin" />}
              {t("Send")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function FeedbackHost({ mobile }: { mobile: boolean }) {
  const mode = useMail((s) => s.feedback);
  const setFeedback = useMail((s) => s.setFeedback);
  const nps = useMail((s) => s.npsPrompt);
  // Not in the way: the 0–10 card waits until nothing else is open.
  const busy = useMail((s) => s.settingsOpen || s.paletteOpen);
  return (
    <>
      <AnimatePresence>{(nps || mode === "nps") && !busy && <NpsCard key="nps" mobile={mobile} />}</AnimatePresence>
      <IdeaDialog open={mode === "idea"} onClose={() => setFeedback(null)} />
    </>
  );
}
