import type { z } from "zod";
import { HttpError } from "../http-error";

/** Parse a JSON body against a zod schema; a bad body is the client's bug, so the message stays generic. */
export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  assertJson(req);
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "Invalid request", "bad_json");
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw new HttpError(400, "Invalid request", "bad_request");
  return result.data;
}

/**
 * JSON only: a cross-site page can POST text/plain without a CORS preflight, and req.json() would
 * happily parse it. Requiring application/json forces the preflight that blocks it.
 */
export function assertJson(req: Request) {
  if (!req.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "Invalid request", "bad_content_type");
  }
}
