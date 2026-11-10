import { withUser } from "@/server/auth/session";
import { activityFor } from "@/server/mcp/activity";

/** Connected agents and the last two weeks of their activity, in the client store's shapes. */
export const GET = withUser(async (user) => Response.json(await activityFor(user.id)));
