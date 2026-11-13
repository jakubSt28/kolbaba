"use client";

import {
  Archive,
  BookUser,
  CalendarClock,
  ChevronRight,
  Clock,
  Ellipsis,
  Eye,
  EyeOff,
  FileText,
  Gift,
  GripVertical,
  History,
  Hourglass,
  Inbox,
  Lightbulb,
  Lock,
  Pencil,
  Plus,
  MessageSquareReply,
  MonitorDown,
  Newspaper,
  Package,
  Paperclip,
  Pin,
  Plane,
  ReceiptText,
  Repeat,
  Search,
  Send,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  Stamp,
  Trash2,
  UserRoundPlus,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion, Reorder, useDragControls } from "motion/react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { BRAND } from "@/lib/brand";
import { t, tk } from "@/lib/i18n";
import { CATEGORY_VIEWS, insightCards, needsAttention, type CategoryView } from "@/lib/insights";
import { arrange, PERMANENT, reorderSection, reorderSections, toggleHidden, type ArrangedItem, type ArrangedSection, type SidebarSectionId } from "@/lib/sidebar-layout";
import { folderHasMail, folderInScope, folderLabel, folderUnread, inDrafts, inFolder, ownFolderId, unreadCount, useMail } from "@/lib/store";
import type { FolderId, Thread } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useNow } from "@/lib/use-now";
import { LATEST_NOTE } from "@/lib/whats-new";
import { droppedThreads, isThreadDrag } from "@/lib/drag-threads";
import { useCalendar } from "@/lib/calendar/store";
import { BrandMark } from "./brand-mark";
import { CalendarSidebar, ModeSwitch } from "./calendar/calendar-sidebar";
import { TasksSidebar } from "./tasks/tasks-sidebar";
import { openFolderDialog } from "./folders";
import { installLabel, startInstall, useInstall } from "./install-guide";
import { FolderGlyph, NavIcon, PlayContext, TravelIcon, type IconGesture } from "./nav-icon";
import { MailboxSwitcher } from "./mailbox-switcher";
import { MailboxBadge, Tooltip, spring } from "./ui";

const FOLDER_ICONS: Record<FolderId, LucideIcon> = {
  inbox: Inbox,
  unanswered: Hourglass,
  pinned: Pin,
  snoozed: Clock,
  scheduled: CalendarClock,
  drafts: FileText,
  sent: Send,
  archive: Archive,
  spam: ShieldAlert,
  trash: Trash2,
  orders: Package,
  travel: Plane,
  invoices: ReceiptText,
  subscriptions: Repeat,
  security: ShieldCheck,
  replies: MessageSquareReply,
  screener: UserRoundPlus,
  files: Paperclip,
  contacts: BookUser,
  lists: Newspaper,
};

/** What each row's icon does when it's clicked (components/nav-icon.tsx). Travel circles the globe. */
const GESTURES: Record<FolderId, IconGesture> = {
  inbox: "drop",
  unanswered: "flip",
  pinned: "pin",
  snoozed: "ring",
  scheduled: "flip",
  drafts: "write",
  sent: "fly",
  archive: "swallow",
  spam: "shake",
  trash: "tip",
  orders: "hop",
  travel: "hop",
  invoices: "flip",
  subscriptions: "spin",
  security: "pulse",
  replies: "talk",
  screener: "wave",
  files: "wiggle",
  contacts: "flip",
  lists: "flip",
};

const CATEGORIES: CategoryView[] = ["orders", "travel", "invoices", "subscriptions", "security", "replies"];

/** Every folder follows the mailbox picked in the switcher above them. Contacts and Files aren't folders: they're tools at the top. */
const FOLDERS: FolderId[] = ["inbox", "unanswered", "pinned", "snoozed", "scheduled", "drafts", "sent", "archive", "lists", "spam", "trash"];

