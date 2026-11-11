import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalCalendar, listEvents, saveCalendarSettings } from "../calendar/service";
import { db, schema } from "../db";
import type { AgentPermission } from "../db/schema";
import { undoEvent } from "./activity";
import { localIso, parseWhen } from "./calendar-tools";
import { handleMcpRequest } from "./server";
import { cleanup, seed } from "./test-helpers";

/** The calendar over MCP, on one of Kolbaba's own calendars (no provider to fake). Guests would send mail: that part is faked. */
const adapter = vi.hoisted(() => ({ send: vi.fn(async () => ({})), close: vi.fn(async () => {}) }));
vi.mock("../mail/adapters", () => ({ withAdapter: async (_row: unknown, fn: (a: typeof adapter) => Promise<unknown>) => fn(adapter), adapterFor: () => adapter }));
vi.mock("../worker-client", () => ({ hasWorker: () => true, nudgeWorker: vi.fn(async () => true) }));
const push = vi.hoisted(() => ({ notifyUser: vi.fn(async () => {}), userLocale: vi.fn(async () => "en" as const) }));
vi.mock("../push", () => push);

afterAll(cleanup);
beforeEach(() => vi.clearAllMocks());

const text = (r: unknown) => ((r as CallToolResult).content[0] as { text: string }).text;
const data = (r: unknown) => JSON.parse(text(r));
const november = [new Date("2026-11-01T00:00:00Z"), new Date("2026-12-01T00:00:00Z")] as const;

async function setup(permission: AgentPermission = "draft", shared = true) {
  const s = await seed(permission);
  await saveCalendarSettings(s.user.id, { timeZone: "Europe/Prague" });
  const calendar = await createLocalCalendar(s.user.id, "Family");
  if (shared) await db().update(schema.agents).set({ calendar: true }).where(eq(schema.agents.id, s.agent.id));
  const client = new Client({ name: "claude-code", version: "2.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost:3000/api/mcp"), {
    fetch: (input, init) => handleMcpRequest(input instanceof Request ? input : new Request(input, init)),
    requestInit: { headers: { authorization: `Bearer ${s.tokens.access_token}` } },
  });
  await client.connect(transport);
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
  const steps = () => db().select().from(schema.agentEvents).where(eq(schema.agentEvents.agentId, s.agent.id)).orderBy(schema.agentEvents.at);
  return { ...s, calendar, call, steps };
}

describe("calendar times for agents", () => {
  it("reads a time without an offset in the user's zone, and writes times back with it", () => {
    expect(parseWhen("2026-11-12T09:00", "Europe/Prague")?.date.toISOString()).toBe("2026-11-12T08:00:00.000Z");
    expect(parseWhen("2026-07-01T09:00", "Europe/Prague")?.date.toISOString()).toBe("2026-07-01T07:00:00.000Z");
    expect(parseWhen("2026-11-12T09:00:00-05:00", "Europe/Prague")?.date.toISOString()).toBe("2026-11-12T14:00:00.000Z");
    expect(parseWhen("2026-11-12", "Europe/Prague")).toMatchObject({ day: "2026-11-12" });
    expect(parseWhen("next Tuesday", "Europe/Prague")).toBeNull();
    expect(localIso(new Date("2026-11-12T08:00:00Z"), "Europe/Prague")).toBe("2026-11-12T09:00:00+01:00");
    expect(localIso(new Date("2026-07-01T07:00:00Z"), "America/New_York")).toBe("2026-07-01T03:00:00-04:00");
  });
});

