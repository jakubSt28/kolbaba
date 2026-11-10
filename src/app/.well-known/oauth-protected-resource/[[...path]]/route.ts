import { connection } from "next/server";
import { json, preflight } from "@/server/mcp/config";
import { protectedResourceMetadata } from "@/server/mcp/metadata";

/**
 * Served at the root and at the path-suffixed form (`/.well-known/oauth-protected-resource/api/mcp`),
 * which RFC 9728-aware clients try first. Request-time so APP_URL is read at runtime, not at build.
 */
export async function GET() {
  await connection();
  return json(protectedResourceMetadata(), 200, { "cache-control": "public, max-age=3600" });
}

export const OPTIONS = preflight;
