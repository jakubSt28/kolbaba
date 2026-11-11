"use client";

import { CalendarPlus, Check, ChevronLeft, ChevronRight, FileUp, KeyRound, Link2, LoaderCircle, X, type LucideIcon } from "lucide-react";
import { Dialog } from "radix-ui";
import { useRef, useState, type ReactNode } from "react";
import { calendarConnectUrl, useCalendar, type AddPage } from "@/lib/calendar/store";
import { t, tn } from "@/lib/i18n";
import { useMail } from "@/lib/store";
import { cn } from "@/lib/utils";
import { GoogleMark } from "../auth/google-mark";
import { FOLDER_HUES } from "../folders";
import { hueStyle, MailboxBadge } from "../ui";
import { useAddSuggestion } from "./calendar-sidebar";

/** A file bigger than this isn't a personal calendar; the server takes no more either. */
const MAX_FILE_BYTES = 3_000_000;

const dialogClass =
  "glass-strong fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-24px)] w-[min(460px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[22px] p-5 outline-none data-[state=open]:animate-[dialog-in_180ms_cubic-bezier(0.32,0.72,0,1)]";
const overlayClass = "fixed inset-0 z-50 bg-black/20 data-[state=open]:animate-[fade-in_140ms_ease-out] dark:bg-black/45";
const inputClass = "h-11 w-full rounded-[12px] bg-canvas px-3 text-[15px] outline-none shadow-[inset_0_0_0_1px_var(--line)] placeholder:text-ink-3 focus:shadow-[inset_0_0_0_1.5px_var(--accent)]";

