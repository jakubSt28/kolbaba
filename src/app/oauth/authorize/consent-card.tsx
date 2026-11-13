"use client";

import { CalendarDays, Check, CircleCheckBig, CircleAlert, Eye, FilePen, Link2, LoaderCircle, Send, ShieldAlert, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Fragment, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { BrandMark } from "@/components/brand-mark";
import { MailboxBadge, softSpring, spring } from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { tk, translate, type Locale } from "@/lib/i18n";
import type { AgentPermission, MailboxIconName } from "@/lib/types";
import { cn, initials } from "@/lib/utils";

/* ---------------------------------- Frame ---------------------------------- */

// Rendered on the server too, so text goes through translate() with the page's locale (never t()).

/** A translated text with React nodes in some of its placeholders: `rich("Hi {name}", { name: <b>…</b> })`. */
function rich(text: string, nodes: Record<string, ReactNode>) {
  return text.split(/\{(\w+)\}/g).map((part, i) => (i % 2 ? <Fragment key={i}>{nodes[part] ?? `{${part}}`}</Fragment> : part));
}

const cardClass = cn(
  "relative w-full max-w-[440px] rounded-[30px] px-5 pt-7 pb-5 sm:px-8 sm:pt-9 sm:pb-7",
  "bg-white/62 shadow-[inset_0_0_0_0.5px_var(--glass-border),inset_0_1px_0_rgb(255_255_255/0.7),var(--shadow-float)] backdrop-blur-2xl backdrop-saturate-[1.8]",
  "dark:bg-[rgb(26_30_38/0.66)] dark:shadow-[inset_0_0_0_0.5px_var(--glass-border),inset_0_1px_0_rgb(255_255_255/0.06),var(--shadow-float)]",
);

export function ConsentShell({ children }: { children: ReactNode }) {
  return (
    <main className="canvas relative isolate flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 pt-[max(env(safe-area-inset-top),32px)] pb-[max(var(--safe-bottom),28px)]">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute top-[12%] left-[calc(50%-320px)] size-[440px] rounded-full bg-[oklch(0.8_0.11_var(--accent-h)/0.45)] blur-[80px] dark:bg-[oklch(0.42_0.1_var(--accent-h)/0.4)]" />
        <div className="absolute top-[48%] left-[calc(50%+10px)] size-[380px] rounded-full bg-[oklch(0.84_0.09_300/0.4)] blur-[90px] dark:bg-[oklch(0.36_0.09_300/0.35)]" />
      </div>
      {children}
    </main>
  );
}

export function ConsentSkeleton() {
  return (
    <div className={cardClass} aria-busy aria-label="Loading">
      <div className="flex animate-pulse flex-col items-center">
        <div className="flex items-center gap-4">
          <div className="size-[52px] rounded-[16px] bg-selected" />
          <div className="h-px w-8 bg-line" />
          <div className="size-[52px] rounded-[16px] bg-selected" />
        </div>
        <div className="mt-6 h-6 w-64 rounded-lg bg-selected" />
        <div className="mt-3 h-4 w-40 rounded-lg bg-hover" />
        <div className="mt-8 h-[196px] w-full rounded-2xl bg-hover" />
        <div className="mt-6 h-12 w-full rounded-2xl bg-hover" />
      </div>
    </div>
  );
}

export function ConsentError({ locale, message, back }: { locale: Locale; message: string; back?: string }) {
  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={softSpring} className={cn(cardClass, "text-center")}>
      <div className="mx-auto mb-5 flex size-[52px] items-center justify-center rounded-[16px] bg-danger/10 text-danger">
        <CircleAlert size={24} />
      </div>
      <h1 className="text-[21px] leading-tight font-semibold tracking-[-0.02em]">{translate(locale, "Couldn't connect")}</h1>
      <p className="mx-auto mt-2 max-w-[320px] text-[14px] leading-relaxed text-balance text-ink-3">{message}</p>
      {back && (
        <a
          href={back}
          className="mt-7 flex h-12 w-full items-center justify-center rounded-2xl bg-solid/90 text-[15px] font-medium text-ink shadow-[inset_0_0_0_1px_var(--line),0_1px_2px_rgb(16_24_40/0.05)] transition-colors hover:bg-solid dark:bg-white/[0.06] dark:hover:bg-white/[0.1]"
        >
          {translate(locale, "Back to the app")}
        </a>
      )}
    </motion.section>
  );
}

