"use client";

import { Check, Palmtree, Plus } from "lucide-react";
import { useState } from "react";
import { awayName, awayOn, awayWaiting } from "@/lib/away";
import { getLocale, intlLocale, t, tn } from "@/lib/i18n";
import { useMail } from "@/lib/store";
import type { Account, AwayReply } from "@/lib/types";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { Group, Toggle } from "./settings";
import { MailboxBadge } from "./ui";

/**
 * Settings → Mail → Out of office: replies Kolbaba sends while the user is away, in any mailbox (Gmail,
 * Seznam or any other). Several can be kept ("Holiday", "Conference"): each one on for the mailboxes
 * picked, or off and saved for next time. A mailbox answers with one reply at a time (src/lib/away.ts);
 * lists, automatic mail and the screener's waiting room get nothing (src/server/mail/away.ts).
 */

/** "2026-10-19" in local time ↔ the start (or the end) of that day, in ms. */
const toDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fromDay = (day: string, end = false) => {
  const [y, m, d] = day.split("-").map(Number);
  return end ? new Date(y, m - 1, d, 23, 59, 59, 999).getTime() : new Date(y, m - 1, d).getTime();
};

export const formatAwayDay = (ms: number) => new Date(ms).toLocaleDateString(intlLocale(), { day: "numeric", month: "long" });

/** A first draft of the reply in the user's language. */
function defaultMessage() {
  return getLocale() === "cs"
    ? "Dobrý den,\n\nteď jsem mimo kancelář a na e-maily neodpovídám. Ozvu se, jakmile to půjde.\n\nDěkuji za pochopení."
    : "Hello,\n\nI'm out of the office and not reading email. I'll get back to you as soon as I can.\n\nThank you for your patience.";
}

const newReply = (): AwayReply => ({
  id: crypto.randomUUID(),
  name: "",
  on: false,
  from: null,
  until: null,
  subject: t("Out of office"),
  message: defaultMessage(),
  accountIds: [],
  onlyKnown: false,
});

const field =
  "w-full min-w-0 rounded-[10px] bg-canvas px-3 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--line)] outline-none transition-shadow placeholder:text-ink-3/70 focus:shadow-[inset_0_0_0_1.5px_var(--accent)] md:text-[13.5px]";

export function AwaySettings() {
  const replies = useMail((s) => s.awayReplies);
  const [editing, setEditing] = useState<AwayReply | null>(null);
  return (
    <Group
      title={t("Out of office")}
      info={t("Each person gets it once every 4 days. Newsletters, automatic mail and new senders waiting in the screener get nothing.")}
      footer={t("Kolbaba answers for you while you're away, in any mailbox: Gmail, Seznam or any other. Keep several replies and turn on the one that fits.")}
    >
      {replies.map((r) =>
        editing?.id === r.id ? <AwayForm key={r.id} reply={editing} onDone={() => setEditing(null)} /> : <AwayRow key={r.id} reply={r} onEdit={() => setEditing(r)} />,
      )}
      {editing && !replies.some((r) => r.id === editing.id) ? (
        <AwayForm reply={editing} fresh onDone={() => setEditing(null)} />
      ) : (
        <button
          onClick={() => setEditing(newReply())}
          className="flex w-full items-center gap-3 px-4 py-3 text-left text-[13.5px] font-medium text-accent-text transition-colors hover:bg-hover"
        >
          <span className="flex size-7 items-center justify-center rounded-[9px] bg-hover">
            <Plus size={15} />
          </span>
          {replies.length ? t("New reply") : t("Make an out-of-office reply")}
        </button>
      )}
    </Group>
  );
}

/** Where a reply answers: "Personal, Studio". */
const mailboxNames = (reply: AwayReply, accounts: Account[]) =>
  accounts
    .filter((a) => reply.accountIds.includes(a.id))
    .map((a) => a.name)
    .join(", ");

/**
 * Turning a reply on: in the mailboxes it was picked for; none picked, in those no other reply answers in
 * (or all of them, if every one does). From today, without a date that's gone.
 */
function turnedOn(reply: AwayReply, accounts: Account[], replies: AwayReply[], now: number): AwayReply {
  const own = reply.accountIds.filter((id) => accounts.some((a) => a.id === id));
  const busy = new Set(replies.filter((r) => r.id !== reply.id && awayOn(r, now)).flatMap((r) => r.accountIds));
  const free = accounts.filter((a) => !busy.has(a.id)).map((a) => a.id);
  return {
    ...reply,
    on: true,
    accountIds: own.length ? own : free.length ? free : accounts.map((a) => a.id),
    from: reply.from && reply.from > now ? reply.from : null,
    until: reply.until && reply.until > now ? reply.until : null,
  };
}

