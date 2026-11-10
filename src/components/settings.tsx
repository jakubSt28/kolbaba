"use client";

import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Inbox,
  Info,
  KeyRound,
  Laptop,
  Mail,
  MonitorDown,
  Moon,
  Sun,
  SunMoon,
  Plus,
  Smartphone,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion, useDragControls } from "motion/react";
import { Dialog, DropdownMenu, Popover } from "radix-ui";
import { useEffect, useId, useRef, useState } from "react";
import { addPasskey, confirmWithCode, confirmWithPasskey, sendConfirmCode, signOut } from "@/components/auth/auth-client";
import { LegalLinks, SourceCodeLink } from "@/components/legal-links";
import { ACCENTS, BRAND } from "@/lib/brand";
import { detectLocale, getLocale, LANGUAGE_SETTINGS, t, tk, tn, type LanguageSetting, type Locale } from "@/lib/i18n";
import { api, clearSnapshots, LIVE } from "@/lib/live";
import { UNDO_SEND_CHOICES, useMail } from "@/lib/store";
import { SWIPE_ACTIONS, type SwipeAction, type Theme } from "@/lib/types";
import { useNow } from "@/lib/use-now";
import { cn, formatListTime } from "@/lib/utils";
import { AgentMailboxes, AgentRecipes, AgentRow, McpSetup } from "./activity";
import { homeScreen, installHint, installLabel, startInstall, useInstall } from "./install-guide";
import { AllMailboxesBadge, MailboxCustomizer } from "./mailbox-switcher";
import { NotificationSettings } from "./notification-settings";
import { PlusPanel } from "./plus";
import { ScreenerSettings } from "./screener";
import { BundlesPreview, CategoriesPreview, DensityPicker, ImagesPreview, ReadTrackingPreview, RepliesPreview, SummaryPreview } from "./settings-previews";
import { SnippetSettings } from "./snippet-settings";
import { RulesSettings } from "./rules-settings";
import { AwaySettings } from "./away-settings";
import { SignatureEditor } from "./signature-editor";
import { FeedbackCards, KolbabaShowcase } from "./settings-showcase";
import { SWIPE_ICONS, SWIPE_LABELS } from "./swipe-row";
import { MailboxBadge, menuContentClass, menuItemClass, Segmented, spring, Tooltip } from "./ui";

type Section = "general" | "mailboxes" | "mail" | "notifications" | "smart" | "agents" | "account";

const SECTIONS: {
  id: Section;
  label: string;
  icon: LucideIcon;
  live?: boolean;
}[] = [
  { id: "general", label: tk("General"), icon: SlidersHorizontal },
  { id: "mailboxes", label: tk("Mailboxes"), icon: Inbox },
  { id: "mail", label: tk("Mail"), icon: Mail },
  { id: "notifications", label: tk("Notifications"), icon: Bell },
  { id: "smart", label: tk("Smart features"), icon: Sparkles },
  { id: "agents", label: tk("Agents"), icon: Bot },
  { id: "account", label: tk("Account"), icon: UserRound },
];

/** On the phone, the list of sections in groups, like the iOS Settings app. */
const SHEET_GROUPS: Section[][] = [
  ["general", "mailboxes", "mail", "notifications"],
  ["smart", "agents"],
  ["account"],
];

const pushSpring = {
  type: "spring",
  stiffness: 380,
  damping: 38,
  mass: 0.9,
} as const;

/**
 * Settings: a window with sections on the computer, a sheet on the phone. Opened from the sidebar,
 * ⌘K or ⌘, and kept in the store so it survives the app re-rendering in another language.
 */
export function SettingsHost({ mobile }: { mobile: boolean }) {
  const open = useMail((s) => s.settingsOpen);
  const setOpen = useMail((s) => s.setSettingsOpen);
  return mobile ? <SettingsSheet open={open} onClose={() => setOpen(false)} /> : <SettingsDialog open={open} onOpenChange={setOpen} />;
}

function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [section, setSection] = useState<Section>("general");
  const requested = useMail((s) => s.settingsSection);
  const [prevRequested, setPrevRequested] = useState(requested);
  if (requested !== prevRequested) {
    setPrevRequested(requested);
    if (requested && SECTIONS.some((s) => s.id === requested)) setSection(requested as Section);
  }
  const sections = SECTIONS.filter((s) => !s.live || LIVE);
  // Each section opens at its top, so the hairline under the title belongs to the one that was scrolled.
  const [scrolledIn, setScrolledIn] = useState<Section | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/20 data-[state=open]:animate-[fade-in_140ms_ease-out] dark:bg-black/45" />
        <Dialog.Content
          aria-describedby={undefined}
          className="sheet fixed top-1/2 left-1/2 z-50 flex h-[min(600px,calc(100dvh-48px))] w-[min(760px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[22px] outline-none data-[state=open]:animate-[dialog-in_180ms_cubic-bezier(0.32,0.72,0,1)]"
        >
          <nav className="flex w-[196px] shrink-0 flex-col gap-0.5 border-r border-line p-3">
            <Dialog.Title className="px-2 pt-1 pb-3 text-[15px] font-semibold tracking-[-0.01em]">{t("Settings")}</Dialog.Title>
            {sections.map((s) => {
              const Icon = s.icon;
              const active = section === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setSection(s.id)}
                  className={cn(
                    "relative flex h-[34px] items-center gap-2.5 rounded-[10px] px-2 text-left text-[13.5px] transition-colors hover:bg-hover",
                    active ? "font-medium text-ink" : "text-ink-2",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="settings-section"
                      transition={spring}
                      className="absolute inset-0 rounded-[10px] bg-selected shadow-[inset_0_0_0_0.5px_var(--line)]"
                    />
                  )}
                  <Icon size={15} className="relative" />
                  <span className="relative">{t(s.label)}</span>
                </button>
              );
            })}
          </nav>
          <div className="flex min-w-0 flex-1 flex-col">
            {/* The title and the close button stay put while the section scrolls; a hairline shows once it has. */}
            <div className={cn("relative shrink-0 border-b px-7 pt-6 pb-3 transition-colors", scrolledIn === section ? "border-line" : "border-transparent")}>
              <h2 className="pr-8 text-[20px] font-semibold tracking-[-0.02em]">{t(SECTIONS.find((s) => s.id === section)!.label)}</h2>
              <Dialog.Close
                aria-label={t("Close")}
                className="absolute top-3.5 right-3.5 flex size-8 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-hover hover:text-ink"
              >
                <X size={16} />
              </Dialog.Close>
            </div>
            <div
              key={section}
              onScroll={(e) => setScrolledIn(e.currentTarget.scrollTop > 0 ? section : null)}
              className="min-h-0 flex-1 overflow-y-auto px-7 pt-2 pb-8"
            >
              <SectionContent section={section} />
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * On the phone: the sections as a list, like the iOS Settings app, each on its own screen (back
 * with the button or a swipe from the left edge). Opened at a section, it goes straight there.
 */
