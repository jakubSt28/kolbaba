import { withUser } from "@/server/auth/session";
import { HttpError } from "@/server/http-error";
import { withAdapter } from "@/server/mail/adapters";
import { cleanSignatureHtml } from "@/server/mail/email-html";
import { ownedAccount } from "@/server/mail/service";

type Ctx = RouteContext<"/api/accounts/[id]/signature">;

/** The signature this mailbox has at its provider (Gmail), to bring over in Settings. Not saved here until the user keeps it. */
export const GET = withUser<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  const account = await ownedAccount(user.id, id);
  if (account.provider !== "gmail") throw new HttpError(400, "Only Gmail keeps a signature Kolbaba can read", "no_provider_signature");
  const html = await withAdapter(account, (adapter) => (adapter.signature ? adapter.signature() : Promise.resolve(null)));
  return Response.json({ html: html ? cleanSignatureHtml(html) : "" });
});
