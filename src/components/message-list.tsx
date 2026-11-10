"use client";

import {
  Archive,
  ArchiveRestore,
  Bell,
  BellOff,
  BellPlus,
  ChevronDown,
  ChevronRight,
  MailMinus,
  Newspaper,
  BellRing,
  Check,
  CheckCheck,
  CircleHelp,
  Layers,
  StickyNote,
  Eye,
  CalendarClock,
  CalendarDays,
  CalendarX,
  Clock,
  FolderInput,
  History,
  Inbox,
  KeyRound,
  ListFilter,
  LoaderCircle,
  Mail,
  MailOpen,
  MessageSquareReply,
  Package,
  Paperclip,
  Pin,
  Plane,
  ReceiptText,
  Repeat,
  Search,
  ShieldAlert,
  ShieldCheck,
  SquareArrowOutUpRight,
  Trash2,
  X,
} from "lucide-react";
import { AnimatePresence, motion, type TargetAndTransition, type Variants } from "motion/react";
import { ContextMenu, Popover } from "radix-ui";
import { forwardRef, memo, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  folderLabel,
  inFolder,
  isBin,
  lastMessage,
  listedMessage,
  selectListItems,
  threadCounterpart,
  useMail,
  type ListItem,
  type MailState,
  type Signature,
} from "@/lib/store";
import { bundleSenders, foldPinned, withBundles, type BundleItem, type DisplayItem } from "@/lib/bundles";
import { copyCode, threadCode } from "@/lib/codes";
import { leavingKind, returningKind } from "@/lib/leaving";
import { startThreadDrag } from "@/lib/drag-threads";
import { t, tk, tn } from "@/lib/i18n";
import { CATEGORY_VIEWS, insightCards, insightChip, isCategoryView } from "@/lib/insights";
import { CODE_FRESH_MS, formatCode } from "@/lib/otp";
import { hasOperator, toggleOperator } from "@/lib/search";
import type { Draft, FolderId, Insight, InviteEvent, Person, Thread } from "@/lib/types";
import { LIVE } from "@/lib/live";
import { cn, dateGroup, formatFuture, formatListTime, htmlToText, isTypingTarget, personName } from "@/lib/utils";
import { useNow } from "@/lib/use-now";
import { eventOver, inviteWhen, threadInvite } from "./invite-card";
import { openSummary, openTooltip } from "@/lib/tracking";
import { AgentLogo } from "./activity";
import { BrandMark } from "./brand-mark";
import { CategoryList } from "./category-view";
import { ScreenerBanner, ScreenerList } from "./screener";
import { InstallBanner } from "./install-guide";
import { NotifyBanner } from "./notify-banner";
import { RemindMenu, SnoozeMenu } from "./menus";
import { useScopeLabel } from "./mailbox-switcher";
import { PullIndicator, usePullToRefresh } from "./pull-to-refresh";
import { SwipeDraftRow, SwipeRow, useCoarsePointer } from "./swipe-row";
import { askDeleteForever, askEmptyBin, canDeleteForever } from "./thread-actions";
import { MoveToFolderContextSub, MoveToFolderMenu } from "./folders";
import { Avatar, ClearSearch, Kbd, MailboxBadge, Tooltip, hueStyle, menuItemClass, spring } from "./ui";
import { NoMailbox } from "./welcome";
import { InboxZero } from "./postcard";
import { FilesView } from "./files-view";
import { ContactsList } from "./contacts";
import { ListsView } from "./lists-view";
import { AwayBanner } from "./away-settings";
import { OfflineBanner } from "./offline-banner";
import { SyncBanner, SyncingState, useSyncingEmpty } from "./sync-notice";

/** Bundling for the list on screen; a new object only when something it depends on changes. */
export function useBundling(): Bundling | null {
  const slice = useMail(useShallow((s) => ({ folder: s.folder, bundles: s.bundles, query: s.query, openBundles: s.openBundles, accounts: s.accounts })));
  return useMemo(() => bundlingFor(slice), [slice]);
}

/** Folding Pinned for the list on screen. Only a pinned open conversation counts, so opening others doesn't regroup the list. */
export function usePinnedFold(): PinnedFold | null {
  const slice = useMail(
    useShallow((s) => ({
      folder: s.folder,
      query: s.query,
      pinnedOpen: s.pinnedOpen,
      selectedId: s.selectedId && s.threads[s.selectedId]?.pinned ? s.selectedId : null,
    })),
  );
  return useMemo(() => pinnedFoldFor(slice), [slice]);
}

export function useListItems() {
  const slice = useMail(
    useShallow((s) => ({
      threads: s.threads,
      drafts: s.drafts,
      scope: s.scope,
      folder: s.folder,
      query: s.query,
      unreadOnly: s.unreadOnly,
      searchIds: s.searchIds,
    })),
  );
  return useMemo(() => selectListItems(slice), [slice]);
}

/** `home`: a group in Pinned, named after the folder its conversations are in. `fold`: Inbox's Pinned has a row to fold or unfold it. */
export type Group = { label: string; items: DisplayItem[]; home?: FolderId; fold?: { hidden: Thread[]; open: boolean } };

type Bundling = { open: string[]; mine: Set<string>; members?: boolean };

/** `keep`: the open conversation, shown even when it would fold away. */
export type PinnedFold = { open: boolean; keep: string | null };

/** Many pinned conversations fold down to the newest few in Inbox (src/lib/bundles.ts), unless unfolded or searching. */
export function pinnedFoldFor(s: Pick<MailState, "folder" | "query" | "pinnedOpen" | "selectedId">): PinnedFold | null {
  if (s.folder !== "inbox" || s.query.trim()) return null;
  return { open: s.pinnedOpen, keep: s.selectedId };
}

/** Twenty pinned would push new mail out of sight: Inbox's Pinned group keeps the newest few, and gets a row for the rest. */
export function foldPinnedGroup(group: Group | undefined, fold: PinnedFold | null) {
  if (group?.label !== "Pinned" || !fold) return;
  const { shown, hidden, foldable } = foldPinned(group.items, fold.open, fold.keep);
  group.items = shown;
  if (foldable) group.fold = { hidden: hidden.flatMap((i) => (i.type === "thread" ? [i.thread] : [])), open: fold.open };
}

/** Inbox folds newsletters and automatic mail into bundles (src/lib/bundles.ts), unless turned off or searching. */
export function bundlingFor(s: Pick<MailState, "folder" | "bundles" | "query" | "openBundles" | "accounts">, members = false): Bundling | null {
  if (s.folder !== "inbox" || !s.bundles || s.query.trim()) return null;
  return { open: s.openBundles, mine: new Set(s.accounts.map((a) => a.email.toLowerCase())), members };
}

/** The date a row sorts under: a bundle's is its newest conversation's. */
const itemDate = (item: DisplayItem, folder: string) =>
  item.type === "bundle" ? lastMessage(item.threads[0]).date : item.type === "thread" ? listedMessage(item.thread, folder).date : item.draft.updatedAt;

/** Pinned groups by where each conversation is, in this order; the user's own folders come last. */
const PINNED_HOMES: FolderId[] = ["inbox", "screener", "snoozed", "archive"];

function pinnedHome(thread: Thread, now: number): FolderId {
  return PINNED_HOMES.find((f) => f !== "archive" && inFolder(thread, f, now)) ?? (thread.folderId ? `folder:${thread.folderId}` : "archive");
}

function groupItems(items: ListItem[], folder: string, bundling: Bundling | null = null, fold: PinnedFold | null = null): Group[] {
  if (folder === "drafts" || folder === "scheduled" || folder === "snoozed") return [{ label: "", items }];
  const groups: Group[] = [];
  const push = (label: string, item: DisplayItem, home?: FolderId) => {
    const g = groups.find((x) => x.label === label);
    if (g) g.items.push(item);
    else groups.push({ label, items: [item], home });
  };
  // Pinned spans Inbox and Archive: what's still in Inbox first, then what's put away, so neither is a surprise.
  if (folder === "pinned") {
    const now = Date.now();
    for (const item of items) {
      if (item.type !== "thread") continue;
      const home = pinnedHome(item.thread, now);
      push(home, item, home);
    }
    const rank = (g: Group) => (PINNED_HOMES.includes(g.home!) ? PINNED_HOMES.indexOf(g.home!) : PINNED_HOMES.length);
    return groups.sort((a, b) => rank(a) - rank(b));
  }
  for (const item of items) {
    if (item.type === "thread" && folder === "inbox" && item.thread.pinned) push(tk("Pinned"), item);
  }
  foldPinnedGroup(groups[0], fold);
  // An open bundle's conversations stay in its day, however old they are.
  let bundleDay = "";
  const shown: DisplayItem[] = bundling ? withBundles(items, bundling) : items;
  for (const item of shown) {
    if (item.type === "draft") continue;
    if (item.type === "thread" && folder === "inbox" && item.thread.pinned) continue;
    const day = item.type === "thread" && item.inBundle ? bundleDay : dateGroup(itemDate(item, folder));
    if (item.type === "bundle") bundleDay = day;
    push(day, item);
  }
  return groups;
}