/** "Add calendar": the mailboxes' own calendars first, then every other way in. Also where one of Kolbaba's calendars gets renamed. */
export function AddCalendarHost() {
  const page = useCalendar((s) => s.adding);
  const renaming = useCalendar((s) => s.renaming);
  const { setAdding, setRenaming } = useCalendar.getState();
  return (
    <>
      <Dialog.Root open={!!page} onOpenChange={(o) => !o && setAdding(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className={overlayClass} />
          <Dialog.Content aria-describedby={undefined} className={dialogClass}>
            {page === "menu" && <Menu />}
            {page === "caldav" && <CalDavForm />}
            {page === "feed" && <FeedForm />}
            {page === "import" && <ImportForm />}
            {page === "local" && <LocalForm />}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className={overlayClass} />
          <Dialog.Content aria-describedby={undefined} className={dialogClass}>
            {renaming && <LocalForm calendarId={renaming} />}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function Header({ title, back }: { title: string; back?: boolean }) {
  const setAdding = useCalendar((s) => s.setAdding);
  return (
    <div className="mb-4 flex items-center gap-1">
      {back && (
        <button type="button" onClick={() => setAdding("menu")} aria-label={t("Back")} className="-ml-2 flex size-8 items-center justify-center rounded-[9px] text-ink-2 transition-colors hover:bg-hover hover:text-ink">
          <ChevronLeft size={18} />
        </button>
      )}
      <Dialog.Title className="flex-1 text-[15.5px] font-semibold tracking-[-0.01em]">{title}</Dialog.Title>
      <Dialog.Close aria-label={t("Close")} className="-mr-2 flex size-8 items-center justify-center rounded-[9px] text-ink-3 transition-colors hover:bg-hover hover:text-ink">
        <X size={16} />
      </Dialog.Close>
    </div>
  );
}

function Buttons({ busy, label, onCancel }: { busy: boolean; label: string; onCancel?: () => void }) {
  const setAdding = useCalendar((s) => s.setAdding);
  return (
    <div className="mt-5 flex items-center justify-end gap-2">
      <button type="button" onClick={onCancel ?? (() => setAdding("menu"))} className="h-9 rounded-[11px] bg-hover px-3.5 text-[13px] font-medium text-ink-2 hover:bg-selected">
        {t("Cancel")}
      </button>
      <button type="submit" disabled={busy} className="press flex h-9 items-center gap-1.5 rounded-[11px] bg-accent px-4 text-[13px] font-medium text-on-accent hover:bg-accent-hover disabled:opacity-60">
        {busy && <LoaderCircle size={13} className="animate-spin" />}
        {label}
      </button>
    </div>
  );
}

/* ----------------------------------- Menu ---------------------------------- */

/** The calendars of mailboxes that are already here: one click each. Used by the window and by the first-run screen. */
export function MailboxCalendars({ className }: { className?: string }) {
  const suggestions = useCalendar((s) => s.suggestions);
  const accounts = useMail((s) => s.accounts);
  const { add, busy, error } = useAddSuggestion();
  const rows = suggestions.map((s) => ({ s, account: accounts.find((a) => a.id === s.accountId) })).filter((r) => r.account);
  if (!rows.length) return null;
  return (
    <ul className={cn("flex flex-col gap-1.5", className)}>
      {rows.map(({ s, account }) => (
        <li key={s.accountId} className="rounded-[14px] bg-solid px-3 py-2.5 shadow-[inset_0_0_0_0.5px_var(--line)]">
          <div className="flex items-center gap-3">
            <MailboxBadge icon={account!.icon} hue={account!.hue} image={account!.image} size={30} className="rounded-[9px]" />
            <div className="min-w-0 flex-1 text-left">
              <div className="truncate text-[13.5px] font-medium">{account!.name}</div>
              <div className="truncate text-[12px] text-ink-3">{account!.email}</div>
            </div>
            <button
              onClick={() => void add(s)}
              disabled={busy === s.accountId}
              className="press flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] bg-accent px-3 text-[13px] font-medium text-on-accent hover:bg-accent-hover disabled:opacity-60"
            >
              {busy === s.accountId && <LoaderCircle size={13} className="animate-spin" />}
              {t("Add calendar")}
            </button>
          </div>
          {error?.accountId === s.accountId && <p className="mt-2 text-left text-[12.5px] leading-snug text-danger">{error.message}</p>}
          {s.how !== "caldav" && (
            <p className="mt-1.5 text-left text-[12px] leading-snug text-ink-3">{s.how === "google" ? t("Google will ask you to allow Kolbaba to see and edit your calendar.") : t("Microsoft will ask you to allow Kolbaba to see and edit your calendar.")}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

function Option({ icon: Icon, mark, title, detail, onClick, href }: { icon?: LucideIcon; mark?: ReactNode; title: string; detail: string; onClick?: () => void; href?: string }) {
  const body = (
    <>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-hover text-ink-2">{mark ?? (Icon && <Icon size={16} />)}</span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[13.5px] font-medium">{title}</span>
        <span className="block truncate text-[12px] text-ink-3">{detail}</span>
      </span>
      <ChevronRight size={15} className="shrink-0 text-ink-3" />
    </>
  );
  const className = "flex w-full items-center gap-3 rounded-[12px] px-2 py-2 transition-colors hover:bg-hover";
  return href ? (
    <a href={href} className={className}>
      {body}
    </a>
  ) : (
    <button onClick={onClick} className={className}>
      {body}
    </button>
  );
}

function MicrosoftMark() {
  return (
    <span aria-hidden className="grid size-[14px] grid-cols-2 gap-[1.5px]">
      <span className="bg-[#f25022]" />
      <span className="bg-[#7fba00]" />
      <span className="bg-[#00a4ef]" />
      <span className="bg-[#ffb900]" />
    </span>
  );
}

/** The other ways in, as a list. `go` opens a page of the window. */
export function OtherWays({ go }: { go: (page: AddPage) => void }) {
  const can = useCalendar((s) => s.can);
  return (
    <div className="flex flex-col">
      {can.google && <Option mark={<GoogleMark size={15} />} title={t("Google Calendar")} detail={t("Sign in with a Google account")} href={calendarConnectUrl("google")} />}
      {can.microsoft && <Option mark={<MicrosoftMark />} title={t("Outlook or Microsoft 365")} detail={t("Sign in with a Microsoft account")} href={calendarConnectUrl("microsoft")} />}
      <Option icon={KeyRound} title={t("Seznam, iCloud or another account")} detail={t("An address and a password (CalDAV)")} onClick={() => go("caldav")} />
      <Option icon={Link2} title={t("Follow a calendar by link")} detail={t("Holidays, a timetable, a shared calendar (.ics)")} onClick={() => go("feed")} />
      <Option icon={FileUp} title={t("Import a file")} detail={t("Events from an .ics file")} onClick={() => go("import")} />
      <Option icon={CalendarPlus} title={t("New calendar in Kolbaba")} detail={t("Kept here, not at another provider")} onClick={() => go("local")} />
    </div>
  );
}

function Menu() {
  const setAdding = useCalendar((s) => s.setAdding);
  const some = useCalendar((s) => s.suggestions.length > 0);
  return (
    <>
      <Header title={t("Add calendar")} />
      {some && (
        <>
          <div className="mb-2 text-[12px] font-medium text-ink-3">{t("Calendars of your mailboxes")}</div>
          <MailboxCalendars className="mb-4" />
          <div className="mb-1 text-[12px] font-medium text-ink-3">{t("Other calendars")}</div>
        </>
      )}
      <div className="-mx-2">
        <OtherWays go={setAdding} />
      </div>
    </>
  );
}

/* ---------------------------------- CalDAV --------------------------------- */

function CalDavForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [url, setUrl] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!email.trim() || !password) return setError(t("Fill in the address and the password."));
    setBusy(true);
    setError(null);
    const message = await useCalendar.getState().connectCalDav({ email: email.trim(), password, url: url.trim() || undefined });
    setBusy(false);
    if (message) {
      setError(message);
      // Nothing found from the address alone: the server's own address is the next thing to try.
      setAdvanced(true);
    } else useCalendar.getState().setAdding(null);
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Header title={t("Calendar account")} back />
      <p className="mb-3 text-[13px] leading-relaxed text-ink-2">{t("Works with Seznam, iCloud, Fastmail and any other calendar that speaks CalDAV. With two-step sign-in, use an app password.")}</p>
      <div className="flex flex-col gap-2">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="username" autoCapitalize="none" placeholder={t("Email address")} aria-label={t("Email address")} className={inputClass} />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder={t("Password")} aria-label={t("Password")} className={inputClass} />
        {advanced ? (
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} autoCapitalize="none" placeholder={t("Server address (https://…)")} aria-label={t("Server address")} className={inputClass} />
        ) : (
          <button type="button" onClick={() => setAdvanced(true)} className="self-start text-[12.5px] font-medium text-accent-text hover:underline">
            {t("Enter the server address yourself")}
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-[12.5px] leading-snug text-danger">{error}</p>}
      <Buttons busy={busy} label={t("Connect")} />
    </form>
  );
}

/* ----------------------------------- Feed ---------------------------------- */

function FeedForm() {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!url.trim()) return setError(t("Paste the calendar's link."));
    setBusy(true);
    setError(null);
    const message = await useCalendar.getState().addFeed(url.trim(), name.trim());
    setBusy(false);
    if (message) setError(message);
    else useCalendar.getState().setAdding(null);
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Header title={t("Follow a calendar by link")} back />
      <p className="mb-3 text-[13px] leading-relaxed text-ink-2">{t("Kolbaba reads the calendar from its link and keeps it up to date. You can look at it here; changes are made where it comes from.")}</p>
      <div className="flex flex-col gap-2">
        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus autoCapitalize="none" placeholder="https://… .ics" aria-label={t("Calendar link")} className={inputClass} />
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t("Name (optional)")} aria-label={t("Name")} className={inputClass} />
      </div>
      {error && <p className="mt-2 text-[12.5px] leading-snug text-danger">{error}</p>}
      <Buttons busy={busy} label={t("Follow")} />
    </form>
  );
}

/* ---------------------------------- Import --------------------------------- */

function ImportForm() {
  const own = useCalendar((s) => s.calendars.filter((c) => s.sources.find((x) => x.id === c.sourceId)?.kind === "local"));
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  // "" = a new calendar named after the file.
  const [target, setTarget] = useState("");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const take = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    if (f.size > MAX_FILE_BYTES) return setError(t("This file is too big (3 MB at most)."));
    const text = await f.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) return setError(t("This file isn't a calendar (.ics)."));
    setFile({ name: f.name.replace(/\.(ics|ical|ifb|icalendar)$/i, ""), text });
  };
  const submit = async () => {
    if (!file) return input.current?.click();
    setBusy(true);
    const message = await useCalendar.getState().importFile({ text: file.text, ...(target ? { calendarId: target } : { name: file.name }) });
    setBusy(false);
    if (message) setError(message);
    else useCalendar.getState().setAdding(null);
  };
  const count = file ? (file.text.match(/BEGIN:VEVENT/gi) ?? []).length : 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Header title={t("Import a file")} back />
      <input ref={input} type="file" accept=".ics,.ical,text/calendar" hidden onChange={(e) => void take(e.target.files?.[0])} />
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void take(e.dataTransfer.files[0]);
        }}
        className={cn(
          "flex w-full flex-col items-center gap-1.5 rounded-[16px] border border-dashed px-4 py-7 text-center transition-colors",
          over ? "border-accent bg-accent-soft" : "border-ink-3/40 hover:bg-hover",
        )}
      >
        <FileUp size={22} className={file ? "text-accent-text" : "text-ink-3"} />
        {file ? (
          <>
            <span className="max-w-full truncate text-[14px] font-medium">{file.name}.ics</span>
            <span className="text-[12.5px] text-ink-3">{tn(count, "{n} event", "{n} events")}</span>
          </>
        ) : (
          <>
            <span className="text-[14px] font-medium">{t("Choose an .ics file")}</span>
            <span className="text-[12.5px] text-ink-3">{t("or drop it here")}</span>
          </>
        )}
      </button>
      {file && own.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-[12px] font-medium text-ink-3">{t("Import into")}</div>
          <div className="flex flex-col gap-1">
            {[{ id: "", name: t("A new calendar “{name}”", { name: file.name }), hue: null as number | null }, ...own].map((c) => (
              <button key={c.id} type="button" onClick={() => setTarget(c.id)} aria-pressed={target === c.id} className={cn("flex h-9 items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[13.5px] transition-colors", target === c.id ? "bg-selected" : "hover:bg-hover")}>
                {c.hue === null ? <CalendarPlus size={14} className="shrink-0 text-ink-3" /> : <span className="cal-dot size-2.5 shrink-0 rounded-[3px]" style={hueStyle(c.hue)} />}
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                {target === c.id && <Check size={14} className="shrink-0 text-accent-text" />}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-[12.5px] leading-snug text-danger">{error}</p>}
      <Buttons busy={busy} label={file ? t("Import") : t("Choose a file")} />
    </form>
  );
}

/* ------------------------------ Kolbaba's own ------------------------------ */

/** A new calendar kept in Kolbaba, or (with `calendarId`) the name of one that's there. */
function LocalForm({ calendarId }: { calendarId?: string }) {
  const calendars = useCalendar((s) => s.calendars);
  const existing = calendars.find((c) => c.id === calendarId);
  const [name, setName] = useState(existing?.name ?? "");
  const [hue, setHue] = useState(existing?.hue ?? FOLDER_HUES.find((h) => !calendars.some((c) => Math.abs(c.hue - h) < 12)) ?? FOLDER_HUES[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => (calendarId ? useCalendar.getState().setRenaming(null) : useCalendar.getState().setAdding(null));
  const submit = async () => {
    const clean = name.trim();
    if (!clean) return setError(t("Give the calendar a name"));
    if (existing) {
      useCalendar.getState().updateCalendar(existing.id, { name: clean, hue });
      return close();
    }
    setBusy(true);
    const made = await useCalendar.getState().createLocal(clean, hue);
    setBusy(false);
    if (made) close();
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Header title={existing ? t("Rename calendar") : t("New calendar in Kolbaba")} back={!calendarId} />
      <div className="flex items-center gap-3 rounded-[12px] bg-canvas px-3 shadow-[inset_0_0_0_1px_var(--line)] focus-within:shadow-[inset_0_0_0_1.5px_var(--accent)]">
        <span className="cal-dot size-3 shrink-0 rounded-[4px]" style={hueStyle(hue)} />
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          autoFocus
          maxLength={80}
          placeholder={t("Calendar name")}
          aria-label={t("Calendar name")}
          className="h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-3"
        />
      </div>
      {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
      <div className="mt-4 text-[12px] font-medium text-ink-3">{t("Colour")}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {FOLDER_HUES.map((h) => (
          <button key={h} type="button" onClick={() => setHue(h)} aria-label={t("Colour {n}", { n: FOLDER_HUES.indexOf(h) + 1 })} aria-pressed={hue === h} className="flex size-8 items-center justify-center rounded-full">
            <span className={cn("hue-dot flex size-6 items-center justify-center rounded-full text-white", hue === h && "ring-2 ring-ink/60 ring-offset-2 ring-offset-[var(--solid)]")} style={hueStyle(h)}>
              {hue === h && <Check size={13} strokeWidth={3} />}
            </span>
          </button>
        ))}
      </div>
      <Buttons busy={busy} label={existing ? t("Save") : t("Create")} onCancel={calendarId ? close : undefined} />
    </form>
  );
}
