"use client";

import { Bell, X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { t } from "@/lib/i18n";
import { installOffer, onInstallChange } from "@/lib/install";
import { LIVE } from "@/lib/live";
import { pushState, usePush } from "@/lib/push-client";
import { useMail } from "@/lib/store";
import { cn } from "@/lib/utils";
import { putOff, turnOnNotifications } from "./install-guide";
import { spring } from "./ui";

/**
 * Onboarding is three moments, each a single tap and each only when it applies: connect a mailbox (the
 * welcome), on a phone put Kolbaba on the Home Screen (InstallBanner), and then this one: notifications
 * on this device. No tour, no steps to click through. "×" puts it away for good on this device; Settings
 * → Notifications has the same switch, and turning them on there puts this away too.
 */

const KEY = "kolbaba:notify-offer";

function dismissed() {
  try {
    return localStorage.getItem(KEY) === "no";
  } catch {
    return false;
  }
}

export function NotifyBanner({ mobile = false }: { mobile?: boolean }) {
  const hasMailbox = useMail((s) => s.accounts.length > 0);
  const pushToast = useMail((s) => s.pushToast);
  const offer = useSyncExternalStore(onInstallChange, installOffer, () => null);
  const [gone, setGone] = useState(dismissed);
  const state = usePush((s) => s.state) ?? (LIVE ? null : "off");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (LIVE && hasMailbox && !gone) void pushState();
  }, [hasMailbox, gone]);
  // Adding the icon comes first on a phone: an iPhone only notifies from the Home Screen app.
  const installFirst = !!offer && !putOff(offer);
  if (!hasMailbox || gone || state !== "off" || installFirst) return null;

  const hide = () => {
    setGone(true);
    try {
      localStorage.setItem(KEY, "no");
    } catch {
      // No storage: it's offered again next time.
    }
  };
  const turnOn = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Refused before: the steps to allow them open instead.
      const next = LIVE ? await turnOnNotifications() : "on";
      if (!LIVE) usePush.setState({ state: next });
      if (next === "on") pushToast({ message: t("Notifications are on. Who may notify you is in Settings → Notifications.") });
    } catch {
      pushToast({ message: t("Couldn't turn on notifications. Try again.") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      className={cn("flex items-center rounded-[14px] bg-accent-soft", mobile ? "mx-2.5 mb-2 rounded-[18px]" : "mt-1 mb-1")}
    >
      <button onClick={() => void turnOn()} disabled={busy} className={cn("flex min-w-0 flex-1 items-center gap-3 pl-3.5 text-left", mobile ? "py-3" : "py-2.5")}>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/60 text-accent-text dark:bg-white/10">
          <Bell size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-ink">{t("Wanna know when mail comes?")}</span>
          <span className="block text-[12px] leading-snug text-ink-3">{t("You choose later who may interrupt you.")}</span>
        </span>
        <span className="shrink-0 rounded-full bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-on-accent">{t("Turn on")}</span>
      </button>
      <button onClick={hide} aria-label={t("Not now")} className="ml-1 flex size-9 shrink-0 items-center justify-center rounded-full text-ink-3 hover:text-ink mr-1.5">
        <X size={15} />
      </button>
    </motion.div>
  );
}
