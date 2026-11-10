import { translate } from "@/lib/i18n";
import { withUser } from "@/server/auth/session";
import { requestLocale } from "@/server/i18n";
import { attachmentResponse } from "@/server/mail/attachment-response";
import { getAttachment } from "@/server/mail/service";

type Ctx = RouteContext<"/api/attachments/[messageId]/[attachmentId]">;

export const GET = withUser<Ctx>(async (user, req, ctx) => {
  const { messageId, attachmentId } = await ctx.params;
  let id: string;
  try {
    id = decodeURIComponent(attachmentId);
  } catch {
    return Response.json({ error: translate(requestLocale(req), "Attachment not found") }, { status: 404 });
  }
  const file = await getAttachment(user.id, messageId, id);
  return attachmentResponse(file, {
    download: new URL(req.url).searchParams.has("download"),
    // Short, and cleared on sign-out (Clear-Site-Data): a shared device mustn't keep attachments around.
    cacheControl: "private, max-age=3600",
  });
});