/* ---------------------------------- Card ---------------------------------- */

const LEVELS: { id: AgentPermission; icon: LucideIcon; label: string; hint: string }[] = [
  { id: "read", icon: Eye, label: tk("Read only"), hint: tk("Search and read your mail.") },
  { id: "draft", icon: FilePen, label: tk("Organize & draft"), hint: tk("Also archive, delete, pin, snooze, add notes and write drafts. Can't send.") },
  { id: "full", icon: Send, label: tk("Full access"), hint: tk("Everything, including sending email as you and unsubscribing.") },
];

export interface ConsentMailbox {
  id: string;
  name: string;
  email: string;
  hue: number;
  icon: MailboxIconName;
  enabled: boolean;
}

/** What sharing the calendar lets the agent do at each access level (src/server/mcp/calendar-tools.ts). */
const CALENDAR_HINT: Record<AgentPermission, string> = {
  read: tk("See your events."),
  draft: tk("See, add, change and delete your events. Can't invite guests."),
  full: tk("See, add, change and delete your events, and invite guests by email."),
};

/** What sharing the tasks lets the agent do at each access level (src/server/mcp/task-tools.ts). */
const TASKS_HINT: Record<AgentPermission, string> = {
  read: tk("See your tasks and lists."),
  draft: tk("See, add, change, tick off and delete your tasks."),
  full: tk("See, add, change, tick off and delete your tasks."),
};

const subscribeNever = () => () => {};
/** Clickjacking guard: never let the Allow button work inside someone else's frame. */
const readFramed = () => window.top !== window.self;

type Status = { kind: "idle" } | { kind: "busy"; decision: "allow" | "deny" } | { kind: "done" } | { kind: "error"; message: string };

