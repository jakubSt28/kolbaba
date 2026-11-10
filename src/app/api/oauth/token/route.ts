import { json, OAuthError, oauthErrorResponse, preflight } from "@/server/mcp/config";
import { authenticateClient, exchangeCode, readForm, refresh } from "@/server/mcp/oauth";

export async function POST(req: Request) {
  try {
    const form = await readForm(req);
    const client = await authenticateClient(form, req.headers.get("authorization"));
    const grant = form.get("grant_type");
    if (grant === "authorization_code") return json(await exchangeCode(client, form));
    if (grant === "refresh_token") return json(await refresh(client, form));
    throw new OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token");
  } catch (err) {
    return oauthErrorResponse(err);
  }
}

export const OPTIONS = preflight;
