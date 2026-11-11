"use client";

import { ChevronDown, ChevronLeft, Menu, Pin, Search, SquarePen } from "lucide-react";
import { AnimatePresence, motion, useDragControls } from "motion/react";
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { isCategoryView } from "@/lib/insights";
import { t, tk } from "@/lib/i18n";
import { folderLabel, isBin, lastMessage, listedMessage, useMail, type Signature } from "@/lib/store";
import { LIVE } from "@/lib/live";
import { cn, dateGroup } from "@/lib/utils";
import { Composer } from "./editor/composer";
import { CategoryList } from "./category-view";
import { FilesView } from "./files-view";
import { ContactsList, ContactView } from "./contacts";
import { ScreenerBanner, ScreenerList } from "./screener";
import { InstallBanner, useInstallGuide } from "./install-guide";
import { NotifyBanner } from "./notify-banner";
import { ListsView } from "./lists-view";
import { AwayBanner } from "./away-settings";
import { OfflineBanner } from "./offline-banner";
import { SyncBanner, SyncingState, useSyncingEmpty } from "./sync-notice";
import {
  BinBar,
  BundleRow,
  foldPinnedGroup,
  leaveAs,
  PinnedFoldRow,
  SelectionActions,
  useBundling,
  useListItems,
  usePinnedFold,
  type ActionButtonProps,
  type Group,
} from "./message-list";
import { PINNED_SHOWN, withBundles, type DisplayItem } from "@/lib/bundles";
import { PullIndicator, usePullToRefresh } from "./pull-to-refresh";
import { InboxZero } from "./postcard";
import { leavingKind, returningKind } from "@/lib/leaving";
import { SwipeDraftRow, SwipeRow } from "./swipe-row";
import { ThreadView } from "./reader";
import { ActivityView } from "./activity";
import { AddAccountView } from "./add-account";
import { MailboxPicker, ScopeBadge, useScopeLabel } from "./mailbox-switcher";
import { Sidebar } from "./sidebar";
import { ClearSearch, MailboxBadge, spring } from "./ui";
import { NoMailbox } from "./welcome";

const pushSpring = { type: "spring", stiffness: 380, damping: 38, mass: 0.9 } as const;

/** The canvas under the bg-black/25 of a sheet, the drawer or a picker. */
const DIMMED_CANVAS = "color-mix(in srgb, var(--canvas), black 25%)";

/**
 * The status bar strip of the Home Screen app (#top-edge in the root layout) in the colour of what's
 * under it: the canvas, a thread's surface, or the canvas dimmed behind an overlay.
 */
function useTopEdge(color: string | null) {
  useEffect(() => {
    const root = document.documentElement.style;
    if (color) root.setProperty("--top-edge", color);
    else root.removeProperty("--top-edge");
    return () => void root.removeProperty("--top-edge");
  }, [color]);
}

