import { connection } from "next/server";
import { json, preflight } from "@/server/mcp/config";
import { authorizationServerMetadata } from "@/server/mcp/metadata";

/** RFC 8414 metadata; the optional suffix covers clients that append the resource path. */
export async function GET() {
  await connection();
  return json(authorizationServerMetadata(), 200, { "cache-control": "public, max-age=3600" });
}

export const OPTIONS = preflight;
