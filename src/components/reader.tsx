"use client";

import {
  Archive,
  ArchiveRestore,
  Ban,
  Bell,
  BellMinus,
  BellOff,
  BellPlus,
  BellRing,
  Crown,
  Hourglass,
  Printer,
  StickyNote,
  CalendarClock,
  Check,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Clock,
  Ellipsis,
  Forward,
  KeyRound,
  LoaderCircle,
  MailMinus,
  Paperclip,
  MailOpen,
  Pin,
  Plus,
  Reply,
  Sparkles,
  ReplyAll,
  ShieldAlert,
  ShieldCheck,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { DropdownMenu, Popover } from "radix-ui";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { copyCode, threadCode } from "@/lib/codes";
import { downloadAll } from "@/lib/download";
import { FileIcon } from "./file-icon";
import { ContactView } from "./contacts";
import { InviteCard } from "./invite-card";
import { ThreadSummaryBlock } from "./thread-summary";
import { ScreenerReaderBanner } from "./screener";
import { formatCode } from "@/lib/otp";
import { t, tn } from "@/lib/i18n";
import { LIVE } from "@/lib/live";
import { doneAction, insightChip, orderPhase, safeHttpUrl, securityOpen } from "@/lib/insights";
import { folderLabel, isBin, lastMessage, threadCounterpart, useMail } from "@/lib/store";
import { parseListUnsubscribe, unsubscribeMethod } from "@/lib/unsubscribe";
import { confirmAction, confirmChoice } from "./confirm";
import type { Attachment, Message, Tab, Thread } from "@/lib/types";
import { MailBody } from "./mail-body";
import { cn, firstName, formatFullTime, formatFuture, formatListTime, htmlToText, personName } from "@/lib/utils";
import { useNow } from "@/lib/use-now";
import { openSummary } from "@/lib/tracking";
import { ActivityView } from "./activity";
import { AddAccountView } from "./add-account";
import { Kolbaba } from "./kolbaba";
import { InboxZero } from "./postcard";
import { useSyncingEmpty } from "./sync-notice";
import { phaseOf } from "@/lib/postcard";
import { Composer } from "./editor/composer";
import { neighbourOf, useListItems } from "./message-list";
import { CATEGORY_ICONS } from "./category-view";
import { RemindMenu, RemindSub, SnoozeMenu } from "./menus";
import { ThreadNote, openNote } from "./thread-note";
import { printThread } from "./print";
import { isFreeMail } from "@/lib/mail-domains";
import { addressInName, splitAddress } from "@/lib/phishing";
import { MoveToFolderSub } from "./folders";
import { askDeleteForever, canDeleteForever } from "./thread-actions";
import { Avatar, IconButton, Kbd, MailboxBadge, Tooltip, menuContentClass, menuItemClass, subTriggerClass, spring } from "./ui";

export function Reader() {
  // Opening the next email (after an archive, J/K) is the heaviest render in the app. Deferred, the list
  // updates and animates first and React fits the reader in between frames instead of stalling them.
  const tabs = useDeferredValue(useMail((s) => s.tabs));
  const activeTabId = useDeferredValue(useMail((s) => s.activeTabId));

  return (
    <div className="flex h-full min-h-0 flex-col">
      {tabs.length > 0 && <TabBar />}
      <div className="relative min-h-0 flex-1">
        {/* Nothing open: no tabs, or tabs kept but none in front (AI activity steps aside, a tab closed). */}
        {!tabs.some((tab) => tab.id === activeTabId) && <EmptyReader />}
        {tabs.map((tab) => (
          <div key={tab.id} hidden={tab.id !== activeTabId} className="absolute inset-0 animate-[tab-in_180ms_cubic-bezier(0.2,0.8,0.2,1)]">
            <TabContent tab={tab} />
          </div>
        ))}
      </div>
    </div>
  );
}

function TabContent({ tab }: { tab: Tab }) {
  if (tab.kind === "thread") return <ThreadView threadId={tab.threadId} />;
  if (tab.kind === "draft") return <Composer draftId={tab.draftId} />;
  if (tab.kind === "activity") return <ActivityView />;
  if (tab.kind === "contact") return <ContactView contactId={tab.contactId} />;
  return <AddAccountView tabId={tab.id} prefill={tab.email} />;
}

/** "Good morning" and so on, by the hour. */
function greeting(d: Date) {
  const h = d.getHours();
  if (h >= 5 && h < 11) return t("Good morning");
  if (h >= 11 && h < 17) return t("Good afternoon");
  if (h >= 17 && h < 22) return t("Good evening");
  return t("Working late?");
}

/**
 * Nothing open: Kolbaba with the day's greeting and the shortcuts, or, when Inbox is empty, his
 * postcard. Below, how many emails didn't get to see when they were opened this week.
 */
function EmptyReader() {
  const unread = useMail((s) => Object.values(s.threads).filter((t) => t.unread && t.folder === "inbox").length);
  const items = useListItems();
  // A first import still running: no postcard (and no Inbox-zero stamps) for an Inbox that's only empty so far.
  const syncEmpty = useSyncingEmpty(items.length === 0);
  const inboxZero = useMail((s) => s.folder === "inbox" && !s.query && s.ready && (!LIVE || s.accounts.length > 0)) && items.length === 0 && !syncEmpty;
  const now = new Date(useNow());
  const trackers = useMail((s) => s.stats?.trackersWeek ?? 0);
  const loadStats = useMail((s) => s.loadStats);
  useEffect(() => void loadStats(), [loadStats]);
  if (inboxZero)
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto py-8 select-none">
        <InboxZero where="reader" />
      </div>
    );
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 text-center select-none">
      <Kolbaba size={48} mood={phaseOf(now) === "night" ? "sleep" : "idle"} snow={now.getMonth() === 11} interactive />
      <div>
        <div className="mb-0.5 text-[12.5px] font-medium text-ink-3">{greeting(now)}</div>
        <div className="text-[16px] font-semibold tracking-[-0.01em]">{unread ? tn(unread, "{n} unread waiting", "{n} unread waiting") : syncEmpty ? t("Your mail is on its way") : t("You're all caught up")}</div>
        <div className="mt-1 text-[13px] text-ink-3">{t("Pick a conversation, or start something new.")}</div>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12.5px] text-ink-3">
        {[
          ["J / K", t("Next / previous")],
          ["E", t("Archive")],
          ["#", t("Delete")],
          ["P", t("Pin")],
          ["R", t("Reply")],
          ["H", t("Snooze")],
          ["C", t("New message")],
          ["⌘K", t("Everything else")],
        ].map(([k, label]) => (
          <div key={k} className="flex items-center gap-2">
            <Kbd className="min-w-9">{k}</Kbd>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1.5 text-[12px] text-ink-3">
        <ShieldCheck size={13} className="shrink-0" />
        {trackers > 0
          ? tn(trackers, "This week I didn't let {n} email see when you open it.", "This week I didn't let {n} emails see when you open them.")
          : t("I keep emails from seeing when you open them. None tried this week yet.")}
      </div>
    </div>
  );
}

/* ---------------------------------- Tabs ---------------------------------- */

function TabBar() {
  const tabs = useMail((s) => s.tabs);
  const compose = useMail((s) => s.compose);
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line bg-hover pr-1.5">
      {/* Inner padding keeps the active tab's ring and shadow from being clipped by the scroll container. */}
      <div role="tablist" className="no-scrollbar flex h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1.5">
        <AnimatePresence initial={false} mode="popLayout">
          {tabs.map((tab) => (
            <TabChip key={tab.id} tab={tab} />
          ))}
        </AnimatePresence>
      </div>
      <IconButton label={t("New message")} shortcut="C" onClick={() => compose()} className="size-8 shrink-0 rounded-[10px]">
        <SquarePen size={15} />
      </IconButton>
    </div>
  );
}