function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const requested = useMail((s) => s.settingsSection);
  const [section, setSection] = useState<Section | null>(null);
  const [opened, setOpened] = useState({ open, requested });
  if (opened.open !== open || opened.requested !== requested) {
    setOpened({ open, requested });
    if (open) setSection(requested && SECTIONS.some((s) => s.id === requested) ? (requested as Section) : null);
  }
  const controls = useDragControls();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // A popover or menu on top took this Escape to close itself.
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (section) setSection(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, section]);
  const current = section ? SECTIONS.find((s) => s.id === section) : undefined;
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/25"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={t("Settings")}
            className="fixed inset-x-0 top-[max(12px,env(safe-area-inset-top))] bottom-0 z-50 flex flex-col overflow-hidden rounded-t-[22px] bg-canvas shadow-[var(--shadow-float)]"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={pushSpring}
          >
            <div className="relative flex h-12 shrink-0 items-center justify-between px-2">
              {current ? (
                <button onClick={() => setSection(null)} className="relative z-10 flex h-10 items-center gap-0.5 rounded-full pr-3 text-[16px] text-accent-text active:opacity-60">
                  <ChevronLeft size={24} />
                  {t("Settings")}
                </button>
              ) : (
                <span />
              )}
              <span className="pointer-events-none absolute inset-x-0 text-center text-[15px] font-semibold">{current ? t(current.label) : t("Settings")}</span>
              <button onClick={onClose} className="relative z-10 h-10 px-2 text-[16px] font-semibold text-accent-text active:opacity-60">
                {t("Done")}
              </button>
            </div>
            <div className="relative min-h-0 flex-1 overflow-hidden">
              <AnimatePresence initial={false}>
                {current ? (
                  <motion.div
                    key={current.id}
                    className="absolute inset-0 bg-canvas"
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
                      if (info.offset.x > 90 || info.velocity.x > 500) setSection(null);
                    }}
                  >
                    <div className="absolute inset-y-0 left-0 z-10 w-5" onPointerDown={(e) => controls.start(e)} style={{ touchAction: "none" }} />
                    <div className="h-full overflow-y-auto overscroll-contain px-4 pt-2 pb-[max(24px,var(--safe-bottom))]">
                      <SectionContent section={current.id} mobile />
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="sections"
                    className="absolute inset-0 overflow-y-auto overscroll-contain px-4 pt-2 pb-[max(24px,var(--safe-bottom))]"
                    initial={{ x: "-28%", opacity: 0.6 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: "-28%", opacity: 0.6 }}
                    transition={pushSpring}
                  >
                    <SectionList onPick={setSection} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function SectionList({ onPick }: { onPick: (section: Section) => void }) {
  const mailboxes = useMail((s) => s.accounts.length);
  const email = useMail((s) => s.user?.email);
  const detail: Partial<Record<Section, string>> = { mailboxes: mailboxes ? String(mailboxes) : "", account: email ?? "" };
  return (
    <>
      <InstallSettings list />
      {SHEET_GROUPS.map((ids) => {
        const items = SECTIONS.filter((s) => ids.includes(s.id) && (!s.live || LIVE));
        if (!items.length) return null;
        return (
          <Group key={ids[0]}>
            {items.map((s) => {
              const Icon = s.icon;
              return (
                <button key={s.id} onClick={() => onPick(s.id)} className="flex min-h-[52px] w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors active:bg-hover">
                  <span className="flex size-[30px] shrink-0 items-center justify-center rounded-[9px] bg-hover text-ink-2">
                    <Icon size={17} />
                  </span>
                  <span className="min-w-0 flex-1 text-[15px] text-ink">{t(s.label)}</span>
                  {detail[s.id] && <span className="max-w-[45%] truncate text-[14px] text-ink-3">{detail[s.id]}</span>}
                  <ChevronRight size={17} className="shrink-0 text-ink-3" />
                </button>
              );
            })}
          </Group>
        );
      })}
    </>
  );
}

function SectionContent({ section, mobile = false }: { section: Section; mobile?: boolean }) {
  switch (section) {
    case "general":
      return <GeneralSettings mobile={mobile} />;
    case "mailboxes":
      return <MailboxSettings />;
    case "mail":
      return <MailSettings />;
    case "notifications":
      return <NotificationSettings mobile={mobile} />;
    case "smart":
      return <SmartSettings />;
    case "agents":
      return <AgentSettings mobile={mobile} />;
    case "account":
      return <AccountSettings mobile={mobile} />;
  }
}

/* --------------------------------- Layout --------------------------------- */

export function Group({ title, info, children, footer }: { title?: string; info?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="mb-5 last:mb-0">
      {title && (
        <div className="flex items-center gap-1 px-1 pb-1.5 text-[12px] font-medium text-ink-3">
          {title}
          {info && <InfoTip about={title}>{info}</InfoTip>}
        </div>
      )}
      <div className="divide-y divide-line overflow-hidden rounded-[14px] bg-solid shadow-[inset_0_0_0_0.5px_var(--line)]">{children}</div>
      {footer && <p className="px-1 pt-1.5 text-[12px] leading-relaxed text-ink-3">{footer}</p>}
    </div>
  );
}

export function Row({
  label,
  hint,
  info,
  children,
  stack,
  preview,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  /** The longer explanation, behind an (i) next to the label. */
  info?: React.ReactNode;
  children?: React.ReactNode;
  stack?: boolean;
  /** A small picture of what the setting does, under the row (settings-previews.tsx). */
  preview?: React.ReactNode;
}) {
  const row = (
    <div className={cn("flex min-h-[52px] gap-x-4 gap-y-2.5 px-4 py-3", stack ? "flex-col" : "items-center justify-between")}>
      <div className="min-w-0">
        <div className="flex items-center gap-1 text-[13.5px] text-ink">
          {label}
          {info && <InfoTip about={typeof label === "string" ? label : undefined}>{info}</InfoTip>}
        </div>
        {hint && <div className="mt-0.5 text-[12px] leading-snug text-ink-3">{hint}</div>}
      </div>
      {children}
    </div>
  );
  if (!preview) return row;
  return (
    <div>
      {row}
      <div className="-mt-0.5 px-4 pb-3.5">{preview}</div>
    </div>
  );
}

