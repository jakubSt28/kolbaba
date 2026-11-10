import { assertSameOrigin } from "@/server/auth/http";
import { listSessions, revokeOtherSessions } from "@/server/auth/devices";
import { currentSessionId, withUser } from "@/server/auth/session";

/** Where this account is signed in. */
export const GET = withUser(async (user) => Response.json({ sessions: await listSessions(user.id, await currentSessionId()) }));

/** Sign out everywhere else. */
export const DELETE = withUser(async (user, req) => {
  assertSameOrigin(req);
  return Response.json({ ended: await revokeOtherSessions(user.id, await currentSessionId()) });
});