function TabChip({ tab }: { tab: Tab }) {
  const active = useMail((s) => s.activeTabId === tab.id);
  const activateTab = useMail((s) => s.activateTab);
  const closeTab = useMail((s) => s.closeTab);
  const keepTab = useMail((s) => s.keepTab);
  const thread = useMail((s) => (tab.kind === "thread" ? s.threads[tab.threadId] : undefined));
  const draft = useMail((s) => (tab.kind === "draft" ? s.drafts[tab.draftId] : undefined));
  const contact = useMail((s) => (tab.kind === "contact" ? s.contacts.find((c) => c.id === tab.contactId) : undefined));
  const accounts = useMail((s) => s.accounts);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [active]);

  let title = t("Add mailbox");
  let icon: React.ReactNode = <Plus size={14} className="text-ink-3" />;
  if (tab.kind === "activity") {
    title = t("Activity");
    icon = <Sparkles size={14} className="text-accent-text" />;
  } else if (tab.kind === "contact") {
    title = contact ? contact.name || contact.emails[0] || t("Contact") : t("Contact");
    icon = <Avatar person={{ name: contact?.name ?? "", email: contact?.emails[0] ?? "" }} size={18} />;
  } else if (thread) {
    title = thread.subject;
    icon = <Avatar person={lastMessage(thread).from} logo={thread.logo} size={18} />;
  } else if (draft) {
    title = draft.subject || t("New message");
    const account = accounts.find((a) => a.id === draft.accountId);
    icon = account ? <MailboxBadge icon={account.icon} hue={account.hue} image={account.image} size={18} className="rounded-[6px]" /> : <SquarePen size={14} />;
  }

  return (
    <motion.div
      ref={ref}
      layout="position"
      role="tab"
      aria-selected={active}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.12 } }}
      transition={spring}
      onClick={() => activateTab(tab.id)}
      onDoubleClick={() => keepTab(tab.id)}
      onAuxClick={(e) => e.button === 1 && closeTab(tab.id)}
      title={tab.preview ? t("{title} — preview, double-click to keep it open", { title }) : title}
      className={cn(
        "group relative flex h-8 min-w-[132px] flex-[0_1_210px] items-center gap-2 rounded-[10px] pr-1 pl-2 text-[12.5px] transition-colors duration-150",
        // Inactive tabs keep a faint card and edge, so they read as tabs you can click, not as loose text.
        active
          ? "bg-tab text-ink shadow-[0_1px_2px_rgb(16_24_40/0.08),0_0_0_0.5px_rgb(16_24_40/0.06)]"
          : "bg-tab/45 text-ink-2 shadow-[inset_0_0_0_1px_var(--line)] hover:bg-tab/80 hover:text-ink",
      )}
    >
      <span className="flex shrink-0 items-center">{icon}</span>
      <span className={cn("min-w-0 flex-1 truncate", tab.preview && "italic", active && "font-medium")}>
        {draft && <span className="mr-1 font-medium not-italic text-danger">{t("Draft")}</span>}
        {title}
      </span>
      <button
        aria-label={t("Close tab")}
        onClick={(e) => {
          e.stopPropagation();
          closeTab(tab.id);
        }}
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-md text-ink-3 transition-[opacity,background-color,color] hover:bg-selected hover:text-ink",
          active ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        )}
      >
        <X size={13} strokeWidth={2.2} />
      </button>
    </motion.div>
  );
}

/* --------------------------------- Thread --------------------------------- */

export function ThreadView({ threadId, mobile }: { threadId: string; mobile?: boolean }) {
  const thread = useMail((s) => s.threads[threadId]);
  const replyDraftId = useMail((s) => Object.values(s.drafts).find((d) => d.threadId === threadId)?.id);
  const reply = useMail((s) => s.reply);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<{ id: string; at: number } | null>(null);

  const startReply = (mode: "reply" | "replyAll" | "forward") => {
    reply(threadId, mode);
    if (mode !== "forward") setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 60);
  };

  if (!thread) {
    return <div className="flex h-full items-center justify-center text-[13px] text-ink-3">{t("This conversation is gone.")}</div>;
  }

  return (
    <div className="relative h-full">
      <div className="@container h-full overflow-y-auto">
        {/* The column grows with the reader: 760px on a laptop, wider on a big monitor so emails don't sit in a
            strip in the middle, up to 1040px, past which lines of text get too long to read comfortably. */}
        <article
          className={cn("mx-auto w-full max-w-[clamp(760px,50cqw_+_260px,1040px)] px-5 pb-32 md:px-8", mobile ? "pt-3" : "pt-7")}
        >
          <ThreadHeader thread={thread} />
          <ThreadNote thread={thread} />
          <ScreenerReaderBanner thread={thread} />
          <ThreadSummaryBlock key={thread.id} thread={thread} />
          <ThreadBanner thread={thread} />
          <CodeBanner thread={thread} />
          <InsightBanner thread={thread} />
          <AttachmentsOverview thread={thread} onJump={(id) => setFocus({ id, at: Date.now() })} />
          <Messages thread={thread} focus={focus} />
          <div ref={bottomRef} className="mt-5 scroll-mb-28">
            {replyDraftId ? (
              <Composer draftId={replyDraftId} variant="inline" />
            ) : thread.folder !== "scheduled" ? (
              <div className="flex flex-wrap gap-2">
                <ReplyButton icon={Reply} label={t("Reply")} shortcut="R" onClick={() => startReply("reply")} />
                <ReplyButton icon={ReplyAll} label={t("Reply all")} shortcut="⇧R" onClick={() => startReply("replyAll")} />
                <ReplyButton icon={Forward} label={t("Forward")} shortcut="F" onClick={() => startReply("forward")} />
              </div>
            ) : null}
          </div>
        </article>
      </div>
      {!replyDraftId && <ActionPill thread={thread} advance={!mobile} onReply={() => startReply("reply")} />}
    </div>
  );
}

