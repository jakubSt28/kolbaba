import { BUILD_ID } from "@/lib/build";
import { withUser } from "@/server/auth/session";
import { checkForUpdate } from "@/server/selfhost-update";

/** Settings on a self-hosted copy: the version running here and a newer one, if any. */
export const GET = withUser(async () => Response.json({ current: BUILD_ID, latest: await checkForUpdate(BUILD_ID) }));
