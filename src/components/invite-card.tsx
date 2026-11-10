"use client";

import { CalendarCheck, CalendarDays, CalendarPlus, CalendarX, Check, ChevronDown, HelpCircle, LoaderCircle, MapPin, Video, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { DropdownMenu } from "radix-ui";
import { useEffect, useState } from "react";
import { intlLocale, t, tk } from "@/lib/i18n";
import { api, LIVE } from "@/lib/live";
import { useMail } from "@/lib/store";
import type { InviteEvent, InviteInfo, Message } from "@/lib/types";
import { track } from "@/lib/usage";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { menuContentClass, menuItemClass, spring } from "./ui";

type Status = NonNullable<InviteInfo["status"]>;

const ANSWERS: { status: Status; label: string; icon: typeof Check }[] = [
  { status: "ACCEPTED", label: tk("Accept"), icon: Check },
  { status: "TENTATIVE", label: tk("Maybe"), icon: HelpCircle },
  { status: "DECLINED", label: tk("Decline"), icon: X },
];
const ANSWERED: Record<Status, string> = {
  ACCEPTED: tk("You're going"),
  TENTATIVE: tk("You might go"),
  DECLINED: tk("You declined"),
};
const SENT: Record<Status, string> = {
  ACCEPTED: tk("Accepted. {name} gets your answer."),
  TENTATIVE: tk("Sent “maybe” to {name}."),
  DECLINED: tk("Declined. {name} gets your answer."),
};

/** "Thu 15 Oct · 10:00–11:00" in the reader's language and zone. */
export function inviteWhen(i: Pick<InviteInfo, "start" | "end" | "allDay">) {
  if (!i.start) return "";
  const loc = intlLocale();
  if (i.allDay) {
    const day = (s: string) => new Intl.DateTimeFormat(loc, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${s}T00:00:00Z`));
    // DTEND of an all-day event is the day after it ends.
    const last = i.end ? new Date(new Date(`${i.end}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10) : null;
    return last && last !== i.start ? `${day(i.start)} – ${day(last)}` : `${day(i.start)} · ${t("all day")}`;
  }
  const start = new Date(i.start);
  const end = i.end ? new Date(i.end) : null;
  const date = new Intl.DateTimeFormat(loc, { weekday: "short", day: "numeric", month: "short" }).format(start);
  const time = (d: Date) => new Intl.DateTimeFormat(loc, { hour: "2-digit", minute: "2-digit" }).format(d);
  const sameDay = end && end.toDateString() === start.toDateString();
  return end ? (sameDay ? `${date} · ${time(start)}–${time(end)}` : `${date} ${time(start)} – ${new Intl.DateTimeFormat(loc, { weekday: "short", day: "numeric", month: "short" }).format(end)} ${time(end)}`) : `${date} · ${time(start)}`;
}

/** When it starts and ends (ms); all-day and floating times count in the reader's zone. */
function eventSpan(i: Pick<InviteEvent, "start" | "end" | "allDay">) {
  if (!i.start) return null;
  const at = (s: string) => new Date(i.allDay ? `${s}T00:00:00` : s).getTime();
  const start = at(i.start);
  // Without an end: a day for all-day events, an hour otherwise.
  return { start, end: i.end ? at(i.end) : start + (i.allDay ? 86_400_000 : 3600_000) };
}

export function eventOver(i: Pick<InviteEvent, "start" | "end" | "allDay">, now: number) {
  const span = eventSpan(i);
  return !!span && now >= span.end;
}

/** Joining makes sense until it ends; from 15 minutes before the start it's the thing to do. */
export function joinState(i: Pick<InviteEvent, "start" | "end" | "allDay" | "method" | "joinUrl">, now: number): "soon" | "later" | null {
  if (!i.joinUrl || i.method === "CANCEL" || eventOver(i, now)) return null;
  const span = eventSpan(i);
  return span && now >= span.start - 15 * 60_000 ? "soon" : "later";
}

/** Methods that put an event in front of you; REPLY and COUNTER only answer one. */
const SHOWS_EVENT = new Set(["REQUEST", "PUBLISH", "CANCEL", "ADD"]);

/** The invitation a conversation is about: the newest one in it, for its row in the list. */
export function threadInvite(messages: Message[]): InviteEvent | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const invite = messages[i].invite;
    if (invite?.start && SHOWS_EVENT.has(invite.method)) return invite;
  }
  return null;
}

