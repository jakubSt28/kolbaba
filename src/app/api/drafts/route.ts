import { withUser } from "@/server/auth/session";
import { DraftBody } from "@/server/api/schemas";
import { parseBody } from "@/server/api/validate";
import { listDrafts, saveDraft } from "@/server/mail/service";

export const GET = withUser(async (user) => Response.json(await listDrafts(user.id)));

export const POST = withUser(async (user, req) => Response.json(await saveDraft(user.id, await parseBody(req, DraftBody), { byUser: true })));
