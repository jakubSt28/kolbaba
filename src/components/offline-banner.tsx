"use client";

import { RefreshCw, WifiOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useSyncExternalStore } from "react";
import { t, tn } from "@/lib/i18n";
import { useMail } from "@/lib/store";
import { cn } from "@/lib/utils";
import { spring } from "./ui";

const subscribe = (fn: () => void) => {
  window.addEventListener("online", fn);
  window.addEventListener("offline", fn);
  return () => {
    window.removeEventListener("online", fn);
    window.removeEventListener("offline", fn);
  };
};

/**
 * Emails written without a signal: what's waiting, at the top of every list, until it's gone. It goes
 * on its own once there's a signal again (with the app open: iPhone web apps can't send in the background).
 */
export function OfflineBanner({ mobile = false }: { mobile?: boolean }) {
  const queue = useMail((s) => s.offline);
  const flush = useMail((s) => s.flushOffline);
  const unqueue = useMail((s) => s.unqueueOffline);
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  const first = queue[0];
  return (
    <AnimatePresence initial={false}>
      {first && (
        <motion.div
          key="offline"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={spring}
          className="overflow-hidden"
        >
          <div className={cn("mb-2 flex items-center gap-2.5 rounded-[12px] bg-hover px-3 py-2 text-[12.5px] text-ink", mobile ? "mx-2.5" : "mx-0.5")}>
            <WifiOff size={15} className="shrink-0 text-ink-2" />
            <span className="min-w-0 flex-1">
              <span className="font-medium">
                {queue.length > 1 ? tn(queue.length, "{n} email waits for a signal", "{n} emails wait for a signal") : t("“{subject}” waits for a signal", { subject: first.draft.subject || t("(no subject)") })}
              </span>
              <span className="block text-ink-3">{online ? t("Sending it now…") : t("It goes out on its own as soon as there's one.")}</span>
            </span>
            {online ? (
              <button onClick={() => void flush()} aria-label={t("Send now")} className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-selected">
                <RefreshCw size={14} />
              </button>
            ) : (
              <button onClick={() => unqueue(first.draft.id)} className="shrink-0 rounded-full px-2 py-1 font-medium text-accent-text hover:bg-selected">
                {t("Edit")}
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
