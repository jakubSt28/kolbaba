import { withUser } from "@/server/auth/session";
import { inviteEventFile } from "@/server/mail/invites";

type Ctx = { params: Promise<{ id: string }> };

/** "Add to calendar": the invitation's event as an .ics file (opens in Calendar on iPhone and Mac). */
export const GET = withUser<Ctx>(async (user, _req, ctx) => {
  const { name, content } = await inviteEventFile(user.id, (await ctx.params).id);
  return new Response(content, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `inline; filename="event.ics"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "private, no-store",
    },
  });
});