/** The order the user sees, which (thanks to the pinned group and bundles) can differ from the sorted list. Bundle rows aside. */
export function visibleOrder(state = useMail.getState()): ListItem[] {
  return groupItems(selectListItems(state), state.folder, bundlingFor(state, true), pinnedFoldFor(state))
    .flatMap((g) => g.items)
    .filter((i): i is ListItem => i.type !== "bundle");
}

/** What can be selected, in on-screen order (conversations, or drafts in Drafts): what a Shift-click range or ⌘A covers. */
export const visibleThreadIds = () => visibleOrder().map((i) => i.id);

/** The item to show once `id` leaves the list (archive, snooze…). */
export function neighbourOf(id: string) {
  const items = visibleOrder();
  const idx = items.findIndex((i) => i.id === id);
  const next = items[idx + 1] ?? items[idx - 1];
  return next?.type === "thread" ? next.id : null;
}

/**
 * A leaving row first goes the way it went, then closes its gap, and the rows below follow in the
 * flow: nothing overlaps, and nothing has to measure every row on each change (a layout animation
 * did, and that was what stuttered). A row that comes back (Undo) opens its gap first, then returns
 * from where it went; new mail just opens up and fades in.
 */
const leaveEase = [0.4, 0, 0.2, 1] as const;

const rowVariants = (id: string): Variants => ({
  // Closed, and off where it went: Undo brings it back from there.
  enter: () => ({ ...leaveAs(returningKind(id)), height: 0 }),
  shown: {
    height: "auto",
    opacity: 1,
    x: 0,
    y: 0,
    rotate: 0,
    scale: 1,
    transition: { default: { duration: 0.28, delay: 0.1, ease: leaveEase }, height: { duration: 0.24, ease: leaveEase } },
  },
  exit: (calm: boolean) => {
    if (!calm) return { opacity: 0, transition: { duration: 0 } };
    const { transition, ...away } = leaveAs(leavingKind(id));
    return { ...away, height: 0, transition: { default: transition, height: { delay: 0.12, duration: 0.24, ease: leaveEase } } };
  },
});

/**
 * A row leaves the way it went, right where you're looking: archived to the right, filed to the
 * left towards the sidebar, deleted down, snoozed up. Anything else just fades.
 */
export function leaveAs(sig: Signature | null): TargetAndTransition {
  switch (sig) {
    case "archive":
      return { opacity: 0, x: 56, transition: { duration: 0.26, ease: leaveEase } };
    case "folder":
      return { opacity: 0, x: -56, transition: { duration: 0.26, ease: leaveEase } };
    case "inbox":
      return { opacity: 0, x: -36, transition: { duration: 0.24, ease: leaveEase } };
    case "trash":
    case "spam":
      return { opacity: 0, y: 12, rotate: -1.2, scale: 0.97, transition: { duration: 0.24, ease: leaveEase } };
    case "snooze":
      return { opacity: 0, y: -14, scale: 0.98, transition: { duration: 0.26, ease: leaveEase } };
    default:
      return { opacity: 0, scale: 0.985, transition: { duration: 0.16 } };
  }
}

/**
 * Whether the latest change to the list was small (an archive, a new email) and worth animating.
 * A refresh, search or bulk action that swaps many rows at once just shows the new list.
 */
function useCalmChanges(items: ListItem[]) {
  const key = items.map((i) => i.id).join(" ");
  const [last, setLast] = useState({ key, ids: new Set(items.map((i) => i.id)), calm: true });
  if (last.key !== key) {
    const ids = new Set(items.map((i) => i.id));
    let changed = 0;
    for (const id of ids) if (!last.ids.has(id)) changed++;
    for (const id of last.ids) if (!ids.has(id)) changed++;
    setLast({ key, ids, calm: changed <= 3 });
  }
  return last.calm;
}

/** One row with its way in and out. Memoized, so a change to one conversation leaves the other rows be. */
const ListRow = memo(function ListRow({
  id,
  thread,
  draft,
  calm,
  touch,
}: {
  id: string;
  thread?: Thread;
  draft?: Draft;
  calm: boolean;
  touch: boolean;
}) {
  const variants = useMemo(() => rowVariants(id), [id]);
  return (
    <motion.div custom={calm} variants={variants} initial={calm ? "enter" : false} animate="shown" exit="exit" className="overflow-hidden">
      {draft ? (
        touch ? (
          <SwipeDraftRow draft={draft} desktop />
        ) : (
          <DesktopDraftRow draft={draft} />
        )
      ) : thread ? (
        touch ? (
          <SwipeRow thread={thread} desktop />
        ) : (
          <DesktopThreadRow thread={thread} />
        )
      ) : null}
    </motion.div>
  );
});

const BUNDLE_LOOK = {
  newsletter: { icon: Newspaper, label: tk("Newsletters"), hue: 28 },
  notification: { icon: Bell, label: tk("Notifications@@bundle"), hue: 205 },
} as const;

/**
 * A bundle's row: newsletters (or automatic mail) as one line with who sent them. A tap opens it and
 * its conversations unfold under it; it can be read or archived all at once (pinned mail is never in a bundle).
 */
