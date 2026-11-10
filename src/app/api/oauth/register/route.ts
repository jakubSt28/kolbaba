import { json, OAuthError, oauthErrorResponse, preflight } from "@/server/mcp/config";
import { registerClient } from "@/server/mcp/oauth";
import { HttpError } from "@/server/http-error";
import { clientIp, limit, LIMITS } from "@/server/rate-limit";

/** RFC 7591 dynamic client registration. Open by design (MCP clients self-register), but rate limited per address. */
export async function POST(req: Request) {
  try {
    try {
      await limit(LIMITS.oauthRegister(clientIp(req)));
    } catch (err) {
      if (err instanceof HttpError && err.status === 429) return json({ error: "too_many_requests", error_description: err.message }, 429);
      throw err;
    }
    const text = await req.text();
    if (text.length > 16_384) throw new OAuthError("invalid_client_metadata", "Registration request too large");
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new OAuthError("invalid_client_metadata", "Expected a JSON body");
    }
    return json(await registerClient(body), 201);
  } catch (err) {
    return oauthErrorResponse(err);
  }
}

export const OPTIONS = preflight;