/** "2026-10-15T08:00:00.000Z" → 20261015T080000Z (a floating wall time stays without Z, a date stays a date). */
function calendarTime(value: string, allDay: boolean) {
  if (allDay) return value.replace(/-/g, "");
  if (value.endsWith("Z")) return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return value.replace(/[-:]/g, "").slice(0, 15);
}

/** Google Calendar's "new event" page, filled in. */
export function googleCalendarUrl(i: Pick<InviteInfo, "summary" | "location" | "start" | "end" | "allDay">) {
  if (!i.start) return null;
  let end = i.end;
  if (!end) {
    // Google wants both ends: a day for all-day events, an hour otherwise.
    end = i.allDay
      ? new Date(new Date(`${i.start}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10)
      : i.start.endsWith("Z")
        ? new Date(new Date(i.start).getTime() + 3600_000).toISOString()
        : i.start;
  }
  const params = new URLSearchParams({ action: "TEMPLATE", text: i.summary, dates: `${calendarTime(i.start, i.allDay)}/${calendarTime(end, i.allDay)}` });
  if (i.location) params.set("location", i.location);
  return `https://calendar.google.com/calendar/render?${params}`;
}

/** Into the user's own calendar: an .ics file (Apple Calendar, Outlook) or Google Calendar. */
function AddToCalendar({ messageId, invite }: { messageId: string; invite: InviteInfo }) {
  const google = googleCalendarUrl(invite);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex h-7 items-center gap-1 rounded-full px-2.5 text-[12.5px] font-medium text-ink shadow-[inset_0_0_0_0.5px_var(--line)] transition-colors hover:bg-selected data-[state=open]:bg-selected">
        <CalendarPlus size={13} /> {t("Add to calendar")} <ChevronDown size={12} className="opacity-60" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={6} className={menuContentClass}>
          <DropdownMenu.Item asChild className={menuItemClass}>
            <a href={`/api/messages/${encodeURIComponent(messageId)}/invite/ics`} download="event.ics" onClick={() => track("calendar")}>
              <CalendarDays size={15} /> {t("Calendar (iPhone, Mac, Outlook)")}
            </a>
          </DropdownMenu.Item>
          {google && (
            <DropdownMenu.Item asChild className={menuItemClass}>
              <a href={google} target="_blank" rel="noopener noreferrer" onClick={() => track("calendar")}>
                <CalendarPlus size={15} /> {t("Google Calendar")}
              </a>
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** The call's own link: in a new tab, where Teams, Meet or Zoom take over. */
function JoinButton({ url, soon }: { url: string; soon: boolean }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => track("joinMeeting")}
      className={cn(
        "flex h-8 shrink-0 items-center gap-1.5 self-start rounded-full px-3 text-[12.5px] font-medium transition-colors",
        soon ? "bg-accent text-on-accent hover:bg-accent-hover" : "text-accent-text shadow-[inset_0_0_0_0.5px_var(--line)] hover:bg-selected",
      )}
    >
      <Video size={14} /> {t("Join")}
    </a>
  );
}

/** A calendar invitation in a message: when and where, joining the call, and Accept / Maybe / Decline right here. */
export function InviteCard({ message }: { message: Message }) {
  const pushToast = useMail((s) => s.pushToast);
  const now = useNow();
  const hasInvite = LIVE && (!!message.invite || !!message.attachments?.some((a) => a.kind === "calendar"));
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [busy, setBusy] = useState<Status | null>(null);
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    if (!hasInvite) return;
    let live = true;
    api
      .get<InviteInfo>(`/api/messages/${encodeURIComponent(message.id)}/invite`)
      .then((i) => live && setInvite(i))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [hasInvite, message.id]);

  // Read at sync, the event shows at once; answering waits for the rest.
  const event = invite ?? message.invite;
  if (!event || (!event.summary && !event.start)) return null;
  const cancelled = event.method === "CANCEL";
  const organizer = event.organizer?.name || event.organizer?.email || "";
  const join = joinState(event, now);
  // A location that's only the call's link adds nothing next to Join.
  const location = join && /^https?:\/\/\S+$/i.test(event.location) ? "" : event.location;
  const online = !!event.joinUrl && /teams|zoom|google meet|webex/i.test(location);

  const answer = async (status: Status) => {
    setBusy(status);
    try {
      setInvite(await api.post<InviteInfo>(`/api/messages/${encodeURIComponent(message.id)}/invite`, { status }));
      setChanging(false);
      pushToast({ message: t(SENT[status], { name: organizer }) });
    } catch (err) {
      pushToast({ message: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const status = invite?.status ?? null;
  const Icon = cancelled ? CalendarX : status === "ACCEPTED" ? CalendarCheck : CalendarDays;
  const showButtons = !!invite?.canReply && !cancelled && (!status || changing);
  // Going (or maybe), or an event that's only shared with you: it can go into your own calendar.
  const canAdd = !!invite && !cancelled && !!invite.start && (status === "ACCEPTED" || status === "TENTATIVE" || !invite.canReply);
  const LocationIcon = online ? Video : MapPin;
  return (
    <div className="mb-4 rounded-xl bg-hover px-3.5 py-3 text-[13px]">
      <div className="flex gap-3">
        <Icon size={18} className={cn("mt-0.5 shrink-0", cancelled ? "text-danger" : status === "ACCEPTED" ? "text-success" : "text-accent-text")} />
        <div className="min-w-0 flex-1">
          <div className={cn("font-medium text-ink", cancelled && "line-through decoration-ink-3/60")}>{event.summary || t("(no subject)")}</div>
          <div className="mt-0.5 text-[12.5px] text-ink-2">{inviteWhen(event)}</div>
          {location && (
            <div className="mt-0.5 flex items-center gap-1 text-[12.5px] text-ink-3">
              <LocationIcon size={12} className="shrink-0" />
              <span className="truncate">{location}</span>
            </div>
          )}
          <div className="mt-0.5 text-[12px] text-ink-3">
            {cancelled ? t("This event was cancelled") : organizer ? t("Invitation from {name}", { name: organizer }) : t("Calendar event")}
          </div>
        </div>
        {join && <JoinButton url={event.joinUrl!} soon={join === "soon"} />}
      </div>
      <AnimatePresence initial={false} mode="popLayout">
        {invite && showButtons ? (
          <motion.div key="buttons" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring} className="mt-3 flex flex-wrap gap-1.5 pl-[30px]">
            {ANSWERS.map((a) => (
              <button
                key={a.status}
                onClick={() => void answer(a.status)}
                disabled={!!busy}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors disabled:opacity-60",
                  a.status === "ACCEPTED" ? "bg-accent text-on-accent hover:bg-accent-hover" : "text-ink shadow-[inset_0_0_0_0.5px_var(--line)] hover:bg-selected",
                  invite.status === a.status && "ring-2 ring-accent/40",
                )}
              >
                {busy === a.status ? <LoaderCircle size={13} className="animate-spin" /> : <a.icon size={13} strokeWidth={2.2} />}
                {t(a.label)}
              </button>
            ))}
          </motion.div>
        ) : invite && (status || canAdd) && !cancelled ? (
          <motion.div key="status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-2.5 flex flex-wrap items-center gap-2 pl-[30px] text-[12.5px]">
            {status && <span className="font-medium text-ink">{t(ANSWERED[status])}</span>}
            {status && invite.canReply && (
              <button onClick={() => setChanging(true)} className="rounded-md px-1.5 py-0.5 font-medium text-accent-text hover:bg-selected">
                {t("Change")}
              </button>
            )}
            {canAdd && <AddToCalendar messageId={message.id} invite={invite} />}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
