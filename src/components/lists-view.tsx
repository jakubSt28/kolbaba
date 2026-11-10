"use client";

import { Check, Newspaper, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { t, tn } from "@/lib/i18n";
import { api, LIVE } from "@/lib/live";
import { lastMessage, useMail } from "@/lib/store";
import type { MailingList, Thread } from "@/lib/types";
import { track } from "@/lib/usage";
import { cn, formatListTime, personName } from "@/lib/utils";
import { confirmChoice } from "./confirm";
import { Avatar, hueStyle, Segmented, spring } from "./ui";

/**
 * Newsletters: everyone who sent newsletters in the last three months, by how much they send and how
 * little of it gets read. Pick a few (or "the ones you never read") and leave them all at once, with
 * what they already sent archived or deleted. A sender that can't be left in one click is blocked
 * instead, so its mail stops reaching Inbox either way.
 */

type Sort = "most" | "unread";

/** Rarely read: at least three emails and at most a fifth of them opened. */
const rarelyRead = (l: MailingList) => !l.unsubscribedAt && l.total >= 3 && l.read / l.total <= 0.2;

/** The prototype has no server: the same picture from the mail it has. */
function fromThreads(threads: Record<string, Thread>, mine: Set<string>): MailingList[] {
  const by = new Map<string, MailingList>();
  const now = Date.now();
  for (const th of Object.values(threads)) {
    if (th.kind !== "newsletter" || th.folder === "spam") continue;
    for (const m of th.messages) {
      const email = m.from.email.toLowerCase();
      if (mine.has(email) || now - m.date > 90 * 86_400_000) continue;
      const l = by.get(email) ?? {
        email,
        name: personName(m.from),
        logo: th.logo ?? null,
        total: 0,
        recent: 0,
        read: 0,
        lastAt: 0,
        lastSubject: "",
        inInbox: 0,
        unsubscribeThreadId: null,
        unsubscribedAt: th.unsubscribedAt ?? null,
        latestThreadId: th.id,
      };
      l.total++;
      if (now - m.date < 30 * 86_400_000) l.recent++;
      if (!th.unread) l.read++;
      if (m.date > l.lastAt) {
        l.lastAt = m.date;
        l.lastSubject = th.subject;
        l.latestThreadId = th.id;
        if (th.listUnsubscribe !== null) l.unsubscribeThreadId = th.id;
      }
      by.set(email, l);
    }
    const sender = lastMessage(th)?.from.email.toLowerCase();
    if (sender && th.folder === "inbox" && by.get(sender)) by.get(sender)!.inInbox++;
  }
  return [...by.values()].sort((a, b) => b.recent - a.recent || b.total - a.total);
}

export function ListsView({ mobile = false }: { mobile?: boolean }) {
  const threads = useMail((s) => s.threads);
  const accounts = useMail((s) => s.accounts);
  const query = useMail((s) => s.query);
  const pushToast = useMail((s) => s.pushToast);
  const [remote, setRemote] = useState<MailingList[] | null>(null);
  /** Lists left here, until the next visit asks the server again. */
  const [left, setLeft] = useState<Record<string, { at: number; cleaned: boolean }>>({});
  const [sort, setSort] = useState<Sort>("most");
  const [picked, setPicked] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const mine = useMemo(() => new Set(accounts.map((a) => a.email.toLowerCase())), [accounts]);

  useEffect(() => {
    track("lists");
    if (!LIVE) return;
    let live = true;
    api.get<MailingList[]>("/api/lists").then(
      (r) => live && setRemote(r),
      (err: Error) => {
        if (!live) return;
        setRemote([]);
        pushToast({ message: err.message });
      },
    );
    return () => {
      live = false;
    };
  }, [pushToast]);
  // The prototype's picture comes from its own mail.
  const mock = useMemo(() => (LIVE ? null : fromThreads(threads, mine)), [threads, mine]);
  const lists = useMemo(
    () => (LIVE ? remote : mock)?.map((l) => (left[l.email] ? { ...l, unsubscribedAt: left[l.email].at, inInbox: left[l.email].cleaned ? 0 : l.inInbox } : l)) ?? null,
    [remote, mock, left],
  );

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    const all = (lists ?? []).filter((l) => !q || `${l.name} ${l.email}`.toLowerCase().includes(q));
    // Already left: at the end, out of the way.
    const rank = (l: MailingList) => (l.unsubscribedAt ? 1 : 0);
    return sort === "most"
      ? [...all].sort((a, b) => rank(a) - rank(b) || b.recent - a.recent || b.total - a.total)
      : [...all].sort((a, b) => rank(a) - rank(b) || a.read / a.total - b.read / b.total || b.total - a.total);
  }, [lists, q, sort]);
  const suggested = (lists ?? []).filter(rarelyRead);

  const toggle = (email: string) => setPicked((p) => (p.includes(email) ? p.filter((e) => e !== email) : [...p, email]));

  const leave = (to: "keep" | "archive" | "trash") => {
    const targets = (lists ?? []).filter((l) => picked.includes(l.email));
    void (async () => {
      track("bulkUnsubscribe");
      setProgress({ done: 0, total: targets.length });
      const undo: string[] = [];
      let left = 0;
      let blocked = 0;
      let moved = 0;
      for (const [i, l] of targets.entries()) {
        try {
          if (!LIVE) {
            // The prototype just pretends.
          } else if (l.unsubscribeThreadId) {
            await api.post(`/api/threads/${encodeURIComponent(l.unsubscribeThreadId)}/unsubscribe`);
            left++;
          } else {
            // No way to leave in one click: blocked instead, so it stops reaching Inbox.
            await api.post("/api/senders", { email: l.email, name: l.name, block: "address" });
            blocked++;
          }
          if (LIVE && to !== "keep") {
            const res = await api.post<{ threads: string[]; historyId: string | null }>("/api/senders/cleanup", { email: l.email, to });
            moved += res.threads.length;
            if (res.historyId) undo.push(res.historyId);
          }
          setLeft((all) => ({ ...all, [l.email]: { at: Date.now(), cleaned: to !== "keep" } }));
        } catch (err) {
          pushToast({ message: t("{name}: {error}", { name: l.name || l.email, error: (err as Error).message }) });
        }
        setProgress({ done: i + 1, total: targets.length });
      }
      if (left) useMail.getState().countStamp("unsubscribed", left);
      setProgress(null);
      setPicked([]);
      const parts = [
        left ? tn(left, "Left {n} newsletter", "Left {n} newsletters") : "",
        blocked ? tn(blocked, "blocked {n}", "blocked {n}") : "",
        moved ? (to === "archive" ? tn(moved, "{n} conversation archived", "{n} conversations archived") : tn(moved, "{n} conversation deleted", "{n} conversations deleted")) : "",
      ].filter(Boolean);
      pushToast({
        message: parts.join(" · ") || t("Done"),
        sig: "snip",
        duration: 7000,
        undo: undo.length
          ? async () => {
              for (const id of undo) await api.post(`/api/history/${id}/undo`).catch(() => {});
              pushToast({ message: t("The mail is back. Leaving the lists can't be taken back.") });
              void useMail.getState().refresh();
            }
          : undefined,
      });
      void useMail.getState().refresh();
    })();
  };

  const ask = () => {
    const targets = (lists ?? []).filter((l) => picked.includes(l.email));
    const noWay = targets.filter((l) => !l.unsubscribeThreadId).length;
    const inbox = targets.reduce((n, l) => n + l.inInbox, 0);
    confirmChoice({
      title: tn(targets.length, "Leave {n} newsletter?", "Leave {n} newsletters?"),
      message: [
        t("Kolbaba asks each of them to stop sending you mail."),
        noWay ? tn(noWay, "{n} of them can't be left that way, so it gets blocked: its mail goes to Trash.", "{n} of them can't be left that way, so they get blocked: their mail goes to Trash.") : "",
        inbox ? tn(inbox, "What about the {n} email from them in your Inbox?", "What about the {n} emails from them in your Inbox?") : t("What about the mail they already sent?"),
      ]
        .filter(Boolean)
        .join(" "),
      choices: [
        { label: t("Leave and archive their mail"), run: () => leave("archive"), tone: "accent" },
        { label: t("Leave and delete their mail"), run: () => leave("trash") },
        { label: t("Just leave"), run: () => leave("keep") },
      ],
      cancelLabel: t("Cancel"),
    });
  };

  if (!lists) {
    return (
      <div className="flex flex-col gap-2 px-2 pt-2" aria-busy>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[58px] animate-pulse rounded-[12px] bg-hover" />
        ))}
      </div>
    );
  }

  if (!lists.length) {
    return (
      <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 px-6 text-center">
        <span className="hue-tint flex size-11 items-center justify-center rounded-full" style={hueStyle(28)}>
          <Newspaper size={20} />
        </span>
        <div className="text-[15px] font-semibold">{t("No newsletters")}</div>
        <div className="max-w-[300px] text-[13px] text-ink-3">{t("Nobody sent you newsletters in the last three months. Lucky you.")}</div>
      </div>
    );
  }

  return (
    <div className={cn("relative flex min-h-full flex-col pb-3", mobile && "px-2.5")}>
      {/* What's here at a glance, and the obvious first step. */}
      <div className={cn("mb-3 flex items-center gap-3 rounded-[14px] bg-solid px-3.5 py-3 shadow-[var(--shadow-panel)]", !mobile && "mx-0.5 mt-1")}>
        <span className="hue-tint flex size-9 shrink-0 items-center justify-center rounded-full" style={hueStyle(28)}>
          <Newspaper size={17} />
        </span>
        <div className="min-w-0 flex-1 text-[13px] leading-snug">
          <div className="font-medium text-ink">{tn(lists.length, "{n} sender of newsletters in 3 months", "{n} senders of newsletters in 3 months")}</div>
          <div className="text-ink-3">
            {suggested.length ? tn(suggested.length, "You hardly ever read {n} of them.", "You hardly ever read {n} of them.") : t("You read most of what they send.")}
          </div>
        </div>
        {suggested.length > 0 && (
          <button
            onClick={() => setPicked((p) => [...new Set([...p, ...suggested.map((l) => l.email)])])}
            className="press shrink-0 rounded-full bg-accent-soft px-3 py-1.5 text-[12.5px] font-medium text-accent-text [--press-scale:0.95] hover:bg-accent hover:text-on-accent"
          >
            {tn(suggested.length, "Select {n}", "Select {n}")}
          </button>
        )}
      </div>

      <div className={cn("mb-1.5 flex items-center justify-between gap-2", !mobile && "px-1")}>
        <span className="text-[11px] font-medium text-ink-3">{sort === "most" ? t("Who sends the most") : t("What you read least")}</span>
        <div className="w-[220px]">
          <Segmented
            id={`lists-sort-${mobile}`}
            value={sort}
            full
            options={[
              { value: "most", label: t("Most mail") },
              { value: "unread", label: t("Least read") },
            ]}
            onChange={setSort}
          />
        </div>
      </div>

      <div className={cn(mobile && "overflow-hidden rounded-[20px] bg-solid shadow-[var(--shadow-panel)]")}>
        {shown.map((l, i) => (
          <ListRow key={l.email} list={l} picked={picked.includes(l.email)} onToggle={() => toggle(l.email)} mobile={mobile} first={i === 0} />
        ))}
      </div>

      <AnimatePresence>
        {(picked.length > 0 || progress) && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97, transition: { duration: 0.15 } }}
            transition={spring}
            // At the bottom of the view however short the list is (mt-auto), and stuck there while it scrolls. On a
            // phone just above the search bar: pinned to the screen, since the list's bottom padding would lift a sticky bar.
            className={cn(
              "pointer-events-none z-20 flex justify-center px-3",
              mobile ? "fixed inset-x-0 bottom-[calc(max(14px,var(--safe-bottom))+62px)]" : "sticky bottom-0 mt-auto pt-4",
            )}
          >
            <div className="pointer-events-auto relative flex items-center gap-1 overflow-hidden rounded-full bg-accent py-1 pr-1 pl-4 text-[13px] text-on-accent shadow-[var(--shadow-float)]">
              {progress ? (
                <>
                  <span className="py-1.5 pr-3 font-medium tabular-nums">{t("Leaving {done} of {total}…", { done: progress.done, total: progress.total })}</span>
                  <motion.span className="absolute bottom-0 left-0 h-[3px] bg-on-accent/60" animate={{ width: `${(progress.done / progress.total) * 100}%` }} transition={spring} />
                </>
              ) : (
                <>
                  <span className="mr-1 font-medium tabular-nums">{t("{n} selected", { n: picked.length })}</span>
                  <button onClick={ask} className="press rounded-full bg-on-accent px-3.5 py-1.5 text-[13px] font-semibold text-accent-text [--press-scale:0.95]">
                    {t("Unsubscribe")}
                  </button>
                  <button onClick={() => setPicked([])} aria-label={t("Clear selection")} className="flex size-8 items-center justify-center rounded-full text-on-accent/80 hover:bg-on-accent/15 hover:text-on-accent">
                    <X size={15} />
                  </button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ListRow({ list: l, picked, onToggle, mobile, first }: { list: MailingList; picked: boolean; onToggle: () => void; mobile: boolean; first: boolean }) {
  const openThreadById = useMail((s) => s.openThreadById);
  const share = l.total ? Math.round((l.read / l.total) * 100) : 0;
  const gone = !!l.unsubscribedAt;
  return (
    <div
      role="checkbox"
      aria-checked={picked}
      tabIndex={0}
      onClick={() => !gone && onToggle()}
      onKeyDown={(e) => (e.key === " " || e.key === "Enter") && !gone && (e.preventDefault(), onToggle())}
      className={cn(
        "group relative flex items-center gap-3 px-2.5 py-2.5 transition-colors outline-none",
        mobile ? cn("px-4", !first && "border-t border-line") : "rounded-[12px]",
        gone ? "opacity-55" : picked ? "bg-accent-soft" : "cursor-pointer hover:bg-hover focus-visible:bg-hover",
      )}
    >
      <span
        className={cn(
          "flex size-[22px] shrink-0 items-center justify-center rounded-full transition-[background-color,box-shadow] duration-150",
          gone ? "invisible" : picked ? "bg-accent text-on-accent" : "text-ink-3/60 shadow-[inset_0_0_0_1.5px_currentColor]",
        )}
        aria-hidden
      >
        {picked && <Check size={13} strokeWidth={3} />}
      </span>
      <Avatar person={{ name: l.name, email: l.email }} logo={l.logo ?? undefined} size={34} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate text-[13.5px] font-medium text-ink">{l.name || l.email}</span>
          {gone && (
            <span className="shrink-0 rounded-full bg-hover px-1.5 py-px text-[11px] font-medium text-ink-3">{t("Left {when}", { when: formatListTime(l.unsubscribedAt!) })}</span>
          )}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            void openThreadById(l.latestThreadId);
          }}
          className="block max-w-full truncate text-left text-[12.5px] text-ink-3 hover:text-ink hover:underline"
        >
          {l.lastSubject || l.email}
        </button>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 whitespace-nowrap">
        <span className="text-[12px] text-ink-2 tabular-nums">{l.recent ? tn(l.recent, "{n} a month", "{n} a month") : tn(l.total, "{n} in 3 months", "{n} in 3 months")}</span>
        <span className="flex items-center gap-1.5 text-[11px] text-ink-3 tabular-nums">
          {/* How much of it gets read: an empty bar is the story. */}
          <span className="relative h-[4px] w-9 overflow-hidden rounded-full bg-hover" aria-hidden>
            <span className={cn("absolute inset-y-0 left-0 rounded-full", share <= 20 ? "bg-danger/60" : "bg-success/70")} style={{ width: `${Math.max(share, 4)}%` }} />
          </span>
          {t("read {share} %", { share })}
        </span>
      </div>
    </div>
  );
}