export function MobileShell() {
  const tabs = useMail((s) => s.tabs);
  const activeTabId = useMail((s) => s.activeTabId);
  const active = tabs.find((t) => t.id === activeTabId);
  // A conversation or a contact slides in from the right; the rest come up as a sheet.
  const pushed = active?.kind === "thread" || active?.kind === "contact" ? active : null;
  const sheet = active && active.kind !== "thread" && active.kind !== "contact" ? active : null;
  const [picking, setPicking] = useState(false);
  const guide = useInstallGuide((s) => !!s.open);
  const dimmed = useMail((s) => !!sheet || s.drawerOpen || s.settingsOpen) || picking || guide;
  useTopEdge(pushed ? "var(--solid)" : dimmed ? DIMMED_CANVAS : null);

  return (
    // A plain canvas on the phone: the soft colour fields read as smudges under the status bar.
    <div className="app-shell overflow-hidden bg-canvas">
      {/*
       * Under a sheet the list shrinks back: the margin it leaves dims too, the same colour as the status
       * bar strip above it, or the sheet's rounded corners show a light seam right below the strip.
       */}
      <motion.div
        className="pointer-events-none absolute inset-0 bg-black"
        initial={false}
        animate={{ opacity: sheet ? 0.25 : 0 }}
        transition={pushSpring}
      />
      {/* Its own canvas: the dimmed margin behind it must not show through the list too. */}
      <motion.div
        className="absolute inset-0 bg-canvas"
        initial={false}
        animate={{ x: pushed ? "-28%" : 0, scale: sheet ? 0.94 : 1, borderRadius: sheet ? 24 : 0 }}
        transition={pushSpring}
        style={{ overflow: "hidden" }}
      >
        <ListScreen onPickMailbox={() => setPicking(true)} />
        <motion.div
          className="pointer-events-none absolute inset-0 bg-black"
          initial={false}
          animate={{ opacity: pushed ? 0.12 : sheet ? 0.25 : 0 }}
          transition={pushSpring}
        />
      </motion.div>

      <AnimatePresence>
        {pushed && <DetailScreen key={pushed.id} tabId={pushed.id} threadId={pushed.kind === "thread" ? pushed.threadId : undefined} contactId={pushed.kind === "contact" ? pushed.contactId : undefined} />}
      </AnimatePresence>
      <AnimatePresence>
        {sheet && (
          <motion.div
            key={sheet.id}
            className="absolute inset-x-0 top-[max(12px,env(safe-area-inset-top))] bottom-0 z-30 flex flex-col overflow-hidden rounded-t-[22px] bg-solid shadow-[var(--shadow-float)]"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={pushSpring}
          >
            <SheetHeader tabId={sheet.id} title={sheet.kind === "draft" ? t("New message") : sheet.kind === "activity" ? t("Activity") : t("Add mailbox")} />
            <div className="min-h-0 flex-1">
              {sheet.kind === "draft" ? (
                <Composer draftId={sheet.draftId} variant="sheet" />
              ) : sheet.kind === "activity" ? (
                <ActivityView />
              ) : (
                <AddAccountView tabId={sheet.id} prefill={sheet.email} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <Drawer />
      <MailboxSheet open={picking} onClose={() => setPicking(false)} />
    </div>
  );
}

/** The mailbox picker as a bottom sheet: the same list as the desktop switcher, sized for a thumb. */
function MailboxSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="absolute inset-0 z-40 bg-black/25"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="glass-strong absolute inset-x-2 bottom-2 z-50 max-h-[75dvh] overflow-y-auto rounded-[26px] px-2 pt-2 pb-[max(8px,var(--safe-bottom))]"
            initial={{ y: "110%" }}
            animate={{ y: 0 }}
            exit={{ y: "110%" }}
            transition={pushSpring}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.7 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 80 || info.velocity.y > 500) onClose();
            }}
          >
            <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-ink/15" />
            <div className="px-2 pb-1 text-[12.5px] font-semibold text-ink-3">{t("Show mail from")}</div>
            <MailboxPicker onPicked={onClose} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function SheetHeader({ tabId, title }: { tabId: string; title: string }) {
  const closeTab = useMail((s) => s.closeTab);
  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
      <button onClick={() => closeTab(tabId)} className="text-[16px] text-accent-text active:opacity-60">
        {t("Close")}
      </button>
      <span className="text-[15px] font-semibold">{title}</span>
      <span className="w-[42px]" />
    </div>
  );
}

/* ------------------------------- List screen ------------------------------ */

/** How far sideways a row goes when it leaves this way (archived right, filed left…), and comes back from. */
function sideways(sig: Signature | null) {
  const way = leaveAs(sig);
  return "x" in way ? way.x : 0;
}

