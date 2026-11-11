import { and, eq, inArray } from "drizzle-orm";
import type { Agent } from "@/lib/types";
import { db, schema } from "../db";
import type { AgentPermission } from "../db/schema";
import { HttpError } from "../http-error";
import { agentDto } from "./activity";

/** Pause/resume, change the access level, the mailboxes it sees or whether it may use the calendar. Takes effect on the agent's very next tool call. */
export async function updateAgent(userId: string, agentId: string, patch: { enabled?: boolean; permission?: AgentPermission; accountIds?: string[]; calendar?: boolean }): Promise<Agent> {
  const { accountIds, ...rest } = patch;
  const set: Partial<typeof schema.agents.$inferInsert> = { ...rest };
  if (accountIds) set.accountIds = await ownMailboxes(userId, accountIds);
  const [row] = await db()
    .update(schema.agents)
    .set(set)
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.userId, userId)))
    .returning();
  if (!row) throw new HttpError(404, "That agent is no longer connected", "not_found");
  return agentDto(row);
}

/** Only the user's own mailboxes, in their order; anything else is dropped. */
export async function ownMailboxes(userId: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = await db()
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(and(eq(schema.accounts.userId, userId), inArray(schema.accounts.id, ids)));
  return ids.filter((id) => rows.some((r) => r.id === id));
}

/**
 * Disconnect for good: the grant goes, and with it (FK cascade) its tokens, codes and activity
 * history. The client can connect again, which starts a fresh grant through the consent screen.
 */
export async function removeAgent(userId: string, agentId: string) {
  const [row] = await db()
    .delete(schema.agents)
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.userId, userId)))
    .returning({ id: schema.agents.id });
  if (!row) throw new HttpError(404, "That agent is no longer connected", "not_found");
}
