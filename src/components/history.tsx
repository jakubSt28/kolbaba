"use client";

import {
  Archive,
  ArchiveRestore,
  Ban,
  Bell,
  BellOff,
  Clock,
  FolderInput,
  History,
  Inbox,
  LoaderCircle,
  Pin,
  PinOff,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { intlLocale, t, tn } from "@/lib/i18n";
import { api, LIVE } from "@/lib/live";
import { useMail } from "@/lib/store";
import type { HistoryEntry, HistoryKind } from "@/lib/types";
import { useNow } from "@/lib/use-now";
import { cn, dateGroup } from "@/lib/utils";

const ICONS: Record<HistoryKind, LucideIcon> = {
  archived: Archive,
  deleted: Trash2,
  spam: ShieldAlert,
  inbox: Inbox,
  restored: ArchiveRestore,
  not_spam: ShieldCheck,
  filed: FolderInput,
  snoozed: Clock,
  unsnoozed: Inbox,
  pinned: Pin,
  unpinned: PinOff,
  deleted_forever: Trash2,
  emptied: Trash2,
  muted: BellOff,
  unmuted: Bell,
  blocked: Ban,
};

const timeFormat = () => new Intl.DateTimeFormat(intlLocale(), { hour: "numeric", minute: "2-digit" });
const whenFormat = () => new Intl.DateTimeFormat(intlLocale(), { weekday: "short", day: "numeric", month: "numeric", hour: "numeric", minute: "2-digit" });

/** What happened, in a few words. */
function headline(e: HistoryEntry) {
  switch (e.kind) {
    case "archived":
      return t("Archived");
    case "deleted":
      return t("Moved to Trash");
    case "spam":
      return t("Moved to Spam");
    case "inbox":
      return t("Moved to Inbox");
    case "restored":
      return t("Restored to Inbox");
    case "not_spam":
      return t("Not spam · moved to Inbox");
    case "filed":
      return t("Moved to {folder}", { folder: String(e.data.folder ?? "") });
    case "snoozed":
      return t("Snoozed until {time}", { time: whenFormat().format(Number(e.data.until)) });
    case "unsnoozed":
      return t("Back in Inbox");
    case "pinned":
      return t("Pinned@@history");
    case "unpinned":
      return t("Unpinned");
    case "deleted_forever":
      return t("Deleted forever");
    case "emptied":
      return e.data.bin === "spam" ? t("Emptied Spam") : t("Emptied Trash");
    case "muted":
      return t("Muted");
    case "unmuted":
      return t("Unmuted");
    case "blocked":
      return t("Blocked {sender}", { sender: String(e.data.sender ?? "") });
  }
}

/** Which conversations: the first one's subject, and how many more. */
function detail(e: HistoryEntry) {
  if (e.kind === "emptied") return tn(e.count, "{n} conversation", "{n} conversations");
  if (e.kind === "blocked") return e.count ? tn(e.count, "{n} conversation moved to Trash", "{n} conversations moved to Trash") : t("Their next emails go to Trash");
  const subject = e.subject || t("(no subject)");
  return e.count > 1 ? tn(e.count - 1, "{subject} and {n} more", "{subject} and {n} more", { subject }) : subject;
}

/**
 * My history: what you did to your mail in the last 30 days, with Undo. (Agents' steps are on the
 * other tab.)
 */
export function HistoryView({ column }: { column: string }) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(LIVE ? null : []);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const now = useNow();

  useEffect(() => {
    if (!LIVE) return;
    let live = true;
    void api.get<{ entries: HistoryEntry[]; next: string | null }>("/api/history").then(
      (r) => {
        if (!live) return;
        setEntries(r.entries);
        setNext(r.next);
      },
      () => live && setEntries([]),
    );
    return () => {
      live = false;
    };
  }, []);

  const more = async () => {
    if (!next) return;
    setLoadingMore(true);
    try {
      const r = await api.get<{ entries: HistoryEntry[]; next: string | null }>(`/api/history?before=${encodeURIComponent(next)}`);
      setEntries((list) => [...(list ?? []), ...r.entries]);
      setNext(r.next);
    } finally {
      setLoadingMore(false);
    }
  };

  const days = useMemo(() => {
    const out: { label: string; items: HistoryEntry[] }[] = [];
    for (const e of entries ?? []) {
      const label = dateGroup(e.at, now);
      const day = out.find((d) => d.label === label);
      if (day) day.items.push(e);
      else out.push({ label, items: [e] });
    }
    return out;
  }, [entries, now]);

  if (entries === null) {
    return (
      <div className="flex justify-center py-16 text-ink-3">
        <LoaderCircle size={18} className="animate-spin" />
      </div>
    );
  }
  if (!entries.length) {
    return (
      <div className={cn(column, "flex flex-col items-center gap-2 py-16 text-center")}>
        <History size={24} className="text-ink-3" />
        <div className="text-[15px] font-semibold">{t("Nothing here yet.")}</div>
        <p className="max-w-[340px] text-[13px] leading-relaxed text-ink-3">
          {t("What you archive, delete, move, snooze or pin shows up here for 30 days, and you can undo it.")}
        </p>
      </div>
    );
  }
  return (
    <div className={cn(column, "pb-16")}>
      {days.map((day) => (
        <section key={day.label} className="mt-5">
          <div className="mb-2 px-1 text-[12px] font-medium text-ink-3">{t(day.label)}</div>
          <div className="divide-y divide-line overflow-hidden rounded-2xl bg-solid shadow-[var(--shadow-panel)]">
            {day.items.map((e) => (
              <HistoryRow key={e.id} entry={e} onUndone={() => setEntries((list) => list?.map((x) => (x.id === e.id ? { ...x, undone: true, undoable: false } : x)) ?? null)} />
            ))}
          </div>
        </section>
      ))}
      {next && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={() => void more()}
            disabled={loadingMore}
            className="flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-medium text-ink-2 shadow-[inset_0_0_0_0.5px_var(--line)] hover:bg-hover disabled:opacity-60"
          >
            {loadingMore && <LoaderCircle size={13} className="animate-spin" />}
            {t("Show older")}
          </button>
        </div>
      )}
    </div>
  );
}