/**
 * The longer story behind a setting, behind an (i) so the list stays short: tap or click it, and
 * with a mouse just hovering is enough. A click while it's open from hovering keeps it open.
 */
export function InfoTip({ about, children }: { about?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pinned = useRef(false);
  const hover = (e: React.PointerEvent, next: boolean, ms: number) => {
    if (e.pointerType !== "mouse" || pinned.current) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(next), ms);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        clearTimeout(timer.current);
        pinned.current = next;
        setOpen(next);
      }}
    >
      <Popover.Trigger asChild>
        <button
          aria-label={about ? t("More about {setting}", { setting: about }) : t("More info")}
          onPointerEnter={(e) => hover(e, true, 220)}
          onPointerLeave={(e) => hover(e, false, 160)}
          onClick={(e) => {
            // Open from hovering: the click keeps it open instead of closing it.
            if (open && !pinned.current) {
              e.preventDefault();
              clearTimeout(timer.current);
              pinned.current = true;
            }
          }}
          className="relative inline-flex size-[18px] shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors after:absolute after:-inset-2.5 hover:text-ink data-[state=open]:text-accent-text"
        >
          <Info size={14} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onPointerEnter={() => clearTimeout(timer.current)}
          onPointerLeave={(e) => hover(e, false, 160)}
          className="glass-strong z-[60] flex w-[min(300px,calc(100vw-24px))] flex-col gap-2 rounded-2xl p-3 text-[12.5px] leading-relaxed text-ink-2 data-[state=open]:animate-[menu-in_140ms_ease-out]"
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function Toggle({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn("relative h-[24px] w-[42px] shrink-0 rounded-full transition-colors disabled:opacity-50", on ? "bg-accent" : "bg-selected")}
    >
      <motion.span
        layout
        transition={spring}
        className={cn("absolute top-[2px] size-[20px] rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.2)]", on ? "right-[2px]" : "left-[2px]")}
      />
    </button>
  );
}

/* --------------------------------- General -------------------------------- */

/** Language names are always in their own language, so anyone can find theirs. */
const LANGUAGE_NAMES: Record<"en" | "cs", string> = {
  en: "English",
  cs: "Čeština",
};

/** A small flag for a language: the UK for English (dates and money follow en-GB), Czechia for Czech. */
function Flag({ locale }: { locale: Locale }) {
  // url(#…) needs a plain id; React's ids carry characters it doesn't like.
  const clip = `flag-${useId().replace(/[^\w-]/g, "")}`;
  return (
    <span aria-hidden className="inline-flex h-[12px] w-[17px] shrink-0 overflow-hidden rounded-[2.5px] shadow-[0_0_0_0.5px_rgb(0_0_0/0.18)]">
      {locale === "cs" ? (
        <svg viewBox="0 0 900 600" preserveAspectRatio="none" className="size-full">
          <rect width="900" height="600" fill="#D7141A" />
          <rect width="900" height="300" fill="#FFFFFF" />
          <path d="M450 300 0 0v600z" fill="#11457E" />
        </svg>
      ) : (
        <svg viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice" className="size-full">
          <clipPath id={clip}>
            <path d="M30 15h30v15zv15H0zH0V0zV0h30z" />
          </clipPath>
          <path d="M0 0v30h60V0z" fill="#012169" />
          <path d="M0 0l60 30m0-30L0 30" stroke="#FFFFFF" strokeWidth="6" />
          <path d="M0 0l60 30m0-30L0 30" clipPath={`url(#${clip})`} stroke="#C8102E" strokeWidth="4" />
          <path d="M30 0v30M0 15h60" stroke="#FFFFFF" strokeWidth="10" />
          <path d="M30 0v30M0 15h60" stroke="#C8102E" strokeWidth="6" />
        </svg>
      )}
    </span>
  );
}

const THEMES: Theme[] = ["auto", "light", "dark"];
const THEME_LABELS: Record<Theme, string> = { auto: tk("Automatic"), light: tk("Light"), dark: tk("Dark") };
const THEME_ICONS: Record<Theme, React.ReactNode> = { auto: <SunMoon size={14} />, light: <Sun size={14} />, dark: <Moon size={14} /> };

function GeneralSettings({ mobile = false }: { mobile?: boolean }) {
  const theme = useMail((s) => s.theme);
  const setTheme = useMail((s) => s.setTheme);
  const language = useMail((s) => s.language);
  const setLanguage = useMail((s) => s.setLanguage);
  const density = useMail((s) => s.density);
  const setDensity = useMail((s) => s.setDensity);
  const accent = useMail((s) => s.accent);
  const setAccent = useMail((s) => s.setAccent);
  const labels: Record<LanguageSetting, string> = {
    auto: t("Automatic"),
    ...LANGUAGE_NAMES,
  };
  return (
    <>
      {!mobile && <InstallSettings />}
      <Group>
        <Row
          label={t("Language")}
          hint={
            language === "auto"
              ? t("Follows your browser: {language}", {
                  language: LANGUAGE_NAMES[detectLocale()],
                })
              : undefined
          }
          stack
        >
          <Segmented
            id={`language-${mobile}`}
            value={language}
            full
            options={LANGUAGE_SETTINGS.map((l) => ({
              value: l,
              label: labels[l],
              // Automatic shows the language it picked.
              icon: <Flag locale={l === "auto" ? detectLocale() : l} />,
            }))}
            onChange={setLanguage}
          />
        </Row>
        <Row label={t("Appearance")} stack>
          <Segmented
            id={`theme-${mobile}`}
            value={theme}
            full
            options={THEMES.map((v) => ({ value: v, label: t(THEME_LABELS[v]), icon: THEME_ICONS[v] }))}
            onChange={setTheme}
          />
        </Row>
        <Row label={t("App colour")} stack>
          <div className={cn("-mx-0.5", mobile ? "grid grid-cols-6 justify-items-center gap-y-1" : "flex flex-wrap gap-1.5")}>
            {ACCENTS.map((a) => (
              <Tooltip key={a.id} label={t(a.label)} side="top">
                <button
                  aria-label={t(a.label)}
                  aria-pressed={accent === a.id}
                  onClick={() => setAccent(a.id)}
                  className="group/swatch flex size-8 items-center justify-center rounded-full"
                >
                  <span
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.12)] transition-transform group-hover/swatch:scale-110 dark:shadow-[inset_0_0_0_0.5px_rgb(255_255_255/0.18)]",
                      accent === a.id && "ring-2 ring-ink/70 ring-offset-2 ring-offset-[var(--solid)]",
                    )}
                    style={{ background: a.swatch }}
                  />
                </button>
              </Tooltip>
            ))}
          </div>
        </Row>
        <Row label={t("List density")} stack>
          <DensityPicker value={density} onChange={setDensity} />
        </Row>
        <Row label={t("Sidebar")} hint={t("Order of folders and sections, and what goes into More")} stack={mobile}>
          <button
            onClick={() => {
              useMail.getState().setSettingsOpen(false);
              useMail.getState().setSidebarEditing(true);
            }}
            className="h-8 shrink-0 rounded-[10px] bg-hover px-3 text-[13px] font-medium text-ink transition-colors hover:bg-selected"
          >
            {t("Edit")}
          </button>
        </Row>
      </Group>
      <SwipeSettings />
    </>
  );
}

