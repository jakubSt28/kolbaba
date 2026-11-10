"use client";

import { LoaderCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useShallow } from "zustand/react/shallow";
import { isCategoryView } from "@/lib/insights";
import { t, tn } from "@/lib/i18n";
import { LIVE } from "@/lib/live";
import { useMail } from "@/lib/store";
import type { FolderId } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Kolbaba } from "./kolbaba";
import { spring } from "./ui";

/**
 * Mailboxes in view whose first import is still running: the last 90 days of every folder, Spam
 * included, which can take minutes. The older history after it doesn't count, the mailbox is usable by then.
 * Their status is re-read every 15 seconds meanwhile (mail-app.tsx), so the notices go on their own.
 */
export function useSyncingMailboxes(): string[] {
  return useMail(useShallow((s) => (LIVE ? s.accounts.filter((a) => a.status === "syncing" && (s.scope === "all" || a.id === s.scope)).map((a) => a.name) : [])));
}

/** Folders a first import fills. In the others (Snoozed, Scheduled, views that aren't a list of mail) empty means empty. */
const fillsUp = (folder: FolderId) =>
  folder !== "snoozed" && folder !== "scheduled" && folder !== "files" && folder !== "contacts" && folder !== "lists" && folder !== "screener" && !isCategoryView(folder);

/** The list is empty only because a first import is still running: say so instead of "Inbox zero". */
export function useSyncingEmpty(empty: boolean): boolean {
  const syncing = useSyncingMailboxes().length > 0;
  const folder = useMail((s) => s.folder);
  const query = useMail((s) => s.query);
  return syncing && empty && !query && fillsUp(folder);
}

/** What's still syncing, in a few words: which mailbox, when others in view are ready already. */
function useSyncTitle(): string | null {
  const syncing = useSyncingMailboxes();
  const othersReady = useMail((s) => s.scope === "all" && s.accounts.length > syncing.length);
  if (!syncing.length) return null;
  if (syncing.length > 1) return tn(syncing.length, "{n} mailbox is still syncing", "{n} mailboxes are still syncing");
  return othersReady ? t("{name} is still syncing", { name: syncing[0] }) : t("Still syncing");
}

/** An empty list during a first import: the mail is on its way, not missing. */
export function SyncingState({ mobile = false }: { mobile?: boolean }) {
  const title = useSyncTitle();
  if (!title) return null;
  return (
    <motion.div
      role="status"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15, ...spring }}
      className={cn("flex flex-col items-center text-center", mobile ? "px-6 pt-20" : "h-full min-h-[280px] justify-center px-4")}
    >
      <Kolbaba size={44} mood="busy" />
      {/* The spinner sits in the line, so a name long enough to wrap the title takes it along. */}
      <div className={cn("mt-3 max-w-[320px] font-semibold tracking-[-0.01em] text-balance", mobile ? "text-[17px]" : "text-[15px]")}>
        <LoaderCircle size={mobile ? 16 : 14} className="mr-1.5 inline-block animate-spin align-[-2px] text-ink-3" aria-hidden />
        {title}
      </div>
      <div className={cn("mt-1 max-w-[320px] text-balance text-ink-3", mobile ? "text-[14px]" : "text-[13px]")}>
        {t("The first sync can take a few minutes. Mail shows up here as it comes in.")}
      </div>
    </motion.div>
  );
}

/** Mail is landing, more is on its way: at the top of the list until the first import is done. */
export function SyncBanner({ mobile = false }: { mobile?: boolean }) {
  const title = useSyncTitle();
  return (
    <AnimatePresence initial={false}>
      {title && (
        <motion.div
          key="sync"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={spring}
          className="overflow-hidden"
        >
          <div role="status" className={cn("mb-2 flex items-center gap-2.5 rounded-[12px] bg-hover px-3 py-2 text-[12.5px] text-ink", mobile ? "mx-2.5" : "mx-0.5")}>
            <LoaderCircle size={15} className="shrink-0 animate-spin text-ink-2" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="font-medium">{title}</span>
              <span className="block text-ink-3">{t("More mail is on its way. The first sync can take a few minutes.")}</span>
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
