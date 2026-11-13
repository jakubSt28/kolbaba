"use client";

import { create } from "zustand";
import { t } from "../i18n";
import { api, LIVE } from "../live";
import { useMail } from "../store";
import { track } from "../usage";
import { addDays, atTime, DAY_MS, dayKey, eventSpan, localZone, minutesOf, parseDay, startOfDay, stepAnchor } from "./dates";
import { buildMockEvents, MOCK_CALENDARS, MOCK_SOURCES } from "./mock";
import {
  DEFAULT_REMINDER,
  type AttendeeStatus,
  type CalEvent,
  type Calendar,
  type CalendarBootstrap,
  type CalendarSettings,
  type CalendarSource,
  type CalendarSuggestion,
  type CalendarView,
  type EditScope,
  type EventInput,
} from "./types";

/**
 * The calendar's own store, apart from the mail's (src/lib/store.ts): which of the two the app shows,
 * the calendars and their ticks, and the events of the days on screen. Events come from the server's
 * copy first (at once), then again once the providers have been asked.
 */

/** Three apps under one name: the mail, the calendar and the tasks (src/lib/tasks/store.ts). */
export type AppMode = "mail" | "calendar" | "tasks";

/** The pages of the "Add calendar" window. */
export type AddPage = "menu" | "caldav" | "feed" | "import" | "local";

export interface EditorState {
  /** The event being changed; not set for a new one. */
  eventId?: string;
  draft: EventInput;
}

/** Where on screen the opened event is, so its details can point at it. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CalendarState {
  mode: AppMode;
  /** Calendars and settings are loaded. Mock mode is always ready. */
  ready: boolean;
  sources: CalendarSource[];
  calendars: Calendar[];
  settings: CalendarSettings;
  suggestions: CalendarSuggestion[];
  can: { google: boolean; microsoft: boolean };
  view: CalendarView;
  /** A day (ms, local midnight) the view is built around. */
  anchor: number;
  events: CalEvent[];
  /** The days whose events are in `events`. */
  loaded: { from: number; to: number } | null;
  /** The providers are being asked. */
  syncing: boolean;
  syncedAt: number;
  openEvent: { id: string; rect: Rect } | null;
  editor: EditorState | null;
  adding: AddPage | null;
  /** One of Kolbaba's own calendars (or a followed link) being renamed. */
  renaming: string | null;
  /** Search is open: what's typed, and what was found for it (null until the first answer). */
  search: { query: string; results: CalEvent[] | null; busy: boolean } | null;
  /** Today's events, for the number on the switch while the calendar hasn't loaded its days (null: not asked yet). */
  today: CalEvent[] | null;

  setMode: (mode: AppMode) => void;
  /** Today's events from the server's copy, for the switch's number (at most every few minutes unless `force`). */
  loadToday: (force?: boolean) => Promise<void>;
  init: () => Promise<void>;
  /** Make sure the events of these days are here and fresh. */
  ensure: (from: Date, to: Date) => Promise<void>;
  /** Ask the providers again now ("Refresh", coming back to the app). */
  refresh: (force?: boolean) => Promise<void>;
  setView: (view: CalendarView) => void;
  step: (delta: number, days?: number) => void;
  goTo: (day: Date, view?: CalendarView) => void;
  goToday: () => void;
  showEvent: (id: string, rect: Rect) => void;
  closeEvent: () => void;
  /** A new event at this time (an hour unless `end` says otherwise), or all day. */
  newEvent: (at?: { start: Date; end?: Date; allDay?: boolean }) => void;
  editEvent: (id: string) => void;
  closeEditor: () => void;
  saveEvent: (draft: EventInput, opts?: { eventId?: string; scope?: EditScope }) => Promise<boolean>;
  deleteEvent: (id: string, scope: EditScope) => Promise<void>;
  respond: (id: string, status: Exclude<AttendeeStatus, "needsAction">, scope: EditScope) => Promise<void>;
  /** This event's own reminder time (null: none); a repeating event gets it for the whole series. */
  setEventReminder: (id: string, minutes: number | null) => void;
  openSearch: () => void;
  closeSearch: () => void;
  setSearch: (query: string) => void;
  /** Go to the event's day and open its details there. */
  revealEvent: (event: CalEvent) => void;
  toggleCalendar: (id: string) => void;
  showOnly: (id: string) => void;
  showAll: () => void;
  updateCalendar: (id: string, patch: { hue?: number; name?: string }) => void;
  deleteCalendar: (id: string) => Promise<void>;
  removeSource: (id: string) => Promise<void>;
  setAdding: (page: AddPage | null) => void;
  setRenaming: (calendarId: string | null) => void;
  createLocal: (name: string, hue?: number) => Promise<Calendar | null>;
  connectCalDav: (input: { accountId?: string; email?: string; username?: string; password?: string; url?: string }) => Promise<string | null>;
  addFeed: (url: string, name?: string) => Promise<string | null>;
  importFile: (input: { text: string; name?: string; calendarId?: string }) => Promise<string | null>;
  /** "Not now" for a mailbox's calendar: it isn't offered again. */
  skipSuggestion: (accountId: string) => void;
  setReminder: (minutes: number | null) => void;
}

