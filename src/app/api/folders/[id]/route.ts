import { z } from "zod";
import { readJson } from "@/server/auth/http";
import { withUser } from "@/server/auth/session";
import { deleteFolder, MAX_FOLDER_NAME, updateFolder } from "@/server/mail/folders";

type Ctx = { params: Promise<{ id: string }> };

const Patch = z.object({
  name: z.string().max(MAX_FOLDER_NAME * 2).optional(),
  hue: z.number().int().min(0).max(360).optional(),
});

export const PATCH = withUser<Ctx>(async (user, req, ctx) => Response.json(await updateFolder(user.id, (await ctx.params).id, await readJson(req, Patch))));

/** The folder goes; what's in it goes to Archive, nothing is deleted. */
export const DELETE = withUser<Ctx>(async (user, _req, ctx) => {
  await deleteFolder(user.id, (await ctx.params).id);
  return Response.json({ ok: true });
});
