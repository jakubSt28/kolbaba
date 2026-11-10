import { withUser } from "@/server/auth/session";
import { parseBody } from "@/server/api/validate";
import { recordUsage, UsageBody } from "@/server/usage";

/** A batch of feature counts from the app (src/lib/usage.ts). */
export const POST = withUser(async (user, req) => {
  const { counts } = await parseBody(req, UsageBody);
  await recordUsage(user.id, counts);
  return Response.json({ ok: true });
});
