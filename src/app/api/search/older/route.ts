import { z } from "zod";
import { readJson } from "@/server/auth/http";
import { withUser } from "@/server/auth/session";
import { limit, LIMITS } from "@/server/rate-limit";
import { searchOlderMail } from "@/server/sync/search-older";

export const maxDuration = 60;

const Body = z.object({ query: z.string().trim().min(1).max(200), scope: z.string().max(64).default("all") });

/** "Search older mail too": what the providers have that isn't here yet comes in. */
export const POST = withUser(async (user, req) => {
  const { query, scope } = await readJson(req, Body);
  await limit(LIMITS.searchOlder(user.id));
  return Response.json(await searchOlderMail(user.id, query, scope));
});