export function BundleRow({ bundle, renderRow, mobile = false }: { bundle: BundleItem; renderRow: (thread: Thread) => React.ReactNode; mobile?: boolean }) {
  const toggle = useMail((s) => s.toggleBundle);
  const accounts = useMail((s) => s.accounts);
  const setFolder = useMail((s) => s.setFolder);
  const { archiveMany, setUnreadMany } = useMail.getState();
  const mine = useMemo(() => new Set(accounts.map((a) => a.email.toLowerCase())), [accounts]);
  const { names, more } = bundleSenders(bundle.threads, mine);
  const unread = bundle.threads.filter((th) => th.unread).length;
  const look = BUNDLE_LOOK[bundle.kind];
  const Icon = look.icon;
  const ids = bundle.threads.map((th) => th.id);
  const newest = lastMessage(bundle.threads[0]).date;
  const action = "press flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors [--press-scale:0.95]";
  return (
    <motion.div layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={bundle.open}
        onClick={() => toggle(bundle.kind)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle(bundle.kind))}
        className={cn(
          "group relative flex cursor-pointer items-center gap-3 rounded-[12px] px-2.5 py-2.5 transition-colors outline-none hover:bg-hover focus-visible:bg-hover [@media(pointer:coarse)]:active:bg-hover",
          mobile && "rounded-none px-4 py-3",
        )}
      >
        {unread > 0 && <span className="absolute top-1/2 left-0.5 size-[7px] -translate-y-1/2 rounded-full bg-accent" aria-label={t("Unread")} />}
        <span className="hue-tint flex size-9 shrink-0 items-center justify-center rounded-full" style={hueStyle(look.hue)}>
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn("min-w-0 truncate text-[13.5px]", unread ? "font-semibold" : "font-medium text-ink/90")}>{t(look.label)}</span>
            <span className="shrink-0 rounded-full bg-hover px-1.5 text-[11.5px] font-medium text-ink-3 tabular-nums">{bundle.threads.length}</span>
            <span className="ml-auto shrink-0 text-[12px] text-ink-3 tabular-nums transition-opacity [@media(hover:hover)]:group-hover:opacity-0">{formatListTime(newest)}</span>
          </div>
          <div className="mt-[1px] truncate text-[12.5px] text-ink-3">
            {more ? t("{names} and {n} more", { names: names.join(", "), n: more }) : names.join(", ")}
          </div>
        </div>
        <motion.span animate={{ rotate: bundle.open ? 90 : 0 }} transition={spring} className="shrink-0 text-ink-3">
          <ChevronRight size={16} />
        </motion.span>
        {/* A mouse gets the two big ones on hover, without opening the bundle. */}
        <div className="glass-strong pointer-events-none absolute top-2 right-9 flex items-center gap-0.5 rounded-full p-0.5 opacity-0 transition-opacity duration-150 [@media(hover:hover)]:group-hover:pointer-events-auto [@media(hover:hover)]:group-hover:opacity-100">
          {unread > 0 && (
            <RowAction label={t("Mark all as read")} onClick={() => setUnreadMany(ids, false)}>
              <MailOpen size={14} />
            </RowAction>
          )}
          <RowAction label={t("Archive all {n}", { n: ids.length })} onClick={() => archiveMany(ids)}>
            <Archive size={14} />
          </RowAction>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {bundle.open && (
          <motion.div
            key="members"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ height: { duration: 0.26, ease: leaveEase }, opacity: { duration: 0.18 } }}
            className="overflow-hidden"
          >
            <div className={cn("flex flex-wrap items-center gap-1.5 pt-0.5 pb-1.5", mobile ? "px-4" : "pl-[54px]")}>
              <button onClick={() => archiveMany(ids)} className={cn(action, "bg-accent text-on-accent hover:bg-accent-hover")}>
                <Archive size={13} /> {t("Archive all {n}", { n: ids.length })}
              </button>
              {unread > 0 && (
                <button onClick={() => setUnreadMany(ids, false)} className={cn(action, "text-ink-2 shadow-[inset_0_0_0_0.5px_var(--line)] hover:bg-hover")}>
                  <MailOpen size={13} /> {t("Mark as read")}
                </button>
              )}
              {bundle.kind === "newsletter" && (
                <button onClick={() => setFolder("lists")} className={cn(action, "text-ink-2 shadow-[inset_0_0_0_0.5px_var(--line)] hover:bg-hover")}>
                  <MailMinus size={13} /> {t("Manage newsletters")}
                </button>
              )}
            </div>
            <div className={cn(mobile ? "border-t border-line" : "ml-[18px] border-l border-line pl-1.5")}>
              <AnimatePresence initial={false}>
                {bundle.threads.map((th, i) => (
                  <motion.div
                    key={th.id}
                    initial={false}
                    exit={{ height: 0, opacity: 0, transition: { duration: 0.22, ease: leaveEase } }}
                    className={cn("overflow-hidden", mobile && i > 0 && "border-t border-line")}
                  >
                    {renderRow(th)}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * The last row of a long Pinned card in Inbox: folded, how many more and from whom, and whether any
 * is unread, so nothing important hides quietly. A tap unfolds them all; unfolded, it folds them back.
 */
export function PinnedFoldRow({ hidden, open, mobile = false }: { hidden: Thread[]; open: boolean; mobile?: boolean }) {
  const toggle = useMail((s) => s.togglePinnedOpen);
  const accounts = useMail((s) => s.accounts);
  const mine = useMemo(() => new Set(accounts.map((a) => a.email.toLowerCase())), [accounts]);
  const unread = hidden.filter((th) => th.unread).length;
  const faces = new Map<string, { person: Person; logo?: string }>();
  for (const th of hidden) {
    const person = threadCounterpart(th, accounts);
    if (faces.size < 3 && !faces.has(person.email)) faces.set(person.email, { person, logo: th.logo });
  }
  return (
    <button
      onClick={toggle}
      aria-expanded={open}
      className={cn(
        "relative flex w-full items-center gap-3 rounded-[12px] px-2.5 py-2 text-left text-[13px] transition-colors outline-none hover:bg-hover focus-visible:bg-hover [@media(pointer:coarse)]:active:bg-hover",
        mobile && "rounded-none border-t border-line px-4 py-2.5",
      )}
    >
      {unread > 0 && <span className="absolute top-1/2 left-0.5 size-[7px] -translate-y-1/2 rounded-full bg-accent" aria-hidden />}
      <span className="flex w-9 shrink-0 justify-center" aria-hidden>
        {[...faces.values()].map((f, i) => (
          <Avatar key={f.person.email} person={f.person} logo={f.logo} size={18} className={cn("shadow-[0_0_0_1.5px_var(--pin-soft)]", i > 0 && "-ml-[9px]")} />
        ))}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {open ? (
          <span className="font-medium text-ink-2">{t("Show fewer")}</span>
        ) : (
          <>
            <span className="font-medium text-ink-2">{tn(hidden.length, "+{n} more", "+{n} more")}</span>{" "}
            <span className="ml-0.5 text-ink-3">{bundleSenders(hidden, mine, 8).names.join(", ")}</span>
          </>
        )}
      </span>
      {unread > 0 && <span className="shrink-0 text-[12px] font-medium text-accent-text tabular-nums">{tn(unread, "{n} unread", "{n} unread")}</span>}
      <motion.span animate={{ rotate: open ? 180 : 0 }} transition={spring} className="shrink-0 text-ink-3">
        <ChevronDown size={15} />
      </motion.span>
    </button>
  );
}

export function MessageList() {
  const items = useListItems();
  const folder = useMail((s) => s.folder);
  const scope = useMail((s) => s.scope);
  const bundling = useBundling();
  const fold = usePinnedFold();
  const groups = useMemo(() => groupItems(items, folder, bundling, fold), [items, folder, bundling, fold]);
  const calm = useCalmChanges(items);
  // Tablets get the phone's gestures in the desktop layout: swipe, long-press to select, pull to refresh.
  const touch = useCoarsePointer();
  const scroller = useRef<HTMLDivElement>(null);
  const selecting = useMail((s) => s.checked.some((id) => s.threads[id] || s.drafts[id]));
  const { pull, refreshing } = usePullToRefresh(scroller, touch && !selecting);
  const syncEmpty = useSyncingEmpty(items.length === 0);
  const togglePinned = useMail((s) => s.togglePinnedOpen);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <ListHeader />
      {/* Another mailbox or folder is a new list: fade it in from the top instead of animating every row out and in. */}
      <motion.div
        key={`${scope}|${folder}`}
        ref={scroller}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.14, ease: "easeOut" }}
        className="relative min-h-0 flex-1 overflow-y-auto px-2 pb-3"
      >
        {touch && <PullIndicator pull={pull} refreshing={refreshing} />}
        {folder === "inbox" && <InstallBanner />}
        {folder === "inbox" && <NotifyBanner />}
        {folder === "inbox" && <ScreenerBanner />}
        {folder === "inbox" && <AwayBanner />}
        <OfflineBanner />
        {!syncEmpty && <SyncBanner />}
        {isCategoryView(folder) ? (
          <CategoryList view={folder} />
        ) : folder === "files" ? (
          <FilesView />
        ) : folder === "contacts" ? (
          <ContactsList />
        ) : folder === "lists" ? (
          <ListsView />
        ) : folder === "screener" ? (
          <ScreenerList />
        ) : syncEmpty ? (
          <SyncingState />
        ) : items.length === 0 ? (
          <>
            <EmptyState />
            <SearchOlder />
          </>
        ) : (
          groups.map((g) => (
            <section key={g.label || "all"} className="relative">
              {g.label && (
                <div className="sticky top-0 z-10 -mx-2 flex items-center gap-1.5 px-4 pt-3 pb-1.5 text-[11px] font-medium text-ink-3 backdrop-blur-xl [background:linear-gradient(var(--panel)_60%,transparent)]">
                  {g.label === "Pinned" && <Pin size={11} className="fill-current text-pin" />}
                  {/* A long Pinned card folds from its heading too. */}
                  {g.fold ? (
                    <button onClick={togglePinned} aria-expanded={g.fold.open} className="transition-colors hover:text-ink-2">
                      {t(g.label)}
                    </button>
                  ) : g.home ? (
                    folderLabel(g.home)
                  ) : (
                    t(g.label)
                  )}
                </div>
              )}
              {/* Pinned: a sticky-note card around them, so they stand apart from the day's mail. */}
              <div className={g.label === "Pinned" ? "rounded-[14px] bg-pin-soft p-0.5 shadow-[inset_0_0_0_1px_var(--pin-line)]" : undefined}>
                <AnimatePresence initial={false} custom={calm}>
                  {g.items.map((item) =>
                    item.type === "bundle" ? (
                      <BundleRow key={item.id} bundle={item} renderRow={(th) => (touch ? <SwipeRow thread={th} desktop /> : <DesktopThreadRow thread={th} />)} />
                    ) : (
                      <ListRow
                        key={item.id}
                        id={item.id}
                        thread={item.type === "thread" ? item.thread : undefined}
                        draft={item.type === "draft" ? item.draft : undefined}
                        calm={calm}
                        touch={touch}
                      />
                    ),
                  )}
                </AnimatePresence>
                {g.fold && <PinnedFoldRow hidden={g.fold.hidden} open={g.fold.open} />}
              </div>
            </section>
          ))
        )}
        {items.length > 0 && !isCategoryView(folder) && folder !== "screener" && folder !== "files" && folder !== "contacts" && folder !== "lists" && <SearchOlder />}
      </motion.div>
      <SelectionBar />
    </div>
  );
}

