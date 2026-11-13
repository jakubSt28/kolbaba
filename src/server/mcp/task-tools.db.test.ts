import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { newListId } from "@/lib/tasks/types";
import { saveCalendarSettings } from "../calendar/service";
import { db, schema } from "../db";
import type { AgentPermission } from "../db/schema";
import { createTaskList, ListBody, listTasks } from "../tasks";
import { undoEvent } from "./activity";
import { handleMcpRequest } from "./server";
import { cleanup, seed } from "./test-helpers";

vi.mock("../worker-client", () => ({ hasWorker: () => true, nudgeWorker: vi.fn(async () => true) }));
const push = vi.hoisted(() => ({ notifyUser: vi.fn(async () => {}), userLocale: vi.fn(async () => "en" as const) }));
vi.mock("../push", () => push);

afterAll(cleanup);
beforeEach(() => vi.clearAllMocks());

const text = (r: unknown) => ((r as CallToolResult).content[0] as { text: string }).text;
const data = (r: unknown) => JSON.parse(text(r));

async function setup(permission: AgentPermission = "draft", shared = true) {
  const s = await seed(permission);
  await saveCalendarSettings(s.user.id, { timeZone: "Europe/Prague" });
  if (shared) await db().update(schema.agents).set({ tasks: true }).where(eq(schema.agents.id, s.agent.id));
  const client = new Client({ name: "claude-code", version: "2.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost:3000/api/mcp"), {
    fetch: (input, init) => handleMcpRequest(input instanceof Request ? input : new Request(input, init)),
    requestInit: { headers: { authorization: `Bearer ${s.tokens.access_token}` } },
  });
  await client.connect(transport);
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
  const steps = () => db().select().from(schema.agentEvents).where(eq(schema.agentEvents.agentId, s.agent.id)).orderBy(schema.agentEvents.at);
  const open = async () => (await listTasks(s.user.id)).tasks.filter((t) => t.completedAt === null && t.deletedAt === null);
  return { ...s, call, steps, open };
}

describe("task tools", () => {
  it("stay shut until the user shares the tasks with the agent", async () => {
    const { call } = await setup("full", false);
    const res = await call("list_tasks");
    expect((res as CallToolResult).isError).toBe(true);
    expect(text(res)).toContain("hasn't shared their tasks");
  });

  it("list lists, add a task to one, find it, change it, tick it off and delete it, each step undoable", async () => {
    const { call, user, steps, open } = await setup("draft");
    await createTaskList(user.id, ListBody.parse({ id: newListId(), kind: "list", name: "Errands", emoji: "🛒", order: 0 }));
    const lists = data(await call("list_task_lists"));
    expect(lists.lists.map((l: { name: string }) => l.name)).toEqual(["Inbox", "Errands"]);

    const today = lists.today as string;
    const made = data(
      await call("create_task", { title: "Pick up the parcel", due: today, time: "17:00", priority: "high", list: "errands", notes: "Ask for the blue box\n- [ ] Bring the ID", intent: "Turning an email into a task" }),
    );
    expect(made.task).toMatchObject({ title: "Pick up the parcel", list: "Errands", due: today, time: "17:00", priority: "high" });
    expect((await open())[0].notes).toContain('data-type="taskItem"');

    expect(data(await call("list_tasks", { view: "today" })).tasks.map((t: { title: string }) => t.title)).toEqual(["Pick up the parcel"]);
    expect(data(await call("list_tasks", { list: "inbox" })).tasks).toEqual([]);
    expect(data(await call("list_tasks", { view: "all", query: "blue box" })).tasks).toHaveLength(1);

    await call("update_task", { task_id: made.task.task_id, title: "Pick up the parcel at the post office", list: "inbox", priority: "low" });
    expect(await open()).toEqual([expect.objectContaining({ title: "Pick up the parcel at the post office", listId: null, priority: 1 })]);

    await call("update_task", { task_id: made.task.task_id, completed: true });
    expect(await open()).toEqual([]);

    await call("delete_task", { task_id: made.task.task_id });
    const log = await steps();
    expect(log.map((e) => e.action)).toEqual(["list", "task_create", "list", "list", "list", "task_update", "task_update", "task_delete"]);
    expect(log[1].summary).toBe("Added the task **Pick up the parcel**");
    expect(log[6].summary).toBe("Ticked off the task **Pick up the parcel at the post office**");

    // Undo the delete, the tick and the change: the task is as it was made.
    await undoEvent(user.id, log[7].id);
    await undoEvent(user.id, log[6].id);
    await undoEvent(user.id, log[5].id);
    expect(await open()).toEqual([expect.objectContaining({ title: "Pick up the parcel", priority: 3, listId: expect.stringMatching(/^lst_/) })]);
    // And the task it made goes away.
    await undoEvent(user.id, log[1].id);
    expect((await listTasks(user.id)).tasks).toEqual([]);
  });

  it("tick off one time of a repeating task: it moves on, a done copy stays, and undo puts both back", async () => {
    const { call, user, steps, open } = await setup("draft");
    const { today } = data(await call("list_task_lists"));
    const made = data(await call("create_task", { title: "Water the plants", due: today, repeat: "daily" }));
    expect(made.task.repeats).toBe("Daily");
    const done = data(await call("update_task", { task_id: made.task.task_id, completed: true }));
    expect(done.task.due > today).toBe(true);
    const all = (await listTasks(user.id)).tasks;
    expect(all.filter((t) => t.completedAt !== null).map((t) => [t.title, t.due])).toEqual([["Water the plants", today]]);
    const log = await steps();
    await undoEvent(user.id, log.at(-1)!.id);
    expect((await listTasks(user.id)).tasks).toEqual([expect.objectContaining({ due: today, completedAt: null })]);
    expect(await open()).toHaveLength(1);
  });

  it("reading is enough to look, not to change", async () => {
    const { call } = await setup("read");
    expect((await call("list_tasks")) as CallToolResult).not.toMatchObject({ isError: true });
    const res = await call("create_task", { title: "x" });
    expect((res as CallToolResult).isError).toBe(true);
  });

  it("says what's wrong with what it was given", async () => {
    const { call } = await setup("draft");
    expect(text(await call("create_task", { title: "x", list: "Nowhere" }))).toContain("No list “Nowhere”");
    expect(text(await call("create_task", { title: "x", time: "09:00" }))).toContain("needs `due`");
    expect(text(await call("create_task", { title: "x", repeat: "weekly" }))).toContain("needs `due`");
  });
});
