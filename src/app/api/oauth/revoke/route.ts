import { json, oauthErrorResponse, preflight } from "@/server/mcp/config";
import { authenticateClient, readForm, revokeToken } from "@/server/mcp/oauth";

/** RFC 7009: 200 whether or not the token existed. */
export async function POST(req: Request) {
  try {
    const form = await readForm(req);
    const client = await authenticateClient(form, req.headers.get("authorization"));
    await revokeToken(client, form.get("token"));
    return json({});
  } catch (err) {
    return oauthErrorResponse(err);
  }
}

export const OPTIONS = preflight;
