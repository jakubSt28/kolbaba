"use client";

import {
  ArrowRight,
  Bell,
  Bot,
  BookUser,
  CalendarClock,
  CalendarDays,
  Check,
  Clock,
  Command,
  FileText,
  Folder,
  Gift,
  History,
  Inbox,
  Keyboard,
  Lightbulb,
  MoveHorizontal,
  Newspaper,
  Package,
  PanelLeft,
  Paperclip,
  Pin,
  Search,
  SlidersHorizontal,
  SquareSlash,
  TextQuote,
  UserRoundPlus,
  X,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Dialog } from "radix-ui";
import { useEffect, useMemo } from "react";
import { intlLocale, t } from "@/lib/i18n";
import { LIVE } from "@/lib/live";
import { useMail } from "@/lib/store";
import { LATEST_NOTE, openTips, RELEASE_NOTES, TIP_EVERY_MS, TIPS, type NewsAction, type NewsIcon, type ReleaseNote, type TipContext } from "@/lib/whats-new";
import { buildScene } from "@/lib/postcard";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { openFolderDialog } from "./folders";
import { PostcardArt } from "./postcard";
import { SignatureIcon } from "./signature";
import { StampArt } from "./stamp-art";
import { StampCard } from "./stamps";
import { hueStyle, Segmented, softSpring } from "./ui";

/** What "Try it" opens. */
const ACTIONS: Record<NewsAction, () => void> = {
  folders: () => openFolderDialog({ mode: "create" }),
  sidebar: () => useMail.getState().setSidebarEditing(true),
  history: () => useMail.getState().openActivity("me"),
  agents: () => useMail.getState().setSettingsOpen(true, "agents"),
  palette: () => useMail.getState().setPaletteOpen(true),
  "mailbox-settings": () => useMail.getState().setSettingsOpen(true, "mailboxes"),
  "mail-settings":() => useMail.getState().setSettingsOpen(true, "mail"),
  "smart-settings": () => useMail.getState().setSettingsOpen(true, "smart"),
  "notification-settings": () => useMail.getState().setSettingsOpen(true, "notifications"),
  contacts: () => useMail.getState().setFolder("contacts"),
  files: () => useMail.getState().setFolder("files"),
  lists: () => useMail.getState().setFolder("lists"),
};

const run = (action: NewsAction) => {
  useMail.getState().setNewsOpen(false);
  // After the window has closed, so what opens isn't under it.
  setTimeout(ACTIONS[action], 150);
};

function useTipContext(mobile: boolean): TipContext {
  const tried = useMail((s) => s.tried);
  const folders = useMail((s) => s.folders.length);
  const snippets = useMail((s) => s.snippets.length);
  const agents = useMail((s) => s.agents.length);
  const screener = useMail((s) => s.screener);
  const smartCategories = useMail((s) => s.smartCategories);
  const summaries = useMail((s) => s.summaries);
  const sidebarArranged = useMail((s) => Object.keys(s.sidebar).length > 0);
  return useMemo(
    () => ({ tried, folders, snippets, agents, screener, smartCategories, summaries, sidebarArranged, mobile }),
    [tried, folders, snippets, agents, screener, smartCategories, summaries, sidebarArranged, mobile],
  );
}

const dateFormat = () => new Intl.DateTimeFormat(intlLocale(), { day: "numeric", month: "long" });

/** Plain icons for notes and tips, each in its own colour. */
const ICONS: Record<Exclude<NewsIcon, "postmark" | "postcard" | "stamps">, [LucideIcon, number]> = {
  contacts: [BookUser, 200],
  drafts: [FileText, 30],
  settings: [SlidersHorizontal, 255],
  folders: [Folder, 262],
  sidebar: [PanelLeft, 175],
  history: [History, 285],
  pins: [Pin, 62],
  agents: [Bot, 300],
  attachments: [Paperclip, 220],
  palette: [Command, 255],
  keyboard: [Keyboard, 200],
  swipe: [MoveHorizontal, 150],
  snooze: [Clock, 70],
  template: [SquareSlash, 330],
  schedule: [CalendarClock, 230],
  summary: [TextQuote, 285],
  smart: [Package, 38],
  screener: [UserRoundPlus, 175],
  bell: [Bell, 15],
  newsletters: [Newspaper, 20],
  search: [Search, 210],
  mailboxes: [Inbox, 245],
  calendar: [CalendarDays, 145],
};

/** A note's or a tip's picture: a coloured tile, or for Kolbaba's own things a little drawing. */
function NewsPicture({ icon, size = 40 }: { icon: NewsIcon; size?: number }) {
  if (icon === "postmark")
    return (
      <span className="flex shrink-0 items-center justify-center rounded-[12px] bg-[var(--paper)] text-[var(--paper-ink)] shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.08)]" style={{ width: size, height: size }}>
        <SignatureIcon sig="send" className="scale-[1.3] text-[var(--paper-ink)]" />
      </span>
    );
  if (icon === "postcard") return <TodayPostcard width={size * 1.45} />;
  if (icon === "stamps")
    return (
      <span className="relative shrink-0" style={{ width: size * 1.25, height: size }}>
        <span className="absolute top-0 left-0 -rotate-8">
          <StampArt id="first-letter" width={size * 0.72} />
        </span>
        <span className="absolute top-0.5 right-0 rotate-6">
          <StampArt id="robot" width={size * 0.72} />
        </span>
      </span>
    );
  const [Icon, hue] = ICONS[icon];
  return (
    <span className="hue-tint flex shrink-0 items-center justify-center rounded-[12px]" style={{ ...hueStyle(hue), width: size, height: size }}>
      <Icon size={Math.round(size * 0.48)} strokeWidth={2} />
    </span>
  );
}

