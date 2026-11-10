import type { AgentPermission } from "../db/schema";
import { env } from "../env";
import { logError } from "../log";

/**
 * Shared constants of the MCP server and its OAuth 2.1 authorization server. The app is both: it
 * issues tokens (issuer = app origin) and accepts them at one protected resource, `/api/mcp`.
 */

export const MCP_PATH = "/api/mcp";
export const SCOPE = "mail";

export const CODE_TTL_MS = 60_000;
export const ACCESS_TTL_MS = 3600_000;
export const REFRESH_TTL_MS = 60 * 24 * 3600_000;
/**
 * A refresh token presented again shortly after it was rotated is most likely a client retrying a
 * request whose response it lost (or two workers refreshing at once), not a stolen token.
 */
export const REFRESH_REUSE_GRACE_MS = 10_000;

export const issuer = () => env.appUrl;
export const mcpUrl = () => `${env.appUrl}${MCP_PATH}`;
export const resourceMetadataUrl = () => `${env.appUrl}/.well-known/oauth-protected-resource`;

const RANK: Record<AgentPermission, number> = { read: 0, draft: 1, full: 2 };
export const allows = (granted: AgentPermission, needed: AgentPermission) => RANK[granted] >= RANK[needed];

export const PERMISSION_LABELS: Record<AgentPermission, string> = {
  read: "Read only",
  draft: "Organize & draft",
  full: "Full access",
};

/** RFC 8707 resource indicators may come with or without a trailing slash. */
export function isOurResource(resource: string) {
  const strip = (s: string) => s.replace(/\/+$/, "");
  return strip(resource) === strip(mcpUrl());
}

/**
 * Discovery, registration, token and MCP endpoints are called from browser-based MCP clients
 * (MCP Inspector, claude.ai's web connector UI). Nothing here relies on cookies, so `*` is safe.
 */
export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "www-authenticate, mcp-session-id, mcp-protocol-version",
  "access-control-max-age": "86400",
};

export const preflight = () => new Response(null, { status: 204, headers: CORS_HEADERS });

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...CORS_HEADERS, "cache-control": "no-store", ...headers } });
}

/** RFC 6749 §5.2 error body. */
export class OAuthError extends Error {
  constructor(
    public error: string,
    description: string,
    public status = 400,
  ) {
    super(description);
  }
}

export function oauthErrorResponse(err: unknown) {
  if (err instanceof OAuthError) {
    const headers: Record<string, string> = err.status === 401 ? { "www-authenticate": 'Basic realm="oauth"' } : {};
    return json({ error: err.error, error_description: err.message }, err.status, headers);
  }
  logError("[oauth]", err);
  return json({ error: "server_error", error_description: "Something went wrong on our side" }, 500);
}
