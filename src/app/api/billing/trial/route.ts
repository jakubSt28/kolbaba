import { withUser } from "@/server/auth/session";
import { startTrial } from "@/server/plus";

/** Start the 14 days of Plus (once). Turning on a Plus feature does the same. */
export const POST = withUser(async (user) => Response.json({ plus: await startTrial(user.id) }));