export function ConsentCard({
  locale,
  app,
  logo,
  userEmail,
  returnTo,
  defaultPermission,
  reconnecting,
  otherAgents,
  mailboxes: initialMailboxes,
  calendar: initialCalendar,
  tasks: initialTasks,
  hidden,
  verified,
}: {
  locale: Locale;
  app: string;
  logo: string | null;
  /** The app is who it says (a known app returning to its own site, this computer or its own app). */
  verified: boolean;
  userEmail: string;
  returnTo: string;
  defaultPermission: AgentPermission;
  reconnecting: boolean;
  otherAgents: number;
  mailboxes: ConsentMailbox[];
  /** Whether the calendar starts shared; null when the user has no calendar, and then it isn't asked about. */
  calendar: boolean | null;
  /** Whether the tasks start shared. */
  tasks: boolean;
  hidden: Record<string, string>;
}) {
  const reduce = useReducedMotion();
  const framed = useSyncExternalStore(subscribeNever, readFramed, () => false);
  const [permission, setPermission] = useState<AgentPermission>(defaultPermission);
  const [understood, setUnderstood] = useState(false);
  const [mailboxes, setMailboxes] = useState(initialMailboxes);
  const [calendar, setCalendar] = useState(!!initialCalendar);
  const [tasks, setTasks] = useState(initialTasks);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const selected = mailboxes.filter((m) => m.enabled).length;
  const needsConfirm = permission === "full" && !understood;
  const needsMailbox = mailboxes.length > 0 && selected === 0;
  const busy = status.kind === "busy" || status.kind === "done";

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy || framed) return;
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const decision = submitter?.value === "allow" ? "allow" : "deny";
    if (decision === "allow" && (needsConfirm || needsMailbox)) return;
    // Read the form before the busy state disables its fields (disabled inputs aren't submitted).
    const body = new FormData(e.currentTarget, submitter);
    setStatus({ kind: "busy", decision });
    try {
      const res = await fetch("/api/oauth/authorize", {
        method: "POST",
        body,
        headers: { accept: "application/json" },
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => ({}))) as { redirect?: string; error?: string };
      if (!res.ok || !data.redirect) throw new Error(data.error ?? translate(locale, "Something went wrong. Try again."));
      if (decision === "deny") return window.location.assign(data.redirect);
      setStatus({ kind: "done" });
      setTimeout(() => window.location.assign(data.redirect!), reduce ? 150 : 700);
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof TypeError ? translate(locale, "You seem to be offline. Try again.") : (err as Error).message });
    }
  };

  return (
    <motion.section
      aria-labelledby="consent-title"
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={softSpring}
      className={cardClass}
    >
      {/* Who is connecting to what */}
      <div className="flex flex-col items-center text-center">
        <div className="mb-6 flex items-center gap-3" aria-hidden>
          <ClientLogo src={logo} name={app} />
          <motion.span
            initial={reduce ? false : { opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ ...spring, delay: 0.15 }}
            className="flex items-center gap-1 text-ink-3"
          >
            <span className="h-px w-3 bg-current opacity-40" />
            <span className="flex size-6 items-center justify-center rounded-full bg-hover">
              {status.kind === "done" ? <Check size={13} className="text-success" strokeWidth={2.6} /> : <Link2 size={13} />}
            </span>
            <span className="h-px w-3 bg-current opacity-40" />
          </motion.span>
          <span className="flex size-[52px] items-center justify-center rounded-[16px] bg-gradient-to-b from-white to-[#eef2f7] shadow-[0_0_0_0.5px_rgb(20_30_50/0.08),0_1px_2px_rgb(16_24_40/0.06),0_10px_24px_-10px_rgb(16_24_40/0.25),inset_0_1px_0_white] dark:from-[#2a2f3a] dark:to-[#1d2129] dark:shadow-[0_0_0_0.5px_rgb(255_255_255/0.1),0_10px_24px_-10px_rgb(0_0_0/0.7),inset_0_1px_0_rgb(255_255_255/0.08)]">
            <BrandMark size={30} />
          </span>
        </div>
        <h1 id="consent-title" className="text-[21px] leading-tight font-semibold tracking-[-0.022em] text-balance text-ink">
          {initialCalendar !== null ? translate(locale, "{app} wants to access your mail, calendar and tasks", { app }) : translate(locale, "{app} wants to access your mail and tasks", { app })}
        </h1>
        <p className="mt-1.5 text-[13.5px] text-ink-3">
          {reconnecting ? `${translate(locale, "Reconnecting")} · ` : ""}
          {rich(translate(locale, "Signed in as {email}"), { email: <span className="whitespace-nowrap text-ink-2">{userEmail}</span> })}
        </p>
        {!verified && (
          <div className="mt-4 flex gap-2.5 rounded-2xl bg-warning/12 px-3.5 py-3 text-left text-[13px] leading-snug text-ink">
            <ShieldAlert size={16} className="mt-px shrink-0 text-[oklch(0.62_0.15_60)] dark:text-warning" aria-hidden />
            <p>
              <span className="font-medium">{translate(locale, "Kolbaba can't confirm who made this app.")}</span>{" "}
              {rich(translate(locale, "Allowing sends you to {address}. Only continue if you set this up yourself and trust that address."), {
                address: <span className="font-medium">{returnTo}</span>,
              })}
            </p>
          </div>
        )}
      </div>

      <form onSubmit={submit} action="/api/oauth/authorize" method="post" className="mt-7">
        {Object.entries(hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <input type="hidden" name="mailboxes_shown" value="1" />
        {mailboxes.filter((m) => m.enabled).map((m) => (
          <input key={m.id} type="hidden" name="mailbox" value={m.id} />
        ))}
        {initialCalendar !== null && <input type="hidden" name="calendar_shown" value="1" />}
        {initialCalendar !== null && calendar && <input type="hidden" name="calendar" value="1" />}
        <input type="hidden" name="tasks_shown" value="1" />
        {tasks && <input type="hidden" name="tasks" value="1" />}

        {/* Access level */}
        <fieldset disabled={busy}>
          <legend className="mb-2 px-1 text-[12px] font-medium text-ink-3">{translate(locale, "What {app} can do", { app })}</legend>
          <div role="radiogroup" className="flex flex-col gap-1.5">
            {LEVELS.map((level) => (
              <LevelOption key={level.id} locale={locale} level={level} checked={permission === level.id} onSelect={() => setPermission(level.id)} />
            ))}
          </div>
        </fieldset>

        <AnimatePresence initial={false}>
          {permission === "full" && (
            <Collapse key="risk">
              <div className="pt-2.5">
                <div className="rounded-2xl bg-warning/12 px-3.5 py-3 text-[13px] leading-snug text-ink">
                  <div className="flex gap-2.5">
                    <ShieldAlert size={16} className="mt-px shrink-0 text-[oklch(0.62_0.15_60)] dark:text-warning" aria-hidden />
                    <p>
                      <span className="font-medium">{translate(locale, "Emails can talk to agents too.")}</span>{" "}
                      <span className="text-ink-2">
                        {translate(
                          locale,
                          "A message in your inbox can hide instructions meant to trick an AI. With Full access, {app} could be misled into sending mail as you. Everything it does shows up in AI activity, where you can undo it.",
                          { app },
                        )}
                      </span>
                    </p>
                  </div>
                  <label className="mt-2.5 flex items-center gap-2.5 pl-[26px] text-[13px] font-medium select-none">
                    <input
                      type="checkbox"
                      name="understand"
                      value="1"
                      checked={understood}
                      onChange={(e) => setUnderstood(e.target.checked)}
                      disabled={busy}
                      className="size-4 shrink-0 accent-[var(--accent)]"
                    />
                    {translate(locale, "I understand the risk")}
                  </label>
                </div>
              </div>
            </Collapse>
          )}
        </AnimatePresence>

        {/* Mailboxes */}
        <div className="mt-6">
          <div className="mb-2 flex items-baseline justify-between px-1">
            <span className="text-[12px] font-medium text-ink-3">{translate(locale, "Mailboxes {app} can see", { app })}</span>
            {mailboxes.length > 1 && (
              <span className="text-[11.5px] text-ink-3 tabular-nums">
                {translate(locale, "{selected} of {total}", { selected, total: mailboxes.length })}
              </span>
            )}
          </div>
          {mailboxes.length === 0 ? (
            <div className="rounded-2xl bg-hover px-4 py-3.5 text-[13px] leading-snug text-ink-2">
              {translate(locale, "You haven't added a mailbox to {brand} yet. Once you do, you can share it with {app} here or in settings.", {
                brand: BRAND.name,
                app,
              })}
            </div>
          ) : (
            <ul className="overflow-hidden rounded-2xl bg-solid/80 shadow-[inset_0_0_0_1px_var(--line)] dark:bg-white/[0.04]">
              {mailboxes.map((m, i) => (
                <li key={m.id} className={cn(i > 0 && "border-t border-line")}>
                  <MailboxToggle
                    mailbox={m}
                    disabled={busy}
                    onToggle={() => setMailboxes((list) => list.map((x) => (x.id === m.id ? { ...x, enabled: !x.enabled } : x)))}
                  />
                </li>
              ))}
            </ul>
          )}
          {mailboxes.length > 0 && (
            <p className={cn("mt-2 px-1 text-[12px] leading-snug", needsMailbox ? "text-danger" : "text-ink-3")}>
              {needsMailbox
                ? translate(locale, "Pick at least one mailbox, or {app} won't see anything.", { app })
                : otherAgents > 0
                  ? translate(locale, "Only {app} gets these. Your other agents keep their own. You can change this later in Settings → Agents.", { app })
                  : translate(locale, "You can change this later in Settings → Agents.")}
            </p>
          )}
        </div>

        {/* Calendar and tasks: shared apart from the mailboxes */}
        <div className="mt-6">
          <div className="mb-2 px-1 text-[12px] font-medium text-ink-3">{initialCalendar !== null ? translate(locale, "Calendar and tasks") : translate(locale, "Tasks")}</div>
          <div className="divide-y divide-line overflow-hidden rounded-2xl bg-solid/80 shadow-[inset_0_0_0_1px_var(--line)] dark:bg-white/[0.04]">
            {initialCalendar !== null && (
              <ShareSwitch
                on={calendar}
                busy={busy}
                onToggle={() => setCalendar((on) => !on)}
                icon={<CalendarDays size={15} />}
                title={translate(locale, "Your calendar")}
                hint={translate(locale, CALENDAR_HINT[permission])}
              />
            )}
            <ShareSwitch
              on={tasks}
              busy={busy}
              onToggle={() => setTasks((on) => !on)}
              icon={<CircleCheckBig size={15} />}
              title={translate(locale, "Your tasks")}
              hint={translate(locale, TASKS_HINT[permission])}
            />
          </div>
        </div>

        <div role="status" aria-live="polite">
          <AnimatePresence initial={false}>
            {(status.kind === "error" || framed) && (
              <Collapse key="error">
                <div className="pt-4">
                  <div className="flex gap-2.5 rounded-xl bg-danger/10 px-3.5 py-3 text-[13px] leading-snug text-danger">
                    <CircleAlert size={16} className="mt-px shrink-0" aria-hidden />
                    {framed
                      ? translate(locale, "For your safety, open this page directly instead of inside another site.")
                      : status.kind === "error"
                        ? status.message
                        : null}
                  </div>
                </div>
              </Collapse>
            )}
          </AnimatePresence>
        </div>

        {/* Decision */}
        <div className="mt-6 flex gap-2.5">
          <motion.button
            type="submit"
            name="decision"
            value="deny"
            disabled={busy}
            whileTap={busy ? undefined : { scale: 0.975 }}
            transition={spring}
            className={cn(
              "flex h-12 flex-1 items-center justify-center rounded-2xl text-[15px] font-medium text-ink transition-[background-color,box-shadow,opacity] duration-200",
              "bg-solid/90 shadow-[inset_0_0_0_1px_var(--line),0_1px_2px_rgb(16_24_40/0.05)] hover:bg-solid dark:bg-white/[0.06] dark:hover:bg-white/[0.1]",
              busy && "opacity-60",
            )}
          >
            {status.kind === "busy" && status.decision === "deny" ? <LoaderCircle size={17} className="animate-spin text-ink-3" /> : translate(locale, "Cancel")}
          </motion.button>
          <motion.button
            type="submit"
            name="decision"
            value="allow"
            disabled={busy || framed || needsConfirm || needsMailbox}
            aria-busy={status.kind === "busy" && status.decision === "allow"}
            whileTap={busy ? undefined : { scale: 0.975 }}
            transition={spring}
            className={cn(
              "relative flex h-12 flex-[1.4] items-center justify-center overflow-hidden rounded-2xl text-[15px] font-medium text-on-accent",
              "shadow-[0_1px_2px_rgb(0_0_0/0.14),0_10px_24px_-10px_var(--accent),inset_0_1px_0_rgb(255_255_255/0.22)] transition-[background-color,box-shadow,opacity] duration-300",
              status.kind === "done" ? "bg-success" : "bg-accent hover:bg-accent-hover",
              !busy && (framed || needsConfirm || needsMailbox) && "opacity-45 shadow-none",
            )}
          >
            <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/14 to-transparent" />
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={status.kind === "done" ? "done" : status.kind === "busy" && status.decision === "allow" ? "busy" : "idle"}
                initial={{ opacity: 0, y: 8, filter: "blur(3px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -8, filter: "blur(3px)" }}
                transition={spring}
                className="relative flex items-center gap-2"
              >
                {status.kind === "done" ? (
                  <>
                    <Check size={18} strokeWidth={2.4} /> {translate(locale, "Connected")}
                  </>
                ) : status.kind === "busy" && status.decision === "allow" ? (
                  <LoaderCircle size={17} className="animate-spin" />
                ) : (
                  translate(locale, "Allow")
                )}
              </motion.span>
            </AnimatePresence>
          </motion.button>
        </div>

        <p className="mt-5 text-center text-[12px] leading-relaxed text-balance text-ink-3">
          {status.kind === "done"
            ? translate(locale, "Taking you back to {address}. If nothing happens, you can close this tab.", { address: returnTo })
            : rich(
                translate(locale, "You'll go back to {address}. Only continue if you started this from {app}. Change access or disconnect anytime in AI activity.", { app }),
                { address: <span className="text-ink-2">{returnTo}</span> },
              )}
        </p>
      </form>
    </motion.section>
  );
}

/* --------------------------------- Pieces --------------------------------- */

/** Registered logo, then the site's favicon, then initials — a broken image never shows. */
function ClientLogo({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState(!src);
  return (
    <span className="flex size-[52px] items-center justify-center overflow-hidden rounded-[16px] bg-white shadow-[0_0_0_0.5px_rgb(20_30_50/0.1),0_1px_2px_rgb(16_24_40/0.06),0_10px_24px_-10px_rgb(16_24_40/0.25)]">
      {failed ? (
        <span className="text-[17px] font-semibold text-neutral-700">{initials(name)}</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src!}
          alt=""
          width={32}
          height={32}
          className="size-8 object-contain"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          // The server-rendered <img> can fail before hydration attaches onError.
          ref={(el) => {
            if (el?.complete && el.naturalWidth === 0) setFailed(true);
          }}
        />
      )}
    </span>
  );
}

function LevelOption({ locale, level, checked, onSelect }: { locale: Locale; level: (typeof LEVELS)[number]; checked: boolean; onSelect: () => void }) {
  const Icon = level.icon;
  return (
    <label
      className={cn(
        "group relative flex cursor-pointer items-center gap-3 rounded-2xl px-3 py-2.5 transition-[background-color,box-shadow] duration-200 select-none",
        checked
          ? "bg-accent-soft shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--accent)_45%,transparent)]"
          : "bg-solid/60 shadow-[inset_0_0_0_1px_var(--line)] hover:bg-solid dark:bg-white/[0.03] dark:hover:bg-white/[0.06]",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--accent)]",
      )}
    >
      <input type="radio" name="permission" value={level.id} checked={checked} onChange={onSelect} className="sr-only" />
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-[10px] transition-colors",
          checked ? "bg-accent text-on-accent" : "bg-hover text-ink-2",
        )}
      >
        <Icon size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[14px] font-medium text-ink">
          {translate(locale, level.label)}
          {level.id === "draft" && (
            <span className="rounded-full bg-hover px-1.5 py-px text-[10.5px] font-medium text-ink-3">{translate(locale, "Recommended")}</span>
          )}
        </span>
        <span className="block text-[12.5px] leading-snug text-ink-3">{translate(locale, level.hint)}</span>
      </span>
      <span
        aria-hidden
        className={cn(
          "flex size-[18px] shrink-0 items-center justify-center rounded-full transition-colors",
          checked ? "bg-accent text-on-accent" : "shadow-[inset_0_0_0_1.5px_var(--line)]",
        )}
      >
        {checked && <Check size={11} strokeWidth={3} />}
      </span>
    </label>
  );
}

