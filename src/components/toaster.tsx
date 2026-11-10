"use client";

import { Check, Eye, KeyRound, Palmtree, Sparkles, Undo2, WandSparkles, WifiOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { t } from "@/lib/i18n";
import { composing, useMail, type Toast } from "@/lib/store";
import { cn } from "@/lib/utils";
import { SignatureIcon } from "./signature";
import { Kbd, spring } from "./ui";

export function Toaster({ className }: { className?: string }) {
  const toasts = useMail((s) => s.toasts);
  const writing = useMail(composing);
  return (
    <div className={cn("pointer-events-none inset-x-0 z-50 flex flex-col items-center gap-2 px-4", className)}>
      <AnimatePresence initial={false}>
        {toasts
          .filter((t) => !(writing && t.notWhileWriting))
          .map((t) => (
            <ToastItem key={t.id} toast={t} />
          ))}
      </AnimatePresence>
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useMail((s) => s.dismissToast);

  useEffect(() => {
    if (!toast.duration) return;
    const timer = setTimeout(() => dismiss(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, dismiss]);

  const undo = () => {
    toast.undo?.();
    dismiss(toast.id);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.96, transition: { duration: 0.15 } }}
      transition={spring}
      data-undo-toast={toast.undo ? "" : undefined}
      className="glass-strong pointer-events-auto relative flex h-11 items-center gap-3 overflow-hidden rounded-full pr-1.5 pl-4 text-[13.5px]"
    >
      {toast.sig ? (
        <SignatureIcon sig={toast.sig} className={toast.sig === "send" ? "-ml-1" : undefined} />
      ) : toast.icon === "eye" ? (
        <Eye size={15} className="text-accent-text" />
      ) : toast.icon === "key" ? (
        <KeyRound size={15} className="text-accent-text" />
      ) : toast.icon === "new" ? (
        <Sparkles size={15} className="text-accent-text" />
      ) : toast.icon === "wifi-off" ? (
        <WifiOff size={15} className="text-ink-2" />
      ) : toast.icon === "rule" ? (
        <WandSparkles size={15} className="text-accent-text" />
      ) : toast.icon === "palmtree" ? (
        <Palmtree size={15} className="text-accent-text" />
      ) : (
        !toast.countdown && <Check size={15} className="text-success" />
      )}
      <span className="font-medium">{toast.message}</span>
      {toast.action && (
        <button
          onClick={() => {
            toast.action!.run();
            dismiss(toast.id);
          }}
          className="press flex h-8 items-center rounded-full bg-accent px-3.5 text-[13px] font-medium text-on-accent [--press-scale:0.93] hover:bg-accent-hover"
        >
          {toast.action.label}
        </button>
      )}
      {toast.undo && (
        <button
          onClick={undo}
          className="press flex h-8 items-center gap-1.5 rounded-full bg-hover px-3 text-[13px] font-medium text-ink [--press-scale:0.93] hover:bg-selected"
        >
          <Undo2 size={14} /> {t("Undo")} <Kbd className="hidden sm:inline-flex">Z</Kbd>
        </button>
      )}
      {toast.countdown && (
        <motion.span
          className="absolute bottom-0 left-0 h-[2px] bg-accent"
          initial={{ width: "100%" }}
          animate={{ width: "0%" }}
          transition={{ duration: toast.duration / 1000, ease: "linear" }}
        />
      )}
    </motion.div>
  );
}

/** Undo the newest undoable toast — bound to Z. */
export function undoLatest() {
  const { toasts, dismissToast } = useMail.getState();
  const t = [...toasts].reverse().find((x) => x.undo);
  if (!t) return false;
  t.undo?.();
  dismissToast(t.id);
  return true;
}
