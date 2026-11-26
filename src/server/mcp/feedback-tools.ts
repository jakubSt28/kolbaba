import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BRAND } from "@/lib/brand";
import { db, schema } from "../db";
import type { AgentFeedbackKind } from "../db/schema";
import { limit, LIMITS } from "../rate-limit";
import { cleanIntent } from "./activity";
import type { ToolKit } from "./calendar-tools";
import type { ToolContext } from "./tools";

/**
 * submit_feedback: an agent tells the people who run Kolbaba what it couldn't do (a missing tool,
 * a call that failed, an option it needed). It lands on /admin; the user sees the step in AI
 * activity like any other. Every enabled agent may send it, whatever its access level.
 */

const KINDS = ["missing", "failed", "confusing", "idea"] as const satisfies readonly AgentFeedbackKind[];

export const FEEDBACK_INSTRUCTION = `- Whenever you can't do what the user asked because ${BRAND.name} has no tool for it, a tool is missing an option you needed, a tool failed or returned something you couldn't use, or a tool's description misled you, call submit_feedback (once per problem), then tell the user what you couldn't do. Describe the case in general terms, without email content, addresses or other personal data. Not needed when the user simply hasn't given you access (access level, mailboxes, calendar, tasks).`;

export function registerFeedbackTools(server: McpServer, ctx: ToolContext, kit: ToolKit) {
  const { guard, run, ok, log, fail, intent } = kit;

  server.registerTool(
    "submit_feedback",
    {
      title: `Tell ${BRAND.name} what's missing`,
      description:
        `Report to the people who build ${BRAND.name} something you couldn't do for the user: a tool that doesn't exist, an option a tool lacks, a call that failed or returned something unusable, or a description that misled you. ` +
        `Call it every time you hit such a limit, once per problem, then tell the user. The team reads every report to decide what to build next. ` +
        `Don't include email content, addresses, names or other personal data: describe the case in general terms.`,
      inputSchema: {
        kind: z
          .enum(KINDS)
          .describe("missing: no tool or option for what the user asked. failed: a tool errored or returned something you couldn't use. confusing: a tool or its description misled you. idea: anything else that would have helped."),
        text: z
          .string()
          .trim()
          .min(10)
          .max(2000)
          .describe("What you tried to do, what stopped you, and what would have let you do it. E.g. 'The user asked to forward a conversation with its attachments; there is no forward tool and create_draft can't attach files from another message.'"),
        tool: z.string().trim().max(100).optional().describe("The tool you called, or the name of the one you wished existed (e.g. 'forward')."),
        intent,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    run(async (args: { kind: AgentFeedbackKind; text: string; tool?: string; intent?: string }) => {
      const { agent } = await guard(ctx, "read");
      await limit(LIMITS.agentFeedback(agent.id)).catch(() => {
        throw fail("You've sent a lot of feedback this hour; it's all been received. Don't send more for now, just tell the user what you couldn't do.");
      });
      await db()
        .insert(schema.agentFeedback)
        .values({
          userId: ctx.userId,
          agentId: agent.id,
          app: agent.app,
          agentName: agent.name,
          kind: args.kind,
          text: args.text,
          tool: args.tool || null,
          task: cleanIntent(args.intent),
        });
      const short = args.text.length > 120 ? `${args.text.slice(0, 119).trimEnd()}…` : args.text;
      await log(args, { action: "feedback", step: { kind: "feedback", text: short } });
      return ok({ ok: true, note: `Thanks, the ${BRAND.name} team will read it. Now tell the user what you couldn't do.` });
    }),
  );
}
