import "server-only";
import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import { CHALLENGE_TTL_MS } from "./challenges";
import { pathCookie, SECURE_COOKIES } from "./cookie-name";
import { assertJson } from "../api/validate";
import { requestLocale } from "../i18n";
import { errorResponse, HttpError } from "./session";

export { assertSameOrigin } from "./origin";

/** One cookie per flow, so a background passkey autofill doesn't clobber a Google round trip. */
export const FLOW_COOKIES = {
  passkeyRegister: pathCookie("kolbaba_wa_reg"),
  passkeyLogin: pathCookie("kolbaba_wa_login"),
  google: pathCookie("kolbaba_oauth_state"),
  /** Signing in or up with a code by email: the code this browser asked for (and later proved). */
  emailCode: pathCookie("kolbaba_email_code"),
  /** "Confirm it's you" with a code by email (before deleting the account). */
  confirmCode: pathCookie("kolbaba_confirm_code"),
};
type FlowCookie = (typeof FLOW_COOKIES)[keyof typeof FLOW_COOKIES];

export async function setFlowCookie(name: FlowCookie, token: string, ttlMs = CHALLENGE_TTL_MS) {
  (await cookies()).set(name, token, {
    httpOnly: true,
    secure: SECURE_COOKIES,
    // Lax so the cookie survives the top-level redirect back from Google.
    sameSite: "lax",
    path: "/api/auth",
    maxAge: Math.floor(ttlMs / 1000),
  });
}

/** Reads a flow cookie without clearing it (a code that can be checked again). */
export async function readFlowCookie(name: FlowCookie) {
  return (await cookies()).get(name)?.value;
}

export async function clearFlowCookie(name: FlowCookie) {
  (await cookies()).set(name, "", { path: "/api/auth", maxAge: 0, secure: SECURE_COOKIES });
}

/** Reads and clears a flow cookie: challenges are single use either way. */
export async function takeFlowCookie(name: FlowCookie) {
  const jar = await cookies();
  const value = jar.get(name)?.value;
  if (value) jar.set(name, "", { path: "/api/auth", maxAge: 0, secure: SECURE_COOKIES });
  return value;
}


export async function readJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S>> {
  assertJson(req);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "Invalid request", "bad_request");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // Our schemas' own messages are marked with tk(), so errorResponse can translate them.
    const issue = parsed.error.issues[0];
    throw new HttpError(400, issue?.message ?? "Invalid request", "bad_request");
  }
  return parsed.data;
}

/** Route handler wrapper: HttpError → JSON error, anything else → logged 500. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (err) {
      unstable_rethrow(err);
      // Next passes the request first.
      return errorResponse(err, args[0] instanceof Request ? requestLocale(args[0]) : "en");
    }
  };
}

export function userAgent(req: Request) {
  return req.headers.get("user-agent");
}