function TodayPostcard({ width }: { width: number }) {
  const scene = useMemo(() => buildScene(new Date()), []);
  return (
    <span className="block shrink-0 -rotate-3 rounded-[5px] bg-[var(--paper)] p-[3px] shadow-[0_1px_2px_rgb(0_0_0/0.15),0_4px_10px_-4px_rgb(0_0_0/0.3)]" style={{ width, height: width / 1.44 }}>
      <span className="block size-full overflow-hidden rounded-[3px]">
        <PostcardArt scene={scene} lite />
      </span>
    </span>
  );
}

/** The newest note, large: its picture, what it is and Try it. */
function LatestNote({ note }: { note: ReleaseNote }) {
  return (
    <li className="overflow-hidden rounded-[18px] bg-linear-to-br from-accent-soft to-transparent p-4 shadow-[inset_0_0_0_0.5px_var(--line)]">
      <div className="flex items-start gap-4">
        <NewsPicture icon={note.icon} size={56} />
        <div className="min-w-0 flex-1">
          <div className="text-[11.5px] font-medium text-accent-text">
            {t("Latest")} · {dateFormat().format(new Date(note.date))}
          </div>
          <div className="mt-0.5 text-[16px] font-semibold tracking-[-0.01em]">{t(note.title)}</div>
        </div>
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-2">{t(note.body)}</p>
      {note.action && (
        <button onClick={() => run(note.action!)} className="press mt-3 flex h-8 items-center gap-1.5 rounded-full bg-accent px-3.5 text-[12.5px] font-medium text-on-accent hover:bg-accent-hover">
          {t("Try it")} <ArrowRight size={13} />
        </button>
      )}
    </li>
  );
}

/* --------------------------------- Window --------------------------------- */