/** Floating actions for a multi-selection (⌘/Ctrl-click, Shift-click, ⌘A). */
function SelectionBar() {
  // Conversations, or drafts in Drafts.
  const checked = useMail(useShallow((s) => s.checked.filter((id) => s.threads[id] || s.drafts[id])));
  const clearChecked = useMail((s) => s.clearChecked);
  const checkAll = useMail((s) => s.checkAll);
  // No ⌘A on a tablet.
  const touch = useCoarsePointer();

  return (
    <AnimatePresence>
      {checked.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.97, transition: { duration: 0.15 } }}
          transition={spring}
          className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3"
        >
          {/* In the app's colour, not glass: it has to be noticed the moment it appears. */}
          <div className="pointer-events-auto flex items-center gap-0.5 rounded-full bg-accent py-1 pr-1 pl-3.5 text-[13px] text-on-accent shadow-[var(--shadow-float)] [&_button]:text-on-accent/80 [&_button:hover]:bg-on-accent/15 [&_button:hover]:text-on-accent [&_button[data-state=open]]:bg-on-accent/15">
            <span className="mr-1.5 font-medium tabular-nums">{t("{n} selected", { n: checked.length })}</span>
            {touch && (
              <button onClick={() => checkAll(visibleThreadIds())} className="mr-1 rounded-full px-2 py-1 text-[12.5px] font-medium">
                {t("All")}
              </button>
            )}
            <SelectionActions ids={checked} />
            <span className="mx-1 h-4 w-px bg-on-accent/25" />
            <RowAction label={t("Clear selection")} shortcut="Esc" onClick={clearChecked}>
              <X size={15} />
            </RowAction>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * What a selection can do, by where it is: Trash and Spam offer a way back and deleting for good,
 * everywhere else the usual Archive, Read, Pin, Snooze and Delete. Shared by the desktop bar and
 * the touch selection bar.
 */
export function SelectionActions({
  ids,
  size = 15,
  button: Button = RowAction,
}: {
  ids: string[];
  size?: number;
  button?: React.ComponentType<ActionButtonProps & React.RefAttributes<HTMLButtonElement>>;
}) {
  const threads = useMail(useShallow((s) => ids.map((id) => s.threads[id]).filter(Boolean)));
  const draftIds = useMail(useShallow((s) => ids.filter((id) => s.drafts[id])));
  const accounts = useMail((s) => s.accounts);
  const { archiveMany, trashMany, moveManyToInbox, setUnreadMany, setPinnedMany, snoozeMany, discardDrafts } = useMail.getState();
  // Drafts in Drafts: deleting is all there is to do with several at once.
  if (!threads.length && draftIds.length) {
    return (
      <Button label={t("Delete")} shortcut="#" onClick={() => discardDrafts(draftIds)}>
        <Trash2 size={size} />
      </Button>
    );
  }
  if (!threads.length) return null;
  const bin = threads.every((th) => isBin(th.folder)) ? threads[0].folder : null;

  if (bin) {
    return (
      <>
        <Button label={bin === "spam" ? t("Not spam") : t("Restore")} onClick={() => moveManyToInbox(ids)}>
          {bin === "spam" ? <ShieldCheck size={size} /> : <ArchiveRestore size={size} />}
        </Button>
        {bin === "spam" && (
          <Button label={t("Delete")} shortcut="#" onClick={() => trashMany(ids)}>
            <Trash2 size={size} />
          </Button>
        )}
        {threads.some((th) => canDeleteForever(th, accounts)) && (
          <Button label={t("Delete forever")} onClick={() => askDeleteForever(ids)}>
            <Trash2 size={size} className="text-danger" />
          </Button>
        )}
      </>
    );
  }

  const allArchived = threads.every((th) => th.folder === "archive");
  const anyUnread = threads.some((th) => th.unread);
  const allPinned = threads.every((th) => th.pinned);
  return (
    <>
      {allArchived ? (
        <Button label={t("Move to Inbox")} shortcut="E" onClick={() => moveManyToInbox(ids)}>
          <Inbox size={size} />
        </Button>
      ) : (
        <Button label={t("Archive")} shortcut="E" onClick={() => archiveMany(ids)}>
          <Archive size={size} />
        </Button>
      )}
      <Button label={t("Delete")} shortcut="#" onClick={() => trashMany(ids)}>
        <Trash2 size={size} />
      </Button>
      <Button label={anyUnread ? t("Mark as read") : t("Mark as unread")} shortcut="U" onClick={() => setUnreadMany(ids, !anyUnread)}>
        {anyUnread ? <MailOpen size={size} /> : <Mail size={size} />}
      </Button>
      <Button label={allPinned ? t("Unpin") : t("Pin")} shortcut="P" onClick={() => setPinnedMany(ids, !allPinned)}>
        <Pin size={size} className={cn(allPinned && "fill-current")} />
      </Button>
      <SnoozeMenu onPick={(at) => snoozeMany(ids, at)} side="top" align="center" tooltip={{ label: t("Snooze"), shortcut: "H" }}>
        <Button label={t("Snooze")} bare>
          <Clock size={size} />
        </Button>
      </SnoozeMenu>
      <MoveToFolderMenu ids={ids}>
        <Button label={t("Move to folder")} bare>
          <FolderInput size={size} />
        </Button>
      </MoveToFolderMenu>
    </>
  );
}

const CARD_COUNTS = {
  orders: (n: number) => tn(n, "{n} order", "{n} orders"),
  travel: (n: number) => tn(n, "{n} trip", "{n} trips"),
  invoices: (n: number) => tn(n, "{n} invoice", "{n} invoices"),
  subscriptions: (n: number) => tn(n, "{n} subscription", "{n} subscriptions"),
  security: (n: number) => tn(n, "{n} security notice", "{n} security notices"),
  replies: (n: number) => tn(n, "{n} conversation", "{n} conversations"),
} as const;

export function ListHeader({ compact }: { compact?: boolean }) {
  const scope = useMail((s) => s.scope);
  const folder = useMail((s) => s.folder);
  const accounts = useMail((s) => s.accounts);
  const query = useMail((s) => s.query);
  const setQuery = useMail((s) => s.setQuery);
  const unreadOnly = useMail((s) => s.unreadOnly);
  const toggleUnreadOnly = useMail((s) => s.toggleUnreadOnly);
  const items = useListItems();
  const account = accounts.find((a) => a.id === scope);
  const scopeLabel = useScopeLabel();
  const contactCount = useMail((s) => s.contacts.length);
  const [focused, setFocused] = useState(false);

  const unread = items.filter((i) => i.type === "thread" && i.thread.unread).length;
  const cards = isCategoryView(folder)
    ? insightCards(
        items.flatMap((i) => (i.type === "thread" ? [i.thread] : [])),
        CATEGORY_VIEWS[folder],
      ).length
    : 0;
  const detail =
    folder === "inbox"
      ? unread
        ? tn(unread, "{n} unread", "{n} unread")
        : t("All read")
      : isCategoryView(folder)
        ? CARD_COUNTS[folder](cards)
        : folder === "files"
          ? t("Attachments from your mail")
          : folder === "contacts"
            ? tn(contactCount, "{n} person", "{n} people")
            : folder === "lists"
              ? t("Who sends you newsletters, and what you read")
              : tn(items.length, "{n} conversation", "{n} conversations");

  return (
    <div className={cn("shrink-0 px-4 pt-4 pb-2", compact && "px-0 pt-0")}>
      {!compact && (
        <div className="mb-3 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 truncate text-[20px] font-semibold tracking-[-0.02em]">
              {account && <MailboxBadge icon={account.icon} hue={account.hue} image={account.image} size={22} />}
              {folderLabel(folder)}
            </h1>
            <p className="truncate text-[12.5px] text-ink-3">
              {scopeLabel} · {detail}
            </p>
          </div>
          {folder !== "drafts" && folder !== "files" && folder !== "contacts" && folder !== "lists" && !isBin(folder) && !isCategoryView(folder) && (
            <Tooltip label={unreadOnly ? t("Show all") : t("Only unread")} shortcut="⇧U">
              <button
                onClick={toggleUnreadOnly}
                aria-pressed={unreadOnly}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium transition-colors",
                  unreadOnly ? "bg-accent text-on-accent" : "text-ink-2 shadow-[inset_0_0_0_0.5px_var(--line)] hover:bg-hover",
                )}
              >
                <ListFilter size={13} />
                {t("Unread")}
              </button>
            </Tooltip>
          )}
        </div>
      )}
      {isBin(folder) && <BinBar folder={folder as "trash" | "spam"} />}
      <label className="group flex h-9 items-center gap-2 rounded-[11px] bg-hover px-3 text-ink-3 transition-shadow focus-within:bg-solid focus-within:shadow-[0_0_0_1px_var(--accent),0_0_0_4px_var(--accent-soft)]">
        <Search size={15} />
        <input
          id="list-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQuery("");
              e.currentTarget.blur();
            }
          }}
          placeholder={folder === "inbox" ? t("Search all mail") : t("Search {folder}", { folder: folderLabel(folder).toLowerCase() })}
          className="min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-ink-3 md:text-[13.5px]"
        />
        {query ? <ClearSearch onClear={() => setQuery("")} /> : <Kbd className="hidden md:inline-flex">/</Kbd>}
      </label>
      {(focused || query) && folder !== "drafts" && folder !== "files" && folder !== "contacts" && folder !== "lists" && <SearchChips query={query} folder={folder} onChange={setQuery} />}
    </div>
  );
}

