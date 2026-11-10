import { translate } from "@/lib/i18n";
import { assertSameOrigin } from "@/server/auth/http";
import { errorResponse, getUser } from "@/server/auth/session";
import { requestLocale } from "@/server/i18n";
import { applyConsent } from "@/server/mcp/consent";

/**
 * The consent screen's Allow / Cancel. Works as a plain form post (303 to the client) and, from the
 * page's script, as fetch with `Accept: application/json` → `{ redirect }`, so the page can show
 * "Connected" before handing over (custom-scheme redirects like cursor:// leave the tab open).
 */
export async function POST(req: Request) {
  const locale = requestLocale(req);
  try {
    assertSameOrigin(req);
    const user = await getUser();
    const form = await req.formData();
    const result = await applyConsent(user?.id ?? null, form);
    const message = result.ok ? "" : translate(locale, result.message);
    if (req.headers.get("accept")?.includes("application/json")) {
      return Response.json(result.ok ? { redirect: result.redirect } : { error: message }, { status: result.ok ? 200 : result.status, headers: { "cache-control": "no-store" } });
    }
    if (!result.ok) return new Response(message, { status: result.status, headers: { "content-type": "text/plain; charset=utf-8" } });
    return new Response(null, { status: 303, headers: { location: result.redirect, "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err, locale);
  }
}
