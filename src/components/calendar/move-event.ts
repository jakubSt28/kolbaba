import type { PointerEvent as ReactPointerEvent } from "react";
import { addDays, DAY_MS, dayKey, eventSpan, sameDay, startOfDay } from "@/lib/calendar/dates";
import { presetOf, ruleFor } from "@/lib/calendar/recurrence";
import { draftOf, useCalendar } from "@/lib/calendar/store";
import type { CalEvent, EditScope, EventInput } from "@/lib/calendar/types";
import { t } from "@/lib/i18n";
import { useMail } from "@/lib/store";
import { track } from "@/lib/usage";
import { confirmChoice } from "../confirm";

/**
 * An event dragged to another time or day. A repeating one asks which events move; one with guests
 * asks first, because they get an email about it. A single event just moves, and can be put back.
 */
export function moveEvent(event: CalEvent, start: Date, end: Date) {
  const was = eventSpan(event);
  if (was.start.getTime() === start.getTime() && was.end.getTime() === end.getTime()) return;
  const { saveEvent } = useCalendar.getState();
  const times = (from: Date, to: Date): Pick<EventInput, "start" | "end"> => (event.allDay ? { start: dayKey(from), end: dayKey(to) } : { start: from.toISOString(), end: to.toISOString() });

  const apply = async (scope: EditScope) => {
    const draft: EventInput = { ...draftOf(event), ...times(start, end) };
    // The whole series on another day: its rule names the new weekday or day of the month.
    if (scope === "all" && !sameDay(start, was.start)) {
      const preset = presetOf(event.recurrence);
      if (preset !== "none" && preset !== "custom" && preset !== "daily" && preset !== "weekdays") draft.recurrence = ruleFor(preset, start) ?? draft.recurrence;
    }
    track("calMove");
    const ok = await saveEvent(draft, { eventId: event.id, scope });
    // Putting it back works for one event; a moved series is made of other events than before, and guests already got the email.
    if (!ok || scope === "all" || event.attendees.length) return;
    useMail.getState().pushToast({
      message: was.start.getTime() === start.getTime() ? t("End time changed") : t("Event moved"),
      undo: () => void saveEvent({ ...draftOf(event), ...times(was.start, was.end) }, { eventId: event.id, scope: "this" }),
    });
  };

  const guests = event.attendees.length > 0;
  if (!event.recurring && !guests) return void apply("this");
  confirmChoice({
    title: event.recurring ? t("Move which events?") : t("Move this event?"),
    message: [event.recurring ? t("This event repeats.") : "", guests ? t("Its guests get an email with the new time.") : ""].filter(Boolean).join(" "),
    choices: event.recurring
      ? [
          { label: t("Only this event"), run: () => void apply("this") },
          { label: t("All events in the series"), run: () => void apply("all") },
        ]
      : [{ label: t("Move event"), run: () => void apply("this") }],
    cancelLabel: t("Cancel"),
  });
}

/** Where a dragged event would land. */
export interface Drag {
  event: CalEvent;
  start: Date;
  end: Date;
}

/** A drag starts once the pointer has gone this far (px): less is a click. */
export const DRAG_SLOP = 5;

/** Events are dragged with a mouse or a pen; a finger scrolls, and changes an event in its window. */
export const canDrag = (event: CalEvent, e: ReactPointerEvent) => event.canEdit && e.pointerType !== "touch" && e.button === 0;

/**
 * Dragging an event from day to day (the month, and the strip of all-day events): it keeps its time
 * and length. `dayAt` says which day is under the pointer; `onChange` gets where it would land, and
 * null when the drag is over; `onDrop` runs before the event is moved.
 */
export function dragByDay(event: CalEvent, e: ReactPointerEvent, dayAt: (x: number, y: number) => Date | null, onChange: (drag: Drag | null) => void, onDrop: () => void) {
  if (!canDrag(event, e)) return;
  const from = dayAt(e.clientX, e.clientY);
  if (!from) return;
  const span = eventSpan(event);
  const origin = { x: e.clientX, y: e.clientY };
  let active = false;
  let next: Drag | null = null;
  const move = (ev: PointerEvent) => {
    if (!active && Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) < DRAG_SLOP) return;
    active = true;
    const to = dayAt(ev.clientX, ev.clientY);
    if (!to) return;
    const days = Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS);
    next = { event, start: addDays(span.start, days), end: addDays(span.end, days) };
    onChange(next);
  };
  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("keydown", key, true);
    onChange(null);
  };
  const up = () => {
    stop();
    if (!active || !next) return;
    onDrop();
    moveEvent(event, next.start, next.end);
  };
  const key = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    ev.stopPropagation();
    stop();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("keydown", key, true);
}