/** Quick filters under the search box (they're operators in the query, so they can be typed too) and how to type the rest. */
function SearchChips({ query, folder, onChange }: { query: string; folder: string; onChange: (q: string) => void }) {
  const chip = (operator: string, label: string, Icon: typeof Paperclip) => {
    const on = hasOperator(query, operator);
    return (
      <button
        // Keep the caret in the search box: the chips only show while it's in use.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onChange(toggleOperator(query, operator))}
        aria-pressed={on}
        className={cn(
          "flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium transition-colors",
          on ? "bg-accent text-on-accent" : "text-ink-2 shadow-[inset_0_0_0_0.5px_var(--line)] hover:bg-hover",
        )}
      >
        <Icon size={12} />
        {label}
      </button>
    );
  };
  return (
    <div className="no-scrollbar -mx-1 mt-2 flex items-center gap-1.5 overflow-x-auto px-1">
      {chip("has:attachment", t("With attachment"), Paperclip)}
      {/* From Inbox the search always looks everywhere (searchFrom). */}
      {folder !== "inbox" && chip("in:all", t("All folders"), Layers)}
      <Popover.Root>
        <Popover.Trigger asChild>
          <button onMouseDown={(e) => e.preventDefault()} className="flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-[12px] font-medium text-ink-3 transition-colors hover:bg-hover hover:text-ink">
            <CircleHelp size={13} /> {t("Search tips")}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content side="bottom" align="start" sideOffset={6} collisionPadding={12} onOpenAutoFocus={(e) => e.preventDefault()} className="glass-strong z-50 w-[300px] rounded-2xl p-3 text-[12.5px] text-ink-2 data-[state=open]:animate-[menu-in_140ms_ease-out]">
            <div className="mb-2 font-medium text-ink">{t("Narrow it down")}</div>
            <ul className="flex flex-col gap-1.5">
              {SEARCH_TIPS.map(([op, label]) => (
                <li key={op} className="flex items-baseline justify-between gap-3">
                  <button onClick={() => onChange(`${query.trim()} ${op}`.trim())} className="shrink-0 rounded-md bg-hover px-1.5 py-0.5 font-mono text-[11.5px] text-ink hover:bg-selected">
                    {op}
                  </button>
                  <span className="text-right text-ink-3">{t(label)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2.5 text-[11.5px] leading-relaxed text-ink-3">{t("Czech works too: od:, komu:, má:přílohu, je:nepřečtené, před:, po:.")}</p>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

const SEARCH_TIPS: [string, string][] = [
  ["from:petr", tk("From someone (name or address)")],
  ["to:jana", tk("To someone")],
  ["subject:invoice", tk("Words in the subject")],
  ["has:attachment", tk("With an attachment")],
  ["is:unread", tk("Unread only")],
  ["is:pinned", tk("Pinned only")],
  ["after:2026-09-01", tk("From that day on")],
  ["before:2026-10-01", tk("Before that day")],
  ["in:all", tk("In every folder")],
];

/** Trash and Spam: how long mail stays, and emptying them for good. */
export function BinBar({ folder }: { folder: "trash" | "spam" }) {
  const accounts = useMail((s) => s.accounts);
  const scope = useMail((s) => s.scope);
  const items = useListItems();
  const inScope = accounts.filter((a) => scope === "all" || a.id === scope);
  const gmail = inScope.filter((a) => a.provider === "gmail").length;
  const deletable = items.some((i) => i.type === "thread" && canDeleteForever(i.thread, accounts));
  const note =
    gmail === 0
      ? null
      : gmail === inScope.length
        ? t("Gmail deletes mail here for good after 30 days.")
        : t("Gmail mailboxes delete mail here after 30 days on their own.");
  if (!note && !deletable) return null;
  return (
    <div className="mb-2 flex items-center gap-3 rounded-[11px] bg-hover px-3 py-2 text-[12px] text-ink-3">
      <span className="min-w-0 flex-1">{note ?? (folder === "trash" ? t("Deleted mail waits here until you empty Trash.") : t("Mail your provider thinks is spam."))}</span>
      {deletable && (
        <button
          onClick={() => askEmptyBin(folder)}
          className="shrink-0 rounded-full px-2.5 py-1 font-medium text-danger transition-colors hover:bg-danger/10"
        >
          {folder === "trash" ? t("Empty Trash") : t("Empty Spam")}
        </button>
      )}
    </div>
  );
}

/**
 * Searching while a mailbox's history is still coming in: what the provider has beyond what's here
 * can be fetched for this search.
 */
export function SearchOlder() {
  const query = useMail((s) => s.query);
  const busy = useMail((s) => s.searchingOlder);
  const importing = useMail((s) => s.accounts.some((a) => (s.scope === "all" || a.id === s.scope) && a.historyComplete === false));
  if (!LIVE || !query.trim() || !importing) return null;
  return (
    <div className="flex flex-col items-center gap-1.5 px-4 py-5 text-center">
      <button
        onClick={() => void useMail.getState().searchOlder()}
        disabled={busy}
        className="flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-medium text-ink shadow-[inset_0_0_0_0.5px_var(--line)] transition-colors hover:bg-hover disabled:opacity-60"
      >
        {busy ? <LoaderCircle size={13} className="animate-spin" /> : <History size={13} />}
        {t("Search older mail too")}
      </button>
      <p className="text-[12px] text-ink-3">{t("Older mail is still coming in. This asks the provider directly.")}</p>
    </div>
  );
}

function EmptyState() {
  const folder = useMail((s) => s.folder);
  const query = useMail((s) => s.query);
  const copy: Record<string, [string, string]> = {
    inbox: [t("Inbox zero"), t("Nothing left. Enjoy the quiet.")],
    pinned: [t("Nothing pinned"), t("Pin what matters with P.")],
    snoozed: [t("No snoozed mail"), t("Press H to bring an email back later.")],
    scheduled: [t("Nothing scheduled"), t("Schedule a message from the send button.")],
    drafts: [t("No drafts"), t("Press C to start writing.")],
    sent: [t("Nothing sent yet"), ""],
    archive: [t("Archive is empty"), ""],
    trash: [t("Trash is empty"), t("Deleted mail waits here before it's gone for good.")],
    unanswered: [t("Nobody owes you a reply"), t("Emails you sent that nobody has answered for three working days show up here.")],
    spam: [t("No spam"), t("Nice. Nothing suspicious got through.")],
  };
  const noMailbox = useMail((s) => LIVE && s.ready && s.accounts.length === 0);
  const ready = useMail((s) => s.ready);
  // On a computer the postcard is always in the reader beside the list; the list just says so.
  if (folder === "inbox" && !query && !noMailbox && ready) return <InboxZero where="list" />;
  const [title, body] = query
    ? [t("No results"), t("Nothing matches “{query}”.", { query })]
    : (copy[folder] ?? [t("Nothing in {folder}", { folder: folderLabel(folder) }), t("Move mail here from its menu, or with the folder button when several are selected.")]);
  if (noMailbox && !query)
    return (
      <div className="flex h-full min-h-[280px] items-center justify-center">
        <NoMailbox />
      </div>
    );
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15, ...spring }}
      className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 text-center"
    >
      <div className="opacity-80">
        <BrandMark size={40} />
      </div>
      <div>
        <div className="text-[15px] font-semibold">{title}</div>
        {body && <div className="mt-0.5 text-[13px] text-ink-3">{body}</div>}
      </div>
    </motion.div>
  );
}

/** Memoized: archiving one conversation re-renders that row, not all of them with their tooltips and menus. */
const DesktopThreadRow = memo(function DesktopThreadRow({ thread }: { thread: Thread }) {
  const openThread = useMail((s) => s.openThread);
  const archive = useMail((s) => s.archive);
  const togglePin = useMail((s) => s.togglePin);
  const setUnread = useMail((s) => s.setUnread);
  const snooze = useMail((s) => s.snooze);
  const checkThread = useMail((s) => s.checkThread);
  const clearChecked = useMail((s) => s.clearChecked);
  const checked = useMail((s) => s.checked.includes(thread.id));
  // Right-clicking a row inside a multi-selection acts on the whole selection.
  const group = useMail(useShallow((s) => (checked && s.checked.length > 1 ? s.checked.filter((id) => s.threads[id]) : null)));
  // While something is selected, the selection bar is what acts: one row's own buttons would act on that row alone.
  const selecting = useMail((s) => s.checked.some((id) => s.threads[id]));
  // Drag onto a folder in the sidebar (with a mouse; touch has long-press and swipes).
  const touch = useCoarsePointer();

  const nextAfter = () => neighbourOf(thread.id);
  const many = group?.length ?? 0;
  const { archiveMany, trashMany, setPinnedMany, setUnreadMany, moveToInbox, trash, spam, notWaiting, remindIfNoReply } = useMail.getState();
  const accounts = useMail((s) => s.accounts);
  const bin = isBin(thread.folder) ? thread.folder : null;
  // No reply yet: what to do about a silence is remind or stop waiting.
  const waitingView = useMail((s) => s.folder === "unanswered");

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          draggable={!touch}
          onDragStart={(e) => {
            const ids = group ?? [thread.id];
            startThreadDrag(e, ids, ids.length > 1 ? tn(ids.length, "{n} conversations", "{n} conversations") : thread.subject || t("(no subject)"));
          }}
        >
          <ThreadRow
            thread={thread}
            checked={checked}
            onCheck={(mode) => {
              // Keys like E act on the selection, so they mustn't land in a reply that was focused.
              if (isTypingTarget(document.activeElement)) (document.activeElement as HTMLElement).blur();
              checkThread(thread.id, mode, visibleThreadIds());
            }}
            onOpen={(newTab) => {
              clearChecked();
              openThread(thread.id, { newTab });
            }}
            actions={
              selecting ? undefined : waitingView ? (
                <>
                  <RemindMenu current={thread.followUpAt} onPick={(at) => remindIfNoReply(thread.id, at)}>
                    <RowButton aria-label={t("Remind me if no reply")}>
                      <BellRing size={14} />
                    </RowButton>
                  </RemindMenu>
                  <RowAction label={t("Not waiting")} onClick={() => notWaiting(thread.id)}>
                    <CheckCheck size={14} />
                  </RowAction>
                </>
              ) : bin ? (
                <>
                  <RowAction label={bin === "spam" ? t("Not spam") : t("Restore")} onClick={() => moveToInbox(thread.id)}>
                    {bin === "spam" ? <ShieldCheck size={14} /> : <ArchiveRestore size={14} />}
                  </RowAction>
                  {bin === "spam" && (
                    <RowAction label={t("Delete")} shortcut="#" onClick={() => trash(thread.id, nextAfter())}>
                      <Trash2 size={14} />
                    </RowAction>
                  )}
                  {canDeleteForever(thread, accounts) && (
                    <RowAction label={t("Delete forever")} onClick={() => askDeleteForever([thread.id])}>
                      <Trash2 size={14} className="text-danger" />
                    </RowAction>
                  )}
                </>
              ) : (
                <>
                  <RowAction label={t("Archive")} shortcut="E" onClick={() => archive(thread.id, nextAfter())}>
                    <Archive size={14} />
                  </RowAction>
                  <RowAction label={t("Delete")} shortcut="#" onClick={() => trash(thread.id, nextAfter())}>
                    <Trash2 size={14} />
                  </RowAction>
                  <RowAction label={thread.pinned ? t("Unpin") : t("Pin")} shortcut="P" onClick={() => togglePin(thread.id)}>
                    <Pin size={14} className={cn(thread.pinned && "fill-current")} />
                  </RowAction>
                  <SnoozeMenu onPick={(at) => snooze(thread.id, at, nextAfter())} tooltip={{ label: t("Snooze"), shortcut: "H" }}>
                    <RowButton aria-label={t("Snooze")}>
                      <Clock size={14} />
                    </RowButton>
                  </SnoozeMenu>
                </>
              )
            }
          />
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="glass-strong z-50 min-w-[210px] rounded-xl p-1 text-[13px] text-ink data-[state=open]:animate-[menu-in_120ms_ease-out]">
          {group ? (
            <>
              <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-ink-3">{tn(many, "{n} conversation", "{n} conversations")}</div>
              <ContextMenu.Item className={menuItemClass} onSelect={() => archiveMany(group)}>
                <Archive size={14} /> {t("Archive all")} <Kbd className="ml-auto">E</Kbd>
              </ContextMenu.Item>
              <ContextMenu.Item className={menuItemClass} onSelect={() => trashMany(group)}>
                <Trash2 size={14} /> {t("Delete all")} <Kbd className="ml-auto">#</Kbd>
              </ContextMenu.Item>
              <ContextMenu.Item className={menuItemClass} onSelect={() => setPinnedMany(group, true)}>
                <Pin size={14} /> {t("Pin all")}
              </ContextMenu.Item>
              <ContextMenu.Item className={menuItemClass} onSelect={() => setUnreadMany(group, false)}>
                <MailOpen size={14} /> {t("Mark all as read")}
              </ContextMenu.Item>
              <ContextMenu.Item className={menuItemClass} onSelect={() => setUnreadMany(group, true)}>
                <Mail size={14} /> {t("Mark all as unread")}
              </ContextMenu.Item>
              <MoveToFolderContextSub ids={group} />
            </>
          ) : (
            <>
              <ContextMenu.Item className={menuItemClass} onSelect={() => openThread(thread.id, { newTab: true })}>
                <SquareArrowOutUpRight size={14} /> {t("Open in new tab")}
              </ContextMenu.Item>
              <ContextMenu.Separator className="my-1 h-px bg-line" />
              {bin ? (
                <ContextMenu.Item className={menuItemClass} onSelect={() => moveToInbox(thread.id)}>
                  {bin === "spam" ? <ShieldCheck size={14} /> : <ArchiveRestore size={14} />} {bin === "spam" ? t("Not spam") : t("Restore to Inbox")}
                </ContextMenu.Item>
              ) : (
                <ContextMenu.Item className={menuItemClass} onSelect={() => archive(thread.id, nextAfter())}>
                  <Archive size={14} /> {t("Archive")} <Kbd className="ml-auto">E</Kbd>
                </ContextMenu.Item>
              )}
              {!bin && (
                <ContextMenu.Item className={menuItemClass} onSelect={() => togglePin(thread.id)}>
                  <Pin size={14} /> {thread.pinned ? t("Unpin") : t("Pin")} <Kbd className="ml-auto">P</Kbd>
                </ContextMenu.Item>
              )}
              <ContextMenu.Item className={menuItemClass} onSelect={() => setUnread(thread.id, !thread.unread)}>
                <MailOpen size={14} /> {thread.unread ? t("Mark as read") : t("Mark as unread")} <Kbd className="ml-auto">U</Kbd>
              </ContextMenu.Item>
              {!bin && <MoveToFolderContextSub ids={[thread.id]} />}
              <ContextMenu.Separator className="my-1 h-px bg-line" />
              {bin !== "spam" && (
                <ContextMenu.Item className={menuItemClass} onSelect={() => spam(thread.id, nextAfter())}>
                  <ShieldAlert size={14} /> {t("Report spam")} <Kbd className="ml-auto">!</Kbd>
                </ContextMenu.Item>
              )}
              {bin !== "trash" && (
                <ContextMenu.Item className={menuItemClass} onSelect={() => trash(thread.id, nextAfter())}>
                  <Trash2 size={14} /> {t("Delete")} <Kbd className="ml-auto">#</Kbd>
                </ContextMenu.Item>
              )}
              {bin && canDeleteForever(thread, accounts) && (
                <ContextMenu.Item className={cn(menuItemClass, "text-danger")} onSelect={() => askDeleteForever([thread.id])}>
                  <Trash2 size={14} /> {t("Delete forever")}
                </ContextMenu.Item>
              )}
            </>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
});

const RowButton = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(function RowButton(
  { onClick, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      {...rest}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      className="press flex size-7 items-center justify-center rounded-full text-ink-2 [--press-scale:0.86] hover:bg-hover hover:text-ink data-[state=open]:bg-hover [@media(pointer:coarse)]:size-10"
    >
      {children}
    </button>
  );
});

export type ActionButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  shortcut?: string;
  /** No tooltip of its own, e.g. inside a menu trigger that brings one. */
  bare?: boolean;
};

const RowAction = forwardRef<HTMLButtonElement, ActionButtonProps>(function RowAction({ label, shortcut, bare, children, ...rest }, ref) {
  const button = (
    <RowButton ref={ref} aria-label={label} {...rest}>
      {children}
    </RowButton>
  );
  return bare ? (
    button
  ) : (
    <Tooltip label={label} shortcut={shortcut} side="top">
      {button}
    </Tooltip>
  );
});

const dotSpring = { type: "spring", stiffness: 620, damping: 22, mass: 0.5 } as const;

/**
 * A warm letter: from someone you write with. Čapek's post-office goblins could feel which letters
 * were written from the heart; the ace of hearts was the one written with love.
 */
export function WarmMark({ active, className, size = 10 }: { active?: boolean; className?: string; size?: number }) {
  return (
    <Tooltip label={t("From someone you write with")} side="top">
      <span className={cn("inline-flex translate-y-[-0.5px] align-middle", active ? "text-on-accent/85" : "text-warm", className)} aria-label={t("From someone you write with")}>
        <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden>
          <path
            fill="currentColor"
            d="M6 10.8C3.1 8.6 1.1 6.8 1.1 4.5c0-1.6 1.2-2.8 2.8-2.8.9 0 1.7.4 2.1 1.1.4-.7 1.2-1.1 2.1-1.1 1.6 0 2.8 1.2 2.8 2.8 0 2.3-2 4.1-4.9 6.3z"
          />
        </svg>
      </span>
    </Tooltip>
  );
}

export const ThreadRow = memo(function ThreadRow({
  thread,
  onOpen,
  onCheck,
  checked = false,
  selectMode = false,
  actions,
  forceInactive,
}: {
  thread: Thread;
  onOpen: (newTab: boolean) => void;
  /** Desktop multi-select: ⌘/Ctrl-click toggles this row, Shift-click selects a range. */
  onCheck?: (mode: "toggle" | "range") => void;
  checked?: boolean;
  /** Touch selection mode: every row shows a small circle in place of the avatar. */
  selectMode?: boolean;
  actions?: React.ReactNode;
  forceInactive?: boolean;
}) {
  const accounts = useMail((s) => s.accounts);
  const scope = useMail((s) => s.scope);
  const density = useMail((s) => s.density);
  // A memoized row still has to show a new language.
  useMail((s) => s.language);
  // While several rows are selected, the open conversation stops looking selected on its own.
  const active = useMail(
    (s) =>
      !forceInactive &&
      !s.checked.length &&
      s.tabs.some((t) => t.id === s.activeTabId && t.kind === "thread" && t.threadId === thread.id),
  );
  const hasDraft = useMail((s) => Object.values(s.drafts).some((d) => d.threadId === thread.id));
  const draftAgent = useMail((s) => {
    const d = Object.values(s.drafts).find((x) => x.threadId === thread.id && x.agentId);
    return d ? s.agents.find((a) => a.id === d.agentId) : undefined;
  });

  const inSent = useMail((s) => s.folder === "sent");

  const account = accounts.find((a) => a.id === thread.accountId);
  const last = listedMessage(thread, inSent ? "sent" : "");
  // In Sent the row is the user's own email, also in a conversation someone has answered since.
  const sentView = inSent && last.date === thread.sentAt;
  const counterpart = (sentView && last.to[0]) || threadCounterpart(thread, accounts);
  const preview = last.snippet ?? htmlToText(last.html);
  const hasAttachment = thread.messages.some((m) => m.attachments?.length);
  const compact = density === "compact";
  const now = useNow();
  const receipt = accounts.some((a) => a.email === last.from.email) ? openSummary(last) : null;
  const code = !isBin(thread.folder) && now - last.date < CODE_FRESH_MS ? threadCode(thread) : null;
  const insight = useMail((s) => (s.smartCategories ? thread.insight : undefined));
  const invite = threadInvite(thread.messages);

  const meta =
    thread.folder === "scheduled" && thread.scheduledAt ? (
      <span className="flex items-center gap-1 text-accent-text">
        <CalendarClock size={12} /> {formatFuture(thread.scheduledAt)}
      </span>
    ) : thread.snoozedUntil && thread.snoozedUntil > now ? (
      <span className="flex items-center gap-1">
        <Clock size={12} /> {formatFuture(thread.snoozedUntil)}
      </span>
    ) : (
      formatListTime(last.date)
    );

  return (
    <div
      role="button"
      tabIndex={-1}
      data-thread-id={thread.id}
      aria-pressed={onCheck ? checked : undefined}
      onClick={(e) => {
        if (onCheck && e.shiftKey) onCheck("range");
        else if (onCheck && (e.metaKey || e.ctrlKey)) onCheck("toggle");
        else onOpen(!onCheck && (e.metaKey || e.ctrlKey));
      }}
      // Shift-click would otherwise also select text across the rows.
      onMouseDown={(e) => onCheck && e.shiftKey && e.preventDefault()}
      onDoubleClick={() => onOpen(true)}
      onAuxClick={(e) => e.button === 1 && onOpen(true)}
      className={cn(
        "group relative flex gap-3 rounded-[12px] px-2.5 transition-colors duration-100",
        compact ? "py-2" : "py-2.5",
        // On touch the row lights up under the finger, a beat late so scrolling doesn't flash every row.
        active ? "bg-accent text-on-accent" : checked ? "bg-accent-soft" : "hover:bg-hover [@media(pointer:coarse)]:active:bg-hover [@media(pointer:coarse)]:active:delay-75",
      )}
    >
      <AnimatePresence initial={false}>
        {thread.unread && !active && (
          <motion.span
            key="unread"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={dotSpring}
            className="absolute top-1/2 left-0.5 size-[7px] -translate-y-1/2 rounded-full bg-accent"
            aria-label={t("Unread")}
          />
        )}
      </AnimatePresence>
      {selectMode ? (
        <span className={cn("flex shrink-0 items-center justify-center", compact ? "w-7" : "mt-0.5 h-9 w-9")} aria-hidden>
          <span
            className={cn(
              "flex size-[22px] items-center justify-center rounded-full transition-[background-color,box-shadow] duration-150",
              checked ? "bg-accent text-on-accent" : "text-ink-3/60 shadow-[inset_0_0_0_1.5px_currentColor]",
            )}
          >
            {checked && <Check size={13} strokeWidth={3} />}
          </span>
        </span>
      ) : (
        <span className={cn("relative shrink-0", compact ? "mt-0" : "mt-0.5")}>
          <Avatar person={counterpart} logo={thread.logo} size={compact ? 28 : 36} className={cn(active && "shadow-[0_0_0_1.5px_rgb(255_255_255/0.6)]")} />
          {checked && (
            <span
              className="absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full bg-accent text-on-accent shadow-[0_0_0_2px_var(--solid)]"
              aria-hidden
            >
              <Check size={10} strokeWidth={3.2} />
            </span>
          )}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-[13.5px]", thread.unread ? "font-semibold" : "font-medium", !active && !thread.unread && "text-ink/90")}>
            {sentView || thread.folder === "sent" || thread.folder === "scheduled" ? t("To: {name}", { name: personName(counterpart) }) : personName(counterpart)}
            {thread.messages.length > 1 && (
              <span className={cn("ml-1.5 text-[12px] font-normal", active ? "text-on-accent/70" : "text-ink-3")}>{thread.messages.length}</span>
            )}
            {thread.warm && !sentView && thread.folder !== "sent" && thread.folder !== "scheduled" && <WarmMark active={active} className="ml-1.5" />}
          </span>
          {/* All mailboxes: which one it came to, as that mailbox's own picture or icon. */}
          {scope === "all" && account && accounts.length > 1 && (
            <Tooltip label={t("To {mailbox}", { mailbox: account.name })} side="top">
              <span className="inline-flex shrink-0" aria-label={t("To {mailbox}", { mailbox: account.name })}>
                <MailboxBadge
                  icon={account.icon}
                  hue={account.hue}
                  image={account.image}
                  size={16}
                  className={cn("rounded-[5px]", active && "shadow-[0_0_0_1.5px_rgb(255_255_255/0.7)]")}
                />
              </span>
            </Tooltip>
          )}
          <span
            className={cn(
              "shrink-0 text-[12px] tabular-nums transition-opacity",
              active ? "text-on-accent/75" : "text-ink-3",
              actions && "group-hover:opacity-0",
            )}
          >
            {meta}
          </span>
        </div>
        <div className={cn("flex items-center gap-1.5", compact ? "mt-0" : "mt-[1px]")}>
          {hasDraft && (
            <span className={cn("flex shrink-0 items-center gap-1 text-[12.5px] font-medium", active ? "text-on-accent" : "text-danger")}>
              {draftAgent && (
                <Tooltip label={t("Drafted by {app}", { app: draftAgent.app })} side="top">
                  <span className="inline-flex">
                    <AgentLogo agent={draftAgent} size={14} />
                  </span>
                </Tooltip>
              )}
              {t("Draft")}
            </span>
          )}
          <span className={cn("truncate text-[13px]", thread.unread ? "font-medium" : "", active ? "text-on-accent" : thread.unread ? "text-ink" : "text-ink-2")}>
            {thread.subject}
          </span>
          {code && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                void copyCode(code.code);
              }}
              aria-label={t("Copy code {code}", { code: code.code })}
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[12px] font-semibold tracking-[0.04em] tabular-nums transition-colors",
                active ? "bg-white/20 text-on-accent" : "bg-accent-soft text-accent-text hover:bg-accent hover:text-on-accent",
              )}
            >
              <KeyRound size={11} />
              {formatCode(code.code)}
            </button>
          )}
          {compact && <span className={cn("truncate text-[13px]", active ? "text-on-accent/70" : "text-ink-3")}>{preview}</span>}
          <span className="ml-auto flex shrink-0 items-center gap-1 pl-1">
            {thread.note && (
              <Tooltip label={t("Has a note")} side="top">
                <StickyNote size={12} className={active ? "text-on-accent/80" : "text-pin"} />
              </Tooltip>
            )}
            {thread.muted && (
              <Tooltip label={t("Muted")} side="top">
                <BellOff size={12} className={active ? "text-on-accent/70" : "text-ink-3"} />
              </Tooltip>
            )}
            {thread.watched && (
              <Tooltip label={t("Notifies you of replies")} side="top">
                <BellPlus size={12} className={active ? "text-on-accent/80" : "text-accent-text"} />
              </Tooltip>
            )}
            {thread.followUpAt && (sentView || thread.folder === "sent" || thread.awaiting) && (
              <Tooltip label={t("Remind me if no reply · {time}", { time: formatFuture(thread.followUpAt) })} side="top">
                <BellRing size={12} className={active ? "text-on-accent/80" : "text-warning"} />
              </Tooltip>
            )}
            {receipt && receipt.state !== "off" && (
              <Tooltip label={openTooltip(last)} side="top">
                <Eye
                  size={13}
                  className={cn(
                    active ? (receipt.state === "opened" ? "text-on-accent" : "text-on-accent/60") : receipt.state === "opened" ? "text-accent-text" : "text-ink-3/70",
                  )}
                />
              </Tooltip>
            )}
            {hasAttachment && <Paperclip size={12} className={active ? "text-on-accent/70" : "text-ink-3"} />}
            <AnimatePresence initial={false}>
              {thread.pinned && (
                <motion.span
                  key="pin"
                  className="inline-flex"
                  initial={{ scale: 0.2, y: -7, rotate: -35, opacity: 0 }}
                  animate={{ scale: 1, y: 0, rotate: 0, opacity: 1 }}
                  exit={{ scale: 0.4, opacity: 0, transition: { duration: 0.12 } }}
                  transition={{ type: "spring", stiffness: 650, damping: 15, mass: 0.6 }}
                >
                  <Pin size={12} className={cn("fill-current", active ? "text-on-accent/80" : "text-pin")} />
                </motion.span>
              )}
            </AnimatePresence>
          </span>
        </div>
        {!compact && invite && <InviteChip invite={invite} active={active} now={now} />}
        {!compact && insight && <InsightChip insight={insight} active={active} />}
        {!compact && (
          <p className={cn("mt-0.5 text-[12.5px] leading-[1.45]", insight || invite ? "line-clamp-1" : "line-clamp-2", active ? "text-on-accent/75" : "text-ink-3")}>
            {preview}
          </p>
        )}
      </div>
      {actions && (
        <div
          className={cn(
            "glass-strong pointer-events-none absolute top-2 right-2 flex items-center gap-0.5 rounded-full p-0.5 opacity-0 transition-[opacity,transform] duration-150 group-hover:pointer-events-auto group-hover:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100",
            active && "text-ink",
          )}
        >
          {actions}
        </div>
      )}
    </div>
  );
});

const INSIGHT_ICONS = {
  order: Package,
  travel: Plane,
  invoice: ReceiptText,
  subscription: Repeat,
  security: ShieldCheck,
  reply: MessageSquareReply,
} as const;

/** A calendar invitation: when it is, without opening the email ("Thu 15 Oct · 10:00–11:00"). */
function InviteChip({ invite, active, now }: { invite: InviteEvent; active: boolean; now: number }) {
  const cancelled = invite.method === "CANCEL";
  const when = inviteWhen(invite);
  return (
    <span
      className={cn(
        "mt-1 mr-1 inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium",
        active
          ? "bg-white/18 text-on-accent"
          : cancelled
            ? "bg-danger/10 text-danger"
            : eventOver(invite, now)
              ? "bg-hover text-ink-3"
              : "bg-accent/10 text-accent-text",
      )}
    >
      {cancelled ? <CalendarX size={11} className="shrink-0" /> : <CalendarDays size={11} className="shrink-0" />}
      <span className="truncate">{cancelled ? t("Cancelled · {when}", { when }) : when}</span>
    </span>
  );
}

/** Smart categories: what the conversation is about, at a glance ("Shipped · 1 290 Kč · PPL"). */
function InsightChip({ insight, active }: { insight: Insight; active: boolean }) {
  const now = useNow();
  const { text, tone } = insightChip(insight, now);
  if (!text) return null;
  const Icon = INSIGHT_ICONS[insight.category];
  const chip = (
    <span
      className={cn(
        "mt-1 inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium",
        active
          ? "bg-white/18 text-on-accent"
          : tone === "good"
            ? "bg-success/12 text-success"
            : tone === "warn"
              ? "bg-warning/15 text-ink"
              : tone === "bad"
                ? "bg-danger/10 text-danger"
                : "bg-hover text-ink-2",
      )}
    >
      <Icon size={11} className="shrink-0" />
      <span className="truncate">{text}</span>
    </span>
  );
  return insight.why ? (
    <Tooltip label={t("Why here: {reason}", { reason: insight.why })} side="top">
      {chip}
    </Tooltip>
  ) : (
    chip
  );
}

export function DraftRow({
  draft,
  onOpen,
  onCheck,
  checked = false,
  selectMode = false,
  actions,
  forceInactive,
}: {
  draft: Draft;
  onOpen?: () => void;
  /** Desktop multi-select: ⌘/Ctrl-click toggles this row, Shift-click selects a range. */
  onCheck?: (mode: "toggle" | "range") => void;
  checked?: boolean;
  /** Touch selection mode: a small circle in place of the mailbox picture. */
  selectMode?: boolean;
  actions?: React.ReactNode;
  forceInactive?: boolean;
}) {
  const account = useMail((s) => s.accounts.find((a) => a.id === draft.accountId));
  const openDraft = useMail((s) => s.openDraft);
  const density = useMail((s) => s.density);
  const active = useMail(
    (s) =>
      !forceInactive &&
      !s.checked.length &&
      s.tabs.some(
        (t) => t.id === s.activeTabId && (t.kind === "draft" ? t.draftId === draft.id : t.kind === "thread" && !!draft.threadId && t.threadId === draft.threadId),
      ),
  );
  const preview = htmlToText(draft.html) || t("Empty message");
  const compact = density === "compact";
  return (
    <div
      role="button"
      tabIndex={-1}
      data-thread-id={draft.id}
      aria-pressed={onCheck ? checked : undefined}
      onClick={(e) => {
        if (onCheck && e.shiftKey) onCheck("range");
        else if (onCheck && (e.metaKey || e.ctrlKey)) onCheck("toggle");
        else if (onOpen) onOpen();
        else openDraft(draft.id);
      }}
      onMouseDown={(e) => onCheck && e.shiftKey && e.preventDefault()}
      className={cn(
        "group relative flex gap-3 rounded-[12px] px-2.5 py-2.5 transition-colors",
        active ? "bg-accent text-on-accent" : checked ? "bg-accent-soft" : "hover:bg-hover",
      )}
    >
      {selectMode ? (
        <span className={cn("flex shrink-0 items-center justify-center", compact ? "w-7" : "mt-0.5 h-9 w-9")} aria-hidden>
          <span
            className={cn(
              "flex size-[22px] items-center justify-center rounded-full transition-[background-color,box-shadow] duration-150",
              checked ? "bg-accent text-on-accent" : "text-ink-3/60 shadow-[inset_0_0_0_1.5px_currentColor]",
            )}
          >
            {checked && <Check size={13} strokeWidth={3} />}
          </span>
        </span>
      ) : (
        <span className="relative shrink-0">
          {account && <MailboxBadge icon={account.icon} hue={account.hue} image={account.image} size={compact ? 28 : 36} className="rounded-full" />}
          {checked && (
            <span
              className="absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full bg-accent text-on-accent shadow-[0_0_0_2px_var(--solid)]"
              aria-hidden
            >
              <Check size={10} strokeWidth={3.2} />
            </span>
          )}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
            <span className={active ? "text-on-accent" : "text-danger"}>{t("Draft")}</span>
            {draft.to && <span className={active ? "text-on-accent/80" : "text-ink-2"}> · {t("To: {name}", { name: draft.to })}</span>}
          </span>
          <span className={cn("shrink-0 text-[12px] transition-opacity", active ? "text-on-accent/75" : "text-ink-3", actions && "group-hover:opacity-0")}>
            {formatListTime(draft.updatedAt)}
          </span>
        </div>
        <div className={cn("truncate text-[13px]", active ? "text-on-accent" : "text-ink-2")}>{draft.subject || t("(no subject)")}</div>
        {!compact && (
          <p className={cn("mt-0.5 line-clamp-2 text-[12.5px] leading-[1.45]", active ? "text-on-accent/75" : "text-ink-3")}>{preview}</p>
        )}
      </div>
      {actions && (
        <div
          className={cn(
            "glass-strong pointer-events-none absolute top-2 right-2 flex items-center gap-0.5 rounded-full p-0.5 opacity-0 transition-[opacity,transform] duration-150 group-hover:pointer-events-auto group-hover:opacity-100",
            active && "text-ink",
          )}
        >
          {actions}
        </div>
      )}
    </div>
  );
}

/** A draft in the Drafts list with a mouse: Delete on hover, ⌘/Shift-click to select several. */
const DesktopDraftRow = memo(function DesktopDraftRow({ draft }: { draft: Draft }) {
  const checkThread = useMail((s) => s.checkThread);
  const clearChecked = useMail((s) => s.clearChecked);
  const openDraft = useMail((s) => s.openDraft);
  const discardDrafts = useMail((s) => s.discardDrafts);
  const checked = useMail((s) => s.checked.includes(draft.id));
  const selecting = useMail((s) => s.checked.length > 0);
  return (
    <DraftRow
      draft={draft}
      checked={checked}
      onCheck={(mode) => {
        if (isTypingTarget(document.activeElement)) (document.activeElement as HTMLElement).blur();
        checkThread(draft.id, mode, visibleThreadIds());
      }}
      onOpen={() => {
        clearChecked();
        openDraft(draft.id);
      }}
      actions={
        selecting ? undefined : (
          <RowAction label={t("Delete draft")} shortcut="#" onClick={() => discardDrafts([draft.id])}>
            <Trash2 size={14} />
          </RowAction>
        )
      }
    />
  );
});