/**
 * In a browser: put Kolbaba on the Home Screen, the Dock or the desktop. First in General on the
 * computer, first in the list of sections on the phone; gone once Kolbaba runs as an app.
 */
function InstallSettings({ list = false }: { list?: boolean }) {
  const guide = useInstall();
  if (!guide) return null;
  const install = () => void startInstall(guide);
  if (list) {
    const Icon = homeScreen(guide) ? Smartphone : MonitorDown;
    return (
      <Group>
        <button onClick={install} className="flex min-h-[52px] w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors active:bg-hover">
          <span className="flex size-[30px] shrink-0 items-center justify-center rounded-[9px] bg-accent-soft text-accent-text">
            <Icon size={17} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] text-ink">{installLabel(guide)}</span>
            <span className="block text-[12.5px] leading-snug text-ink-3">{installHint(guide)}</span>
          </span>
          <ChevronRight size={17} className="shrink-0 text-ink-3" />
        </button>
      </Group>
    );
  }
  return (
    <Group>
      <Row label={installLabel(guide)} hint={installHint(guide)}>
        <button onClick={install} className="h-8 shrink-0 rounded-[10px] bg-hover px-3 text-[13px] font-medium text-ink transition-colors hover:bg-selected">
          {homeScreen(guide) ? t("Add") : t("Install")}
        </button>
      </Row>
    </Group>
  );
}

/** One action per direction. Synced, so it can be set up on the computer for the phone too. */
function SwipeSettings() {
  const swipeLeft = useMail((s) => s.swipeLeft);
  const swipeRight = useMail((s) => s.swipeRight);
  const setSwipe = useMail((s) => s.setSwipe);
  return (
    <Group title={t("Swipe on phone and tablet")}>
      <Row label={<SwipeLabel icon={<ArrowLeft size={14} />}>{t("Swipe left")}</SwipeLabel>}>
        <SwipePicker value={swipeLeft} onChange={(a) => setSwipe("left", a)} />
      </Row>
      <Row label={<SwipeLabel icon={<ArrowRight size={14} />}>{t("Swipe right")}</SwipeLabel>}>
        <SwipePicker value={swipeRight} onChange={(a) => setSwipe("right", a)} />
      </Row>
    </Group>
  );
}

