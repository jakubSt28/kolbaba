import { deletePasskey } from "@/server/auth/devices";
import { withUser } from "@/server/auth/session";

/** Remove a passkey (not the account's last way in). Password managers keep their copy until the user deletes it there. */
export const DELETE = withUser<{ params: Promise<{ id: string }> }>(async (user, _req, ctx) => {
  await deletePasskey(user.id, decodeURIComponent((await ctx.params).id));
  return Response.json({ ok: true });
});
