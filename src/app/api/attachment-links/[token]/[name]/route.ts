import { translate } from "@/lib/i18n";
import { errorResponse } from "@/server/auth/session";
import { requestLocale } from "@/server/i18n";
import { attachmentResponse } from "@/server/mail/attachment-response";
import { getAttachment } from "@/server/mail/service";
import { openAttachmentLink } from "@/server/mcp/attachment-links";

type Ctx = RouteContext<"/api/attachment-links/[token]/[name]">;

/** An agent's short-lived download link from get_attachment: no session, the signed link is the permission. */
export async function GET(req: Request, ctx: Ctx) {
  const locale = requestLocale(req);
  try {
    const target = await openAttachmentLink((await ctx.params).token);
    if (!target) {
      return Response.json({ error: translate(locale, "This download link has expired or isn't valid. Ask for the attachment again.") }, { status: 404 });
    }
    const file = await getAttachment(target.userId, target.messageId, target.attachmentId);
    return attachmentResponse(file, { download: true, cacheControl: "private, no-store" });
  } catch (err) {
    return errorResponse(err, locale);
  }
}
