import { addDays, atTime, dayKey, startOfWeek } from "./dates";
import type { CalEvent, Calendar, CalendarSource } from "./types";

/** The prototype's calendars (mock mode): made-up events around this week, so every view has something to show. */

export const MOCK_SOURCES: CalendarSource[] = [
  { id: "cso_work", kind: "google", accountId: "acc_personal", label: "daniel.svoboda@example.com", status: "ok", statusMessage: null },
  { id: "cso_home", kind: "caldav", accountId: "acc_seznam", label: "daniel.svoboda@example.cz", status: "ok", statusMessage: null },
  { id: "cso_own", kind: "local", accountId: null, label: "", status: "ok", statusMessage: null },
  { id: "cso_feed", kind: "feed", accountId: null, label: "calendars.example.org", status: "ok", statusMessage: null },
];

export const MOCK_CALENDARS: Calendar[] = [
  { id: "cal_work", sourceId: "cso_work", name: "Work", hue: 228, visible: true, readOnly: false, primary: true },
  { id: "cal_team", sourceId: "cso_work", name: "Team holidays", hue: 282, visible: true, readOnly: true, primary: false },
  { id: "cal_home", sourceId: "cso_home", name: "Personal", hue: 152, visible: true, readOnly: false, primary: true },
  { id: "cal_family", sourceId: "cso_own", name: "Family", hue: 28, visible: true, readOnly: false, primary: false },
  { id: "cal_holidays", sourceId: "cso_feed", name: "Public holidays", hue: 340, visible: true, readOnly: true, primary: false },
];

const base = { location: "", description: "", recurring: false, recurrence: null, organizer: null, attendees: [], myStatus: null, joinUrl: null, url: null, canEdit: true, canRespond: false };

export function buildMockEvents(now = new Date()): CalEvent[] {
  const monday = startOfWeek(now);
  let n = 0;
  const timed = (calendarId: string, day: number, from: number, to: number, title: string, extra: Partial<CalEvent> = {}): CalEvent => ({
    ...base,
    id: `evt_mock_${n++}`,
    calendarId,
    title,
    start: atTime(addDays(monday, day), from).toISOString(),
    end: atTime(addDays(monday, day), to).toISOString(),
    allDay: false,
    ...extra,
  });
  const days = (calendarId: string, day: number, length: number, title: string, extra: Partial<CalEvent> = {}): CalEvent => ({
    ...base,
    id: `evt_mock_${n++}`,
    calendarId,
    title,
    start: dayKey(addDays(monday, day)),
    end: dayKey(addDays(monday, day + length)),
    allDay: true,
    ...extra,
  });
  const standup = { recurring: true, recurrence: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", joinUrl: "https://meet.example.com/abc-defg-hij" };
  const guests = [
    { name: "Petra Malá", email: "petra@northwind.example", status: "accepted" as const },
    { name: "Tomáš Bureš", email: "tomas@northwind.example", status: "needsAction" as const },
  ];
  return [
    ...[-7, 0, 7].flatMap((week) => [0, 1, 2, 3, 4].map((d) => timed("cal_work", week + d, 9 * 60, 9 * 60 + 15, "Standup", standup))),
    timed("cal_work", 0, 10 * 60, 11 * 60 + 30, "Planning the autumn release", { location: "Meeting room Sněžka", attendees: guests }),
    timed("cal_work", 1, 13 * 60, 14 * 60, "Call with the Brno office", { joinUrl: "https://meet.example.com/brn-call-xyz", attendees: guests }),
    timed("cal_work", 2, 10 * 60, 10 * 60 + 45, "Design review", {
      organizer: { name: "Petra Malá", email: "petra@northwind.example" },
      attendees: guests,
      myStatus: "needsAction",
      canEdit: false,
      canRespond: true,
    }),
    timed("cal_work", 2, 10 * 60 + 30, 12 * 60, "Budget for next year", { description: "Bring last quarter's numbers." }),
    timed("cal_work", 3, 15 * 60, 16 * 60, "1:1 with Tomáš", { recurring: true, recurrence: "FREQ=WEEKLY;INTERVAL=2;BYDAY=TH" }),
    timed("cal_home", 0, 18 * 60, 19 * 60 + 30, "Climbing", { location: "Climbing wall", recurring: true, recurrence: "FREQ=WEEKLY;BYDAY=MO" }),
    timed("cal_home", 1, 7 * 60 + 30, 8 * 60 + 15, "Dentist", { location: "Dr. Veselá" }),
    timed("cal_home", 3, 19 * 60, 21 * 60 + 30, "Dinner with Klára", { location: "Bistro Na Rohu" }),
    timed("cal_family", 2, 16 * 60 + 30, 17 * 60 + 30, "Pick up Ema from school"),
    timed("cal_family", 5, 10 * 60, 13 * 60, "Farmers' market"),
    timed("cal_home", 4, 22 * 60, 24 * 60 + 90, "Night train to Košice", { location: "Main station" }),
    days("cal_family", 5, 2, "Weekend at grandma's"),
    days("cal_work", 8, 3, "Conference in Vienna", { location: "Vienna" }),
    days("cal_team", 3, 2, "Petra on holiday"),
    days("cal_holidays", 1, 1, "Day of Freedom and Democracy"),
    timed("cal_work", 9, 14 * 60, 15 * 60, "Quarterly results"),
    timed("cal_home", -3, 17 * 60, 18 * 60, "Car service"),
    timed("cal_family", 12, 15 * 60, 18 * 60, "Ema's birthday party"),
    days("cal_home", 16, 1, "Rent is due", { recurring: true, recurrence: "FREQ=MONTHLY;BYMONTHDAY=15" }),
  ];
}
