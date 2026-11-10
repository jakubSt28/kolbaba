import { cookies } from "next/headers";
import { z } from "zod";
import { translate } from "@/lib/i18n";
import { assertSameOrigin, handle, readJson } from "@/server/auth/http";
import { assertRecentlyReauthenticated } from "@/server/auth/devices";
import { clearSessionCookies, currentSessionId, getUser, HttpError, withUser } from "@/server/auth/session";
import { deleteUser, normalizeEmail } from "@/server/auth/users";
import { cancelOnAccountDelete } from "@/server/billing";
import { requestLocale } from "@/server/i18n";
import { nudgeWorker } from "@/server/worker-client";

/** The signed-in user, or 401. A stale session cookie is cleared so the proxy stops letting it through. */
export const GET = handle(async (req: Request) => {
  const user = await getUser();
  if (!user) {
    clearSessionCookies(await cookies());
    return Response.json(
      { error: translate(requestLocale(req), "Sign in to continue"), code: "unauthenticated" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json({ user }, { headers: { "Cache-Control": "private, no-store" } });
});

const Confirm = z.object({ confirm: z.string().max(320) });

/**
 * Delete the account. The user types their email address to confirm, and an account with a passkey must
 * have confirmed it's them with it in the last few minutes (a borrowed unlocked phone isn't enough).
 */
export const DELETE = withUser(async (user, req) => {
  assertSameOrigin(req);
  const { confirm } = await readJson(req, Confirm);
  if (normalizeEmail(confirm) !== user.email) throw new HttpError(400, "Type your email address exactly to confirm", "confirm_mismatch");
  await assertRecentlyReauthenticated(user.id, await currentSessionId());
  await cancelOnAccountDelete(user.id);
  const mailboxes = await deleteUser(user.id);
  await Promise.all(mailboxes.map((accountId) => nudgeWorker({ kind: "account-removed", accountId })));
  clearSessionCookies(await cookies());
  return Response.json({ ok: true });
});
