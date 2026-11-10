import { HttpError } from "../http-error";

/**
 * Cheap CSRF guard for state-changing JSON endpoints: browsers always send Origin on cross-site
 * POSTs, and it must match the host we're serving. (JSON bodies also force a CORS preflight.)
 */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    // treated as a mismatch below
  }
  if (!host || originHost !== host) throw new HttpError(403, "Request blocked", "bad_origin");
}