function ReplyButton({ icon: Icon, label, shortcut, onClick }: { icon: typeof Reply; label: string; shortcut: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex h-9 items-center gap-2 rounded-[11px] px-3.5 text-[13px] font-medium text-ink-2 shadow-[inset_0_0_0_0.5px_var(--line)] transition-colors hover:bg-hover hover:text-ink"
    >
      <Icon size={15} />
      {label}
      <Kbd className="ml-0.5 hidden md:inline-flex">{shortcut}</Kbd>
    </button>
  );
}

function ThreadHeader({ thread }: { thread: Thread }) {
  const account = useMail((s) => s.accounts.find((a) => a.id === thread.accountId));
  return (
    <header className="mb-5">
      <h1 className="text-[22px] leading-[1.25] font-semibold tracking-[-0.02em] text-balance md:text-[24px]">{thread.subject}</h1>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[12px]">
        {account && (
          <span className="flex h-6 items-center gap-1.5 rounded-full bg-hover pr-2.5 pl-1 text-ink-2">
            <MailboxBadge icon={account.icon} hue={account.hue} image={account.image} size={16} className="rounded-full" />
            {account.name}
          </span>
        )}
        {thread.pinned && (
          <span className="flex h-6 items-center gap-1 rounded-full bg-accent-soft px-2.5 font-medium text-accent-text">
            <Pin size={11} className="fill-current" /> {t("Pinned")}
          </span>
        )}
        {thread.messages.length > 1 && (
          <span className="flex h-6 items-center rounded-full px-1.5 text-ink-3">{tn(thread.messages.length, "{n} message", "{n} messages")}</span>
        )}
        <UnsubscribeChip thread={thread} />
      </div>
    </header>
  );
}

/**
 * Leave the list a newsletter came from. One click or the list's email: Kolbaba does it (after a
 * yes); a page to finish on opens in a new tab.
 */
function UnsubscribeChip({ thread }: { thread: Thread }) {
  const accounts = useMail((s) => s.accounts);
  const method = unsubscribeMethod(thread.listUnsubscribe, thread.listUnsubscribeOneClick);
  if (!method || thread.folder === "sent" || thread.folder === "scheduled") return null;
  const chip = "ml-auto flex h-6 items-center gap-1 rounded-full px-2.5 font-medium transition-colors";
  if (thread.unsubscribedAt) {
    return (
      <span className={cn(chip, "text-ink-3")}>
        <Check size={12} /> {t("Unsubscribed")}
      </span>
    );
  }
  if (method === "page") {
    return (
      <a href={parseListUnsubscribe(thread.listUnsubscribe).https} target="_blank" rel="noopener noreferrer" className={cn(chip, "text-ink-2 hover:bg-hover hover:text-ink")}>
        <MailMinus size={12} /> {t("Unsubscribe")} <ExternalLink size={11} className="opacity-60" />
      </a>
    );
  }
  const sender = threadCounterpart(thread, accounts);
  const who = sender.name || sender.email;
  const mailbox = accounts.find((a) => a.id === thread.accountId);
  return (
    <button
      onClick={() =>
        confirmAction({
          title: t("Unsubscribe from {sender}?", { sender: who }),
          message:
            method === "one-click"
              ? t("Kolbaba asks {sender} to stop sending you this. Mail that's already here stays.", { sender: who })
              : t("An unsubscribe email goes from {mailbox} to the sender's list. Mail that's already here stays.", { mailbox: mailbox?.email ?? "" }),
          confirmLabel: t("Unsubscribe"),
          onConfirm: () => void unsubscribeAndOffer(thread.id),
        })
      }
      className={cn(chip, "text-ink-2 hover:bg-hover hover:text-ink")}
    >
      <MailMinus size={12} /> {t("Unsubscribe")}
    </button>
  );
}

/**
 * Unsubscribe, then (when more of their mail is around) offer to clean it up: Archive what's in Inbox,
 * or delete all of it. Pinned conversations stay either way.
 */
async function unsubscribeAndOffer(threadId: string) {
  const res = await useMail.getState().unsubscribe(threadId);
  if (!res || !res.total) return;
  const who = res.sender.name || res.sender.email;
  confirmChoice({
    title: t("Unsubscribed from {sender}", { sender: who }),
    message: tn(res.total, "{n} conversation from them is still here. Clean it up too?", "{n} conversations from them are still here. Clean them up too?"),
    choices: [
      ...(res.inbox ? [{ label: tn(res.inbox, "Archive {n} from Inbox", "Archive {n} from Inbox"), run: () => void useMail.getState().cleanUpSender(res.sender, "archive") }] : []),
      { label: tn(res.total, "Delete it", "Delete all {n}"), tone: "danger" as const, run: () => void useMail.getState().cleanUpSender(res.sender, "trash") },
    ],
    cancelLabel: t("Keep them"),
  });
}

