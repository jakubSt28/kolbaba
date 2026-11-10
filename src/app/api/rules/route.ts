import { z } from "zod";
import { withUser } from "@/server/auth/session";
import { parseBody } from "@/server/api/validate";
import { RuleBody } from "@/server/api/schemas";
import { createRule, listRules } from "@/server/mail/rules";

/** Applying a new rule to what's in Inbox already can move a few hundred conversations. */
export const maxDuration = 300;

export const GET = withUser(async (user) => Response.json(await listRules(user.id)));

/** `applyNow`: what's in Inbox already goes too. */
export const POST = withUser(async (user, req) => {
  const body = await parseBody(req, RuleBody.extend({ applyNow: z.boolean().optional() }));
  const { applyNow, ...input } = body;
  return Response.json(await createRule(user.id, input, { applyNow }));
});