const SwipeLabel = ({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) => (
  <span className="flex items-center gap-2">
    <span className="text-ink-3">{icon}</span>
    {children}
  </span>
);

function SwipePicker({ value, onChange }: { value: SwipeAction; onChange: (a: SwipeAction) => void }) {
  const Icon = SWIPE_ICONS[value];
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button className="flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] bg-hover pr-2 pl-2.5 text-[13px] font-medium text-ink transition-colors hover:bg-selected data-[state=open]:bg-selected">
          {Icon && <Icon size={14} />}
          {t(SWIPE_LABELS[value])}
          <ChevronsUpDown size={12} className="text-ink-3" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="bottom" align="end" sideOffset={6} className={cn(menuContentClass, "z-[60]")}>
          <DropdownMenu.RadioGroup value={value} onValueChange={(v) => onChange(v as SwipeAction)}>
            {SWIPE_ACTIONS.map((a) => {
              const ItemIcon = SWIPE_ICONS[a];
              return (
                <DropdownMenu.RadioItem key={a} value={a} className={menuItemClass}>
                  <span className="inline-flex w-4 justify-center">{ItemIcon ? <ItemIcon size={14} /> : null}</span>
                  {t(SWIPE_LABELS[a])}
                  <DropdownMenu.ItemIndicator className="ml-auto">
                    <Check size={14} />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              );
            })}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/* -------------------------------- Mailboxes ------------------------------- */

/** The same name, colour, icon and picture as in the mailbox switcher, where people look for settings. */
function MailboxSettings() {
  const accounts = useMail((s) => s.accounts);
  const openAddAccount = useMail((s) => s.openAddAccount);
  const setSettingsOpen = useMail((s) => s.setSettingsOpen);
  const [editing, setEditing] = useState<string | null>(null);
  const account = accounts.find((a) => a.id === editing);

  if (account) {
    return (
      <>
        <button
          onClick={() => setEditing(null)}
          className="mb-2 -ml-1.5 flex h-8 items-center gap-1 rounded-lg pr-2 pl-1 text-[13px] font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink"
        >
          <ChevronLeft size={16} />
          {t("All mailboxes")}
        </button>
        <div className="mb-5 rounded-[14px] bg-solid p-4 shadow-[inset_0_0_0_0.5px_var(--line)]">
          <MailboxCustomizer account={account} page onRemoved={() => setEditing(null)} />
        </div>
        <Group title={t("Signature")} footer={t("Goes under every email you send from {email}.", { email: account.email })}>
          <SignatureEditor key={account.id} account={account} />
        </Group>
      </>
    );
  }

  return (
    <>
      {accounts.length > 1 && <OpenMailboxSetting />}
      <Group footer={t("You'll find the same in the mailbox switcher at the top of the sidebar.")}>
        {accounts.map((a) => (
          <button key={a.id} onClick={() => setEditing(a.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hover">
            <MailboxBadge icon={a.icon} hue={a.hue} image={a.image} size={32} className="rounded-[10px]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium text-ink">{a.name}</span>
              <span className="block truncate text-[12px] text-ink-3">{a.email}</span>
            </span>
            {a.status === "error" && <span className="shrink-0 text-[12px] text-danger">{t("Needs reconnecting")}</span>}
            <ChevronRight size={16} className="shrink-0 text-ink-3" />
          </button>
        ))}
        <button
          onClick={() => {
            setSettingsOpen(false);
            openAddAccount();
          }}
          className="flex w-full items-center gap-3 px-4 py-3 text-left text-[13.5px] font-medium text-accent-text transition-colors hover:bg-hover"
        >
          <span className="flex size-8 items-center justify-center rounded-[10px] bg-hover">
            <Plus size={16} />
          </span>
          {t("Add mailbox")}
        </button>
      </Group>
    </>
  );
}

/** Which mailbox shows first when the app opens; switching mailboxes afterwards doesn't change it. */
function OpenMailboxSetting() {
  const accounts = useMail((s) => s.accounts);
  const value = useMail((s) => s.openMailbox);
  const setOpenMailbox = useMail((s) => s.setOpenMailbox);
  const current = accounts.find((a) => a.id === value);
  return (
    <Group>
      <Row label={t("When Kolbaba opens, show")} hint={t("The mailbox you see first, on all your devices")} stack>
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <button className="flex h-9 w-full items-center gap-2 rounded-[10px] bg-hover pr-2 pl-2 text-left text-[13px] font-medium text-ink transition-colors hover:bg-selected data-[state=open]:bg-selected">
              {current ? <MailboxBadge icon={current.icon} hue={current.hue} image={current.image} size={20} /> : <AllMailboxesBadge size={20} />}
              <span className="min-w-0 flex-1 truncate">{current?.name ?? t("All mailboxes")}</span>
              <ChevronsUpDown size={12} className="shrink-0 text-ink-3" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content side="bottom" align="start" sideOffset={6} className={cn(menuContentClass, "z-[60]")}>
              <DropdownMenu.RadioGroup value={current?.id ?? "all"} onValueChange={setOpenMailbox}>
                <DropdownMenu.RadioItem value="all" className={menuItemClass}>
                  <AllMailboxesBadge size={18} />
                  {t("All mailboxes")}
                  <DropdownMenu.ItemIndicator className="ml-auto pl-3">
                    <Check size={14} />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
                {accounts.map((a) => (
                  <DropdownMenu.RadioItem key={a.id} value={a.id} className={menuItemClass}>
                    <MailboxBadge icon={a.icon} hue={a.hue} image={a.image} size={18} />
                    <span className="max-w-[220px] truncate">{a.name}</span>
                    <DropdownMenu.ItemIndicator className="ml-auto pl-3">
                      <Check size={14} />
                    </DropdownMenu.ItemIndicator>
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </Row>
    </Group>
  );
}

/* ---------------------------------- Mail ---------------------------------- */

function MailSettings() {
  const trackByDefault = useMail((s) => s.trackByDefault);
  const setTrackByDefault = useMail((s) => s.setTrackByDefault);
  const undoSendSeconds = useMail((s) => s.undoSendSeconds);
  const setUndoSendSeconds = useMail((s) => s.setUndoSendSeconds);
  const bundles = useMail((s) => s.bundles);
  const setBundles = useMail((s) => s.setBundles);
  return (
    <>
      <Group>
        <Row
          label={t("Bundle newsletters and notifications")}
          hint={t("One row each in Inbox, so people's mail stands out")}
          info={t("Pinned mail, fresh sign-in codes, conversations you replied in and cards with something to do (a bill to pay, a parcel on its way) always stay in sight.")}
          preview={<BundlesPreview />}
        >
          <Toggle on={bundles} label={t("Bundle newsletters and notifications")} onChange={setBundles} />
        </Row>
      </Group>
      <RulesSettings />
      <AwaySettings />
      {LIVE && <LiveMailSettings />}
      <Group>
        <Row label={t("Undo send")} hint={t("How long a sent email can still be taken back")} stack>
          <Segmented
            id="undo-send"
            value={String(undoSendSeconds)}
            full
            options={UNDO_SEND_CHOICES.map((n) => ({ value: String(n), label: t("{n} s", { n }) }))}
            onChange={(v) => setUndoSendSeconds(Number(v))}
          />
        </Row>
      </Group>
      <Group>
        <Row
          label={t("Read tracking")}
          hint={t("See when someone opens your email")}
          info={
            <>
              <p>{t("On for new messages by default. You can still turn it off for each message.")}</p>
              <p>{t("Tracked with an invisible image. Apple Mail preloads images and many apps block them, so treat this as a hint, not proof.")}</p>
            </>
          }
          preview={<ReadTrackingPreview />}
        >
          <Toggle on={trackByDefault} label={t("Read tracking")} onChange={setTrackByDefault} />
        </Row>
      </Group>
      <SnippetSettings />
      {LIVE && <BlockedSenders />}
    </>
  );
}

type BlockedSender = { email: string; name: string; bin: boolean; domain: boolean };

/** Everyone blocked (from any email: to Trash) and turned away in the screener (to Archive), with Unblock. */
function BlockedSenders() {
  const pushToast = useMail((s) => s.pushToast);
  const [blocked, setBlocked] = useState<BlockedSender[] | null>(null);
  useEffect(() => {
    void api.get<{ blocked: BlockedSender[] }>("/api/senders").then((r) => setBlocked(r.blocked), () => setBlocked([]));
  }, []);
  if (!blocked?.length) return null;
  const unblock = (b: BlockedSender) => {
    setBlocked((list) => list?.filter((x) => x.email !== b.email) ?? null);
    const who = b.domain ? b.email.slice(1) : b.name || b.email;
    void api.del("/api/senders", { email: b.email }).then(
      () => pushToast({ message: t("{name} can reach your Inbox again", { name: who }) }),
      (err: Error) => pushToast({ message: err.message }),
    );
  };
  return (
    <Group title={t("Blocked senders")} footer={t("Blocked: their mail goes to Trash. Turned away in the screener: to Archive.")}>
      {blocked.map((b) => (
        <Row
          key={b.email}
          label={b.domain ? t("Everyone at {domain}", { domain: b.email.slice(1) }) : b.name || b.email}
          hint={[b.domain || !b.name ? null : b.email, b.bin ? t("To Trash") : t("To Archive · screener")].filter(Boolean).join(" · ")}
        >
          <button onClick={() => unblock(b)} className="h-8 shrink-0 rounded-[10px] bg-hover px-3 text-[13px] font-medium text-ink transition-colors hover:bg-selected">
            {t("Unblock")}
          </button>
        </Row>
      ))}
    </Group>
  );
}

/* ------------------------------ Smart features ----------------------------- */

/** What the app sorts and reads for you: categories and summaries by AI (OpenAI), the screener by rules. */
function SmartSettings() {
  const selfHosted = useMail((s) => s.selfHosted);
  const aiAvailable = useMail((s) => s.aiAvailable);
  const smartCategories = useMail((s) => s.smartCategories);
  const setSmartCategories = useMail((s) => s.setSmartCategories);
  const replyReminders = useMail((s) => s.replyReminders);
  const setReplyReminders = useMail((s) => s.setReplyReminders);
  const summaries = useMail((s) => s.summaries);
  const setSummaries = useMail((s) => s.setSummaries);
  return (
    <>
      {LIVE && !selfHosted && <PlusPanel />}
      {!aiAvailable && (
        <div className="rounded-2xl bg-[color-mix(in_oklab,var(--ink)_5%,transparent)] px-4 py-3 text-[13px] leading-relaxed text-ink-2">
          {t("These need an OpenAI key. Add OPENAI_API_KEY to the .env file on your server and restart Kolbaba. Your mail then goes to OpenAI under your own account.")}
        </div>
      )}
      <Group>
        <Row
          label={t("Smart categories")}
          hint={t("Orders, trips, invoices, subscriptions and security notices on their own pages")}
          info={t(
            "TypeSafe sorts incoming mail by its sender, subject and first lines, and senders that only ever send newsletters stop being sorted. OpenAI then reads only emails from the last three months that look like an order, a trip, an invoice, a subscription or a security notice, and pulls out amounts, dates and delivery status. With a Plus subscription, older mail is sorted too, so its cards have no details. Neither trains on your mail, and OpenAI deletes it within 30 days.",
          )}
          preview={<CategoriesPreview />}
        >
          <Toggle on={smartCategories} label={t("Smart categories")} onChange={setSmartCategories} />
        </Row>
      </Group>
      <Group>
        <Row
          label={t("Awaiting my reply")}
          hint={smartCategories ? t("AI also reads emails from people, to show who's waiting for your answer") : t("Works on top of Smart categories: turn those on first")}
          info={t(
            "With this on, OpenAI also reads emails from the last three months from people who seem to ask you something, to show who's waiting for your answer. It doesn't train on them and deletes them within 30 days.",
          )}
          preview={<RepliesPreview />}
        >
          <Toggle on={smartCategories && replyReminders} label={t("Awaiting my reply")} onChange={setReplyReminders} disabled={!smartCategories} />
        </Row>
      </Group>
      {LIVE && (
        <Group>
          <Row
            label={t("Summarize long conversations")}
            hint={t("A Summarize button in conversations of three or more emails")}
            info={t("A conversation goes to OpenAI only when you press Summarize. OpenAI doesn't train on it and deletes it within 30 days.")}
            preview={<SummaryPreview />}
          >
            <Toggle on={summaries} label={t("Summarize long conversations")} onChange={setSummaries} />
          </Row>
        </Group>
      )}
      {LIVE && <ScreenerSettings />}
    </>
  );
}

/** Live mode only: settings that live on the server. */
function LiveMailSettings() {
  const remoteImages = useMail((s) => s.loadRemoteImages);
  const setRemoteImages = useMail((s) => s.setLoadRemoteImages);

  return (
    <>
      <Group>
        <Row
          label={t("Load images automatically")}
          hint={t("Pictures in emails show right away")}
          info={t("When it's off, tracking pixels stay blocked until you tap “Show images”")}
          preview={<ImagesPreview load={remoteImages} />}
        >
          <Toggle on={remoteImages} label={t("Load images automatically")} onChange={setRemoteImages} />
        </Row>
      </Group>
    </>
  );
}

/* --------------------------------- Agents --------------------------------- */

/** MCP: the server address, who is connected and with what access, and which mailboxes they see. */
function AgentSettings({ mobile = false }: { mobile?: boolean }) {
  const agents = useMail((s) => s.agents);
  const openActivity = useMail((s) => s.openActivity);
  const setSettingsOpen = useMail((s) => s.setSettingsOpen);
  const now = useNow();
  const button = "h-8 shrink-0 rounded-[10px] bg-hover px-3 text-[13px] font-medium text-ink transition-colors hover:bg-selected";
  return (
    <>
      <Group title={t("MCP server")}>
        <div className="px-4 py-3.5">
          <p className="mb-3 text-[12.5px] leading-relaxed text-ink-3">
            {t("Connect Claude, ChatGPT, Cursor or any MCP client to {brand}. You'll pick what it may do and which mailboxes it sees when you sign in from the agent.", {
              brand: BRAND.name,
            })}
          </p>
          <McpSetup />
        </div>
      </Group>
      <Group title={t("Things to ask")} footer={t("Tap one to copy it. Words in [brackets] are yours to fill in.")}>
        <AgentRecipes />
      </Group>
      <Group title={t("Connected agents")} footer={agents.length ? t("Each agent sees only the mailboxes shown under it. A new mailbox isn't shared with anyone until you add it here.") : undefined}>
        {agents.length ? (
          agents.map((a) => (
            <div key={a.id} className="px-2 py-1">
              <AgentRow agent={a} now={now} />
              <AgentMailboxes agent={a} />
            </div>
          ))
        ) : (
          <Row label={t("No agents connected yet")} />
        )}
      </Group>
      <Group>
        <Row label={t("AI activity")} hint={t("Every step your agents took, with Undo")} stack={mobile}>
          <button
            onClick={() => {
              setSettingsOpen(false);
              openActivity("agents");
            }}
            className={button}
          >
            {t("Open")}
          </button>
        </Row>
      </Group>
    </>
  );
}

/* --------------------------------- Account -------------------------------- */

/** On a self-hosted copy: which version runs, and whether a newer one is out (/api/selfhost/update). */
function SelfHostedVersion() {
  const [info, setInfo] = useState<{ current: string; latest: string | null } | null>(null);
  useEffect(() => {
    api
      .get<{ current: string; latest: string | null }>("/api/selfhost/update")
      .then(setInfo)
      .catch(() => {});
  }, []);
  if (!info) return null;
  return (
    <p className="px-1 pt-1 text-center text-[12px] leading-relaxed text-ink-3">
      {t("Version {version}, on your own server", { version: info.current })}
      {info.latest && (
        <>
          <br />
          {t("Version {version} is out. It installs by itself overnight, or run:", { version: info.latest })}{" "}
          <code className="rounded bg-hover px-1 py-0.5 text-[11.5px]">docker compose pull && docker compose up -d</code>
        </>
      )}
      <br />
      <SourceCodeLink locale={getLocale()} />
    </p>
  );
}

function AccountSettings({ mobile = false }: { mobile?: boolean }) {
  const user = useMail((s) => s.user);
  const selfHosted = useMail((s) => s.selfHosted);
  const button = "h-8 shrink-0 rounded-[10px] bg-hover px-3 text-[13px] font-medium text-ink transition-colors hover:bg-selected";
  const [passkeys, setPasskeys] = useState<PasskeyInfo[] | null>(null);
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null);
  const load = () => {
    void api.get<{ passkeys: PasskeyInfo[] }>("/api/auth/passkeys").then((r) => setPasskeys(r.passkeys), () => setPasskeys([]));
    void api.get<{ sessions: DeviceSession[] }>("/api/auth/sessions").then((r) => setSessions(r.sessions), () => setSessions([]));
  };
  useEffect(() => {
    if (LIVE) load();
  }, []);
  // The prototype has no account, just what Kolbaba has to show.
  if (!LIVE)
    return (
      <>
        <KolbabaShowcase />
        <FeedbackCards mobile={mobile} />
      </>
    );
  return (
    <>
      <Group>
        <Row label={t("Signed in as")} hint={user?.email} stack={mobile}>
          <button
            onClick={() =>
              void signOut()
                .catch(() => {})
                .then(clearSnapshots)
                // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                .then(() => window.location.assign("/login"))
            }
            className={button}
          >
            {t("Sign out")}
          </button>
        </Row>
      </Group>
      <KolbabaShowcase />
      {!selfHosted && <FeedbackCards mobile={mobile} />}
      {user?.admin && (
        <Group title={t("Admin")}>
          <Row label={t("Admin")} hint={t("Open the overview of users and feedback")} stack={mobile}>
            <a href="/admin" className={cn(button, "flex items-center")}>
              {t("Open")}
            </a>
          </Row>
        </Group>
      )}
      <PasskeyList passkeys={passkeys} onChange={load} button={button} />
      <DeviceList sessions={sessions} onChange={load} button={button} />
      {user && <DeleteAccount email={user.email} hasPasskey={!!passkeys?.length} />}
      {selfHosted ? <SelfHostedVersion /> : <LegalLinks locale={getLocale()} className="pt-1 text-[12px] text-ink-3" />}
    </>
  );
}

interface PasskeyInfo {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
  synced: boolean;
}

interface DeviceSession {
  id: string;
  device: string;
  browser: string | null;
  createdAt: number;
  lastSeenAt: number;
  current: boolean;
}

/** Device names come from the server in English; these are the ones it knows. */
const DEVICE_NAMES: Record<string, string> = {
  iPhone: "iPhone",
  iPad: "iPad",
  Mac: "Mac",
  Chromebook: "Chromebook",
  "Android phone": tk("Android phone"),
  "Android tablet": tk("Android tablet"),
  "Windows PC": tk("Windows PC"),
  "Linux PC": tk("Linux PC"),
  Passkey: tk("Passkey"),
  "Unknown device": tk("Unknown device"),
};
const deviceName = (name: string) => (DEVICE_NAMES[name] ? t(DEVICE_NAMES[name]) : name);
const isPhone = (name: string) => /iPhone|Android phone/.test(name);

function PasskeyList({ passkeys, onChange, button }: { passkeys: PasskeyInfo[] | null; onChange: () => void; button: string }) {
  const selfHosted = useMail((s) => s.selfHosted);
  const pushToast = useMail((s) => s.pushToast);
  const [confirming, setConfirming] = useState<string | null>(null);
  const remove = async (id: string) => {
    try {
      await api.del(`/api/auth/passkeys/${encodeURIComponent(id)}`);
      pushToast({ message: t("Passkey removed. You can delete it from your password manager too.") });
      onChange();
    } catch (err) {
      pushToast({ message: (err as Error).message });
    }
    setConfirming(null);
  };
  return (
    <Group title={t("Passkeys")} footer={selfHosted ? t("Sign in with Face ID, Touch ID or your device's screen lock. Lost them all? The command kolbaba-link on your server gets you back in.") : t("Optional: sign in with Face ID, Touch ID or your device's screen lock instead of a code. A code by email always works too.")}>
      {passkeys?.map((p) => (
        <Row
          key={p.id}
          label={
            <span className="flex items-center gap-2">
              <KeyRound size={14} className="text-ink-3" />
              {deviceName(p.label)}
            </span>
          }
          hint={
            p.lastUsedAt
              ? t("Added {added} · last used {used}", { added: formatListTime(p.createdAt), used: formatListTime(p.lastUsedAt) })
              : t("Added {added}", { added: formatListTime(p.createdAt) })
          }
        >
          {confirming === p.id ? (
            <span className="flex shrink-0 gap-1.5">
              <button onClick={() => setConfirming(null)} className={button}>
                {t("Cancel")}
              </button>
              <button onClick={() => void remove(p.id)} className={cn(button, "bg-danger text-white hover:bg-danger/90")}>
                {t("Remove")}
              </button>
            </span>
          ) : (
            <button onClick={() => setConfirming(p.id)} className={cn(button, "bg-transparent text-ink-2 shadow-[inset_0_0_0_0.5px_var(--line)]")}>
              {t("Remove…")}
            </button>
          )}
        </Row>
      ))}
      <Row label={t("Add a passkey")} hint={passkeys?.length ? t("For another device, or a second one as a backup") : t("The fastest way in on this device")}>
        <button
          onClick={() =>
            addPasskey()
              .then(() => {
                pushToast({ message: t("Passkey added to this device") });
                onChange();
              })
              .catch(() => {})
          }
          className={button}
        >
          {t("Add passkey")}
        </button>
      </Row>
    </Group>
  );
}

function DeviceList({ sessions, onChange, button }: { sessions: DeviceSession[] | null; onChange: () => void; button: string }) {
  const pushToast = useMail((s) => s.pushToast);
  if (!sessions?.length) return null;
  const others = sessions.filter((s) => !s.current).length;
  const signOutDevice = async (id: string) => {
    await api.del(`/api/auth/sessions/${id}`).catch(() => {});
    onChange();
  };
  const signOutOthers = async () => {
    const { ended } = await api.del<{ ended: number }>("/api/auth/sessions").catch(() => ({ ended: 0 }));
    pushToast({ message: tn(ended, "Signed out of {n} other device", "Signed out of {n} other devices") });
    onChange();
  };
  return (
    <Group
      title={t("Where you're signed in")}
      footer={
        others > 0 ? (
          <button onClick={() => void signOutOthers()} className="font-medium text-danger hover:underline">
            {t("Sign out everywhere else")}
          </button>
        ) : (
          t("Only this device is signed in.")
        )
      }
    >
      {sessions.map((s) => {
        const Icon = isPhone(s.device) ? Smartphone : Laptop;
        const name = s.browser ? t("{device} · {browser}", { device: deviceName(s.device), browser: s.browser }) : deviceName(s.device);
        return (
          <Row
            key={s.id}
            label={
              <span className="flex items-center gap-2">
                <Icon size={14} className="text-ink-3" />
                {name}
                {s.current && <span className="rounded-full bg-accent-soft px-1.5 py-px text-[11px] font-medium text-accent-text">{t("This device")}</span>}
              </span>
            }
            hint={s.current ? t("Signed in {when}", { when: formatListTime(s.createdAt) }) : t("Last active {when}", { when: formatListTime(s.lastSeenAt) })}
          >
            {!s.current && (
              <button onClick={() => void signOutDevice(s.id)} className={button}>
                {t("Sign out")}
              </button>
            )}
          </Row>
        );
      })}
    </Group>
  );
}

/**
 * Deletes everything Kolbaba holds; typing the address makes it deliberate, and a passkey or a code by
 * email confirms it's really you (a borrowed unlocked device isn't enough). Mail at the providers stays.
 */
function DeleteAccount({ email, hasPasskey }: { email: string; hasPasskey: boolean }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  /** "code": a code went to the address and waits to be typed. */
  const [phase, setPhase] = useState<"type" | "code">("type");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim().toLowerCase() === email.toLowerCase();

  const deleteNow = async () => {
    await api.del("/api/auth/me", { confirm: typed });
    await clearSnapshots();
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  };

  const withPasskey = async () => {
    setBusy(true);
    setError(null);
    try {
      await confirmWithPasskey();
      await deleteNow();
    } catch (err) {
      const cancelled = (err as Error).name === "NotAllowedError" || (err as Error).name === "AbortError";
      setError(cancelled ? t("The account stays. Confirm with your passkey to delete it.") : (err as Error).message || t("Couldn't delete the account. Try again."));
      setBusy(false);
    }
  };

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendConfirmCode();
      setPhase("code");
      setCode("");
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };

  const withCode = async (value: string) => {
    if (value.replace(/\D/g, "").length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await confirmWithCode(value);
      await deleteNow();
    } catch (err) {
      setError((err as Error).message || t("Couldn't delete the account. Try again."));
      setBusy(false);
    }
  };

  const close = () => {
    setOpen(false);
    setTyped("");
    setPhase("type");
    setCode("");
    setError(null);
  };

  const field = "mt-3 h-9 w-full rounded-[10px] bg-canvas px-3 text-[13.5px] shadow-[inset_0_0_0_1px_var(--line)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--danger)]";
  return (
    <Group title={t("Danger zone")}>
      {!open ? (
        <Row label={t("Delete account")} hint={t("Mailboxes, our copy of your mail, drafts, AI agents and passkeys")}>
          <button
            onClick={() => setOpen(true)}
            className="h-8 shrink-0 rounded-[10px] px-3 text-[13px] font-medium text-danger shadow-[inset_0_0_0_0.5px_var(--line)] transition-colors hover:bg-danger/8"
          >
            {t("Delete…")}
          </button>
        </Row>
      ) : (
        <div className="p-4">
          <p className="text-[13px] leading-relaxed text-ink-2">
            {phase === "code"
              ? t("We sent a 6-digit code to {email}. Type it to delete the account.", { email })
              : t(
                  "This deletes your Kolbaba account: mailboxes, our copy of your mail, drafts, scheduled emails, AI agents and passkeys. Mail at your providers stays. Type {email} to confirm.",
                  { email },
                )}
          </p>
          {phase === "code" ? (
            <input
              value={code}
              onChange={(e) => {
                const value = e.target.value.replace(/[^\d ]/g, "").slice(0, 7);
                setCode(value);
                void withCode(value);
              }}
              placeholder="000 000"
              aria-label={t("Code from the email")}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              disabled={busy}
              className={cn(field, "text-center font-semibold tracking-[0.3em] tabular-nums")}
            />
          ) : (
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && matches && !busy && void (hasPasskey ? withPasskey() : sendCode())}
              placeholder={email}
              aria-label={t("Your email address")}
              autoComplete="off"
              spellCheck={false}
              autoFocus
              className={field}
            />
          )}
          {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            {phase === "type" && hasPasskey && (
              <button onClick={() => void sendCode()} disabled={!matches || busy} className="mr-auto text-[12.5px] font-medium text-ink-2 hover:underline disabled:opacity-50">
                {t("Use a code from email instead")}
              </button>
            )}
            <button onClick={close} className="h-8 rounded-[10px] bg-hover px-3 text-[13px] font-medium text-ink-2 transition-colors hover:bg-selected">
              {t("Cancel")}
            </button>
            {phase === "type" ? (
              <button
                disabled={!matches || busy}
                onClick={() => void (hasPasskey ? withPasskey() : sendCode())}
                className="h-8 rounded-[10px] bg-danger px-3 text-[13px] font-medium text-white transition-opacity disabled:opacity-50"
              >
                {busy ? t("Deleting…") : hasPasskey ? t("Confirm with passkey and delete") : t("Send a code and delete")}
              </button>
            ) : (
              <button
                disabled={busy || code.replace(/\D/g, "").length !== 6}
                onClick={() => void withCode(code)}
                className="h-8 rounded-[10px] bg-danger px-3 text-[13px] font-medium text-white transition-opacity disabled:opacity-50"
              >
                {busy ? t("Deleting…") : t("Delete account")}
              </button>
            )}
          </div>
        </div>
      )}
    </Group>
  );
}
