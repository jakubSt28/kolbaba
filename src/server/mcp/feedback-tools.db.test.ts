import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import type { AgentPermission } from "../db/schema";
import { handleMcpRequest } from "./server";
import { cleanup, seed } from "./test-helpers";

afterAll(cleanup);

const text = (r: unknown) => ((r as CallToolResult).content[0] as { text: string }).text;

async function setup(permission: AgentPermission) {
  const s = await seed(permission);
  const client = new Client({ name: "claude-code", version: "2.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost:3000/api/mcp"), {
    fetch: (input, init) => handleMcpRequest(input instanceof Request ? input : new Request(input, init)),
    requestInit: { headers: { authorization: `Bearer ${s.tokens.access_token}` } },
  });
  await client.connect(transport);
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
  return { ...s, client, call };
}

describe("submit_feedback", () => {
  it("tells agents to use it, in the server instructions", async () => {
    const { client } = await setup("read");
    expect(client.getInstructions()).toContain("submit_feedback");
  });

  it("stores what the agent couldn't do, for the admin page, and shows the step in AI activity", async () => {
    const { call, user, agent } = await setup("read");
    const res = await call("submit_feedback", {
      kind: "missing",
      text: "The user asked to forward a conversation with its attachments, and there is no forward tool.",
      tool: "forward",
      intent: "Forwarding the invoice to accounting",
    });
    expect((res as CallToolResult).isError).toBeFalsy();

    const rows = await db().select().from(schema.agentFeedback).where(eq(schema.agentFeedback.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ agentId: agent.id, kind: "missing", tool: "forward", task: "Forwarding the invoice to accounting", app: agent.app });

    const steps = await db().select().from(schema.agentEvents).where(eq(schema.agentEvents.agentId, agent.id));
    expect(steps.map((s) => s.step)).toContainEqual({ kind: "feedback", text: expect.stringContaining("no forward tool") });
  });

  it("keeps the report when the user disconnects the agent", async () => {
    const { call, user, agent } = await setup("full");
    await call("submit_feedback", { kind: "failed", text: "search returned nothing for a sender I could see in list_threads." });
    await db().delete(schema.agents).where(eq(schema.agents.id, agent.id));
    const [row] = await db().select().from(schema.agentFeedback).where(eq(schema.agentFeedback.userId, user.id));
    expect(row).toMatchObject({ agentId: null, app: agent.app, kind: "failed", tool: null, task: null });
  });

  it("turns down an empty report", async () => {
    const { call } = await setup("read");
    const res = await call("submit_feedback", { kind: "idea", text: "x" });
    expect((res as CallToolResult).isError).toBe(true);
    expect(text(res)).toBeTruthy();
  });
});