function ListScreen({ onPickMailbox }: { onPickMailbox: () => void }) {
  const items = useListItems();
  const scroller = useRef<HTMLDivElement>(null);
  const checked = useMail(useShallow((s) => s.checked.filter((id) => s.threads[id] || s.drafts[id])));
  const selecting = checked.length > 0;
  const { pull, refreshing } = usePullToRefresh(scroller, !selecting);
  const folder = useMail((s) => s.folder);
  const account = useMail((s) => s.accounts.find((a) => a.id === s.scope));
  const setDrawerOpen = useMail((s) => s.setDrawerOpen);
  const compose = useMail((s) => s.compose);
  const query = useMail((s) => s.query);
  const setQuery = useMail((s) => s.setQuery);
  const scopeLabel = useScopeLabel();
  const noMailbox = useMail((s) => LIVE && s.ready && s.accounts.length === 0);
  const ready = useMail((s) => s.ready);
  const syncEmpty = useSyncingEmpty(items.length === 0);
  const title = folderLabel(folder);

  const bundling = useBundling();
  const fold = usePinnedFold();
  const togglePinned = useMail((s) => s.togglePinnedOpen);
  const groups = useMemo(() => {
    const out: Group[] = [];
    const shown: DisplayItem[] = bundling ? withBundles(items, bundling) : items;
    for (const item of shown) {
      const label =
        item.type === "bundle"
          ? dateGroup(lastMessage(item.threads[0]).date)
          : item.type === "thread"
            ? folder === "inbox" && item.thread.pinned
              ? tk("Pinned")
              : folder === "inbox" || folder === "archive" || folder === "sent" || folder.startsWith("folder:")
                ? dateGroup(listedMessage(item.thread, folder).date)
                : ""
            : "";
      const g = out.find((x) => x.label === label);
      if (g) g.items.push(item);
      else out.push({ label, items: [item] });
    }
    out.sort((a, b) => (a.label === "Pinned" ? -1 : b.label === "Pinned" ? 1 : 0));
    foldPinnedGroup(out[0], fold);
    return out;
  }, [items, folder, bundling, fold]);

  return (
    <div className="absolute inset-0 flex flex-col">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-32">
        {selecting ? (
          <SelectionTopBar count={checked.length} />
        ) : (
          <div className="sticky top-0 z-10 -mb-2 flex items-center gap-2 bg-linear-to-b from-canvas from-60% to-canvas/0 px-3 pt-[max(14px,env(safe-area-inset-top))] pb-3">
            <button
              aria-label={t("Folders")}
              onClick={() => setDrawerOpen(true)}
              className="glass press flex size-10 shrink-0 items-center justify-center rounded-full text-ink"
            >
              <Menu size={19} />
            </button>
            {/* The mailbox is the filter above every folder: always in reach, one tap to switch. */}
            <button
              aria-label={t("Mailbox: {name}", { name: scopeLabel })}
              onClick={onPickMailbox}
              className="glass flex h-10 min-w-0 items-center gap-2 rounded-full pr-3 pl-1.5 text-[14px] font-medium text-ink press [--press-scale:0.97]"
            >
              <ScopeBadge size={28} className="rounded-full" />
              <span className="truncate">{scopeLabel}</span>
              <ChevronDown size={15} className="shrink-0 text-ink-3" />
            </button>
          </div>
        )}
        <PullIndicator pull={pull} refreshing={refreshing} />
        <div className="px-4 pt-1 pb-2">
          <h1 className="flex items-center gap-2.5 text-[32px] leading-tight font-bold tracking-[-0.03em]">
            {account && <MailboxBadge icon={account.icon} hue={account.hue} image={account.image} size={28} className="rounded-[9px]" />}
            {title}
          </h1>
          {isBin(folder) && (
            <div className="mt-2 -mx-1">
              <BinBar folder={folder as "trash" | "spam"} />
            </div>
          )}
        </div>

        {folder === "inbox" && <InstallBanner mobile />}
        {folder === "inbox" && <NotifyBanner mobile />}
        {folder === "inbox" && <ScreenerBanner mobile />}
        {folder === "inbox" && <AwayBanner mobile />}
        <OfflineBanner mobile />
        {!syncEmpty && <SyncBanner mobile />}
        {isCategoryView(folder) ? (
          <CategoryList view={folder} mobile />
        ) : folder === "files" ? (
          <FilesView mobile />
        ) : folder === "contacts" ? (
          <ContactsList mobile />
        ) : folder === "lists" ? (
          <ListsView mobile />
        ) : folder === "screener" ? (
          <ScreenerList mobile />
        ) : items.length === 0 && noMailbox && !query ? (
          <div className="pt-24">
            <NoMailbox />
          </div>
        ) : syncEmpty ? (
          <SyncingState mobile />
        ) : items.length === 0 && folder === "inbox" && !query && ready ? (
          <InboxZero where="phone" />
        ) : items.length === 0 ? (
          <div className="px-6 pt-24 text-center">
            <div className="text-[17px] font-semibold">{query ? t("No results") : folder === "inbox" ? t("Inbox zero") : t("Nothing in {folder}", { folder: title })}</div>
            <div className="mt-1 text-[14px] text-ink-3">{query ? t("Nothing matches “{query}”.", { query }) : t("Enjoy the quiet.")}</div>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.label || "all"} className="px-2.5">
              {g.label && (
                <div className="flex items-center gap-1.5 px-3 pt-4 pb-1.5 text-[12.5px] font-semibold text-ink-3">
                  {g.label === "Pinned" && <Pin size={12} className="fill-current text-pin" />}
                  {g.fold ? (
                    <button onClick={togglePinned} aria-expanded={g.fold.open}>
                      {t(g.label)}
                    </button>
                  ) : (
                    t(g.label)
                  )}
                </div>
              )}
              <div
                className={cn(
                  "overflow-hidden rounded-[20px] bg-solid shadow-[var(--shadow-panel)]",
                  // Pinned: the whole card is a sticky note, so it reads as something you keep at hand.
                  g.label === "Pinned" && "bg-pin-soft shadow-[inset_0_0_0_1px_var(--pin-line),var(--shadow-panel)]",
                )}
              >
                <AnimatePresence initial={false}>
                  {g.items.map((item, i) => (
                    <motion.div
                      key={item.id}
                      layout="position"
                      // A row that comes back while it's still leaving (Undo, a failed action) grows back to full size;
                      // one that had already gone opens up again and slides back from where it went.
                      // So does a pinned one that unfolds (on a fresh list AnimatePresence holds it still).
                      initial={returningKind(item.id) || (g.fold?.open && i >= PINNED_SHOWN) ? "back" : false}
                      variants={{
                        back: () => ({ height: 0, opacity: 0, x: sideways(returningKind(item.id)) }),
                        shown: { height: "auto", opacity: 1, x: 0 },
                        // Collapses, and slides the way it went (archived right, filed left…).
                        gone: () => ({
                          height: 0,
                          opacity: 0,
                          x: sideways(leavingKind(item.id)),
                          transition: { duration: 0.26, ease: [0.32, 0.72, 0, 1] },
                        }),
                      }}
                      animate="shown"
                      exit="gone"
                      transition={spring}
                      className={cn("overflow-hidden", i > 0 && "border-t border-line")}
                    >
                      {item.type === "bundle" ? (
                        <BundleRow bundle={item} mobile renderRow={(th) => <SwipeRow thread={th} />} />
                      ) : item.type === "thread" ? (
                        <SwipeRow thread={item.thread} />
                      ) : (
                        <SwipeDraftRow draft={item.draft} />
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
                {g.fold && <PinnedFoldRow hidden={g.fold.hidden} open={g.fold.open} mobile />}
              </div>
            </section>
          ))
        )}
      </div>

      {selecting ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-3 pt-3 pb-[max(14px,var(--safe-bottom))]">
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={spring}
            className="action-bar pointer-events-auto flex items-center justify-around gap-1 rounded-[26px] px-2 py-1.5"
          >
            <SelectionActions ids={checked} size={20} button={MobileAction} />
          </motion.div>
        </div>
      ) : (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-2.5 px-3 pt-3 pb-[max(14px,var(--safe-bottom))]">
          {/* Opaque with a clear edge, like the reader's actions: over white mail, glass melted into the rows. */}
          <label className="action-bar pointer-events-auto flex h-12 min-w-0 flex-1 items-center gap-2 rounded-full px-4 text-ink-2">
            <Search size={17} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Search")}
              className="min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-ink-3"
            />
            {query && <ClearSearch size={18} onClear={() => setQuery("")} />}
          </label>
          <button
            aria-label={t("New message")}
            onClick={() => compose()}
            className="pointer-events-auto flex size-12 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent shadow-[var(--shadow-bar)] press [--press-scale:0.9]"
          >
            <SquarePen size={20} />
          </button>
        </div>
      )}
    </div>
  );
}

/** Touch selection: how many, a way out, and everything at once. */
function SelectionTopBar({ count }: { count: number }) {
  const clearChecked = useMail((s) => s.clearChecked);
  const checkAll = useMail((s) => s.checkAll);
  const all = useListItems().map((i) => i.id);
  const everything = count >= all.length;
  return (
    <div className="sticky top-0 z-10 -mb-2 flex items-center justify-between gap-2 bg-linear-to-b from-canvas from-60% to-canvas/0 px-3 pt-[max(14px,env(safe-area-inset-top))] pb-3">
      <button onClick={clearChecked} className="glass h-10 rounded-full px-4 text-[15px] font-medium text-accent-text press">
        {t("Cancel")}
      </button>
      <span className="text-[15px] font-semibold tabular-nums">{t("{n} selected", { n: count })}</span>
      <button
        onClick={() => (everything ? clearChecked() : checkAll(all))}
        className="glass h-10 rounded-full px-4 text-[15px] font-medium text-accent-text press"
      >
        {everything ? t("Deselect") : t("Select all")}
      </button>
    </div>
  );
}

/** A selection action sized for a thumb: icon over a short label. */
const MobileAction = forwardRef<HTMLButtonElement, ActionButtonProps>(function MobileAction({ label, children, className, ...props }, ref) {
  // Keyboard hints and tooltips don't apply to touch.
  const { shortcut, bare, ...rest } = props;
  void shortcut;
  void bare;
  return (
    <button
      ref={ref}
      aria-label={label}
      {...rest}
      className={cn("press flex h-14 min-w-14 flex-col items-center justify-center gap-0.5 rounded-[18px] px-2 text-ink [--press-scale:0.92] active:bg-hover", className)}
    >
      {children}
      <span className="text-[10.5px] font-medium text-ink-2">{label}</span>
    </button>
  );
});

/* ------------------------------ Detail screen ----------------------------- */

function DetailScreen({ tabId, threadId, contactId }: { tabId: string; threadId?: string; contactId?: string }) {
  const closeTab = useMail((s) => s.closeTab);
  const folder = useMail((s) => s.folder);
  const thread = useMail((s) => (threadId ? s.threads[threadId] : undefined));
  const controls = useDragControls();
  const back = () => closeTab(tabId);

  return (
    <motion.div
      className="absolute inset-0 z-20 flex flex-col bg-solid shadow-[-12px_0_40px_rgb(0_0_0/0.12)]"
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={pushSpring}
      drag="x"
      dragListener={false}
      dragControls={controls}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0, right: 1 }}
      onDragEnd={(_, info) => {
        if (info.offset.x > 90 || info.velocity.x > 500) back();
      }}
    >
      <div
        className="absolute inset-y-0 left-0 z-30 w-5"
        onPointerDown={(e) => controls.start(e)}
        style={{ touchAction: "none" }}
      />
      <div className="flex shrink-0 items-center justify-between px-2 pt-[max(14px,env(safe-area-inset-top))] pb-1">
        <button onClick={back} className="flex h-10 items-center gap-0.5 rounded-full pr-3 pl-1 text-[16px] text-accent-text active:opacity-60">
          <ChevronLeft size={24} />
          {folderLabel(folder)}
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {thread && threadId && <MobileThread threadId={threadId} />}
        {contactId && <ContactView contactId={contactId} />}
      </div>
    </motion.div>
  );
}

function MobileThread({ threadId }: { threadId: string }) {
  return <ThreadView threadId={threadId} mobile />;
}

/* --------------------------------- Drawer --------------------------------- */

/** The sidebar as a drawer from the left; the calendar on a phone uses it too. */
export function Drawer() {
  const open = useMail((s) => s.drawerOpen);
  const setOpen = useMail((s) => s.setDrawerOpen);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="absolute inset-0 z-40 bg-black/25"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          />
          {/* Below the status bar: in the Home Screen app iOS paints that strip in one colour (#top-edge). */}
          <motion.aside
            className="glass-strong absolute top-[max(12px,env(safe-area-inset-top))] bottom-0 left-0 z-50 w-[82%] max-w-[320px] rounded-r-[24px] pb-[var(--safe-bottom)]"
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={pushSpring}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0.8, right: 0 }}
            onDragEnd={(_, info) => {
              if (info.offset.x < -70 || info.velocity.x < -400) setOpen(false);
            }}
          >
            <Sidebar onNavigate={() => setOpen(false)} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
