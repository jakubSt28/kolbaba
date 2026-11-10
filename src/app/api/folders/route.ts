import { z } from "zod";
import { readJson } from "@/server/auth/http";
import { withUser } from "@/server/auth/session";
import { createFolder, listFolders, MAX_FOLDER_NAME } from "@/server/mail/folders";

const FolderBody = z.object({
  name: z.string().max(MAX_FOLDER_NAME * 2),
  hue: z.number().int().min(0).max(360).optional(),
  /** Made while that mailbox is picked: created at its provider right away. */
  accountId: z.string().max(64).optional(),
});

export const GET = withUser(async (user) => Response.json(await listFolders(user.id)));

export const POST = withUser(async (user, req) => Response.json(await createFolder(user.id, await readJson(req, FolderBody)), { status: 201 }));