function AwayRow({ reply, onEdit }: { reply: AwayReply; onEdit: () => void }) {
  const accounts = useMail((s) => s.accounts);
  const replies = useMail((s) => s.awayReplies);
  const saveAway = useMail((s) => s.saveAway);
  const now = useNow();
  const on = awayOn(reply, now);
  const where = accounts.length > 1 ? mailboxNames(reply, accounts) : "";
  const status = on
    ? awayWaiting(reply, now)
      ? t("Starts {date}", { date: formatAwayDay(reply.from!) })
      : reply.until
        ? t("On until {date}", { date: formatAwayDay(reply.until) })
        : t("On until you turn it off")
    : reply.on && reply.until && reply.until < now
      ? t("Ended {date}", { date: formatAwayDay(reply.until) })
      : t("Saved for next time");
  return (
    <div className="flex min-h-[52px] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-hover">
      <button onClick={onEdit} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-[9px]", on ? "bg-accent-soft text-accent-text" : "bg-hover text-ink-3")}>
          <Palmtree size={15} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13.5px] text-ink">{awayName(reply)}</span>
          <span className="block truncate text-[12px] text-ink-3">{[status, where].filter(Boolean).join(" · ")}</span>
        </span>
      </button>
      <Toggle on={on} label={awayName(reply)} onChange={(next) => void saveAway(next ? turnedOn(reply, accounts, replies, Date.now()) : { ...reply, on: false })} />
    </div>
  );
}

