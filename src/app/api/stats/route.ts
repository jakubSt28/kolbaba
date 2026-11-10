import { withUser } from "@/server/auth/session";
import { userStats } from "@/server/stats";

/** Kolbaba's counters (src/server/stats.ts). */
export const GET = withUser(async (user) => Response.json(await userStats(user.id)));
