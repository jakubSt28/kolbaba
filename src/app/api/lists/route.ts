import { withUser } from "@/server/auth/session";
import { listNewsletters } from "@/server/mail/lists";

/** Newsletters: who sends them, how many, and how much gets read (the last three months). */
export const GET = withUser(async (user) => Response.json(await listNewsletters(user.id)));