const MODE_KEY = "kolbaba.mode";
const LAST_CALENDAR_KEY = "kolbaba.calendar.last";

const read = (storage: "session" | "local", key: string) => {
  try {
    return (storage === "session" ? sessionStorage : localStorage).getItem(key);
  } catch {
    return null;
  }
};
const write = (storage: "session" | "local", key: string, value: string) => {
  try {
    (storage === "session" ? sessionStorage : localStorage).setItem(key, value);
  } catch {}
};

const toast = (message: string) => useMail.getState().pushToast({ message });
const failed = (err: unknown) => toast((err as Error).message || t("That didn't work. Try again."));

/** Where Google's or Microsoft's permission page for a calendar starts (the whole page goes there and comes back). */
export function calendarConnectUrl(how: "google" | "microsoft", opts: { accountId?: string; hint?: string } = {}) {
  const params = new URLSearchParams({ calendar: "1" });
  if (opts.accountId) params.set("account", opts.accountId);
  if (opts.hint) params.set("hint", opts.hint);
  return `/api/accounts/${how}/start?${params}`;
}

/** The calendar a new event goes to: the one used last, else the first main one that can be written to. */
export function defaultCalendar(calendars: Calendar[]): Calendar | undefined {
  const writable = calendars.filter((c) => !c.readOnly);
  const last = read("local", LAST_CALENDAR_KEY);
  return writable.find((c) => c.id === last && c.visible) ?? writable.find((c) => c.primary && c.visible) ?? writable.find((c) => c.visible) ?? writable[0];
}

/** Round up to the next half hour: where a new event starts when no time was picked. */
function nextSlot(day: Date, now = new Date()) {
  const sameDay = startOfDay(day).getTime() === startOfDay(now).getTime();
  const minutes = sameDay ? Math.min(23 * 60, Math.ceil((minutesOf(now) + 1) / 30) * 30) : 9 * 60;
  return atTime(day, minutes);
}

let seq = 0;
let searchSeq = 0;
let seenSent = false;
let todayAt = 0;

/** What the editor starts from for an event that's already there. */
export function draftOf(e: CalEvent): EventInput {
  return {
    calendarId: e.calendarId,
    title: e.title,
    location: e.location,
    description: e.description,
    start: e.start,
    end: e.end,
    allDay: e.allDay,
    timeZone: localZone(),
    recurrence: e.recurrence,
    attendees: e.attendees.map((a) => ({ name: a.name, email: a.email })),
  };
}

const plain = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** The prototype's search: every word somewhere in the title, place, notes or guests; what's coming first. */
function searchLocal(events: CalEvent[], query: string): CalEvent[] {
  const words = plain(query).split(/\s+/).filter(Boolean);
  const now = Date.now();
  const at = (e: CalEvent) => eventSpan(e).start.getTime();
  const over = (e: CalEvent) => eventSpan(e).end.getTime() < now;
  const hits = events
    .filter((e) => {
      const text = plain([e.title, e.location, e.description, ...e.attendees.flatMap((a) => [a.name, a.email])].join(" "));
      return words.every((w) => text.includes(w));
    })
    .sort((a, b) => at(a) - at(b));
  // A repeating event once: its next occurrence, or its last when it's over.
  const picked = new Map<string, CalEvent>();
  for (const e of hits) {
    const key = e.recurring ? `${e.calendarId}\n${e.title}` : e.id;
    const have = picked.get(key);
    if (!have || over(have)) picked.set(key, e);
  }
  const coming = [...picked.values()].filter((e) => !over(e)).sort((a, b) => at(a) - at(b));
  const past = [...picked.values()].filter(over).sort((a, b) => at(b) - at(a));
  return [...coming, ...past].slice(0, 40);
}