function NewsDialog({ mobile }: { mobile: boolean }) {
  const tab = useMail((s) => s.newsOpen);
  const setOpen = useMail((s) => s.setNewsOpen);
  const context = useTipContext(mobile);
  const tips = TIPS.filter((tip) => !tip.only || (tip.only === "mobile") === mobile);
  return (
    <Dialog.Root open={!!tab} onOpenChange={(o) => !o && setOpen(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/20 data-[state=open]:animate-[fade-in_140ms_ease-out] dark:bg-black/45" />
        <Dialog.Content
          aria-describedby={undefined}
          className="sheet fixed top-1/2 left-1/2 z-50 flex max-h-[min(640px,calc(100dvh-32px))] w-[min(480px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[22px] outline-none data-[state=open]:animate-[dialog-in_180ms_cubic-bezier(0.32,0.72,0,1)]"
        >
          <div className="flex items-center gap-3 px-5 pt-5 pb-3">
            <Dialog.Title className="flex-1 text-[16px] font-semibold tracking-[-0.01em]">{t("What's new and tips")}</Dialog.Title>
            <Dialog.Close aria-label={t("Close")} className="flex size-8 items-center justify-center rounded-full text-ink-3 hover:bg-hover hover:text-ink">
              <X size={16} />
            </Dialog.Close>
          </div>
          <div className="px-5 pb-3">
            <Segmented
              id="news-tab"
              value={tab || "news"}
              options={[
                { value: "news", label: t("What's new") },
                { value: "tips", label: t("Tips") },
              ]}
              onChange={(v) => setOpen(v)}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            {tab === "tips" ? (
              <ul className="flex flex-col gap-2">
                {tips.map((tip) => {
                  const done = tip.done(context);
                  return (
                    <li key={tip.id} className="flex items-center gap-3 rounded-[14px] bg-solid/70 p-3 shadow-[inset_0_0_0_0.5px_var(--line)]">
                      <span className={cn("relative", done && "opacity-60")}>
                        <NewsPicture icon={tip.icon} size={38} />
                        {done && (
                          <span className="absolute -right-1 -bottom-1 flex size-[18px] items-center justify-center rounded-full bg-success text-white shadow-[0_0_0_2px_var(--solid)]">
                            <Check size={11} strokeWidth={3} />
                          </span>
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className={cn("text-[13.5px] font-medium", done && "text-ink-2")}>{t(tip.title)}</div>
                        <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-3">{t(tip.body)}</p>
                      </div>
                      {!done && tip.action && (
                        <button onClick={() => run(tip.action!)} className="h-8 shrink-0 self-center rounded-[10px] bg-hover px-3 text-[12.5px] font-medium text-ink hover:bg-selected">
                          {t("Try it")}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <ul className="flex flex-col gap-2">
                {RELEASE_NOTES.map((note, i) =>
                  i === 0 ? (
                    <LatestNote key={note.id} note={note} />
                  ) : (
                    <li key={note.id} className="flex gap-3.5 rounded-[14px] bg-solid/70 p-3.5 shadow-[inset_0_0_0_0.5px_var(--line)]">
                      <NewsPicture icon={note.icon} size={38} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[11.5px] text-ink-3">{dateFormat().format(new Date(note.date))}</div>
                        <div className="mt-0.5 text-[14px] font-semibold">{t(note.title)}</div>
                        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{t(note.body)}</p>
                        {note.action && (
                          <button onClick={() => run(note.action!)} className="mt-2 flex items-center gap-1 text-[12.5px] font-medium text-accent-text hover:underline">
                            {t("Try it")} <ArrowRight size={13} />
                          </button>
                        )}
                      </div>
                    </li>
                  ),
                )}
              </ul>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ---------------------------------- Cards --------------------------------- */

function Card({ mobile, icon, label, title, body, onOpen, openLabel, onClose }: {
  mobile: boolean;
  icon: React.ReactNode;
  label: string;
  title: string;
  body: string;
  onOpen: () => void;
  openLabel: string;
  onClose: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12 }}
      transition={softSpring}
      role="status"
      className={cn("glass-strong fixed z-40 rounded-[20px] p-4", mobile ? "inset-x-2.5 bottom-[calc(88px+var(--safe-bottom))]" : "right-5 bottom-5 w-[360px]")}
    >
      <button onClick={onClose} aria-label={t("Close")} className="absolute top-3 right-3 flex size-7 items-center justify-center rounded-lg text-ink-3 hover:bg-hover hover:text-ink">
        <X size={14} />
      </button>
      <div className="flex items-center gap-1.5 pr-8 text-[11.5px] font-medium text-ink-3">
        {icon} {label}
      </div>
      <div className="mt-1 text-[14px] font-semibold">{title}</div>
      <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">{body}</p>
      <div className="mt-3 flex justify-end">
        <button onClick={onOpen} className="flex h-8 items-center gap-1.5 rounded-full bg-accent px-3.5 text-[12.5px] font-medium text-on-accent hover:bg-accent-hover">
          {openLabel} <ArrowRight size={13} />
        </button>
      </div>
    </motion.div>
  );
}

/**
 * The window, plus at most one small card: what's new after an update (once), otherwise now and
 * then a tip for something not tried yet. Never over the 0–10 question or an open window.
 */
export function NewsHost({ mobile }: { mobile: boolean }) {
  const ready = useMail((s) => s.ready && !!s.user);
  const newsSeen = useMail((s) => s.newsSeen);
  const tipShownAt = useMail((s) => s.tipShownAt);
  const busy = useMail((s) => s.npsPrompt || !!s.feedback || s.settingsOpen || s.paletteOpen || !!s.newsOpen || !!s.collectionOpen || s.sidebarEditing);
  // A new stamp has the card slot first, but never while a message is being written.
  const stamp = useMail((s) => (s.stampsOn ? s.stampQueue[0] : undefined));
  const writing = useMail((s) => s.tabs.some((tab) => tab.id === s.activeTabId && tab.kind === "draft"));
  const { markNewsSeen, markTipShown, setNewsOpen } = useMail.getState();
  const context = useTipContext(mobile);
  const tip = openTips(context)[0];
  const latest = RELEASE_NOTES[0];
  const now = useNow();

  // Someone new: the tip clock starts now, the first one comes in a few days.
  useEffect(() => {
    if (LIVE && ready && tipShownAt === null) markTipShown();
  }, [ready, tipShownAt, markTipShown]);

  const showNews = LIVE && ready && newsSeen !== null && newsSeen !== LATEST_NOTE;
  const showTip = LIVE && ready && !showNews && !!tip && tipShownAt !== null && now - tipShownAt > TIP_EVERY_MS;

  return (
    <>
      <NewsDialog mobile={mobile} />
      <AnimatePresence>
        {!busy && !writing && stamp && <StampCard key={`stamp-${stamp}`} id={stamp} mobile={mobile} />}
        {!busy && !stamp && showNews && (
          <Card
            key="news"
            mobile={mobile}
            icon={<Gift size={13} />}
            label={t("What's new")}
            title={t(latest.title)}
            body={t(latest.body)}
            openLabel={t("See what's new")}
            onOpen={() => setNewsOpen("news")}
            onClose={markNewsSeen}
          />
        )}
        {!busy && !stamp && showTip && (
          <Card
            key={`tip-${tip.id}`}
            mobile={mobile}
            icon={<Lightbulb size={13} />}
            label={t("Tip")}
            title={t(tip.title)}
            body={t(tip.body)}
            openLabel={tip.action ? t("Try it") : t("More tips")}
            onOpen={() => {
              markTipShown();
              if (tip.action) ACTIONS[tip.action]();
              else setNewsOpen("tips");
            }}
            onClose={markTipShown}
          />
        )}
      </AnimatePresence>
    </>
  );
}