function MailboxToggle({ mailbox, disabled, onToggle }: { mailbox: ConsentMailbox; disabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={mailbox.enabled}
      disabled={disabled}
      onClick={onToggle}
      className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-hover disabled:cursor-default"
    >
      <MailboxBadge icon={mailbox.icon} hue={mailbox.hue} size={26} className={cn("transition-opacity", !mailbox.enabled && "opacity-45")} />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[13.5px] font-medium transition-colors", mailbox.enabled ? "text-ink" : "text-ink-3")}>{mailbox.name}</span>
        <span className="block truncate text-[12px] text-ink-3">{mailbox.email}</span>
      </span>
      <Switch on={mailbox.enabled} />
    </button>
  );
}

function Switch({ on }: { on: boolean }) {
  return (
    <span className={cn("relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors", on ? "bg-accent" : "bg-selected")}>
      <motion.span layout transition={spring} className={cn("absolute top-[2px] size-[18px] rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.2)]", on ? "right-[2px]" : "left-[2px]")} />
    </span>
  );
}

function Collapse({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={softSpring}
      className="-mx-1.5 overflow-hidden px-1.5"
    >
      {children}
    </motion.div>
  );
}

/** A part of the app shared with the agent or not (the calendar, the tasks). */
function ShareSwitch({ on, busy, onToggle, icon, title, hint }: { on: boolean; busy: boolean; onToggle: () => void; icon: ReactNode; title: string; hint: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={busy} onClick={onToggle} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-hover disabled:cursor-default">
      <span className={cn("flex size-[26px] shrink-0 items-center justify-center rounded-[8px] bg-accent-soft text-accent-text transition-opacity", !on && "opacity-45")}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-[13.5px] font-medium transition-colors", on ? "text-ink" : "text-ink-3")}>{title}</span>
        <span className="block text-[12px] leading-snug text-ink-3">{hint}</span>
      </span>
      <Switch on={on} />
    </button>
  );
}
