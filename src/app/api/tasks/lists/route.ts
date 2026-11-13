import { readJson } from "@/server/auth/http";
import { withUser } from "@/server/auth/session";
import { createTaskList, ListBody } from "@/server/tasks";

/** A new list of tasks, or a folder for lists. */
export const POST = withUser(async (user, req) => Response.json(await createTaskList(user.id, await readJson(req, ListBody)), { status: 201 }));
