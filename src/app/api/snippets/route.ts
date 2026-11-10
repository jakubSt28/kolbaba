import { readJson } from "@/server/auth/http";
import { withUser } from "@/server/auth/session";
import { createSnippet, listSnippets, SnippetBody } from "@/server/mail/snippets";

export const GET = withUser(async (user) => Response.json(await listSnippets(user.id)));

export const POST = withUser(async (user, req) => Response.json(await createSnippet(user.id, await readJson(req, SnippetBody)), { status: 201 }));
