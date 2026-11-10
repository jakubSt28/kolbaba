"use client";

import { Check, ChevronRight, UserRoundPlus, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { t, tn } from "@/lib/i18n";
import { inFolder, useMail } from "@/lib/store";
import type { Person, Thread } from "@/lib/types";
import { cn, formatListTime } from "@/lib/utils";
import { Group, Row, Toggle } from "./settings";
import { ScreenerPreview } from "./settings-previews";
import { Avatar, spring } from "./ui";

/** Who a waiting conversation is from: its first message's sender. */
const senderOf = (thread: Thread): Person => thread.messages[0]?.from ?? { name: "", email: "" };

/** Waiting conversations in the current mailbox, one group per sender. */
function useWaiting() {
  const threads = useMail(useShallow((s) => Object.values(s.threads).filter((t) => (s.scope === "all" || t.accountId === s.scope) && inFolder(t, "screener"))));
  return useMemo(() => {
    const groups = new Map<string, { sender: Person; threads: Thread[] }>();
    // A sorted copy: useShallow compares the next answer with this very array, so sorting it in place
    // made every answer look new and re-rendered without end (whenever the newest wasn't first already).
    for (const th of [...threads].sort((a, b) => (b.messages.at(-1)?.date ?? 0) - (a.messages.at(-1)?.date ?? 0))) {
      const sender = senderOf(th);
      const key = sender.email.toLowerCase();
      const g = groups.get(key) ?? { sender, threads: [] };
      g.threads.push(th);
      groups.set(key, g);
    }
    return [...groups.values()];
  }, [threads]);
}

/** At the top of Inbox: new senders are waiting (a tap opens them). */
export function ScreenerBanner({ mobile = false }: { mobile?: boolean }) {
  const on = useMail((s) => s.screener);
  const folder = useMail((s) => s.folder);
  const setFolder = useMail((s) => s.setFolder);
  const waiting = useWaiting();
  if (!on || folder !== "inbox" || !waiting.length) return null;
  const names = waiting
    .slice(0, 3)
    .map((g) => g.sender.name || g.sender.email)
    .join(", ");
  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      onClick={() => setFolder("screener")}
      className={cn(
        "flex w-full items-center gap-3 rounded-[14px] bg-accent-soft px-3.5 py-2.5 text-left transition-colors hover:bg-accent-soft/80",
        mobile ? "mx-2.5 mb-2 w-[calc(100%-20px)] rounded-[18px] py-3" : "mt-1 mb-1",
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/60 text-accent-text dark:bg-white/10">
        <UserRoundPlus size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-ink">{tn(waiting.length, "{n} new sender is waiting", "{n} new senders are waiting")}</span>
        <span className="block truncate text-[12px] text-ink-3">{names}</span>
      </span>
      <ChevronRight size={16} className="shrink-0 text-ink-3" />
    </motion.button>
  );
}

/** The screener: one row per new sender, with what they sent and Yes / No. */
export function ScreenerList({ mobile = false }: { mobile?: boolean }) {
  const waiting = useWaiting();
  const openThread = useMail((s) => s.openThread);
  const screenSender = useMail((s) => s.screenSender);
  const on = useMail((s) => s.screener);
  const setScreener = useMail((s) => s.setScreener);

  if (!on) {
    return (
      <div className="mx-auto flex max-w-[320px] flex-col items-center gap-3 px-4 pt-16 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-accent-soft text-accent-text">
          <UserRoundPlus size={20} />
        </span>
        <div className="text-[15px] font-semibold">{t("Decide who can reach your Inbox")}</div>
        <p className="text-[13px] leading-relaxed text-ink-3">{t("The first email from someone new waits here for a yes or no, without a notification. People you've written with pass.")}</p>
        <button onClick={() => setScreener(true)} className="h-9 rounded-full bg-accent px-4 text-[13px] font-medium text-on-accent hover:bg-accent-hover">
          {t("Turn on")}
        </button>
      </div>
    );
  }
  if (!waiting.length) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 pt-20 text-center">
        <UserRoundPlus size={26} className="text-ink-3" />
        <div className="text-[15px] font-semibold">{t("Nobody new is waiting")}</div>
        <p className="text-[13px] text-ink-3">{t("The first email from someone new shows up here.")}</p>
      </div>
    );
  }
  return (
    <div className={cn("flex flex-col gap-1.5 pt-1", mobile && "px-2.5")}>
      <p className={cn("px-2 pt-1 pb-1 text-[12px] leading-relaxed text-ink-3", mobile && "px-3")}>{t("Yes: their mail goes to Inbox from now on. No: it goes to Archive, nothing is deleted.")}</p>
      <AnimatePresence initial={false} mode="popLayout">
        {waiting.map(({ sender, threads }) => (
          <motion.div
            key={sender.email}
            layout
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={spring}
            className="rounded-[14px] bg-solid/60 p-3 shadow-[inset_0_0_0_0.5px_var(--line)]"
          >
            <div className="flex items-center gap-3">
              <Avatar person={sender} logo={threads[0].logo} size={36} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold">{sender.name || sender.email}</div>
                {sender.name && <div className="truncate text-[12px] text-ink-3">{sender.email}</div>}
              </div>
            </div>
            <div className="mt-2 flex flex-col gap-0.5 pl-12">
              {threads.slice(0, 3).map((th) => (
                <button key={th.id} onClick={() => openThread(th.id)} className="-mx-1.5 flex items-baseline gap-2 rounded-md px-1.5 py-0.5 text-left hover:bg-hover">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{th.subject}</span>
                  <span className="shrink-0 text-[11.5px] text-ink-3">{formatListTime(th.messages.at(-1)?.date ?? 0)}</span>
                </button>
              ))}
              {threads.length > 3 && <span className="text-[12px] text-ink-3">{tn(threads.length - 3, "and {n} more", "and {n} more")}</span>}
            </div>
            <ScreenButtons sender={sender} onPick={(status) => screenSender(sender, status)} className="mt-2.5 pl-12" />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function ScreenButtons({ sender, onPick, className }: { sender: Person; onPick: (status: "allowed" | "blocked") => void; className?: string }) {
  return (
    <div className={cn("flex gap-1.5", className)}>
      <button
        onClick={() => onPick("allowed")}
        className="flex h-8 items-center gap-1.5 rounded-full bg-accent px-3.5 text-[12.5px] font-medium text-on-accent hover:bg-accent-hover"
        aria-label={t("Yes, let {name} in", { name: sender.name || sender.email })}
      >
        <Check size={13} strokeWidth={2.4} /> {t("Yes")}
      </button>
      <button
        onClick={() => onPick("blocked")}
        className="flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-medium text-ink shadow-[inset_0_0_0_0.5px_var(--line)] hover:bg-selected"
        aria-label={t("No, archive mail from {name}", { name: sender.name || sender.email })}
      >
        <X size={13} strokeWidth={2.4} /> {t("No")}
      </button>
    </div>
  );
}

/** In the reader, for a waiting conversation: the same question. */
export function ScreenerReaderBanner({ thread }: { thread: Thread }) {
  const screenSender = useMail((s) => s.screenSender);
  if (!thread.screening) return null;
  const sender = senderOf(thread);
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-accent-soft px-3.5 py-2.5 text-[13px]">
      <UserRoundPlus size={16} className="shrink-0 text-accent-text" />
      <span className="min-w-0 flex-1 text-ink">{t("First email from {name}. Do you want their mail in Inbox?", { name: sender.name || sender.email })}</span>
      <ScreenButtons sender={sender} onPick={(status) => screenSender(sender, status)} />
    </div>
  );
}

/** Settings → Mail: the screener switch, and the senders said no to (with a way back). */
export function ScreenerSettings() {
  const on = useMail((s) => s.screener);
  const setScreener = useMail((s) => s.setScreener);
  return (
    // Who was turned away is listed in Mail → Blocked senders, with everyone blocked from an email.
    <Group footer={on ? t("Senders you say no to are listed in Mail → Blocked senders.") : undefined}>
      <Row
        label={t("Screener")}
        hint={t("New senders wait for your yes or no")}
        info={t("The first email from someone new waits for your yes or no, without a notification")}
        preview={<ScreenerPreview />}
      >
        <Toggle on={on} label={t("Screener")} onChange={setScreener} />
      </Row>
    </Group>
  );
}
