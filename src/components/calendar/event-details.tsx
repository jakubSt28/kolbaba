"use client";

import { AlignLeft, Check, CircleHelp, ExternalLink, MapPin, Pencil, Repeat, Trash2, Users, Video, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Popover } from "radix-ui";
import { useMemo, useState } from "react";
import { eventSpan, formatWhen } from "@/lib/calendar/dates";
import { describeRule } from "@/lib/calendar/recurrence";
import { useCalendar } from "@/lib/calendar/store";
import type { AttendeeStatus, CalEvent, EditScope } from "@/lib/calendar/types";
import { t, tk, tn } from "@/lib/i18n";
import { useMail } from "@/lib/store";
import { useNow } from "@/lib/use-now";
import { track } from "@/lib/usage";
import { cn } from "@/lib/utils";
import { confirmAction, confirmChoice } from "../confirm";
import { hueStyle, Tooltip } from "../ui";
import { ReminderPicker } from "./picker";

/** A change to a repeating event asks which events it's for; a single event just goes ahead. */
export function askScope(event: Pick<CalEvent, "recurring">, title: string, run: (scope: EditScope) => void) {
  if (!event.recurring) return run("this");
  confirmChoice({
    title,
    message: t("This event repeats."),
    choices: [
      { label: t("Only this event"), run: () => run("this") },
      { label: t("All events in the series"), run: () => run("all") },
    ],
    cancelLabel: t("Cancel"),
  });
}

export function askDelete(event: CalEvent) {
  const remove = (scope: EditScope) => void useCalendar.getState().deleteEvent(event.id, scope);
  if (event.recurring) return askScope(event, t("Delete which events?"), remove);
  const guests = event.attendees.length > 0;
  confirmAction({
    title: t("Delete this event?"),
    message: guests ? t("“{title}” goes from the calendar, and its guests are told it's cancelled.", { title: event.title || t("(No title)") }) : t("“{title}” goes from the calendar.", { title: event.title || t("(No title)") }),
    confirmLabel: t("Delete event"),
    onConfirm: () => remove("this"),
  });
}

const STATUS_LABEL: Record<AttendeeStatus, string> = { accepted: tk("Yes@@rsvp"), tentative: tk("Maybe@@rsvp"), declined: tk("No@@rsvp"), needsAction: tk("No answer yet") };