function HistoryRow({ entry: e, onUndone }: { entry: HistoryEntry; onUndone: () => void }) {
  const [busy, setBusy] = useState(false);
  const Icon = ICONS[e.kind];
  const undo = async () => {
    setBusy(true);
    try {
      const { failed } = await api.post<{ failed: string[] }>(`/api/history/${e.id}/undo`);
      onUndone();
      const { pushToast, refresh } = useMail.getState();
      pushToast({ message: failed.length ? t("Couldn't update {failed} of {total}. Try again.", { failed: failed.length, total: e.count }) : t("Undone") });
      void refresh().catch(() => {});
    } catch (err) {
      useMail.getState().pushToast({ message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", e.kind === "deleted_forever" || e.kind === "emptied" ? "bg-danger/10 text-danger" : "bg-hover text-ink-2")}>
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-[13.5px] font-medium", e.undone && "text-ink-3 line-through decoration-ink-3/50")}>{headline(e)}</div>
        <div className="truncate text-[12.5px] text-ink-3">{detail(e)}</div>
      </div>
      <span className="shrink-0 text-[12px] text-ink-3 tabular-nums">{timeFormat().format(e.at)}</span>
      {e.undone ? (
        <span className="w-[72px] shrink-0 text-right text-[12px] text-ink-3">{t("Undone")}</span>
      ) : e.undoable ? (
        <button
          onClick={() => void undo()}
          disabled={busy}
          className="flex h-8 w-[72px] shrink-0 items-center justify-center gap-1 rounded-[10px] text-[12.5px] font-medium text-accent-text transition-colors hover:bg-hover disabled:opacity-60"
        >
          {busy ? <LoaderCircle size={13} className="animate-spin" /> : <Undo2 size={13} />}
          {t("Undo")}
        </button>
      ) : (
        <span className="w-[72px] shrink-0" />
      )}
    </div>
  );
}
