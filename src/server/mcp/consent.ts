import { tk } from "@/lib/i18n";
import type { AgentPermission } from "../db/schema";
import { ownMailboxes } from "./agents";
import { approve, checkAuthorizeRequest, denyRedirect, verifyConsentToken } from "./oauth";

/** Authorize-request fields the consent form carries through unchanged. */
export const PASSTHROUGH = ["client_id", "redirect_uri", "response_type", "state", "code_challenge", "code_challenge_method", "resource", "scope"] as const;

/** `message` is English, marked with tk(): the route translates it. */
type Outcome = { ok: true; redirect: string } | { ok: false; status: number; message: string };

/**
 * Apply the user's answer on the consent screen. Everything is re-validated from scratch: the form
 * is just a carrier, and the HMAC token ties it to this user and this exact request.
 */
export async function applyConsent(userId: string | null, form: FormData): Promise<Outcome> {
  if (!userId) return { ok: false, status: 401, message: tk("Your session ended. Sign in and try connecting again.") };
  const fields: Record<string, string> = {};
  for (const key of PASSTHROUGH) {
    const v = form.get(key);
    if (typeof v === "string" && v) fields[key] = v;
  }
  const check = await checkAuthorizeRequest(fields);
  if (check.kind === "fatal") return { ok: false, status: 400, message: check.message };
  if (check.kind === "client_error") return { ok: true, redirect: check.redirect };

  const token = form.get("consent");
  if (!verifyConsentToken(typeof token === "string" ? token : null, userId, check.params)) {
    return { ok: false, status: 403, message: tk("This page expired. Go back to the app and connect again.") };
  }
  if (form.get("decision") !== "allow") return { ok: true, redirect: denyRedirect(check.params) };

  const permission = (["read", "draft", "full"] as const).find((p) => p === form.get("permission")) ?? "draft";
  // The spec's "user confirms they understand the risks" for sending.
  if (permission === "full" && form.get("understand") !== "1") {
    return { ok: false, status: 400, message: tk("Confirm that you understand the risks of Full access, or pick a lower level.") };
  }

  // This agent's own mailboxes: other agents keep theirs.
  const accountIds = await ownMailboxes(userId, form.getAll("mailbox").filter((v): v is string => typeof v === "string"));
  const { redirect } = await approve(userId, check.client, check.params, permission as AgentPermission, accountIds);
  return { ok: true, redirect };
}