export function Sidebar({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const threads = useMail((s) => s.threads);
  const drafts = useMail((s) => s.drafts);
  const scope = useMail((s) => s.scope);
  const folder = useMail((s) => s.folder);
  const setFolder = useMail((s) => s.setFolder);
  const compose = useMail((s) => s.compose);
  const setPaletteOpen = useMail((s) => s.setPaletteOpen);
  const now = useNow();
  const openActivity = useMail((s) => s.openActivity);
  const activityOpen = useMail((s) => s.tabs.some((t) => t.id === s.activeTabId && t.kind === "activity"));
  const activityView = useMail((s) => s.activityView);
  const agentChangesToday = useMail(
    (s) => s.agentEvents.filter((e) => e.undoable && !e.undone && now - e.at < 86_400_000).length,
  );
  const layout = useMail((s) => s.sidebar);
  // The calendar and the tasks have their own sidebars under the same name and switch (components/calendar/calendar-sidebar.tsx, components/tasks/tasks-sidebar.tsx).
  const mode = useCalendar((s) => s.mode);
  const editing = useMail((s) => s.sidebarEditing) && !collapsed && mode === "mail";
  const setEditing = useMail((s) => s.setSidebarEditing);
  const [moreOpen, setMoreOpen] = useMoreOpen();
  const folders = useMail((s) => s.folders);
  const accounts = useMail((s) => s.accounts);
  const unseenNews = useMail((s) => s.newsSeen !== null && s.newsSeen !== LATEST_NOTE);

  const folderCounts = useMemo(() => {
    const scoped = Object.values(threads).filter((t) => scope === "all" || t.accountId === scope);
    return {
      unanswered: scoped.filter((t) => inFolder(t, "unanswered", now)).length,
      snoozed: scoped.filter((t) => inFolder(t, "snoozed", now)).length,
      scheduled: scoped.filter((t) => inFolder(t, "scheduled", now)).length,
      drafts: Object.values(drafts).filter((d) => inDrafts(d) && (scope === "all" || d.accountId === scope)).length,
      ...categoryCounts(scoped, now),
    } as Partial<Record<FolderId, number>>;
  }, [threads, drafts, scope, now]);
  const smartCategories = useMail((s) => s.smartCategories);
  const replyReminders = useMail((s) => s.replyReminders);
  const inboxUnread = unreadCount(threads, scope);

  const sections = useMemo(
    () =>
      arrange(
        layout,
        {
          folders: FOLDERS,
          categories: smartCategories ? CATEGORIES.filter((f) => f !== "replies" || replyReminders) : [],
          // Editing arranges every folder (the order is the same for all mailboxes); otherwise the picked mailbox's.
          mine: folders.filter((f) => editing || folderInScope(f, scope)).map((f) => `folder:${f.id}`),
          agents: ["history", "activity"],
        },
        folderCounts,
      ),
    [layout, smartCategories, replyReminders, folderCounts, folders, editing, scope],
  );
  const away = sections.flatMap((sec) => sec.items.filter((i) => i.away));
  // The folder you're in is never tucked out of sight.
  const showMore = moreOpen || away.some((i) => i.id === folder && !activityOpen);

  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setEditing(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, setEditing]);

  /** What dropping dragged conversations on a folder does (folders that can't take them return nothing). */
  const dropOn = (f: FolderId): ((ids: string[]) => void) | undefined => {
    const s = useMail.getState();
    const own = ownFolderId(f);
    if (own) return (ids) => s.moveToFolder(ids, own);
    switch (f) {
      case "inbox":
        return (ids) => s.moveManyToInbox(ids);
      case "archive":
        return (ids) => s.archiveMany(ids);
      case "trash":
        return (ids) => s.trashMany(ids);
      case "spam":
        return (ids) => s.spamMany(ids);
      case "pinned":
        return (ids) => s.setPinnedMany(ids, true);
    }
  };

  const go = (nextFolder: FolderId) => {
    setFolder(nextFolder);
    // AI activity steps aside (its tab stays) so the reader isn't covering the folder you picked.
    if (activityOpen) useMail.setState({ activeTabId: null });
    onNavigate?.();
  };

  const row = (id: string, indent = false) => {
    if (id === "activity" || id === "history") {
      const view = id === "history" ? "me" : "agents";
      return (
        <NavRow
          key={id}
          collapsed={collapsed}
          active={activityOpen && activityView === view}
          label={itemLabel(id)}
          count={id === "activity" ? agentChangesToday : undefined}
          countMuted
          indent={indent}
          onClick={() => {
            openActivity(view);
            onNavigate?.();
          }}
          icon={itemIcon(id)}
        />
      );
    }
    const f = id as FolderId;
    const inbox = f === "inbox";
    const own = ownFolderId(f);
    const ownFolder = own ? folders.find((x) => x.id === own) : undefined;
    // All mailboxes: a folder only one of them has shows which, like the rows in the list do.
    const ownAt = ownFolder && scope === "all" && accounts.length > 1 ? ownFolder.accountIds : undefined;
    const home = ownAt?.length === 1 ? accounts.find((a) => a.id === ownAt[0]) : undefined;
    return (
      <NavRow
        key={id}
        collapsed={collapsed}
        active={folder === f && !activityOpen}
        label={itemLabel(id)}
        count={inbox ? inboxUnread : ownFolder ? folderUnread(ownFolder, scope) : folderCounts[f]}
        countMuted={!inbox}
        indent={indent}
        onClick={() => go(f)}
        onDrop={dropOn(f)}
        icon={itemIcon(id)}
        badge={
          home && (
            <Tooltip label={t("In {mailbox}", { mailbox: home.name })} side="right">
              <span className="inline-flex shrink-0" aria-label={t("In {mailbox}", { mailbox: home.name })}>
                <MailboxBadge icon={home.icon} hue={home.hue} image={home.image} size={14} className="rounded-[4px]" />
              </span>
            </Tooltip>
          )
        }
        // Right-click an own folder to rename, recolour or delete it.
        onContextMenu={
          own
            ? (e) => {
                e.preventDefault();
                openFolderDialog({ mode: "edit", id: own });
              }
            : undefined
        }
      />
    );
  };

  return (
    <nav className={cn("group/nav flex h-full flex-col gap-1 px-2.5 pt-3 pb-2.5 select-none", collapsed && "items-center px-2")}>
      <div className={cn("mb-2 flex items-center gap-1", collapsed && "flex-col gap-2")}>
        {/* The name opens What's new and tips; a dot says there's something new. */}
        <button
          onClick={() => {
            useMail.getState().setNewsOpen(unseenNews ? "news" : "tips");
            onNavigate?.();
          }}
          aria-label={t("What's new and tips")}
          className={cn("flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[10px] px-1.5 text-left transition-colors hover:bg-hover", collapsed && "flex-none justify-center px-0")}
        >
          <span className="relative inline-flex">
            <BrandMark size={22} />
            {unseenNews && collapsed && <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-accent ring-2 ring-[var(--glass-strong)]" />}
          </span>
          {!collapsed && <span className="flex-1 truncate text-[15px] font-semibold tracking-[-0.01em]">{BRAND.name}</span>}
          {!collapsed && unseenNews && <span className="size-2 shrink-0 rounded-full bg-accent" aria-label={t("New@@news")} />}
        </button>
        {/* Mail, calendar or tasks: three apps under one name. */}
        {!editing && <ModeSwitch collapsed={collapsed} onSwitch={onNavigate} />}
      </div>

      {mode === "calendar" ? (
        <CalendarSidebar collapsed={collapsed} onNavigate={onNavigate} />
      ) : mode === "tasks" ? (
        <TasksSidebar collapsed={collapsed} onNavigate={onNavigate} />
      ) : editing ? (
        <SidebarEditor sections={sections} onDone={() => setEditing(false)} />
      ) : (
        <>
          <div className={cn("mb-2 flex gap-1.5", collapsed && "flex-col")}>
            <Tooltip label={t("New message")} shortcut="C" side="right">
              <button
                onClick={() => {
                  compose();
                  onNavigate?.();
                }}
                className={cn(
                  "flex h-9 flex-1 items-center justify-center gap-2 rounded-[11px] bg-accent text-[13px] font-medium text-on-accent shadow-[0_1px_2px_rgb(0_0_0/0.12),inset_0_1px_0_rgb(255_255_255/0.18)] press [--press-scale:0.97] hover:bg-accent-hover",
                  collapsed && "size-9 flex-none",
                )}
              >
                <SquarePen size={15} strokeWidth={2.2} />
                {!collapsed && t("New message")}
              </button>
            </Tooltip>
            <Tooltip label={t("Search & commands")} shortcut="⌘K" side="right">
              <button
                onClick={() => setPaletteOpen(true)}
                aria-label={t("Search")}
                className="flex size-9 items-center justify-center rounded-[11px] text-ink-2 shadow-[inset_0_0_0_0.5px_var(--line)] transition-colors hover:bg-hover hover:text-ink"
              >
                <Search size={16} />
              </button>
            </Tooltip>
          </div>

          {/* Contacts and Files work across the mail rather than holding any: tools of their own, not more folders. */}
          <div className={cn("mb-2 flex gap-1.5", collapsed && "flex-col items-center")}>
            {(["contacts", "files"] as const).map((f) => (
              <ToolButton key={f} collapsed={collapsed} active={folder === f && !activityOpen} label={folderLabel(f)} icon={FOLDER_ICONS[f]} gesture={GESTURES[f]} onClick={() => go(f)} />
            ))}
          </div>

          <div className={cn("mb-2", collapsed && "flex justify-center")}>
            <MailboxSwitcher collapsed={collapsed} onNavigate={onNavigate} />
          </div>

          {/* Folders, categories and agents scroll on short screens; the switcher and Settings stay put. */}
          <div className={cn("no-scrollbar -mx-2.5 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2.5", collapsed && "items-center")}>
            {sections.map((sec, index) => {
              const visible = sec.items.filter((i) => !i.away);
              // Folders open the sidebar without a heading; moved further down they get one like the rest.
              const labelled = sec.id !== "folders" || index > 0;
              return (
                <Fragment key={sec.id}>
                  {labelled && (visible.length > 0 || (sec.id === "mine" && !collapsed)) && (
                    <>
                      {!collapsed && (
                        <SectionLabel className="mt-3">
                          {t(SECTION_LABELS[sec.id])}
                          {/* Own folders: a new one is always one click away, even before the first. */}
                          {sec.id === "mine" && (
                            <Tooltip label={t("New folder")} side="right">
                              <button
                                onClick={() => openFolderDialog({ mode: "create" })}
                                aria-label={t("New folder")}
                                className="-my-1 ml-auto flex size-6 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-hover hover:text-ink"
                              >
                                <Plus size={14} />
                              </button>
                            </Tooltip>
                          )}
                        </SectionLabel>
                      )}
                      {collapsed && <div className="my-1.5 h-px w-6 bg-line" />}
                    </>
                  )}
                  {visible.map((i) => row(i.id))}
                  {sec.id === "folders" && (
                    <>
                      <NavRow
                        collapsed={collapsed}
                        label={t("More@@sidebar")}
                        muted
                        aria-expanded={showMore}
                        onClick={() => setMoreOpen(!showMore)}
                        // Dragging mail towards Trash or Spam: More opens on its own.
                        onDragHover={() => setMoreOpen(true)}
                        icon={
                          <span className="inline-flex size-[22px] items-center justify-center text-ink-3">
                            {collapsed ? <Ellipsis size={15} /> : <ChevronRight size={15} className={cn("transition-transform", showMore && "rotate-90")} />}
                          </span>
                        }
                      />
                      <AnimatePresence initial={false}>
                        {showMore && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={spring}
                            // shrink-0: in the scrolling column a clipped box would otherwise be squeezed to nothing.
                            className={cn("flex shrink-0 flex-col gap-1 overflow-hidden", collapsed && "items-center")}
                          >
                            {away.map((i) => row(i.id, true))}
                            {!collapsed && (
                              <NavRow
                                label={t("Edit sidebar")}
                                muted
                                indent
                                onClick={() => setEditing(true)}
                                icon={
                                  <span className="inline-flex size-[22px] items-center justify-center text-ink-3">
                                    <SlidersHorizontal size={14} />
                                  </span>
                                }
                              />
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </>
                  )}
                </Fragment>
              );
            })}
          </div>
        </>
      )}

      <SidebarFoot collapsed={collapsed} onNavigate={onNavigate} />
    </nav>
  );
}

function ToolButton({ icon: Icon, gesture, label, active, collapsed, onClick }: { icon: LucideIcon; gesture: IconGesture; label: string; active: boolean; collapsed: boolean; onClick: () => void }) {
  const [play, setPlay] = useState(0);
  const button = (
    <button
      onClick={() => {
        setPlay((p) => p + 1);
        onClick();
      }}
      aria-label={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[11px] px-2 text-[13px] font-medium shadow-[inset_0_0_0_0.5px_var(--line)] transition-colors",
        active ? "bg-selected text-ink" : "text-ink-2 hover:bg-hover hover:text-ink",
        collapsed && "size-9 flex-none px-0",
      )}
    >
      <PlayContext.Provider value={play}>
        <NavIcon icon={Icon} gesture={gesture} className="-mx-1 shrink-0" />
      </PlayContext.Provider>
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );
  return collapsed ? (
    <Tooltip label={label} side="right">
      {button}
    </Tooltip>
  ) : (
    button
  );
}

const SECTION_LABELS: Record<SidebarSectionId, string> = {
  folders: tk("Folders"),
  categories: tk("Categories"),
  mine: tk("My folders"),
  agents: tk("Activity"),
};

function itemLabel(id: string) {
  if (id === "activity") return t("AI activity");
  if (id === "history") return t("My history");
  return folderLabel(id as FolderId);
}

function itemIcon(id: string) {
  const own = ownFolderId(id);
  if (own) return <OwnFolderIcon id={own} />;
  if (id === "activity") {
    return (
      <span className="inline-flex size-[22px] items-center justify-center rounded-[7px] bg-accent-soft text-accent-text">
        <NavIcon icon={Sparkles} gesture="twinkle" size={13} className="size-auto" />
      </span>
    );
  }
  if (id === "history") return <NavIcon icon={History} gesture="rewind" className="text-ink-2" />;
  if (id === "travel") {
    return (
      <span className="inline-flex text-ink-2">
        <TravelIcon />
      </span>
    );
  }
  const f = id as FolderId;
  return <NavIcon icon={FOLDER_ICONS[f] ?? Inbox} gesture={GESTURES[f] ?? "drop"} className="text-ink-2" />;
}

/** An own folder: open while you're in it, with papers in it when it holds mail. */
function OwnFolderIcon({ id }: { id: string }) {
  const hue = useMail((s) => s.folders.find((f) => f.id === id)?.hue ?? 262);
  const open = useMail((s) => s.folder === `folder:${id}` && !s.tabs.some((t) => t.id === s.activeTabId && t.kind === "activity"));
  const full = useMail((s) => {
    const folder = s.folders.find((f) => f.id === id);
    return !!folder && folderHasMail(folder, s.scope, s.threads);
  });
  return <FolderGlyph hue={hue} open={open} full={full} />;
}

const MORE_KEY = "kolbaba.sidebar-more";

/** Whether "More" is open, remembered on this device. */
function useMoreOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(MORE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const set = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(MORE_KEY, next ? "1" : "0");
    } catch {}
  };
  return [open, set];
}

/* ------------------------------ Editing the sidebar ------------------------------ */

/**
 * Sections and items get drag handles (mouse and touch), and an eye that puts an item away into
 * "More" or brings it back. Inbox stays put in sight. Changes are saved as they happen.
 */
function SidebarEditor({ sections, onDone }: { sections: ArrangedSection[]; onDone: () => void }) {
  const layout = useMail((s) => s.sidebar);
  const setLayout = useMail((s) => s.setSidebar);
  const shown = sections.filter((sec) => sec.items.length);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-1 flex items-center justify-between gap-2 px-1.5">
        <span className="text-[13.5px] font-semibold">{t("Edit sidebar")}</span>
        <button onClick={onDone} className="h-8 rounded-[10px] bg-accent px-3 text-[13px] font-medium text-on-accent hover:bg-accent-hover">
          {t("Done")}
        </button>
      </div>
      <p className="mb-2 px-1.5 text-[12px] leading-snug text-ink-3">
        {t("Drag by the handle to reorder. The eye puts an item away into More. Drafts, Snoozed and Scheduled go there by themselves while they're empty.")}
      </p>
      <motion.div layoutScroll className="no-scrollbar -mx-2.5 min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
        <Reorder.Group
          as="div"
          axis="y"
          values={shown.map((sec) => sec.id)}
          onReorder={(ids: SidebarSectionId[]) => setLayout(reorderSections(layout, mergeOrder(sections.map((sec) => sec.id), ids)))}
          className="flex flex-col gap-2"
        >
          {shown.map((sec) => (
            <EditSection key={sec.id} section={sec} />
          ))}
        </Reorder.Group>
      </motion.div>
    </div>
  );
}

