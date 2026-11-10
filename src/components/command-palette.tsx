"use client";

import { Command } from "cmdk";
import {
  Lightbulb,
  Archive,
  Ban,
  Bell,
  BellMinus,
  BellOff,
  BellPlus,
  BellRing,
  Crown,
  Hourglass,
  Keyboard,
  Moon,
  Printer,
  StickyNote,
  Sun,
  SunMoon,
  BookUser,
  Paperclip,
  CalendarClock,
  Clock,
  FileText,
  Inbox,
  MailOpen,
  Pin,
  Plus,
  Reply,
  Rows3,
  Search,
  Send,
  Settings2,
  ShieldAlert,
  Gift,
  History,
  Sparkles,
  SquarePen,
  Stamp,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { t, tn } from "@/lib/i18n";
import { folderInScope, folderLabel, lastMessage, threadCounterpart, useMail } from "@/lib/store";
import type { FolderId } from "@/lib/types";
import { formatListTime, htmlToText, snoozePresets } from "@/lib/utils";
import { FolderIcon } from "./folders";
import { neighbourOf } from "./message-list";
import { remindPresets } from "./menus";
import { printThread } from "./print";
import { openNote } from "./thread-note";
import { isFreeMail } from "@/lib/mail-domains";
import { Avatar, Kbd, MailboxBadge } from "./ui";

const FOLDER_ITEMS: { id: FolderId; icon: LucideIcon }[] = [
  { id: "inbox", icon: Inbox },
  { id: "unanswered", icon: Hourglass },
  { id: "pinned", icon: Pin },
  { id: "snoozed", icon: Clock },
  { id: "scheduled", icon: CalendarClock },
  { id: "drafts", icon: FileText },
  { id: "sent", icon: Send },
  { id: "archive", icon: Archive },
  { id: "files", icon: Paperclip },
  { id: "contacts", icon: BookUser },
  { id: "spam", icon: ShieldAlert },
  { id: "trash", icon: Trash2 },
];

export function CommandPalette() {
  const open = useMail((s) => s.paletteOpen);
  const setOpen = useMail((s) => s.setPaletteOpen);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/10 px-4 pt-[14vh] dark:bg-black/40"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -4, transition: { duration: 0.12 } }}
            transition={{ type: "spring", stiffness: 600, damping: 40 }}
            className="w-full max-w-[600px]"
          >
            <Palette onClose={() => setOpen(false)} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // A closing menu may hand focus back to its trigger a frame later; take it back.
    const id = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(id);
  }, []);
  const s = useMail();
  const activeTab = s.tabs.find((t) => t.id === s.activeTabId);
  const current = activeTab?.kind === "thread" ? s.threads[activeTab.threadId] : undefined;

  // "Move to…" acts on the selection if there is one, otherwise on the open conversation.
  const moving = s.checked.filter((id) => s.threads[id]);
  const targets = moving.length ? moving : current ? [current.id] : [];
  const here = targets.length === 1 ? s.threads[targets[0]]?.folderId : undefined;
  const ownFolders = s.folders.filter((f) => folderInScope(f, s.scope));

  const threads = useMemo(
    () => Object.values(s.threads).sort((a, b) => lastMessage(b).date - lastMessage(a).date),
    [s.threads],
  );
  const mine = new Set(s.accounts.map((a) => a.email.toLowerCase()));
  const sentLast = !!current && mine.has(lastMessage(current).from.email.toLowerCase()) && current.folder !== "scheduled";
  const sender = current ? [...current.messages].reverse().find((m) => !mine.has(m.from.email.toLowerCase()))?.from : undefined;

  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  const item = "flex h-10 cursor-pointer items-center gap-3 rounded-xl px-3 text-[13.5px] text-ink data-[selected=true]:bg-accent data-[selected=true]:text-on-accent [&_kbd]:data-[selected=true]:bg-white/20 [&_kbd]:data-[selected=true]:text-on-accent";
  const group = "px-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-3";

  return (
    <Command
      loop
      className="glass-strong overflow-hidden rounded-[20px]"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          // Don't let the same Escape reach the global shortcuts (which would close the open tab).
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search size={17} className="text-ink-3" />
        <Command.Input
          ref={inputRef}
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder={t("Search mail or type a command…")}
          className="h-14 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-ink-3"
        />
        <Kbd>esc</Kbd>
      </div>
      <Command.List className="max-h-[min(440px,60vh)] overflow-y-auto py-1.5">
        <Command.Empty className="py-10 text-center text-[13px] text-ink-3">{t("Nothing found.")}</Command.Empty>

        {current && (
          <Command.Group heading={t("This conversation · {subject}", { subject: current.subject })} className={group}>
            <Command.Item className={item} onSelect={run(() => s.reply(current.id))}>
              <Reply size={16} /> {t("Reply")} <Kbd className="ml-auto">R</Kbd>
            </Command.Item>
            <Command.Item className={item} onSelect={run(() => s.archive(current.id, neighbourOf(current.id)))}>
              <Archive size={16} /> {t("Archive")} <Kbd className="ml-auto">E</Kbd>
            </Command.Item>
            {current.folder !== "trash" && (
              <Command.Item className={item} onSelect={run(() => s.trash(current.id, neighbourOf(current.id)))}>
                <Trash2 size={16} /> {t("Delete")} <Kbd className="ml-auto">#</Kbd>
              </Command.Item>
            )}
            {current.folder !== "spam" && (
              <Command.Item className={item} onSelect={run(() => s.spam(current.id, neighbourOf(current.id)))}>
                <ShieldAlert size={16} /> {t("Report spam")} <Kbd className="ml-auto">!</Kbd>
              </Command.Item>
            )}
            <Command.Item className={item} onSelect={run(() => s.togglePin(current.id))}>
              <Pin size={16} /> {current.pinned ? t("Unpin") : t("Pin")} <Kbd className="ml-auto">P</Kbd>
            </Command.Item>
            {snoozePresets().slice(0, 2).map((p) => (
              <Command.Item key={p.id} className={item} value={`snooze ${p.label}`} keywords={[t("Snooze")]} onSelect={run(() => s.snooze(current.id, p.at, neighbourOf(current.id)))}>
                <Clock size={16} /> {t("Snooze · {time}", { time: p.label })}
              </Command.Item>
            ))}
            <Command.Item className={item} onSelect={run(() => s.setUnread(current.id, true))}>
              <MailOpen size={16} /> {t("Mark as unread")} <Kbd className="ml-auto">U</Kbd>
            </Command.Item>
            <Command.Item className={item} value="note poznamka" keywords={[t("Add a note")]} onSelect={run(() => openNote(current.id))}>
              <StickyNote size={16} /> {current.note ? t("Edit note") : t("Add a note")} <Kbd className="ml-auto">N</Kbd>
            </Command.Item>
            {current.folder !== "trash" && current.folder !== "spam" && (
              <Command.Item className={item} value="mute ztlumit" keywords={[t("Mute")]} onSelect={run(() => s.setMuted(current.id, !current.muted, neighbourOf(current.id)))}>
                {current.muted ? <Bell size={16} /> : <BellOff size={16} />} {current.muted ? t("Unmute") : t("Mute")} <Kbd className="ml-auto">M</Kbd>
              </Command.Item>
            )}
            {current.folder !== "trash" && current.folder !== "spam" && (
              <Command.Item className={item} value="notify replies upozornit odpovedi" keywords={[t("Notify me of replies")]} onSelect={run(() => s.setWatched(current.id, !current.watched))}>
                {current.watched ? <BellMinus size={16} /> : <BellPlus size={16} />} {current.watched ? t("Stop notifying me of replies") : t("Notify me of replies")}
              </Command.Item>
            )}
            {sender && (
              <Command.Item
                className={item}
                value={`vip ${sender.email}`}
                keywords={["VIP"]}
                onSelect={run(() => void s.setVip(sender, !s.vips.includes(sender.email.toLowerCase())))}
              >
                <Crown size={16} />{" "}
                {s.vips.includes(sender.email.toLowerCase()) ? t("Remove {name} from VIPs", { name: sender.name || sender.email }) : t("Mark {name} as VIP", { name: sender.name || sender.email })}
              </Command.Item>
            )}
            {sentLast &&
              remindPresets().map((p) => (
                <Command.Item key={p.id} className={item} value={`remind ${p.label}`} keywords={[t("Remind me if no reply")]} onSelect={run(() => s.remindIfNoReply(current.id, p.at))}>
                  <BellRing size={16} /> {t("Remind me if no reply · {time}", { time: p.label })}
                </Command.Item>
              ))}
            <Command.Item className={item} value="print pdf tisk" keywords={[t("Print")]} onSelect={run(() => void printThread(current.id))}>
              <Printer size={16} /> {t("Print")} <Kbd className="ml-auto">⌘P</Kbd>
            </Command.Item>
            {sender && (
              <Command.Item className={item} value={`block ${sender.email}`} keywords={[t("Block")]} onSelect={run(() => void s.blockSender(sender))}>
                <Ban size={16} /> {t("Block {sender}", { sender: sender.email })}
              </Command.Item>
            )}
            {sender && !isFreeMail(sender.email) && (
              <Command.Item className={item} value={`block domain ${sender.email}`} keywords={[t("Block")]} onSelect={run(() => void s.blockSender(sender, { domain: true }))}>
                <Ban size={16} /> {t("Block everyone at {domain}", { domain: sender.email.split("@")[1] ?? "" })}
              </Command.Item>
            )}
          </Command.Group>
        )}

        {/* Typed for (a folder's name, "move"…): not to make the list long when nothing is. */}
        {targets.length > 0 && query.length > 0 && s.folders.length > 0 && (
          <Command.Group heading={moving.length > 1 ? tn(moving.length, "Move {n} selected to", "Move {n} selected to") : t("Move to folder")} className={group}>
            {s.folders
              .filter((f) => f.id !== here)
              .map((f) => (
                <Command.Item
                  key={f.id}
                  className={item}
                  value={`move ${f.name} ${f.id}`}
                  keywords={[t("Move to folder"), f.name]}
                  onSelect={run(() => s.moveToFolder(targets, f.id))}
                >
                  <FolderIcon hue={f.hue} size={16} /> {t("Move to {folder}", { folder: f.name })}
                </Command.Item>
              ))}
          </Command.Group>
        )}

        <Command.Group heading={t("Actions")} className={group}>
          <Command.Item className={item} onSelect={run(() => s.compose())}>
            <SquarePen size={16} /> {t("New message")} <Kbd className="ml-auto">C</Kbd>
          </Command.Item>
          <Command.Item className={item} onSelect={run(() => s.openAddAccount())}>
            <Plus size={16} /> {t("Add mailbox")}
          </Command.Item>
          <Command.Item className={item} value="ai activity agents mcp" keywords={[t("AI activity")]} onSelect={run(() => s.openActivity("agents"))}>
            <Sparkles size={16} /> {t("AI activity")}
          </Command.Item>
          <Command.Item className={item} value="my history undo archived deleted" keywords={[t("My history")]} onSelect={run(() => s.openActivity("me"))}>
            <History size={16} /> {t("My history")}
          </Command.Item>
          <Command.Item className={item} value="whats new tips changelog" keywords={[t("What's new and tips")]} onSelect={run(() => s.setNewsOpen("news"))}>
            <Gift size={16} /> {t("What's new and tips")}
          </Command.Item>
          {s.stampsOn && (
            <Command.Item className={item} value="collection stamp album stamps postcards achievements znamky pohlednice sbirka" keywords={[t("Collection")]} onSelect={run(() => s.setCollectionOpen("stamps"))}>
              <Stamp size={16} /> {t("Collection")}
            </Command.Item>
          )}
          <Command.Item className={item} value="keyboard shortcuts klavesove zkratky help" keywords={[t("Keyboard shortcuts")]} onSelect={run(() => s.setShortcutsOpen(true))}>
            <Keyboard size={16} /> {t("Keyboard shortcuts")} <Kbd className="ml-auto">?</Kbd>
          </Command.Item>
          {s.theme !== "dark" && (
            <Command.Item className={item} value="dark mode appearance tmavy vzhled" keywords={[t("Dark")]} onSelect={run(() => s.setTheme("dark"))}>
              <Moon size={16} /> {t("Switch to dark")}
            </Command.Item>
          )}
          {s.theme !== "light" && (
            <Command.Item className={item} value="light mode appearance svetly vzhled" keywords={[t("Light")]} onSelect={run(() => s.setTheme("light"))}>
              <Sun size={16} /> {t("Switch to light")}
            </Command.Item>
          )}
          {s.theme !== "auto" && (
            <Command.Item className={item} value="system appearance automatic vzhled automaticky" keywords={[t("Automatic")]} onSelect={run(() => s.setTheme("auto"))}>
              <SunMoon size={16} /> {t("Light and dark like the system")}
            </Command.Item>
          )}
          <Command.Item className={item} onSelect={run(() => s.setDensity(s.density === "compact" ? "comfortable" : "compact"))}>
            <Rows3 size={16} /> {s.density === "compact" ? t("Switch to comfortable list") : t("Switch to compact list")}
          </Command.Item>
          <Command.Item className={item} value="settings preferences language" keywords={[t("Settings")]} onSelect={run(() => s.setSettingsOpen(true))}>
            <Settings2 size={16} /> {t("Settings")} <Kbd className="ml-auto">⌘,</Kbd>
          </Command.Item>
          {!s.selfHosted && (
            <Command.Item className={item} value="feedback idea feature suggest napad zpetna vazba" keywords={[t("Suggest an improvement")]} onSelect={run(() => s.setFeedback("idea"))}>
              <Lightbulb size={16} /> {t("Suggest an improvement")}
            </Command.Item>
          )}
        </Command.Group>

        <Command.Group heading={t("Go to")} className={group}>
          <Command.Item className={item} value="all inboxes" keywords={[t("All inboxes")]} onSelect={run(() => { s.setScope("all"); s.setFolder("inbox"); })}>
            <Inbox size={16} /> {t("All inboxes")} <Kbd className="ml-auto">G I</Kbd>
          </Command.Item>
          {s.accounts.map((a) => (
            // A mailbox is the filter above the folders: switching keeps the folder you're in.
            <Command.Item key={a.id} className={item} value={`mailbox ${a.name} ${a.email}`} onSelect={run(() => s.setScope(a.id))}>
              <MailboxBadge icon={a.icon} hue={a.hue} image={a.image} size={18} className="rounded-[6px]" /> {a.name}
              <span className="ml-auto text-[12px] opacity-60">{a.email}</span>
            </Command.Item>
          ))}
          {FOLDER_ITEMS.filter((f) => f.id !== "inbox").map((f) => (
            <Command.Item key={f.id} className={item} value={`folder ${f.id}`} keywords={[folderLabel(f.id)]} onSelect={run(() => s.setFolder(f.id))}>
              <f.icon size={16} /> {folderLabel(f.id)}
            </Command.Item>
          ))}
          {ownFolders.map((f) => (
            <Command.Item key={f.id} className={item} value={`go ${f.name} ${f.id}`} keywords={[f.name]} onSelect={run(() => s.setFolder(`folder:${f.id}`))}>
              <FolderIcon hue={f.hue} size={16} /> {f.name}
            </Command.Item>
          ))}
        </Command.Group>

        {query.length > 1 && (
          <Command.Group heading={t("Mail")} className={group}>
            {threads.map((t) => {
              const who = threadCounterpart(t, s.accounts);
              const text = lastMessage(t).snippet ?? htmlToText(lastMessage(t).html);
              return (
                <Command.Item
                  key={t.id}
                  className={`${item} h-auto py-2`}
                  value={`${t.subject} ${who.name} ${who.email} ${text}`}
                  onSelect={run(() => s.openThread(t.id, { newTab: true }))}
                >
                  <Avatar person={who} logo={t.logo} size={26} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{t.subject}</span>
                    <span className="block truncate text-[12px] opacity-60">{who.name} · {text}</span>
                  </span>
                  <span className="shrink-0 text-[12px] opacity-60">{formatListTime(lastMessage(t).date)}</span>
                </Command.Item>
              );
            })}
          </Command.Group>
        )}
      </Command.List>
    </Command>
  );
}