function ThreadBanner({ thread }: { thread: Thread }) {
  const unsnooze = useMail((s) => s.unsnooze);
  const cancelScheduled = useMail((s) => s.cancelScheduled);
  const remindIfNoReply = useMail((s) => s.remindIfNoReply);
  const notWaiting = useMail((s) => s.notWaiting);
  const setMuted = useMail((s) => s.setMuted);
  const setWatched = useMail((s) => s.setWatched);
  const accounts = useMail((s) => s.accounts);
  const now = useNow();
  let content: React.ReactNode = null;
  if (thread.folder === "scheduled" && thread.scheduledAt) {
    content = (
      <>
        <CalendarClock size={15} className="text-accent-text" />
        <span className="flex-1">{t("Sends {time}", { time: formatFuture(thread.scheduledAt) })}</span>
        <button onClick={() => cancelScheduled(thread.id)} className="rounded-lg px-2 py-1 font-medium text-accent-text hover:bg-hover">
          {t("Edit message")}
        </button>
      </>
    );
  } else if (thread.snoozedUntil && thread.snoozedUntil > now) {
    content = (
      <>
        <Clock size={15} className="text-ink-2" />
        <span className="flex-1">{t("Snoozed until {time}", { time: formatFuture(thread.snoozedUntil) })}</span>
        <button onClick={() => unsnooze(thread.id)} className="rounded-lg px-2 py-1 font-medium text-accent-text hover:bg-hover">
          {t("Unsnooze")}
        </button>
      </>
    );
  } else if (thread.followUpAt && thread.followUpAt > now) {
    content = (
      <>
        <BellRing size={15} className="text-warning" />
        <span className="flex-1">{t("We'll remind you {time} if nobody replies.", { time: formatFuture(thread.followUpAt) })}</span>
        <RemindMenu current={thread.followUpAt} onPick={(at) => remindIfNoReply(thread.id, at)}>
          <button className="rounded-lg px-2 py-1 font-medium text-accent-text hover:bg-hover data-[state=open]:bg-hover">{t("Change")}</button>
        </RemindMenu>
      </>
    );
  } else if (thread.awaiting) {
    const days = Math.max(1, Math.floor((now - lastMessage(thread).date) / 86_400_000));
    const who = threadCounterpart(thread, accounts);
    content = (
      <>
        <Hourglass size={15} className="text-ink-2" />
        <span className="min-w-0 flex-1">{tn(days, "No reply from {name} for {n} day", "No reply from {name} for {n} days", { name: who.name || who.email })}</span>
        <RemindMenu onPick={(at) => at && remindIfNoReply(thread.id, at)}>
          <button className="shrink-0 rounded-lg px-2 py-1 font-medium text-accent-text hover:bg-hover data-[state=open]:bg-hover">{t("Remind me")}</button>
        </RemindMenu>
        <button onClick={() => notWaiting(thread.id)} className="shrink-0 rounded-lg px-2 py-1 font-medium text-ink-2 hover:bg-hover hover:text-ink">
          {t("Not waiting")}
        </button>
      </>
    );
  } else if (thread.watched) {
    content = (
      <>
        <BellPlus size={15} className="text-accent-text" />
        <span className="flex-1">{t("You'll be notified of every reply here, even in quiet hours.")}</span>
        <button onClick={() => setWatched(thread.id, false)} className="rounded-lg px-2 py-1 font-medium text-accent-text hover:bg-hover">
          {t("Turn off")}
        </button>
      </>
    );
  } else if (thread.muted) {
    content = (
      <>
        <BellOff size={15} className="text-ink-2" />
        <span className="flex-1">{t("Muted. New replies stay out of your Inbox, without a notification.")}</span>
        <button onClick={() => setMuted(thread.id, false)} className="rounded-lg px-2 py-1 font-medium text-accent-text hover:bg-hover">
          {t("Unmute")}
        </button>
      </>
    );
  }
  if (!content) return null;
  return <div className="mb-4 flex items-center gap-2.5 rounded-xl bg-hover px-3.5 py-2.5 text-[13px] text-ink">{content}</div>;
}

/** Smart categories: the order (trip, invoice, subscription) this conversation is about, with a way to its category. */
function InsightBanner({ thread }: { thread: Thread }) {
  const enabled = useMail((s) => s.smartCategories);
  const setFolder = useMail((s) => s.setFolder);
  const setInsightDone = useMail((s) => s.setInsightDone);
  const dismissInsight = useMail((s) => s.dismissInsight);
  const pushToast = useMail((s) => s.pushToast);
  const now = useNow();
  const insight = thread.insight;
  if (!enabled || !insight) return null;
  const { text, tone } = insightChip(insight, now);
  const view = (
    { order: "orders", travel: "travel", invoice: "invoices", subscription: "subscriptions", security: "security", reply: "replies" } as const
  )[insight.category];
  // One text per category: in Czech "All" agrees with the category's gender and number.
  const all = {
    orders: t("All orders"),
    travel: t("All travel"),
    invoices: t("All invoices"),
    subscriptions: t("All subscriptions"),
    security: t("All security notices"),
    replies: t("All awaiting reply"),
  }[view];
  const Icon = CATEGORY_ICONS[view];
  const track = insight.order && orderPhase(insight, now) === "open" ? safeHttpUrl(insight.order.trackingUrl) : null;
  const done = doneAction(insight, now);
  // A sign-in the user doesn't recognise: the service's own page for it (only a plain web link).
  const notMe = insight.security && securityOpen(insight, now) ? safeHttpUrl(insight.security.actionUrl) : null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-hover px-3.5 py-2.5 text-[13px]">
      <Icon size={16} className={cn("shrink-0", tone === "good" ? "text-success" : tone === "bad" ? "text-danger" : "text-ink-2")} />
      {/* A real basis, not flex-1: on a phone the actions wrap to their own line instead of squeezing the text to a sliver. */}
      <div className="min-w-0 flex-[1_1_14rem]">
        <div className="truncate font-medium text-ink">{insight.merchant ?? folderLabel(view)}</div>
        <div className="truncate text-[12.5px] text-ink-3">{text}</div>
        {/* Why AI put it here, in the email's own facts: so a wrong card is easy to spot and hide. */}
        {insight.why && <div className="mt-0.5 text-[12px] leading-snug text-ink-3/90">{t("Why here: {reason}", { reason: insight.why })}</div>}
      </div>
      {track && (
        <a
          href={track}
          target="_blank"
          rel="noreferrer noopener"
          className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-accent px-3 text-[12.5px] font-medium text-on-accent hover:bg-accent-hover"
        >
          {t("Track")} <ExternalLink size={12} />
        </a>
      )}
      {notMe && (
        <a
          href={notMe}
          target="_blank"
          rel="noreferrer noopener"
          className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-danger/10 px-3 text-[12.5px] font-medium text-danger hover:bg-danger/15"
        >
          {t("I don't know about it")} <ExternalLink size={12} />
        </a>
      )}
      {done && (
        <button
          onClick={() => {
            setInsightDone(insight.key, true);
            pushToast({ message: done.toast, undo: () => setInsightDone(insight.key, false) });
          }}
          className="flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[12.5px] font-medium text-ink shadow-[inset_0_0_0_0.5px_var(--line)] hover:bg-selected"
        >
          <Check size={13} strokeWidth={2.4} /> {done.label}
        </button>
      )}
      <button onClick={() => setFolder(view)} className="shrink-0 rounded-lg px-2 py-1 text-[12.5px] font-medium text-accent-text hover:bg-selected">
        {all}
      </button>
      <Tooltip label={t("Doesn't belong here")}>
        <button
          onClick={() => dismissInsight(insight.key)}
          aria-label={t("Doesn't belong here")}
          className="-mr-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-selected hover:text-ink"
        >
          <EyeOff size={14} />
        </button>
      </Tooltip>
    </div>
  );
}