/** Opens an event's details once it's among the loaded events and drawn (after going to its day). */
function showWhenHere(eventId: string) {
  const open = () => {
    if (!useCalendar.getState().events.some((e) => e.id === eventId)) return false;
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-event="${CSS.escape(eventId)}"]`);
      const r = el?.getBoundingClientRect();
      useCalendar.getState().showEvent(eventId, r ? { x: r.x, y: r.y, width: r.width, height: r.height } : { x: window.innerWidth / 2, y: window.innerHeight / 3, width: 0, height: 0 });
    });
    return true;
  };
  if (open()) return;
  const stop = useCalendar.subscribe(() => open() && stop());
  setTimeout(stop, 15_000);
}

export const useCalendar = create<CalendarState>()((set, get) => {
  /** The events again from the server's copy (after a change it already holds the result). */
  const reload = async () => {
    const { loaded } = get();
    if (!LIVE || !loaded) return;
    const mine = ++seq;
    const { events } = await api.get<{ events: CalEvent[] }>(`/api/calendar/events?from=${new Date(loaded.from).toISOString()}&to=${new Date(loaded.to).toISOString()}`);
    if (mine === seq) set({ events });
  };

  const applyBootstrap = (b: CalendarBootstrap) => set({ sources: b.sources, calendars: b.calendars, settings: b.settings, suggestions: b.suggestions, can: b.can });

  const patchCalendar = (id: string, patch: Partial<Calendar>) => set((s) => ({ calendars: s.calendars.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));

  const saveSettings = (patch: CalendarSettings & { seen?: true }) => {
    const { seen, ...settings } = patch;
    void seen;
    set((s) => ({ settings: { ...s.settings, ...settings } }));
    if (LIVE) api.patch("/api/calendar/settings", patch).catch(() => {});
  };

  return {
    mode: "mail",
    ready: !LIVE,
    sources: LIVE ? [] : MOCK_SOURCES,
    calendars: LIVE ? [] : MOCK_CALENDARS,
    settings: {},
    suggestions: [],
    can: { google: true, microsoft: true },
    view: "week",
    anchor: startOfDay(new Date()).getTime(),
    events: LIVE ? [] : buildMockEvents(),
    loaded: null,
    syncing: false,
    syncedAt: 0,
    openEvent: null,
    editor: null,
    adding: null,
    renaming: null,
    search: null,
    today: null,

    setMode: (mode) => {
      if (get().mode === mode) return;
      set({ mode, openEvent: null, editor: null, search: null });
      write("session", MODE_KEY, mode);
      if (mode === "mail") return;
      // Mail's overlays step aside; the open conversation stays where it was for the way back.
      useMail.setState({ paletteOpen: false, sidebarEditing: false });
      if (mode === "tasks") return track("tasksOpen");
      track("calOpen");
      // Every time: a mailbox added since last time is offered its calendar, and the events are fresh.
      const first = !get().ready;
      void get()
        .init()
        .then(() => (first ? undefined : get().refresh()));
      if (LIVE && !seenSent) {
        seenSent = true;
        saveSettings({ seen: true, ...(get().settings.timeZone === localZone() ? {} : { timeZone: localZone() }) });
      }
    },

    loadToday: async (force) => {
      if (!LIVE) return;
      if (!force && Date.now() - todayAt < 5 * 60_000) return;
      todayAt = Date.now();
      const from = startOfDay(new Date());
      try {
        const { events } = await api.get<{ events: CalEvent[] }>(`/api/calendar/events?from=${from.toISOString()}&to=${addDays(from, 1).toISOString()}`);
        set({ today: events });
      } catch {
        // Only a number: the calendar says what's wrong once it's opened.
      }
    },

    init: async () => {
      if (!LIVE) return;
      try {
        const b = await api.get<CalendarBootstrap>("/api/calendar");
        applyBootstrap(b);
        // The saved view applies when the calendar first opens, not every time it's looked at again.
        set(get().ready ? {} : { ready: true, view: b.settings.view ?? get().view });
      } catch (err) {
        failed(err);
      }
    },

    ensure: async (from, to) => {
      if (!LIVE) return set({ loaded: { from: from.getTime(), to: to.getTime() } });
      const { loaded, syncedAt, ready } = get();
      if (!ready) return;
      const covered = loaded && loaded.from <= from.getTime() && loaded.to >= to.getTime();
      if (covered && Date.now() - syncedAt < 60_000) return;
      // A week on each side: stepping to the neighbouring days shows them at once.
      const window = covered ? loaded : { from: from.getTime() - 7 * DAY_MS, to: to.getTime() + 7 * DAY_MS };
      const query = { from: new Date(window.from).toISOString(), to: new Date(window.to).toISOString() };
      const mine = ++seq;
      if (!covered) {
        try {
          const { events } = await api.get<{ events: CalEvent[] }>(`/api/calendar/events?from=${query.from}&to=${query.to}`);
          if (mine !== seq) return;
          set({ events, loaded: window });
        } catch {
          // The sync below says what's wrong.
        }
      }
      if (!get().calendars.length) return set({ loaded: window, syncedAt: Date.now() });
      set({ syncing: true });
      try {
        const fresh = await api.post<{ events: CalEvent[]; sources: CalendarSource[]; calendars: Calendar[] }>("/api/calendar/sync", { ...query, tz: localZone() });
        if (mine === seq) set({ events: fresh.events, sources: fresh.sources, calendars: fresh.calendars, loaded: window, syncedAt: Date.now() });
      } catch (err) {
        if (mine === seq) failed(err);
      } finally {
        if (mine === seq) set({ syncing: false });
      }
    },

    refresh: async (force) => {
      const { loaded } = get();
      if (!LIVE || !loaded) return;
      const query = { from: new Date(loaded.from).toISOString(), to: new Date(loaded.to).toISOString() };
      const mine = ++seq;
      set({ syncing: true });
      try {
        const fresh = await api.post<{ events: CalEvent[]; sources: CalendarSource[]; calendars: Calendar[] }>("/api/calendar/sync", { ...query, tz: localZone(), force });
        if (mine === seq) set({ events: fresh.events, sources: fresh.sources, calendars: fresh.calendars, syncedAt: Date.now() });
      } catch (err) {
        if (mine === seq && force) failed(err);
      } finally {
        if (mine === seq) set({ syncing: false });
      }
    },

    setView: (view) => {
      if (get().view === view) return;
      track("calView");
      set({ view, openEvent: null });
      saveSettings({ view });
    },
    step: (delta, days) => set((s) => ({ anchor: stepAnchor(s.view, new Date(s.anchor), delta, days).getTime(), openEvent: null })),
    goTo: (day, view) => {
      if (view && view !== get().view) get().setView(view);
      set({ anchor: startOfDay(day).getTime(), openEvent: null });
    },
    goToday: () => set({ anchor: startOfDay(new Date()).getTime(), openEvent: null }),

    showEvent: (id, rect) => set({ openEvent: { id, rect } }),
    closeEvent: () => set({ openEvent: null }),

    newEvent: (at) => {
      const { calendars, anchor } = get();
      const calendar = defaultCalendar(calendars);
      const start = at?.start ?? nextSlot(new Date(anchor));
      const allDay = !!at?.allDay;
      const end = at?.end ?? (allDay ? addDays(startOfDay(start), 1) : new Date(start.getTime() + 3600_000));
      set({
        openEvent: null,
        editor: {
          draft: {
            // Nothing to write to yet: saving makes a calendar of Kolbaba's own first.
            calendarId: calendar?.id ?? "",
            title: "",
            location: "",
            description: "",
            start: allDay ? dayKey(start) : start.toISOString(),
            end: allDay ? dayKey(end) : end.toISOString(),
            allDay,
            timeZone: localZone(),
            recurrence: null,
            attendees: [],
          },
        },
      });
    },
    editEvent: (id) => {
      const e = get().events.find((x) => x.id === id);
      if (e) set({ openEvent: null, editor: { eventId: id, draft: draftOf(e) } });
    },
    closeEditor: () => set({ editor: null }),

    saveEvent: async (draft, opts = {}) => {
      let input = draft;
      if (!input.calendarId) {
        const own = await get().createLocal(t("My calendar"));
        if (!own) return false;
        input = { ...draft, calendarId: own.id };
      }
      write("local", LAST_CALENDAR_KEY, input.calendarId);
      const before = get().events;
      const shown: CalEvent = {
        ...(before.find((e) => e.id === opts.eventId) ?? { id: `tmp_${Date.now()}`, organizer: null, myStatus: null, joinUrl: null, url: null, canEdit: true, canRespond: false }),
        calendarId: input.calendarId,
        title: input.title,
        location: input.location,
        description: input.description,
        start: input.start,
        end: input.end,
        allDay: input.allDay,
        recurring: !!input.recurrence,
        recurrence: input.recurrence,
        attendees: input.attendees.map((a) => ({ ...a, status: "needsAction" as const })),
        ...(input.reminder !== undefined ? { reminder: input.reminder } : {}),
      };
      // Shown at once; the server's answer replaces it (or takes it back).
      set({ editor: null, events: opts.eventId ? before.map((e) => (e.id === opts.eventId ? shown : e)) : [...before, shown] });
      track(opts.eventId ? "calEventEdit" : "calEventNew");
      if (!LIVE) return true;
      try {
        if (opts.eventId) await api.patch(`/api/calendar/events/${encodeURIComponent(opts.eventId)}`, { event: input, scope: opts.scope ?? "this" });
        else await api.post("/api/calendar/events", input);
        await reload();
        return true;
      } catch (err) {
        set({ events: before });
        failed(err);
        void reload().catch(() => {});
        return false;
      }
    },

    deleteEvent: async (id, scope) => {
      const before = get().events;
      set({ openEvent: null, editor: null, events: before.filter((e) => e.id !== id) });
      track("calEventDelete");
      if (!LIVE) return;
      try {
        await api.del(`/api/calendar/events/${encodeURIComponent(id)}?scope=${scope}`);
        await reload();
      } catch (err) {
        set({ events: before });
        failed(err);
      }
    },

    respond: async (id, status, scope) => {
      const before = get().events;
      set({ events: before.map((e) => (e.id === id ? { ...e, myStatus: status } : e)) });
      track("calRsvp");
      if (!LIVE) return;
      try {
        await api.post(`/api/calendar/events/${encodeURIComponent(id)}/respond`, { status, scope });
        await reload();
      } catch (err) {
        set({ events: before });
        failed(err);
        // The answer may be saved even when telling the organizer failed.
        void reload().catch(() => {});
      }
    },

    setEventReminder: (id, minutes) => {
      const before = get().events;
      const event = before.find((e) => e.id === id);
      if (!event) return;
      set({ events: before.map((e) => (e.id === id ? { ...e, reminder: minutes } : e)) });
      track("calReminder");
      if (!LIVE) return;
      api
        .put(`/api/calendar/events/${encodeURIComponent(id)}/reminder`, { minutes, scope: event.recurring ? "all" : "this" })
        .then(reload)
        .catch((err) => {
          set({ events: before });
          failed(err);
        });
    },

    openSearch: () => set((s) => ({ search: s.search ?? { query: "", results: null, busy: false }, openEvent: null })),
    closeSearch: () => {
      searchSeq++;
      set({ search: null });
    },
    setSearch: (query) => {
      const mine = ++searchSeq;
      const q = query.trim();
      if (!q) return set({ search: { query, results: null, busy: false } });
      if (!LIVE) {
        const shown = visibleEvents(get().events, get().calendars);
        return set({ search: { query, results: searchLocal(shown, q), busy: false } });
      }
      set((s) => ({ search: { query, results: s.search?.results ?? null, busy: true } }));
      const ask = (deep: boolean) => api.get<{ events: CalEvent[] }>(`/api/calendar/search?q=${encodeURIComponent(q)}${deep ? "&deep=1" : ""}`);
      // What's here already shows at once; then the same question after the providers were asked for the whole two years.
      setTimeout(async () => {
        if (mine !== searchSeq) return;
        try {
          const quick = await ask(false);
          if (mine !== searchSeq) return;
          set({ search: { query, results: quick.events, busy: true } });
          const full = await ask(true);
          if (mine === searchSeq) set({ search: { query, results: full.events, busy: false } });
        } catch (err) {
          if (mine !== searchSeq) return;
          set((s) => ({ search: { query, results: s.search?.results ?? [], busy: false } }));
          failed(err);
        }
      }, 220);
    },
    revealEvent: (event) => {
      set({ search: null });
      get().goTo(eventSpan(event).start);
      showWhenHere(event.id);
    },

    toggleCalendar: (id) => {
      const calendar = get().calendars.find((c) => c.id === id);
      if (!calendar) return;
      const visible = !calendar.visible;
      patchCalendar(id, { visible });
      track("calFilter");
      if (!LIVE) return;
      api
        .patch(`/api/calendar/calendars/${encodeURIComponent(id)}`, { visible })
        // A calendar ticked on may never have been read here: ask for it.
        .then(() => (visible ? get().refresh() : undefined))
        .catch((err) => {
          patchCalendar(id, { visible: !visible });
          failed(err);
        });
    },
    showOnly: (id) => {
      const changed = get().calendars.filter((c) => c.visible !== (c.id === id));
      set((s) => ({ calendars: s.calendars.map((c) => ({ ...c, visible: c.id === id })) }));
      track("calFilter");
      if (!LIVE) return;
      void Promise.all(changed.map((c) => api.patch(`/api/calendar/calendars/${encodeURIComponent(c.id)}`, { visible: c.id === id })))
        .then(() => get().refresh())
        .catch(failed);
    },
    showAll: () => {
      const hidden = get().calendars.filter((c) => !c.visible);
      set((s) => ({ calendars: s.calendars.map((c) => ({ ...c, visible: true })) }));
      if (!LIVE || !hidden.length) return;
      void Promise.all(hidden.map((c) => api.patch(`/api/calendar/calendars/${encodeURIComponent(c.id)}`, { visible: true })))
        .then(() => get().refresh())
        .catch(failed);
    },
    updateCalendar: (id, patch) => {
      patchCalendar(id, patch);
      if (LIVE) api.patch(`/api/calendar/calendars/${encodeURIComponent(id)}`, patch).catch(failed);
    },
    deleteCalendar: async (id) => {
      const before = { calendars: get().calendars, events: get().events };
      set({ calendars: before.calendars.filter((c) => c.id !== id), events: before.events.filter((e) => e.calendarId !== id) });
      if (!LIVE) return;
      try {
        await api.del(`/api/calendar/calendars/${encodeURIComponent(id)}`);
        applyBootstrap(await api.get<CalendarBootstrap>("/api/calendar"));
      } catch (err) {
        set(before);
        failed(err);
      }
    },
    removeSource: async (id) => {
      const gone = new Set(get().calendars.filter((c) => c.sourceId === id).map((c) => c.id));
      const before = { sources: get().sources, calendars: get().calendars, events: get().events };
      set({ sources: before.sources.filter((s) => s.id !== id), calendars: before.calendars.filter((c) => !gone.has(c.id)), events: before.events.filter((e) => !gone.has(e.calendarId)) });
      if (!LIVE) return;
      try {
        applyBootstrap(await api.del<CalendarBootstrap>(`/api/calendar/sources/${encodeURIComponent(id)}`));
      } catch (err) {
        set(before);
        failed(err);
      }
    },

    setAdding: (adding) => set({ adding }),
    setRenaming: (renaming) => set({ renaming }),

    createLocal: async (name, hue) => {
      if (!LIVE) {
        const sources = get().sources.some((s) => s.kind === "local") ? get().sources : [...get().sources, { id: "cso_own", kind: "local" as const, accountId: null, label: "", status: "ok" as const, statusMessage: null }];
        const calendar: Calendar = { id: `cal_${Date.now()}`, sourceId: sources.find((s) => s.kind === "local")!.id, name, hue: hue ?? 200, visible: true, readOnly: false, primary: false };
        set({ sources, calendars: [...get().calendars, calendar] });
        return calendar;
      }
      try {
        const calendar = await api.post<Calendar>("/api/calendar/calendars", { name, hue });
        applyBootstrap(await api.get<CalendarBootstrap>("/api/calendar"));
        return calendar;
      } catch (err) {
        failed(err);
        return null;
      }
    },
    connectCalDav: async (input) => {
      if (!LIVE) return t("The prototype has no real calendars to connect.");
      try {
        applyBootstrap(await api.post<CalendarBootstrap>("/api/calendar/sources", { kind: "caldav", ...input }));
        track("calConnect");
        void get().refresh();
        return null;
      } catch (err) {
        return (err as Error).message;
      }
    },
    addFeed: async (url, name) => {
      if (!LIVE) return t("The prototype has no real calendars to connect.");
      try {
        applyBootstrap(await api.post<CalendarBootstrap>("/api/calendar/sources", { kind: "feed", url, name: name || undefined }));
        track("calFeed");
        void get().refresh();
        return null;
      } catch (err) {
        return (err as Error).message;
      }
    },
    importFile: async (input) => {
      if (!LIVE) return t("The prototype has no real calendars to connect.");
      try {
        const { calendar, count } = await api.post<{ calendar: Calendar; count: number }>("/api/calendar/import", input);
        applyBootstrap(await api.get<CalendarBootstrap>("/api/calendar"));
        track("calImport");
        toast(t("{count} events imported into {calendar}", { count, calendar: calendar.name }));
        void get().refresh(true);
        return null;
      } catch (err) {
        return (err as Error).message;
      }
    },

    skipSuggestion: (accountId) => {
      const skipped = [...new Set([...(get().settings.skipped ?? []), accountId])].slice(-100);
      set((s) => ({ suggestions: s.suggestions.filter((x) => x.accountId !== accountId) }));
      saveSettings({ skipped });
    },
    setReminder: (reminder) => saveSettings({ reminder }),
  };
});

/** The reminder in force: what's set, or ten minutes before. */
export const reminderOf = (settings: CalendarSettings) => (settings.reminder === undefined ? DEFAULT_REMINDER : settings.reminder);

/** Events of the ticked calendars only (unticking hides at once, before the server knows). */
export function visibleEvents(events: CalEvent[], calendars: Calendar[]) {
  const shown = new Set(calendars.filter((c) => c.visible).map((c) => c.id));
  return events.filter((e) => shown.has(e.calendarId));
}

/** The app comes back in the calendar or the tasks after a reload in the same window (a fresh launch opens the mail). */
export function restoreMode() {
  const mode = read("session", MODE_KEY);
  if (mode === "calendar" || mode === "tasks") useCalendar.getState().setMode(mode);
}

/** A link into the calendar: `/?calendar`, `/?calendar=2026-11-12`, with `&event=…` to open one. */
export function openCalendarLink(day: string | null, eventId: string | null) {
  const s = useCalendar.getState();
  s.setMode("calendar");
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) s.goTo(parseDay(day), eventId ? "day" : undefined);
  if (eventId) showWhenHere(eventId);
}

// Anything that opens mail (a notification, a shortcut, the command palette) brings the mail back.
if (typeof window !== "undefined") {
  useMail.subscribe((s, prev) => {
    if (useCalendar.getState().mode === "mail") return;
    if ((s.activeTabId && s.activeTabId !== prev.activeTabId) || s.folder !== prev.folder) useCalendar.getState().setMode("mail");
  });
}

/**
 * What's still to come today, for the number on the switch: the loaded days when they cover today
 * (they change as events are made and moved), else what loadToday brought.
 */
export function todayLeft(s: Pick<CalendarState, "events" | "calendars" | "loaded" | "today">, now = Date.now()) {
  const from = startOfDay(new Date(now));
  const to = addDays(from, 1);
  const covered = s.loaded && s.loaded.from <= from.getTime() && s.loaded.to >= to.getTime();
  const list = covered || !LIVE ? visibleEvents(s.events, s.calendars) : s.today;
  if (!list) return 0;
  return list.filter((e) => {
    const span = eventSpan(e);
    return span.start < to && span.end > from && (e.allDay || span.end.getTime() > now);
  }).length;
}

/** When the event is, for sorting and "is it over". */
export const endsAt = (e: CalEvent) => eventSpan(e).end.getTime();