/** Put the reordered visible ids back among the ones that aren't shown (e.g. categories while they're off). */
function mergeOrder<T>(all: T[], visibleOrder: T[]): T[] {
  const visible = new Set(visibleOrder);
  let next = 0;
  return all.map((id) => (visible.has(id) ? visibleOrder[next++] : id));
}

function EditSection({ section }: { section: ArrangedSection }) {
  const layout = useMail((s) => s.sidebar);
  const setLayout = useMail((s) => s.setSidebar);
  const controls = useDragControls();
  return (
    <Reorder.Item as="div" value={section.id} dragListener={false} dragControls={controls} className="rounded-[12px] bg-hover/60 p-1">
      <div className="flex h-7 items-center gap-1.5 px-1 text-[11px] font-medium text-ink-3">
        <DragHandle controls={controls} label={t("Move {name}", { name: t(SECTION_LABELS[section.id]) })} />
        {t(SECTION_LABELS[section.id])}
      </div>
      <Reorder.Group
        as="div"
        axis="y"
        values={section.items.map((i) => i.id)}
        onReorder={(ids: string[]) => setLayout(reorderSection(layout, section.id, ids))}
        className="flex flex-col"
      >
        {section.items.map((item) => (
          <EditItem key={item.id} item={item} />
        ))}
      </Reorder.Group>
    </Reorder.Item>
  );
}