/** A sign-in or verification code, big and one tap from the clipboard. */
function CodeBanner({ thread }: { thread: Thread }) {
  const found = threadCode(thread);
  if (!found) return null;
  return (
    <div className="mb-4 flex items-center gap-3 rounded-xl bg-accent-soft px-3.5 py-2.5">
      <KeyRound size={16} className="shrink-0 text-accent-text" />
      <div className="min-w-0 flex-1">
        <div className="text-[11.5px] font-medium text-ink-3">{t("Verification code")}</div>
        <div className="font-mono text-[20px] leading-tight font-semibold tracking-[0.06em] text-ink tabular-nums select-all">{formatCode(found.code)}</div>
      </div>
      <button
        onClick={() => void copyCode(found.code)}
        className="flex h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-[13px] font-medium text-on-accent press hover:bg-accent-hover"
      >
        <Copy size={14} /> {t("Copy")}
      </button>
    </div>
  );
}

function Messages({ thread, focus }: { thread: Thread; focus: { id: string; at: number } | null }) {
  const lastId = lastMessage(thread).id;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([lastId]));
  const [prevLast, setPrevLast] = useState(lastId);
  if (prevLast !== lastId) {
    setPrevLast(lastId);
    setExpanded((s) => new Set([...s, lastId]));
  }
  const [prevFocus, setPrevFocus] = useState(focus);
  const [highlight, setHighlight] = useState<string | null>(null);
  if (focus && focus !== prevFocus) {
    setPrevFocus(focus);
    setExpanded((s) => new Set([...s, focus.id]));
    setHighlight(focus.id);
  }

  useEffect(() => {
    if (!focus) return;
    // Wait a frame so the message is expanded before scrolling to it.
    const raf = requestAnimationFrame(() =>
      document.querySelector(`[data-message-id="${focus.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
    const timer = setTimeout(() => setHighlight(null), 1600);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [focus]);

  return (
    <div className="flex flex-col gap-2.5">
      {thread.messages.map((m) => {
        const open = expanded.has(m.id);
        return (
          <motion.div
            layout="position"
            key={m.id}
            data-message-id={m.id}
            transition={spring}
            className={cn(
              "scroll-mt-4 rounded-2xl transition-shadow duration-500",
              thread.messages.length > 1 && "bg-solid",
              highlight === m.id
                ? "shadow-[0_0_0_2px_var(--accent),var(--shadow-panel)]"
                : thread.messages.length > 1 && "shadow-[var(--shadow-panel)]",
            )}
          >
            {open ? (
              <MessageView message={m} thread={thread} framed={thread.messages.length > 1} onCollapse={thread.messages.length > 1 && m.id !== lastId ? () => setExpanded((s) => { const n = new Set(s); n.delete(m.id); return n; }) : undefined} />
            ) : (
              <button
                onClick={() => setExpanded((s) => new Set([...s, m.id]))}
                className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors hover:bg-hover"
              >
                <Avatar person={m.from} size={28} logo={thread.logo} />
                <span className="w-32 shrink-0 truncate text-[13px] font-medium">{personName(m.from)}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink-3">{m.snippet ?? htmlToText(m.html)}</span>
                <span className="shrink-0 text-[12px] text-ink-3">{formatListTime(m.date)}</span>
              </button>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

function MessageView({ message, thread, framed, onCollapse }: { message: Message; thread: Thread; framed: boolean; onCollapse?: () => void }) {
  const accounts = useMail((s) => s.accounts);
  const mine = new Set(accounts.map((a) => a.email));
  const recipients = [...message.to, ...(message.cc ?? [])].map((p) => (mine.has(p.email) ? t("me") : firstName(p)));
  return (
    <div className={cn(framed && "px-4 pt-3.5 pb-4")}>
      <div className="mb-3.5 flex items-start gap-3" onClick={onCollapse} role={onCollapse ? "button" : undefined}>
        <Avatar person={message.from} logo={mine.has(message.from.email) ? undefined : thread.logo} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            {mine.has(message.from.email) || !LIVE ? (
              <span className="truncate text-[14px] font-semibold">{mine.has(message.from.email) ? t("You") : personName(message.from)}</span>
            ) : (
              // Their name opens them in the address book.
              <Tooltip label={t("Show contact")} side="top">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void useMail.getState().openContactFor(message.from);
                  }}
                  className="truncate text-left text-[14px] font-semibold decoration-ink-3/50 underline-offset-2 hover:underline"
                >
                  {message.from.name || message.from.email}
                </button>
              </Tooltip>
            )}
            <span className={cn("hidden truncate text-[12.5px] text-ink-3 sm:inline", message.stranger && "sm:hidden")}>{message.from.email}</span>
          </div>
          {/* Someone you never wrote to: the whole address, phone included, with the domain where a fake shows. */}
          {message.stranger && !mine.has(message.from.email) && <SenderAddress email={message.from.email} />}
          <div className="truncate text-[12.5px] text-ink-3">{t("to {recipients}", { recipients: recipients.join(", ") })}</div>
        </div>
        <Tooltip label={formatFullTime(message.date)} side="top">
          <span className="shrink-0 pt-0.5 text-[12px] text-ink-3">{formatListTime(message.date)}</span>
        </Tooltip>
      </div>
      {message.nameMismatch && <NameMismatch message={message} />}
      <InviteCard message={message} />
      {!mine.has(message.from.email) && <PrivacyLine message={message} />}
      <MailBody message={message} threadId={thread.id} />
      {mine.has(message.from.email) && message.tracked && <ReadReceipt message={message} />}
      {!!message.attachments?.length && (
        <section className="mt-4">
          {message.attachments.length > 1 && (
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-2">
                <Paperclip size={13} />
                {tn(message.attachments.length, "{n} attachment", "{n} attachments")}
              </span>
              <DownloadAllButton attachments={message.attachments} subject={thread.subject} />
            </div>
          )}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
            {message.attachments.map((a, i) => (
              <AttachmentCard key={`${i}-${a.name}`} attachment={a} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * What Kolbaba kept this email from doing, right where it happened: the invisible images that would have
 * told the sender you opened it (named when it's a known service), and the tracking codes taken off links.
 */
function PrivacyLine({ message }: { message: Message }) {
  const pixels = message.spyPixels ?? 0;
  const links = message.cleanedLinks ?? 0;
  if (!pixels && !links) return null;
  const names = message.trackers?.length ? ` (${message.trackers.join(", ")})` : "";
  const parts = [
    ...(pixels ? [tn(pixels, "Blocked {n} tracker", "Blocked {n} trackers") + names] : []),
    ...(links ? [tn(links, "cleaned {n} link", "cleaned {n} links")] : []),
  ];
  const text = parts.join(" · ");
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="mb-3 flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 -ml-2 text-[12px] text-ink-3 transition-colors hover:bg-hover hover:text-ink-2">
          <ShieldCheck size={13} className="shrink-0 text-success" />
          <span className="truncate">{text.charAt(0).toUpperCase() + text.slice(1)}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="bottom" align="start" sideOffset={6} collisionPadding={12} className="glass-strong z-50 flex w-[300px] flex-col gap-2 rounded-2xl p-3 text-[12.5px] leading-relaxed text-ink-2 data-[state=open]:animate-[menu-in_140ms_ease-out]">
          {pixels > 0 && <p>{t("Trackers are invisible images that tell the sender when, and on what, you opened the email. Kolbaba removes them, so this one never found out.")}</p>}
          {links > 0 && <p>{t("Links carried codes that tell the sender who clicked (utm_… and the like). Kolbaba took them off; the links still go to the same page.")}</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ReadReceipt({ message }: { message: Message }) {
  const summary = openSummary(message);
  const opens = message.opens ?? [];
  const tone =
    summary.state === "opened" ? "bg-accent-soft text-accent-text" : summary.state === "apple" ? "bg-warning/12 text-ink-2" : "bg-hover text-ink-3";
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className={cn("mt-4 flex h-7 max-w-full items-center gap-1.5 rounded-full px-2.5 text-[12px] transition-[filter] hover:brightness-95", tone)}>
          <Eye size={13} className="shrink-0" />
          <span className="font-medium">{summary.label}</span>
          {summary.detail && <span className="truncate opacity-75">· {summary.detail}</span>}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="start" sideOffset={6} className="glass-strong z-50 w-[300px] rounded-2xl p-3 text-[12.5px] data-[state=open]:animate-[menu-in_140ms_ease-out]">
          <div className="mb-2 font-medium">{t("Read receipts")}</div>
          {opens.length === 0 ? (
            <p className="text-ink-3">{t("Nobody has opened this yet. We'll notify you the moment they do.")}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {opens.map((o, i) => (
                <li key={i} className="flex items-center justify-between gap-3">
                  <span className={o.viaApple ? "text-ink-3" : ""}>{o.viaApple ? t("Apple Mail (preloaded)") : o.client}</span>
                  <span className="shrink-0 text-ink-3">{formatFullTime(o.at)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 border-t border-line pt-2 text-[11.5px] leading-relaxed text-ink-3">
            {t("Tracked with an invisible image. Apple Mail preloads images and many apps block them, so treat this as a hint, not proof.")}
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Every attachment in the conversation, up top, so nobody has to open each message to find a file. */
function AttachmentsOverview({ thread, onJump }: { thread: Thread; onJump: (messageId: string) => void }) {
  const accounts = useMail((s) => s.accounts);
  const items = thread.messages.flatMap((m) => (m.attachments ?? []).map((a) => ({ a, m })));
  if (thread.messages.length < 2 || items.length === 0) return null;
  const mine = new Set(accounts.map((x) => x.email));
  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-2">
          <Paperclip size={13} />
          {tn(items.length, "{n} attachment", "{n} attachments")}
          <span className="hidden sm:inline">{t("in this conversation")}</span>
        </span>
        {items.length > 1 && <DownloadAllButton attachments={items.map(({ a }) => a)} subject={thread.subject} />}
      </div>
      <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 py-1 md:-mx-8 md:px-8">
        {items.map(({ a, m }) => (
          <Tooltip key={`${m.id}-${a.name}`} label={t("Show in conversation")} side="bottom">
            <button
              onClick={() => onJump(m.id)}
              className="flex w-[228px] shrink-0 items-center gap-3 rounded-xl bg-solid p-2.5 text-left shadow-[var(--shadow-panel)] transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[var(--shadow-float)] active:translate-y-0"
            >
              <FileIcon kind={a.kind} />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium">{a.name}</span>
                <span className="block truncate text-[12px] text-ink-3">
                  {a.size} · {mine.has(m.from.email) ? t("You") : firstName(m.from)} · {formatListTime(m.date)}
                </span>
              </span>
            </button>
          </Tooltip>
        ))}
      </div>
    </section>
  );
}

/** Zips every attachment it's given (fetched in the browser) and drops the zip into Downloads. */
function DownloadAllButton({ attachments, subject }: { attachments: Attachment[]; subject: string }) {
  const pushToast = useMail((s) => s.pushToast);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const files = attachments.flatMap((a) => (a.url ? [{ name: a.name, url: a.url }] : []));
    // The prototype's mock attachments have nothing behind them.
    if (!files.length) return pushToast({ message: tn(attachments.length, "Downloading {n} file as a zip", "Downloading {n} files as a zip") });
    setBusy(true);
    try {
      await downloadAll(files, subject);
    } catch {
      pushToast({ message: t("Couldn't download the attachments. Try again in a moment.") });
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      onClick={() => void run()}
      disabled={busy}
      aria-busy={busy}
      className="flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium whitespace-nowrap text-accent-text transition-colors hover:bg-accent-soft disabled:cursor-progress"
    >
      {busy ? <LoaderCircle size={13} className="animate-spin" /> : <Download size={13} />} {t("Download all")}
    </button>
  );
}

/**
 * Click opens the file in a new window if the browser can show it (images, PDFs, plain text) and downloads
 * anything else, where a new window would stay empty. The arrow, shown on hover (always on touch), always downloads.
 */
function AttachmentCard({ attachment }: { attachment: Attachment }) {
  const { url, name } = attachment;
  const open = attachment.opensInBrowser ? { href: url, target: "_blank", rel: "noopener" } : { href: url && `${url}?download`, download: name };
  return (
    <div className="group relative rounded-xl shadow-[inset_0_0_0_0.5px_var(--line)] transition-colors hover:bg-hover">
      <a {...open} className="flex min-w-0 items-center gap-3 rounded-xl p-2.5 text-left pointer-coarse:pr-12">
        <FileIcon kind={attachment.kind} />
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium">{name}</span>
          <span className="block text-[12px] text-ink-3">{attachment.size}</span>
        </span>
      </a>
      <Tooltip label={t("Download")} side="top">
        <a
          href={url && `${url}?download`}
          download={name}
          aria-label={t("Download {name}", { name })}
          className="absolute top-1/2 right-2.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-solid text-ink-2 opacity-0 shadow-[var(--shadow-panel)] transition-[opacity,color] group-hover:opacity-100 hover:text-accent-text focus-visible:opacity-100 pointer-coarse:bg-transparent pointer-coarse:text-ink-3 pointer-coarse:opacity-100 pointer-coarse:shadow-none"
        >
          <Download size={15} />
        </a>
      </Tooltip>
    </div>
  );
}

/** The whole address of someone new, the domain a little louder: "overeni@" quiet, "neco-jineho.ru" clear. */
function SenderAddress({ email }: { email: string }) {
  const [local, domain] = splitAddress(email);
  return (
    <Tooltip label={t("You've never written to this address")} side="top">
      <div className="flex min-w-0 items-center gap-1 text-[12.5px]">
        <span className="min-w-0 truncate">
          <span className="text-ink-3">{local}</span>
          <span className="font-medium text-ink-2">{domain}</span>
        </span>
        <span className="shrink-0 rounded-full bg-hover px-1.5 py-px text-[10.5px] font-medium text-ink-3">{t("New")}</span>
      </div>
    </Tooltip>
  );
}

/** The sender's name carries another address than the real one: the classic disguise, said plainly. */
function NameMismatch({ message }: { message: Message }) {
  const fake = addressInName(message.from);
  if (!fake) return null;
  return (
    <div className="mb-3.5 flex gap-2.5 rounded-xl bg-danger/8 px-3.5 py-2.5 text-[13px] leading-snug text-ink">
      <ShieldAlert size={15} className="mt-px shrink-0 text-danger" />
      <span>
        <span className="font-medium">{t("Careful: the name says {fake}", { fake })}</span>{" "}
        <span className="text-ink-2">{t("but the email came from {real}. Don't click links or reply with anything private.", { real: message.from.email })}</span>
      </span>
    </div>
  );
}

/** Block a sender from any email: just this address, or everyone at their company's domain. */
function BlockSub({ sender }: { sender: { name: string; email: string } }) {
  const blockSender = useMail((s) => s.blockSender);
  const domain = sender.email.slice(sender.email.lastIndexOf("@") + 1).toLowerCase();
  const who = sender.name || sender.email;
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger className={subTriggerClass}>
        <Ban size={14} /> <span className="flex-1 truncate">{t("Block {sender}", { sender: who })}</span>
        <ChevronRight size={14} className="shrink-0 opacity-60" />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent sideOffset={6} collisionPadding={8} className={cn(menuContentClass, "max-w-[320px]")}>
          <div className="px-2.5 pt-1.5 pb-1 text-[11px] leading-snug font-medium text-ink-3">{t("What they send goes straight to Trash. You can undo it in Settings.")}</div>
          <DropdownMenu.Item className={menuItemClass} onSelect={() => void blockSender(sender)}>
            <Ban size={14} /> <span className="truncate">{sender.email}</span>
          </DropdownMenu.Item>
          {!isFreeMail(sender.email) && (
            <DropdownMenu.Item className={menuItemClass} onSelect={() => void blockSender(sender, { domain: true })}>
              <Ban size={14} /> <span className="truncate">{t("Everyone at {domain}", { domain })}</span>
            </DropdownMenu.Item>
          )}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

/* ------------------------------ Floating pill ----------------------------- */

export function ActionPill({ thread, onReply, advance = true }: { thread: Thread; onReply: () => void; advance?: boolean }) {
  const archive = useMail((s) => s.archive);
  const moveToInbox = useMail((s) => s.moveToInbox);
  const togglePin = useMail((s) => s.togglePin);
  const snooze = useMail((s) => s.snooze);
  const setUnread = useMail((s) => s.setUnread);
  const reply = useMail((s) => s.reply);
  const trash = useMail((s) => s.trash);
  const spam = useMail((s) => s.spam);
  const accounts = useMail((s) => s.accounts);
  const setMuted = useMail((s) => s.setMuted);
  const setWatched = useMail((s) => s.setWatched);
  const setVip = useMail((s) => s.setVip);
  const remindIfNoReply = useMail((s) => s.remindIfNoReply);
  const archived = thread.folder === "archive";
  const bin = isBin(thread.folder) ? thread.folder : null;
  const next = () => (advance ? neighbourOf(thread.id) : null);
  const mine = new Set(accounts.map((a) => a.email.toLowerCase()));
  // "Remind me if no reply" is for a conversation where the last word was yours.
  const sentLast = mine.has(lastMessage(thread).from.email.toLowerCase());
  // Someone who wrote here (not you) can be blocked.
  const sender = [...thread.messages].reverse().find((m) => !mine.has(m.from.email.toLowerCase()))?.from;
  const vip = useMail((s) => !!sender && s.vips.includes(sender.email.toLowerCase()));

  const pillBtn = "flex size-10 items-center justify-center rounded-full text-ink press [--press-scale:0.88] hover:bg-hover data-[state=open]:bg-hover";

  return (
    <motion.div
      initial={{ y: 24, opacity: 0, scale: 0.96 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      transition={{ ...spring, delay: 0.05 }}
      className="action-bar absolute bottom-[max(20px,var(--safe-bottom))] left-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-full p-1"
    >
      {bin ? (
        <>
          <Tooltip label={bin === "spam" ? t("Not spam") : t("Restore to Inbox")} side="top">
            <button aria-label={bin === "spam" ? t("Not spam") : t("Restore to Inbox")} onClick={() => moveToInbox(thread.id)} className={pillBtn}>
              {bin === "spam" ? <ShieldCheck size={18} /> : <ArchiveRestore size={18} />}
            </button>
          </Tooltip>
          {bin === "spam" && (
            <Tooltip label={t("Delete")} shortcut="#" side="top">
              <button aria-label={t("Delete")} onClick={() => trash(thread.id, next())} className={pillBtn}>
                <Trash2 size={18} />
              </button>
            </Tooltip>
          )}
          {canDeleteForever(thread, accounts) && (
            <Tooltip label={t("Delete forever")} side="top">
              <button aria-label={t("Delete forever")} onClick={() => askDeleteForever([thread.id])} className={cn(pillBtn, "text-danger hover:text-danger")}>
                <Trash2 size={18} />
              </button>
            </Tooltip>
          )}
        </>
      ) : archived ? (
        <Tooltip label={t("Move to Inbox")} shortcut="E" side="top">
          <button aria-label={t("Move to Inbox")} onClick={() => moveToInbox(thread.id)} className={pillBtn}>
            <ArchiveRestore size={18} />
          </button>
        </Tooltip>
      ) : (
        <Tooltip label={t("Archive")} shortcut="E" side="top">
          <button aria-label={t("Archive")} onClick={() => archive(thread.id, next())} className={pillBtn}>
            <Archive size={18} />
          </button>
        </Tooltip>
      )}
      {!bin && (
        <Tooltip label={t("Delete")} shortcut="#" side="top">
          <button aria-label={t("Delete")} onClick={() => trash(thread.id, next())} className={pillBtn}>
            <Trash2 size={18} />
          </button>
        </Tooltip>
      )}
      {!bin && (
        <Tooltip label={thread.pinned ? t("Unpin") : t("Pin")} shortcut="P" side="top">
          <button aria-label={t("Pin")} onClick={() => togglePin(thread.id)} className={cn(pillBtn, thread.pinned && "text-accent-text")}>
            <Pin size={18} className={cn("transition-transform", thread.pinned && "fill-current")} />
          </button>
        </Tooltip>
      )}
      {!bin && (
        <SnoozeMenu side="top" align="center" tooltip={{ label: t("Snooze"), shortcut: "H" }} onPick={(ts) => snooze(thread.id, ts, next())}>
          <button aria-label={t("Snooze")} className={pillBtn}>
            <Clock size={18} />
          </button>
        </SnoozeMenu>
      )}
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <button aria-label={t("More")} className={pillBtn}>
            <Ellipsis size={18} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content side="top" align="center" sideOffset={8} className={menuContentClass}>
            <DropdownMenu.Item className={menuItemClass} onSelect={() => setUnread(thread.id, true)}>
              <MailOpen size={14} /> {t("Mark as unread")} <Kbd className="ml-auto">U</Kbd>
            </DropdownMenu.Item>
            <DropdownMenu.Item className={menuItemClass} onSelect={() => reply(thread.id, "replyAll")}>
              <ReplyAll size={14} /> {t("Reply all")} <Kbd className="ml-auto">⇧R</Kbd>
            </DropdownMenu.Item>
            <DropdownMenu.Item className={menuItemClass} onSelect={() => reply(thread.id, "forward")}>
              <Forward size={14} /> {t("Forward")} <Kbd className="ml-auto">F</Kbd>
            </DropdownMenu.Item>
            {!bin && <MoveToFolderSub ids={[thread.id]} />}
            <DropdownMenu.Separator className="my-1 h-px bg-line" />
            <DropdownMenu.Item className={menuItemClass} onSelect={() => openNote(thread.id)}>
              <StickyNote size={14} /> {thread.note ? t("Edit note") : t("Add a note")} <Kbd className="ml-auto">N</Kbd>
            </DropdownMenu.Item>
            {sentLast && !bin && <RemindSub current={thread.followUpAt} onPick={(at) => remindIfNoReply(thread.id, at)} />}
            {!bin && (
              <DropdownMenu.Item className={menuItemClass} onSelect={() => setMuted(thread.id, !thread.muted, next())}>
                {thread.muted ? <Bell size={14} /> : <BellOff size={14} />} {thread.muted ? t("Unmute") : t("Mute")} <Kbd className="ml-auto">M</Kbd>
              </DropdownMenu.Item>
            )}
            {!bin && (
              <DropdownMenu.Item className={menuItemClass} onSelect={() => setWatched(thread.id, !thread.watched)}>
                {thread.watched ? <BellMinus size={14} /> : <BellPlus size={14} />} {thread.watched ? t("Stop notifying me of replies") : t("Notify me of replies")}
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item className={menuItemClass} onSelect={() => void printThread(thread.id)}>
              <Printer size={14} /> {t("Print")} <Kbd className="ml-auto">⌘P</Kbd>
            </DropdownMenu.Item>
            {(bin !== "spam" || sender) && <DropdownMenu.Separator className="my-1 h-px bg-line" />}
            {bin !== "spam" && (
              <DropdownMenu.Item className={menuItemClass} onSelect={() => spam(thread.id, next())}>
                <ShieldAlert size={14} /> {t("Report spam")} <Kbd className="ml-auto">!</Kbd>
              </DropdownMenu.Item>
            )}
            {sender && (
              <DropdownMenu.Item className={menuItemClass} onSelect={() => void setVip(sender, !vip)}>
                <Crown size={14} className={cn(vip && "fill-current text-pin")} /> <span className="truncate">{vip ? t("Remove {name} from VIPs", { name: sender.name || sender.email }) : t("Mark {name} as VIP", { name: sender.name || sender.email })}</span>
              </DropdownMenu.Item>
            )}
            {sender && <BlockSub sender={sender} />}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <span className="mx-1 h-6 w-px bg-line" />
      <Tooltip label={t("Reply")} shortcut="R" side="top">
        <button
          onClick={onReply}
          className="flex h-10 items-center gap-2 rounded-full bg-accent pr-4 pl-3.5 text-[13.5px] font-medium text-on-accent press hover:bg-accent-hover"
        >
          <Reply size={16} strokeWidth={2.2} />
          {t("Reply")}
        </button>
      </Tooltip>
    </motion.div>
  );
}