/** An event's details next to it (computer) or as a sheet from the bottom (phone). */
export function EventDetailsHost({ mobile }: { mobile: boolean }) {
  const open = useCalendar((s) => s.openEvent);
  const event = useCalendar((s) => (s.openEvent ? s.events.find((e) => e.id === s.openEvent!.id) : undefined));
  const close = useCalendar((s) => s.closeEvent);
  const anchor = useMemo(
    () => ({ current: { getBoundingClientRect: () => DOMRect.fromRect(open?.rect ?? { x: 0, y: 0, width: 0, height: 0 }) } }),
    // The same spot until another event is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open?.id, open?.rect.x, open?.rect.y],
  );

  if (mobile) {
    return (
      <AnimatePresence>
        {open && event && (
          <>
            <motion.div className="fixed inset-0 z-40 bg-black/25" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} />
            <motion.div
              className="glass-strong fixed inset-x-2 bottom-2 z-50 max-h-[80dvh] overflow-y-auto rounded-[26px] px-5 pt-3 pb-[max(18px,var(--safe-bottom))]"
              initial={{ y: "110%" }}
              animate={{ y: 0 }}
              exit={{ y: "110%" }}
              transition={{ type: "spring", stiffness: 380, damping: 38, mass: 0.9 }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.7 }}
              onDragEnd={(_, info) => {
                if (info.offset.y > 80 || info.velocity.y > 500) close();
              }}
            >
              <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-ink/15" />
              <EventDetails event={event} mobile />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    );
  }

  return (
    <Popover.Root open={!!open && !!event} onOpenChange={(o) => !o && close()}>
      <Popover.Anchor virtualRef={anchor} />
      <Popover.Portal>
        <Popover.Content
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="glass-strong z-40 w-[340px] origin-[var(--radix-popover-content-transform-origin)] rounded-[18px] p-4 outline-none data-[state=open]:animate-[menu-in_140ms_ease-out]"
        >
          {event && <EventDetails event={event} />}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function EventDetails({ event, mobile }: { event: CalEvent; mobile?: boolean }) {
  const calendar = useCalendar((s) => s.calendars.find((c) => c.id === event.calendarId));
  const source = useCalendar((s) => s.sources.find((x) => x.id === calendar?.sourceId));
  const account = useMail((s) => s.accounts.find((a) => a.id === source?.accountId));
  const { closeEvent, editEvent, respond, setEventReminder } = useCalendar.getState();
  const now = useNow();
  // Timed events that aren't over remind; this one can have its own time.
  const reminds = !event.allDay && eventSpan(event).end.getTime() > now;
  const [allGuests, setAllGuests] = useState(false);
  const repeats = describeRule(event.recurrence, event.recurring);
  const guests = allGuests ? event.attendees : event.attendees.slice(0, 5);
  const answer = (status: Exclude<AttendeeStatus, "needsAction">) => askScope(event, t("Answer for which events?"), (scope) => void respond(event.id, status, scope));
  const icon = "mt-[2px] shrink-0 text-ink-3";

  return (
    <div className={cn("flex flex-col gap-3", mobile ? "text-[15px]" : "text-[13.5px]")}>
      <div className="flex items-start gap-2.5">
        <span className="cal-dot mt-[7px] size-2.5 shrink-0 rounded-[3px]" style={hueStyle(calendar?.hue ?? 200)} />
        <div className="min-w-0 flex-1">
          <h2 className={cn("font-semibold tracking-[-0.01em] break-words", mobile ? "text-[19px]" : "text-[16px]", event.myStatus === "declined" && "line-through")}>{event.title || t("(No title)")}</h2>
          <div className="mt-0.5 text-ink-2">{formatWhen(event)}</div>
          {repeats && (
            <div className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-ink-3">
              <Repeat size={12} /> {t(repeats)}
            </div>
          )}
        </div>
        <div className="-mt-1 -mr-1.5 flex shrink-0 items-center">
          {event.canEdit && (
            <>
              <Tooltip label={t("Edit")} side="top">
                <button onClick={() => editEvent(event.id)} aria-label={t("Edit")} className="flex size-8 items-center justify-center rounded-[9px] text-ink-2 transition-colors hover:bg-hover hover:text-ink">
                  <Pencil size={15} />
                </button>
              </Tooltip>
              <Tooltip label={t("Delete")} side="top">
                <button onClick={() => askDelete(event)} aria-label={t("Delete")} className="flex size-8 items-center justify-center rounded-[9px] text-ink-2 transition-colors hover:bg-hover hover:text-danger">
                  <Trash2 size={15} />
                </button>
              </Tooltip>
            </>
          )}
          {!mobile && (
            <button onClick={closeEvent} aria-label={t("Close")} className="flex size-8 items-center justify-center rounded-[9px] text-ink-3 transition-colors hover:bg-hover hover:text-ink">
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {event.joinUrl && (
        <a
          href={event.joinUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => track("calJoin")}
          className={cn("press flex items-center justify-center gap-2 rounded-[11px] bg-accent font-medium text-on-accent hover:bg-accent-hover", mobile ? "h-11 text-[15px]" : "h-9 text-[13px]")}
        >
          <Video size={15} /> {t("Join the call")}
        </a>
      )}

      {event.location && (
        <div className="flex gap-2.5">
          <MapPin size={15} className={icon} />
          <span className="min-w-0 break-words text-ink-2">{event.location}</span>
        </div>
      )}

      {event.attendees.length > 0 && (
        <div className="flex gap-2.5">
          <Users size={15} className={icon} />
          <div className="min-w-0 flex-1">
            <div className="text-ink-2">
              {tn(event.attendees.length, "{n} guest", "{n} guests")}
              {event.organizer && <span className="text-ink-3"> · {t("invited by {name}", { name: event.organizer.name || event.organizer.email })}</span>}
            </div>
            <ul className="mt-1 flex flex-col gap-0.5">
              {guests.map((a) => (
                <li key={a.email} className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
                  <GuestMark status={a.status} />
                  <span className="truncate" title={a.email}>
                    {a.name || a.email}
                  </span>
                </li>
              ))}
            </ul>
            {event.attendees.length > 5 && !allGuests && (
              <button onClick={() => setAllGuests(true)} className="mt-0.5 text-[12.5px] font-medium text-accent-text hover:underline">
                {tn(event.attendees.length - 5, "and {n} more", "and {n} more")}
              </button>
            )}
          </div>
        </div>
      )}

      {event.description && (
        <div className="flex gap-2.5">
          <AlignLeft size={15} className={icon} />
          <p className="max-h-40 min-w-0 flex-1 overflow-y-auto text-[13px] leading-relaxed break-words whitespace-pre-wrap text-ink-2">{event.description}</p>
        </div>
      )}

      {reminds && (
        <div className="flex text-ink-2">
          <ReminderPicker row value={event.reminder} onChange={(minutes) => setEventReminder(event.id, minutes)} />
        </div>
      )}

      {event.canRespond && (
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-ink-3">{t("Are you going?")}</div>
          <div className="grid grid-cols-3 gap-1.5">
            {(["accepted", "tentative", "declined"] as const).map((status) => (
              <button
                key={status}
                onClick={() => answer(status)}
                aria-pressed={event.myStatus === status}
                className={cn(
                  "press rounded-[10px] font-medium transition-colors",
                  mobile ? "h-11" : "h-8 text-[13px]",
                  event.myStatus === status ? "bg-accent text-on-accent" : "bg-hover text-ink-2 hover:bg-selected hover:text-ink",
                )}
              >
                {t(STATUS_LABEL[status])}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-line pt-2.5 text-[12px] text-ink-3">
        <span className="min-w-0 flex-1 truncate">
          {calendar?.name}
          {account ? ` · ${account.name}` : source?.label ? ` · ${source.label}` : ""}
        </span>
        {event.url && (
          <a href={event.url} target="_blank" rel="noopener noreferrer" className="flex shrink-0 items-center gap-1 font-medium text-accent-text hover:underline">
            {source?.kind === "microsoft" ? t("Open in Outlook") : t("Open in Google Calendar")} <ExternalLink size={11} />
          </a>
        )}
      </div>
    </div>
  );
}

function GuestMark({ status }: { status: AttendeeStatus }) {
  const label = t(STATUS_LABEL[status]);
  const mark =
    status === "accepted" ? (
      <Check size={11} strokeWidth={3} className="text-success" />
    ) : status === "declined" ? (
      <X size={11} strokeWidth={3} className="text-danger" />
    ) : (
      <CircleHelp size={11} className="text-ink-3" />
    );
  return (
    <span className="inline-flex shrink-0" title={label} aria-label={label}>
      {mark}
    </span>
  );
}
