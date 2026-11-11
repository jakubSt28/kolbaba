"use client";

import { AlignLeft, CalendarDays, Clock, LoaderCircle, MapPin, Repeat, Trash2, Users, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { addDays, atTime, dayKey, minutesOf, parseDay, startOfDay } from "@/lib/calendar/dates";
import { presetOf, REPEAT_LABELS, REPEAT_PRESETS, ruleFor, type RepeatPreset } from "@/lib/calendar/recurrence";
import { useCalendar } from "@/lib/calendar/store";
import type { Calendar, CalendarSource, EventInput } from "@/lib/calendar/types";
import { t } from "@/lib/i18n";
import { LIVE } from "@/lib/live";
import { useMail } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Toggle } from "../settings";
import { hueStyle } from "../ui";
import { askDelete, askScope } from "./event-details";
import { Picker, ReminderPicker } from "./picker";

const pad = (n: number) => String(n).padStart(2, "0");
const timeValue = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/** The window for a new event or a change to one: a dialog on a computer, a sheet on a phone. */
export function EventEditorHost({ mobile }: { mobile: boolean }) {
  const editor = useCalendar((s) => s.editor);
  const close = useCalendar((s) => s.closeEditor);
  return (
    <Dialog.Root open={!!editor} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/20 data-[state=open]:animate-[fade-in_140ms_ease-out] dark:bg-black/45" />
        <Dialog.Content
          aria-describedby={undefined}
          // The title is where typing starts; on a phone the keyboard waits until a field is tapped.
          onOpenAutoFocus={(e) => mobile && e.preventDefault()}
          className={cn(
            "z-50 flex flex-col outline-none",
            mobile
              ? "sheet fixed inset-x-0 top-[max(12px,env(safe-area-inset-top))] bottom-0 rounded-t-[22px] data-[state=open]:animate-[tab-in_200ms_ease-out]"
              : "glass-strong fixed top-1/2 left-1/2 max-h-[min(720px,calc(100dvh-32px))] w-[min(500px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 rounded-[22px] data-[state=open]:animate-[dialog-in_180ms_cubic-bezier(0.32,0.72,0,1)]",
          )}
        >
          {editor && <EditorForm key={editor.eventId ?? `new:${editor.draft.start}`} eventId={editor.eventId} initial={editor.draft} mobile={mobile} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function EditorForm({ eventId, initial, mobile }: { eventId?: string; initial: EventInput; mobile: boolean }) {
  const calendars = useCalendar((s) => s.calendars);
  const sources = useCalendar((s) => s.sources);
  const original = useCalendar((s) => (eventId ? s.events.find((e) => e.id === eventId) : undefined));
  const mailboxes = useMail((s) => s.accounts.length);
  const { closeEditor, saveEvent, setEventReminder } = useCalendar.getState();
  const [draft, setDraft] = useState(initial);
  const [guest, setGuest] = useState("");
  const [busy, setBusy] = useState(false);
  // The event's own reminder time; left alone (the usual one) until another is picked.
  const [reminder, setReminder] = useState<number | null | undefined>(original?.reminder);
  const set = (patch: Partial<EventInput>) => setDraft((d) => ({ ...d, ...patch }));

  const start = draft.allDay ? parseDay(draft.start) : new Date(draft.start);
  // All-day events end "the day after the last": the form shows the last day.
  const end = draft.allDay ? addDays(parseDay(draft.end), -1) : new Date(draft.end);
  const calendar = calendars.find((c) => c.id === draft.calendarId);
  const source = sources.find((s) => s.id === calendar?.sourceId);
  // Google and Microsoft email guests themselves; for the rest Kolbaba does, from one of the mailboxes.
  const canInvite = !source || source.kind === "google" || source.kind === "microsoft" || !LIVE || mailboxes > 0;
  const preset = presetOf(draft.recurrence);

  const setTimes = (nextStart: Date, nextEnd: Date) => {
    if (draft.allDay) return set({ start: dayKey(nextStart), end: dayKey(addDays(nextEnd < nextStart ? nextStart : nextEnd, 1)) });
    set({ start: nextStart.toISOString(), end: (nextEnd < nextStart ? new Date(nextStart.getTime() + 3600_000) : nextEnd).toISOString() });
  };
  /** Moving the start keeps the length. */
  const moveStart = (next: Date) => setTimes(next, new Date(next.getTime() + (end.getTime() - start.getTime())));
  const repeatOn = (next: Date) => (preset !== "none" && preset !== "custom" ? { recurrence: ruleFor(preset, next) } : {});

  const toggleAllDay = (allDay: boolean) => {
    if (allDay) return set({ allDay, start: dayKey(start), end: dayKey(addDays(startOfDay(end), 1)) });
    const from = atTime(start, 9 * 60);
    set({ allDay, start: from.toISOString(), end: new Date(from.getTime() + 3600_000).toISOString() });
  };

  const addGuests = (raw: string) => {
    const found = raw
      .split(/[\s,;]+/)
      .map((x) => x.trim().toLowerCase())
      .filter((x) => EMAIL.test(x));
    if (!found.length) return false;
    setDraft((d) => ({ ...d, attendees: [...d.attendees, ...found.filter((email) => !d.attendees.some((a) => a.email === email)).map((email) => ({ name: "", email }))] }));
    setGuest("");
    return true;
  };

  const submit = () => {
    if (busy) return;
    const pending = guest.trim().toLowerCase();
    const invited = EMAIL.test(pending) && !draft.attendees.some((a) => a.email === pending) ? { ...draft, attendees: [...draft.attendees, { name: "", email: pending }] } : draft;
    // Sent only when it was changed here.
    const final: EventInput = reminder !== original?.reminder && !draft.allDay ? { ...invited, reminder } : invited;
    const save = async (scope: "this" | "all") => {
      setBusy(true);
      const ok = await saveEvent(final, { eventId, scope });
      // Still here: it failed and the toast says why.
      if (!ok) setBusy(false);
    };
    if (!eventId || !original) return void save("this");
    // Nothing but the reminder changed: the event itself isn't saved again (its guests would get an email about nothing).
    if (JSON.stringify(invited) === JSON.stringify(initial)) {
      if (final.reminder !== undefined) setEventReminder(eventId, final.reminder);
      return closeEditor();
    }
    // A new rule is a change to the whole series; anything else asks which events it's for.
    if (original.recurring && final.recurrence !== original.recurrence) return void save("all");
    askScope(original, t("Change which events?"), (scope) => void save(scope));
  };

  const field = cn("h-9 rounded-[10px] bg-hover px-2.5 outline-none transition-shadow focus:shadow-[inset_0_0_0_1.5px_var(--accent)]", mobile ? "text-[16px]" : "text-[13.5px]");
  const text = cn("min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-3", mobile ? "text-[16px]" : "text-[13.5px]");

  return (
    <form
      className={cn("flex min-h-0 flex-1 flex-col", mobile ? "text-[16px]" : "text-[13.5px]")}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          submit();
        }
      }}
    >
      <div className="flex shrink-0 items-center gap-2 px-5 pt-4 pb-1">
        <Dialog.Title className="flex-1 text-[13px] font-medium text-ink-3">{eventId ? t("Edit event") : t("New event")}</Dialog.Title>
        <Dialog.Close aria-label={t("Close")} className="-mr-2 flex size-8 items-center justify-center rounded-[9px] text-ink-3 transition-colors hover:bg-hover hover:text-ink">
          <X size={16} />
        </Dialog.Close>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-2">
        <input
          value={draft.title}
          onChange={(e) => set({ title: e.target.value })}
          autoFocus={!mobile}
          maxLength={300}
          placeholder={t("Add a title")}
          aria-label={t("Title")}
          className="w-full bg-transparent pb-3 text-[21px] font-semibold tracking-[-0.015em] outline-none placeholder:font-medium placeholder:text-ink-3"
        />

        <Line icon={<Clock size={16} />}>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="date"
              value={dayKey(start)}
              aria-label={t("Starts on")}
              onChange={(e) => {
                if (!e.target.value) return;
                const next = atTime(parseDay(e.target.value), minutesOf(start));
                moveStart(next);
                set(repeatOn(next));
              }}
              className={field}
            />
            {!draft.allDay && (
              <>
                <input
                  type="time"
                  step={300}
                  value={timeValue(start)}
                  aria-label={t("Starts at")}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(":").map(Number);
                    if (Number.isFinite(h) && Number.isFinite(m)) moveStart(atTime(start, h * 60 + m));
                  }}
                  className={field}
                />
                <span className="text-ink-3">–</span>
                <input
                  type="time"
                  step={300}
                  value={timeValue(end)}
                  aria-label={t("Ends at")}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(":").map(Number);
                    if (!Number.isFinite(h) || !Number.isFinite(m)) return;
                    // An end before the start means it runs past midnight.
                    const same = atTime(start, h * 60 + m);
                    setTimes(start, same > start ? same : addDays(same, 1));
                  }}
                  className={field}
                />
              </>
            )}
            {(draft.allDay || dayKey(end) !== dayKey(start)) && (
              <>
                {draft.allDay && <span className="text-ink-3">–</span>}
                <input
                  type="date"
                  value={dayKey(end)}
                  min={dayKey(start)}
                  aria-label={t("Ends on")}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    const day = parseDay(e.target.value);
                    setTimes(start, draft.allDay ? day : atTime(day, minutesOf(end)));
                  }}
                  className={field}
                />
              </>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-2 text-ink-2">
              <Toggle on={draft.allDay} label={t("All day")} onChange={toggleAllDay} />
              {t("All day")}
            </label>
            <Picker
              icon={<Repeat size={13} />}
              label={t(REPEAT_LABELS[preset])}
              options={[...REPEAT_PRESETS, ...(preset === "custom" ? (["custom"] as const) : [])]
                // Google and Microsoft can't turn a series back into one event: there the series is deleted instead.
                .filter((p) => p !== "none" || !original?.recurring || !(source?.kind === "google" || source?.kind === "microsoft"))
                .map((p) => ({ id: p, label: t(REPEAT_LABELS[p]), selected: p === preset }))}
              onPick={(p) => p !== "custom" && set({ recurrence: ruleFor(p as RepeatPreset, start) })}
            />
            {!draft.allDay && <ReminderPicker value={reminder} onChange={setReminder} />}
          </div>
        </Line>

        <Line icon={<MapPin size={16} />}>
          <input value={draft.location} onChange={(e) => set({ location: e.target.value })} maxLength={300} placeholder={t("Add a place")} aria-label={t("Place")} className={cn(text, "h-9 w-full")} />
        </Line>

        {canInvite && (
          <Line icon={<Users size={16} />}>
            <div className="flex min-h-9 flex-wrap items-center gap-1.5 py-1">
              {draft.attendees.map((a) => (
                <span key={a.email} className="flex h-7 max-w-full items-center gap-1 rounded-full bg-hover pr-1 pl-2.5 text-[12.5px] text-ink-2">
                  <span className="truncate">{a.name || a.email}</span>
                  <button
                    type="button"
                    onClick={() => set({ attendees: draft.attendees.filter((x) => x.email !== a.email) })}
                    aria-label={t("Remove {name}", { name: a.name || a.email })}
                    className="flex size-5 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-selected hover:text-ink"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
              <input
                value={guest}
                onChange={(e) => {
                  // A comma or a space ends an address; a pasted list goes in whole.
                  if (/[\s,;]/.test(e.target.value) && addGuests(e.target.value)) return;
                  setGuest(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && guest.trim() && !e.metaKey && !e.ctrlKey) {
                    e.preventDefault();
                    addGuests(guest);
                  }
                  if (e.key === "Backspace" && !guest && draft.attendees.length) set({ attendees: draft.attendees.slice(0, -1) });
                }}
                onBlur={() => guest && addGuests(guest)}
                type="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                placeholder={draft.attendees.length ? t("Add another guest") : t("Add guests by email")}
                aria-label={t("Guests")}
                className={cn(text, "h-7 min-w-[140px]")}
              />
            </div>
            {draft.attendees.length > 0 && <p className="pb-1 text-[12px] text-ink-3">{t("Guests get the invitation by email and can answer it from their own calendar.")}</p>}
          </Line>
        )}

        <Line icon={<AlignLeft size={16} />}>
          <Notes value={draft.description} onChange={(description) => set({ description })} className={text} />
        </Line>

        <Line icon={<CalendarDays size={16} />} last>
          {eventId ? (
            <CalendarLabel calendar={calendar} sources={sources} className="h-9" />
          ) : (
            <Picker
              label={<CalendarLabel calendar={calendar} sources={sources} />}
              options={calendars
                .filter((c) => !c.readOnly)
                .map((c) => ({ id: c.id, label: <CalendarLabel calendar={c} sources={sources} detail />, selected: c.id === draft.calendarId }))}
              onPick={(calendarId) => set({ calendarId })}
              plain
            />
          )}
        </Line>
      </div>

      <div className={cn("flex shrink-0 items-center gap-2 border-t border-line px-5 py-3", mobile && "pb-[max(12px,var(--safe-bottom))]")}>
        {eventId && original && (
          <button type="button" onClick={() => askDelete(original)} className="flex h-9 items-center gap-1.5 rounded-[11px] px-3 text-[13px] font-medium text-danger hover:bg-hover">
            <Trash2 size={14} /> {t("Delete")}
          </button>
        )}
        <span className="flex-1" />
        <button type="button" onClick={closeEditor} className="h-9 rounded-[11px] bg-hover px-3.5 text-[13px] font-medium text-ink-2 hover:bg-selected">
          {t("Cancel")}
        </button>
        <button type="submit" disabled={busy} className="press flex h-9 items-center gap-1.5 rounded-[11px] bg-accent px-4 text-[13px] font-medium text-on-accent hover:bg-accent-hover disabled:opacity-60">
          {busy && <LoaderCircle size={13} className="animate-spin" />}
          {eventId ? t("Save") : draft.attendees.length ? t("Save and invite") : t("Save")}
        </button>
      </div>
    </form>
  );
}

/** One line of the form: its icon on the left, a hairline under it. */
function Line({ icon, children, last }: { icon: ReactNode; children: ReactNode; last?: boolean }) {
  return (
    <div className={cn("flex gap-3 py-2", !last && "border-b border-line")}>
      <span className="flex h-9 w-4 shrink-0 items-center justify-center text-ink-3">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Notes grow with what's written, up to a point, then scroll. */
function Notes({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const rows = useMemo(() => Math.min(8, Math.max(1, value.split("\n").length)), [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      maxLength={8000}
      placeholder={t("Add notes")}
      aria-label={t("Notes")}
      className={cn(className, "block w-full resize-none py-2 leading-relaxed")}
    />
  );
}

function CalendarLabel({ calendar, sources, detail, className }: { calendar?: Calendar; sources: CalendarSource[]; detail?: boolean; className?: string }) {
  const source = sources.find((s) => s.id === calendar?.sourceId);
  const account = useMail((s) => s.accounts.find((a) => a.id === source?.accountId));
  if (!calendar) return <span className={cn("flex items-center text-ink-2", className)}>{t("My calendar")}</span>;
  const where = account?.name ?? source?.label;
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <span className="cal-dot size-2.5 shrink-0 rounded-[3px]" style={hueStyle(calendar.hue)} />
      <span className="truncate">{calendar.name}</span>
      {detail && where && <span className="truncate text-ink-3">{where}</span>}
    </span>
  );
}
