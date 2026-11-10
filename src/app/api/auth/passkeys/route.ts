import { listPasskeys } from "@/server/auth/devices";
import { withUser } from "@/server/auth/session";

export const GET = withUser(async (user) => Response.json({ passkeys: await listPasskeys(user.id) }));