describe("calendar tools", () => {
  it("stay shut until the user shares the calendar with the agent", async () => {
    const { call } = await setup("full", false);
    const res = await call("list_events");
    expect((res as CallToolResult).isError).toBe(true);
    expect(text(res)).toContain("hasn't shared their calendar");
  });

  it("list calendars, add an event, find it, move it and delete it, each step undoable", async () => {
    const { call, user, calendar, steps } = await setup("draft");
    const listed = data(await call("list_calendars"));
    expect(listed).toMatchObject({ time_zone: "Europe/Prague", calendars: [{ id: calendar.id, name: "Family", account: "Kolbaba", read_only: false }] });

    const made = data(await call("create_event", { title: "Dentist", start: "2026-11-12T09:00", end: "2026-11-12T09:45", location: "Clinic", intent: "Booking the dentist" }));
    expect(made.event).toMatchObject({ title: "Dentist", calendar: "Family", start: "2026-11-12T09:00:00+01:00", end: "2026-11-12T09:45:00+01:00", all_day: false, location: "Clinic" });

    const found = data(await call("list_events", { from: "2026-11-10", to: "2026-11-14", query: "dent" }));
    expect(found.events).toHaveLength(1);
    expect(data(await call("list_events", { from: "2026-11-10", to: "2026-11-14", query: "nothing like it" })).events).toEqual([]);

    // A new start alone keeps the 45 minutes.
    await call("update_event", { event_id: made.event.event_id, start: "2026-11-13T15:00" });
    expect((await listEvents(user.id, ...november)).map((e) => [e.start, e.end])).toEqual([["2026-11-13T14:00:00.000Z", "2026-11-13T14:45:00.000Z"]]);

    await call("delete_event", { event_id: made.event.event_id });
    expect(await listEvents(user.id, ...november)).toEqual([]);

    const log = await steps();
    expect(log.map((e) => e.action)).toEqual(["list", "event_create", "list", "list", "event_update", "event_delete"]);
    expect(log[1].summary).toContain("Dentist");

    // Undo the delete: it's back where it was after the move.
    await undoEvent(user.id, log[5].id);
    expect((await listEvents(user.id, ...november)).map((e) => [e.title, e.start])).toEqual([["Dentist", "2026-11-13T14:00:00.000Z"]]);
  });

  it("undo takes back an event the agent made and a change it made", async () => {
    const { call, user, steps } = await setup("draft");
    const made = data(await call("create_event", { title: "Trip", start: "2026-11-20", end: "2026-11-22" }));
    expect(made.event).toMatchObject({ all_day: true, start: "2026-11-20", end: "2026-11-23" });
    await call("update_event", { event_id: made.event.event_id, title: "Trip to Brno" });
    const [, changed] = await steps();
    await undoEvent(user.id, changed.id);
    expect((await listEvents(user.id, ...november)).map((e) => e.title)).toEqual(["Trip"]);
    const [created] = await steps();
    await undoEvent(user.id, created.id);
    expect(await listEvents(user.id, ...november)).toEqual([]);
  });

  it("reading is enough to look, not to change", async () => {
    const { call } = await setup("read");
    expect((await call("list_events")) as CallToolResult).not.toMatchObject({ isError: true });
    const res = await call("create_event", { title: "x", start: "2026-11-12T09:00" });
    expect((res as CallToolResult).isError).toBe(true);
  });

  it("inviting people needs Full access, and then the invitation goes out by email", async () => {
    const organize = await setup("draft");
    const refused = await organize.call("create_event", { title: "Lunch", start: "2026-11-12T12:00", guests: ["petra@example.com"] });
    expect((refused as CallToolResult).isError).toBe(true);
    expect(adapter.send).not.toHaveBeenCalled();

    const full = await setup("full");
    const made = data(await full.call("create_event", { title: "Lunch", start: "2026-11-12T12:00", guests: ["petra@example.com"] }));
    expect(made.event.guests).toEqual([{ email: "petra@example.com", answer: "needsAction" }]);
    expect(adapter.send).toHaveBeenCalledTimes(1);
    expect(adapter.send).toHaveBeenCalledWith(expect.objectContaining({ subject: "Invitation: Lunch", to: [{ name: "", email: "petra@example.com" }], icalEvent: expect.objectContaining({ method: "REQUEST" }) }));
  });
});