function EditItem({ item }: { item: ArrangedItem }) {
  const layout = useMail((s) => s.sidebar);
  const setLayout = useMail((s) => s.setSidebar);
  const controls = useDragControls();
  const label = itemLabel(item.id);
  const permanent = PERMANENT.includes(item.id);
  return (
    <Reorder.Item
      as="div"
      value={item.id}
      dragListener={false}
      dragControls={controls}
      className="flex h-[34px] items-center gap-1.5 rounded-[10px] bg-solid px-1 shadow-[inset_0_0_0_0.5px_var(--line)] [&+&]:mt-1"
    >
      <DragHandle controls={controls} label={t("Move {name}", { name: label })} />
      {itemIcon(item.id)}
      <span className={cn("min-w-0 flex-1 truncate text-[13.5px]", item.hidden ? "text-ink-3" : "text-ink-2")}>{label}</span>
      {ownFolderId(item.id) && (
        <button
          onClick={() => openFolderDialog({ mode: "edit", id: ownFolderId(item.id)! })}
          aria-label={t("Edit {name}", { name: label })}
          className="inline-flex size-7 items-center justify-center rounded-[8px] text-ink-3 transition-colors hover:bg-hover hover:text-ink"
        >
          <Pencil size={13} />
        </button>
      )}
      {permanent ? (
        <span className="inline-flex size-7 items-center justify-center text-ink-3" title={t("Always shown")}>
          <Lock size={13} />
        </span>
      ) : (
        <button
          onClick={() => setLayout(toggleHidden(layout, item.id))}
          aria-label={item.hidden ? t("Show {name}", { name: label }) : t("Put {name} away into More", { name: label })}
          aria-pressed={!item.hidden}
          className="inline-flex size-7 items-center justify-center rounded-[8px] text-ink-3 transition-colors hover:bg-hover hover:text-ink"
        >
          {item.hidden ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      )}
    </Reorder.Item>
  );
}

function DragHandle({ controls, label }: { controls: ReturnType<typeof useDragControls>; label: string }) {
  return (
    <span
      role="button"
      aria-label={label}
      onPointerDown={(e) => {
        e.preventDefault();
        // Not the phone drawer's swipe-to-close as well.
        e.stopPropagation();
        controls.start(e);
      }}
      // The finger drags the row, not the page.
      style={{ touchAction: "none" }}
      className="inline-flex size-7 shrink-0 cursor-grab items-center justify-center rounded-[8px] text-ink-3 hover:bg-hover hover:text-ink active:cursor-grabbing"
    >
      <GripVertical size={14} />
    </span>
  );
}

/** What's worth a number next to each category: orders on their way, trips ahead, bills to pay, trials ending. */
function categoryCounts(threads: Thread[], now: number): Partial<Record<CategoryView, number>> {
  const count = (view: CategoryView) =>
    insightCards(
      threads.filter((th) => inFolder(th, view, now)),
      CATEGORY_VIEWS[view],
    ).filter((c) => needsAttention(c, now)).length;
  return {
    orders: count("orders"),
    travel: count("travel"),
    invoices: count("invoices"),
    subscriptions: count("subscriptions"),
    security: count("security"),
    replies: count("replies"),
  };
}

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex items-center px-2 pt-1 pb-1 text-[11px] font-medium tracking-[0.01em] text-ink-3", className)}>{children}</div>;
}

