import type { OAuthMetadata, OAuthProtectedResourceMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import { BRAND } from "@/lib/brand";
import { issuer, mcpUrl, SCOPE } from "./config";

/** RFC 9728: tells MCP clients which authorization server protects /api/mcp. */
export function protectedResourceMetadata(): OAuthProtectedResourceMetadata {
  return {
    resource: mcpUrl(),
    authorization_servers: [issuer()],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: `${BRAND.name} mail`,
  };
}

/** RFC 8414 authorization server metadata. */
export function authorizationServerMetadata(): OAuthMetadata {
  const base = issuer();
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    scopes_supported: [SCOPE],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
  } as OAuthMetadata;
}