function AwayForm({ reply, fresh = false, onDone }: { reply: AwayReply; fresh?: boolean; onDone: () => void }) {
  const accounts = useMail((s) => s.accounts);
  const others = useMail((s) => s.awayReplies);
  const saveAway = useMail((s) => s.saveAway);
  const deleteAway = useMail((s) => s.deleteAway);
  const now = useNow();
  const [draft, setDraft] = useState(reply);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const change = (patch: Partial<AwayReply>) => {
    setError(null);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const today = toDay(now);

  const save = async (turnOn = false) => {
    if (busy) return;
    if (!draft.message.trim()) return setError(t("Write what people get back"));
    let next = turnOn ? turnedOn(draft, accounts, others, Date.now()) : draft;
    // A reply that's on and lost its last mailbox here stops answering, and stays saved.
    if (next.on && !next.accountIds.length) next = { ...next, on: false };
    setBusy(true);
    const err = await saveAway(next);
    setBusy(false);
    if (err) setError(err);
    else onDone();
  };

  /** Mailboxes another reply that's on answers in: picking one here moves it (said in a toast on save). */
  const busyElsewhere = (id: string) => others.find((r) => r.id !== draft.id && awayOn(r, now) && r.accountIds.includes(id));

  return (
    <div className="flex flex-col gap-3 bg-hover/40 px-4 py-3.5">
      <input
        value={draft.name}
        onChange={(e) => change({ name: e.target.value })}
        placeholder={t("Name, like Holiday")}
        aria-label={t("Name")}
        autoFocus={fresh}
        className={cn(field, "h-9 font-medium")}
      />
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-2 text-[13px] text-ink-3">
            {t("From")}
            <input
              type="date"
              value={draft.from ? toDay(draft.from) : ""}
              min={today}
              onChange={(e) => change({ from: e.target.value && e.target.value !== today ? fromDay(e.target.value) : null })}
              className={cn(field, "h-8 w-auto px-2.5 font-medium tabular-nums")}
            />
          </label>
          <label className="flex items-center gap-2 text-[13px] text-ink-3">
            {t("Until")}
            <input
              type="date"
              value={draft.until ? toDay(draft.until) : ""}
              min={draft.from ? toDay(draft.from) : today}
              onChange={(e) => change({ until: e.target.value ? fromDay(e.target.value, true) : null })}
              className={cn(field, "h-8 w-auto px-2.5 font-medium tabular-nums")}
            />
          </label>
        </div>
        <p className="text-[12px] text-ink-3">{t("Without dates it starts when you turn it on and runs until you turn it off.")}</p>
      </div>
      <input value={draft.subject} onChange={(e) => change({ subject: e.target.value })} placeholder={t("Subject")} aria-label={t("Subject")} className={cn(field, "h-9")} />
      <textarea value={draft.message} onChange={(e) => change({ message: e.target.value })} rows={6} aria-label={t("Message")} className={cn(field, "resize-y py-2.5 leading-relaxed")} />
      {accounts.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] text-ink-3">{t("Answers in")}</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("Answers in")}>
            {accounts.map((a) => {
              const picked = draft.accountIds.includes(a.id);
              const elsewhere = !picked ? busyElsewhere(a.id) : undefined;
              return (
                <button
                  key={a.id}
                  aria-pressed={picked}
                  title={elsewhere ? t("Answers with “{reply}” now", { reply: awayName(elsewhere) }) : undefined}
                  onClick={() => change({ accountIds: picked ? draft.accountIds.filter((id) => id !== a.id) : [...draft.accountIds, a.id] })}
                  className={cn(
                    "press flex h-7 items-center gap-1.5 rounded-full pr-2.5 pl-1 text-[12px] font-medium transition-colors [--press-scale:0.95]",
                    picked ? "bg-accent-soft text-accent-text" : "text-ink-3 shadow-[inset_0_0_0_0.5px_var(--line)] hover:bg-hover",
                  )}
                >
                  <MailboxBadge icon={a.icon} hue={a.hue} image={a.image} size={20} className={cn("rounded-full", !picked && "opacity-45 grayscale")} />
                  {a.name}
                  {picked && <Check size={12} />}
                  {elsewhere && <Palmtree size={11} className="text-ink-3" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <label className="flex items-center gap-2.5 text-[13px] text-ink select-none">
        <input type="checkbox" checked={draft.onlyKnown} onChange={(e) => change({ onlyKnown: e.target.checked })} className="size-4 accent-[var(--accent)]" />
        {t("Only to people I've written to before")}
      </label>
      {error && <p className="text-[12.5px] text-danger">{error}</p>}
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        {!fresh && (
          <button
            onClick={() => {
              deleteAway(draft.id);
              onDone();
            }}
            className="rounded-[9px] px-2.5 py-1.5 text-[13px] font-medium text-danger hover:bg-danger/10"
          >
            {t("Delete reply")}
          </button>
        )}
        <span className="flex-1" />
        <button onClick={onDone} className="rounded-[9px] px-3 py-1.5 text-[13px] font-medium text-ink-2 hover:bg-hover">
          {t("Cancel")}
        </button>
        {!draft.on && (
          <button
            onClick={() => void save(false)}
            disabled={busy}
            className="rounded-[9px] px-3 py-1.5 text-[13px] font-medium text-ink shadow-[inset_0_0_0_1px_var(--line)] hover:bg-hover disabled:opacity-50"
          >
            {t("Save for later")}
          </button>
        )}
        <button
          onClick={() => void save(!draft.on)}
          disabled={busy}
          className="press rounded-[9px] bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50 [--press-scale:0.96]"
        >
          {draft.on ? t("Save") : t("Save and turn on")}
        </button>
      </div>
    </div>
  );
}

/** While a reply is on: a quiet line at the top of Inbox, so it isn't forgotten after the holiday. */
export function AwayBanner({ mobile = false }: { mobile?: boolean }) {
  const replies = useMail((s) => s.awayReplies);
  const stopAway = useMail((s) => s.stopAway);
  const folder = useMail((s) => s.folder);
  const now = useNow();
  const on = replies.filter((r) => awayOn(r, now));
  if (!on.length || folder !== "inbox") return null;
  const [one] = on;
  return (
    <div className={cn("mb-2 flex items-center gap-2.5 rounded-[12px] bg-accent-soft px-3 py-2 text-[12.5px] text-ink", mobile ? "mx-2.5" : "mx-0.5")}>
      <Palmtree size={15} className="shrink-0 text-accent-text" />
      <span className="min-w-0 flex-1">
        {on.length > 1
          ? tn(on.length, "{n} out-of-office reply is on", "{n} out-of-office replies are on")
          : awayWaiting(one, now)
            ? t("Out-of-office reply starts {date}", { date: formatAwayDay(one.from!) })
            : one.until
              ? t("Out-of-office reply is on until {date}", { date: formatAwayDay(one.until) })
              : t("Out-of-office reply is on")}
      </span>
      <button onClick={stopAway} className="shrink-0 rounded-full px-2 py-1 font-medium text-accent-text hover:bg-accent/10">
        {t("Turn off")}
      </button>
    </div>
  );
}
