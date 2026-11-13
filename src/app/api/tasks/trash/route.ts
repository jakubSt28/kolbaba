import { withUser } from "@/server/auth/session";
import { emptyTrash } from "@/server/tasks";

/** Empty Trash: its tasks are gone for good. */
export const DELETE = withUser(async (user) => {
  await emptyTrash(user.id);
  return Response.json({ ok: true });
});