function NavRow({
  icon,
  label,
  count,
  countMuted,
  active,
  muted,
  collapsed,
  onClick,
  trailing,
  badge,
  onContextMenu,
  onDrop,
  onDragHover,
  indent,
  "aria-expanded": expanded,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  countMuted?: boolean;
  active?: boolean;
  muted?: boolean;
  collapsed?: boolean;
  onClick?: () => void;
  trailing?: React.ReactNode;
  /** After the label, e.g. which mailbox an own folder is in. */
  badge?: React.ReactNode;
  /** Conversations dragged from the list land here. */
  onDrop?: (ids: string[]) => void;
  /** Dragged conversations are over this row. */
  onDragHover?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  /** Inside "More". */
  indent?: boolean;
  "aria-expanded"?: boolean;
}) {
  const [over, setOver] = useState(false);
  // Each click plays the icon's gesture (components/nav-icon.tsx).
  const [play, setPlay] = useState(0);
  const row = (
    <div
      className="group relative"
      onContextMenu={onContextMenu}
      onDragEnter={(e) => {
        if (!isThreadDrag(e)) return;
        onDragHover?.();
        if (onDrop) setOver(true);
      }}
      onDragOver={(e) => {
        if (!onDrop || !isThreadDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        setOver(false);
        if (!onDrop || !isThreadDrag(e)) return;
        e.preventDefault();
        const ids = droppedThreads(e);
        if (ids.length) onDrop(ids);
      }}
    >
      {over && <div className="pointer-events-none absolute inset-0 rounded-[10px] bg-accent-soft shadow-[inset_0_0_0_1.5px_var(--accent)]" />}
      {active && (
        <motion.div
          layoutId="sidebar-active"
          transition={spring}
          className="absolute inset-0 rounded-[10px] bg-selected shadow-[inset_0_0_0_0.5px_var(--line)]"
        />
      )}
      <button
        onClick={() => {
          setPlay((p) => p + 1);
          onClick?.();
        }}
        aria-expanded={expanded}
        className={cn(
          "relative flex h-[34px] w-full items-center gap-2.5 rounded-[10px] px-1.5 text-left text-[13.5px] transition-colors hover:bg-hover",
          active ? "font-medium text-ink" : muted ? "text-ink-3" : "text-ink-2",
          indent && !collapsed && "pl-4",
          collapsed && "w-9 justify-center px-0",
        )}
      >
        <PlayContext.Provider value={play}>{icon}</PlayContext.Provider>
        {!collapsed && <span className="flex-1 truncate">{label}</span>}
        {!collapsed && badge}
        {!collapsed && !!count && (
          <span
            className={cn(
              "text-[12px] tabular-nums transition-opacity",
              countMuted ? "text-ink-3" : "font-medium text-ink-2",
              trailing && "group-hover:opacity-0",
            )}
          >
            {count}
          </span>
        )}
        {collapsed && !!count && !countMuted && (
          <span className="absolute top-1 right-1 size-1.5 rounded-full bg-accent" />
        )}
      </button>
      {!collapsed && trailing}
    </div>
  );
  return collapsed ? (
    <Tooltip label={label} side="right">
      {row}
    </Tooltip>
  ) : (
    row
  );
}

/**
 * The sidebar's foot: Settings, and next to it What's new and tips, the collection and Suggest an
 * improvement as small icons (a dot when something new waits). On touch, where there are no
 * tooltips, all four are one row of tiles with short names; in the narrow sidebar, icons stacked.
 */
function SidebarFoot({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const unseenNews = useMail((s) => s.newsSeen !== null && s.newsSeen !== LATEST_NOTE);
  // A stamp that came quietly (there's one card a day) waits in the album, marked new.
  const unseenStamps = useMail((s) => s.stampsOn && Object.values(s.stamps).some((at) => at > s.stampsSeen));
  const stampsOn = useMail((s) => s.stampsOn);
  const selfHosted = useMail((s) => s.selfHosted);
  const items: { key: string; icon: LucideIcon; gesture: IconGesture; label: string; short: string; dot?: boolean; run: () => void }[] = [
    { key: "news", icon: Gift, gesture: "hop", label: t("What's new and tips"), short: t("News@@foot"), dot: unseenNews, run: () => useMail.getState().setNewsOpen(unseenNews ? "news" : "tips") },
    ...(stampsOn
      ? [{ key: "collection", icon: Stamp, gesture: "pulse" as const, label: t("Collection"), short: t("Collection"), dot: unseenStamps, run: () => useMail.getState().setCollectionOpen("stamps") }]
      : []),
    ...(selfHosted ? [] : [{ key: "idea", icon: Lightbulb, gesture: "glow" as const, label: t("Suggest an improvement"), short: t("Idea@@foot"), run: () => useMail.getState().setFeedback("idea") }]),
  ];
  const rows = items.map((i) => <FooterButton key={i.key} collapsed={collapsed} icon={i.icon} gesture={i.gesture} label={i.label} dot={i.dot} onClick={i.run} onNavigate={onNavigate} />);
  // In a browser on the computer, a way to install Kolbaba is always at hand; phones and tablets
  // have the Inbox banner and Settings.
  const guide = useInstall();
  const install = guide && (
    <div className="pointer-coarse:hidden">
      <FooterButton collapsed={collapsed} icon={MonitorDown} gesture="drop" label={installLabel(guide)} onClick={() => void startInstall(guide)} />
    </div>
  );
  if (collapsed)
    return (
      <div className="pt-2">
        {install}
        {rows}
        <SettingsButton collapsed onNavigate={onNavigate} />
      </div>
    );
  const settings = { key: "settings", icon: Settings2, gesture: "tune" as const, label: t("Settings"), short: t("Settings"), run: () => useMail.getState().setSettingsOpen(true) };
  return (
    <div className="pt-2">
      {install}
      <div className="hidden grid-cols-4 gap-1 pointer-coarse:grid">
        {[...items, settings].map((i) => (
          <FootTile key={i.key} icon={i.icon} gesture={i.gesture} label={i.short} dot={"dot" in i ? i.dot : undefined} onClick={i.run} onNavigate={onNavigate} />
        ))}
      </div>
      <div className="flex items-center gap-0.5 pointer-coarse:hidden">
        <div className="min-w-0 flex-1">
          <SettingsButton collapsed={false} onNavigate={onNavigate} />
        </div>
        {items.map((i) => (
          <FootIcon key={i.key} icon={i.icon} gesture={i.gesture} label={i.label} dot={i.dot} onClick={i.run} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  );
}

/** On touch: an icon over a short name, four in a row. */
function FootTile({
  icon,
  gesture,
  label,
  dot,
  onClick,
  onNavigate,
}: {
  icon: LucideIcon;
  gesture: IconGesture;
  label: string;
  dot?: boolean;
  onClick: () => void;
  onNavigate?: () => void;
}) {
  const [play, setPlay] = useState(0);
  return (
    <button
      onClick={() => {
        setPlay((p) => p + 1);
        onClick();
        onNavigate?.();
      }}
      className="press relative flex min-w-0 flex-col items-center gap-0.5 rounded-[12px] py-1.5 text-[11px] font-medium text-ink-2 [--press-scale:0.92] active:bg-hover"
    >
      <PlayContext.Provider value={play}>
        <NavIcon icon={icon} gesture={gesture} size={18} className="size-6" />
      </PlayContext.Provider>
      <span className="max-w-full truncate px-0.5">{label}</span>
      {dot && <span className="absolute top-1 right-[calc(50%-14px)] size-2 rounded-full bg-accent ring-2 ring-[var(--glass-strong)]" />}
    </button>
  );
}

function FootIcon({
  icon,
  gesture,
  label,
  dot,
  onClick,
  onNavigate,
}: {
  icon: LucideIcon;
  gesture: IconGesture;
  label: string;
  dot?: boolean;
  onClick: () => void;
  onNavigate?: () => void;
}) {
  const [play, setPlay] = useState(0);
  return (
    <Tooltip label={label} side="top">
      <button
        aria-label={label}
        onClick={() => {
          setPlay((p) => p + 1);
          onClick();
          onNavigate?.();
        }}
        className="press relative flex size-[34px] shrink-0 items-center justify-center rounded-[10px] text-ink-3 [--press-scale:0.88] hover:bg-hover hover:text-ink-2 pointer-coarse:hidden"
      >
        <PlayContext.Provider value={play}>
          <NavIcon icon={icon} gesture={gesture} />
        </PlayContext.Provider>
        {dot && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-accent ring-2 ring-[var(--glass-strong)]" />}
      </button>
    </Tooltip>
  );
}

function FooterButton({
  collapsed,
  icon: Icon,
  gesture,
  label,
  dot,
  onClick,
  onNavigate,
}: {
  collapsed: boolean;
  icon: LucideIcon;
  gesture: IconGesture;
  label: string;
  dot?: boolean;
  onClick: () => void;
  onNavigate?: () => void;
}) {
  const [play, setPlay] = useState(0);
  const button = (
    <button
      onClick={() => {
        setPlay((p) => p + 1);
        onClick();
        onNavigate?.();
      }}
      className={cn(
        "flex h-[34px] w-full items-center gap-2.5 rounded-[10px] px-1.5 text-[13.5px] text-ink-3 transition-colors hover:bg-hover hover:text-ink-2",
        collapsed && "w-9 justify-center px-0",
      )}
    >
      <PlayContext.Provider value={play}>
        <span className="relative inline-flex">
          <NavIcon icon={Icon} gesture={gesture} />
          {dot && <span className="absolute top-0 right-0 size-2 rounded-full bg-accent ring-2 ring-[var(--glass-strong)]" />}
        </span>
      </PlayContext.Provider>
      {!collapsed && <span className="flex-1 text-left">{label}</span>}
    </button>
  );
  return collapsed ? (
    <Tooltip label={label} side="right">
      {button}
    </Tooltip>
  ) : (
    button
  );
}

function SettingsButton({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const setSettingsOpen = useMail((s) => s.setSettingsOpen);
  const [play, setPlay] = useState(0);
  const button = (
    <button
      onClick={() => {
        setPlay((p) => p + 1);
        setSettingsOpen(true);
        onNavigate?.();
      }}
      className={cn(
        "flex h-[34px] w-full items-center gap-2.5 rounded-[10px] px-1.5 text-[13.5px] text-ink-2 transition-colors hover:bg-hover",
        collapsed && "w-9 justify-center px-0",
      )}
    >
      <PlayContext.Provider value={play}>
        <NavIcon icon={Settings2} gesture="tune" />
      </PlayContext.Provider>
      {!collapsed && <span className="flex-1 text-left">{t("Settings")}</span>}
    </button>
  );
  return collapsed ? (
    <Tooltip label={t("Settings")} shortcut="⌘," side="right">
      {button}
    </Tooltip>
  ) : (
    button
  );
}
