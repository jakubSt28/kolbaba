import {
  sendSignal,
  startAuthentication,
  startRegistration,
  WebAuthnAbortService,
  WebAuthnError,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { BRAND } from "@/lib/brand";
import { tk, translate, type Locale } from "@/lib/i18n";
import { disablePush } from "@/lib/push-client";

/** Error from our auth API, carrying the server's machine-readable `code`. The server's message is already translated. */
export class AuthApiError extends Error {
  constructor(
    message: string,
    public code: string | undefined,
    public status: number,
  ) {
    super(message);
  }
}

async function post<T>(url: string, body: unknown = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthApiError(tk("You seem to be offline. Check your connection and try again."), "offline", 0);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new AuthApiError(data.error ?? tk("Something went wrong on our side"), data.code, res.status);
  return data as T;
}

type SignedIn = { user: { id: string; email: string; name: string }; redirectTo: string };

/**
 * Sign in with a discoverable passkey. With `autofill`, this waits quietly for the user to pick a
 * passkey from the browser's autofill on an `autocomplete="… webauthn"` field (conditional UI).
 */
export async function signInWithPasskey({ autofill = false, next }: { autofill?: boolean; next?: string } = {}) {
  const { options } = await post<{ options: PublicKeyCredentialRequestOptionsJSON }>("/api/auth/passkey/login/options");
  const response = await startAuthentication({ optionsJSON: options, useBrowserAutofill: autofill });
  try {
    return await post<SignedIn>("/api/auth/passkey/login/verify", { response, next });
  } catch (err) {
    // The passkey was deleted on our side: ask the password manager to forget it too.
    if (err instanceof AuthApiError && err.code === "unknown_credential" && options.rpId) {
      sendSignal({ signalName: "unknownCredential", rpID: options.rpId, credentialID: response.id }).catch(() => {});
    }
    throw err;
  }
}

/** "Continue with email": a 6-digit code goes to the address, for signing in and signing up alike. */
export async function sendEmailCode(email: string) {
  await post("/api/auth/email/code", { email });
}

/** The code from the email: signed in, or (a new address) on to creating the account. */
export async function verifyEmailCode(code: string, next?: string) {
  return post<SignedIn | { newAccount: true }>("/api/auth/email/verify", { code, next });
}

/** A new address, proved with its code: the account with this name, signed in. */
export async function createAccount(name: string, next?: string) {
  return post<SignedIn>("/api/auth/email/create", { name, next });
}

/** The link from `kolbaba-link` on a self-hosted server: what it's for (`peek`), or use it (src/server/auth/setup-link.ts). */
export function setupLink(body: { token: string; peek: true }): Promise<{ mode: "new" } | { mode: "sign-in"; email: string }>;
export function setupLink(body: { token: string; details?: { name: string; email: string } }): Promise<{ hasPasskey: boolean }>;
export function setupLink(body: object): Promise<unknown> {
  return post("/api/auth/setup", body);
}

/** "Add passkey" from inside the app (requires a session). */
export async function addPasskey() {
  const { options } = await post<{ options: PublicKeyCredentialCreationOptionsJSON }>("/api/auth/passkey/add/options");
  const response = await startRegistration({ optionsJSON: options });
  return post<{ passkey: { id: string; label: string; createdAt: string } }>("/api/auth/passkey/add/verify", { response });
}

/** "Confirm it's you" with one of this account's passkeys (before deleting the account). */
export async function confirmWithPasskey() {
  const { options } = await post<{ options: PublicKeyCredentialRequestOptionsJSON }>("/api/auth/reauth/options");
  const response = await startAuthentication({ optionsJSON: options });
  await post("/api/auth/reauth/verify", { response });
}

/** "Confirm it's you" with a code to the account's address, then the code typed back. */
export async function sendConfirmCode() {
  await post("/api/auth/reauth/code");
}

export async function confirmWithCode(code: string) {
  await post("/api/auth/reauth/code/verify", { code });
}

export async function signOut() {
  // A signed-out device must stop getting this account's mail notifications (shared iPads, work PCs).
  await disablePush().catch(() => {});
  await post("/api/auth/logout");
}

export function cancelPasskeyPrompt() {
  WebAuthnAbortService.cancelCeremony();
}

export type Notice = { tone: "calm" | "warn" | "error"; message: string; code?: string };

/** Turns any failure into something calm and human, in `locale`. `null` = nothing worth showing. */
export function describeError(locale: Locale, err: unknown): Notice | null {
  if (err instanceof WebAuthnError || (err instanceof Error && ["NotAllowedError", "AbortError"].includes(err.name))) {
    const code = err instanceof WebAuthnError ? err.code : undefined;
    // We aborted it ourselves (e.g. switched modes): not the user's problem.
    if (code === "ERROR_CEREMONY_ABORTED" || err.name === "AbortError") return null;
    if (code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
      return { tone: "calm", message: translate(locale, "This device already has a passkey for {app}. Sign in with it instead.", { app: BRAND.name }) };
    }
    if (code === "ERROR_INVALID_DOMAIN" || code === "ERROR_INVALID_RP_ID") {
      return { tone: "error", message: translate(locale, "Passkeys don't work on this address. Open the app on its usual domain.") };
    }
    if (err.name === "NotAllowedError" || (err.cause as Error | undefined)?.name === "NotAllowedError") {
      return { tone: "calm", message: translate(locale, "No worries. Try again whenever you're ready."), code: "cancelled" };
    }
    return { tone: "error", message: translate(locale, "Your device couldn't finish that. Please try again.") };
  }
  if (err instanceof AuthApiError) {
    // The server's messages arrive translated; this catches our own (offline, no answer).
    const message = translate(locale, err.message);
    switch (err.code) {
      case "invite_only":
      case "rate_limited":
        return { tone: "warn", message, code: err.code };
      case "account_exists":
      case "challenge_expired":
      case "code_expired":
      case "email_unconfirmed":
        return { tone: "calm", message, code: err.code };
      default:
        return { tone: "error", message, code: err.code };
    }
  }
  return { tone: "error", message: translate(locale, "Something went wrong. Please try again.") };
}

/** Messages for `/login?error=…` after a Google round trip, in `locale`. */
export function describeRedirectError(locale: Locale, code: string): Notice {
  switch (code) {
    case "google_cancelled":
      return { tone: "calm", message: translate(locale, "Google sign-in was cancelled. Try again whenever you're ready."), code };
    case "invite_only":
      return { tone: "warn", message: translate(locale, "{app} is invite-only for now", { app: BRAND.name }), code };
    case "email_unverified":
      return { tone: "warn", message: translate(locale, "Your Google account's email address isn't verified yet."), code };
    case "identity_taken":
      return { tone: "warn", message: translate(locale, "That Google account is already connected to another {app} account.", { app: BRAND.name }), code };
    case "challenge_expired":
      return { tone: "calm", message: translate(locale, "That sign-in took a little too long. Please try again."), code };
    case "google_unavailable":
      return { tone: "error", message: translate(locale, "Google sign-in isn't available right now."), code };
    case "rate_limited":
      return { tone: "warn", message: translate(locale, "Too many sign-in attempts from this network. Try again in a few minutes."), code };
    default:
      return { tone: "error", message: translate(locale, "Google sign-in didn't go through. Please try again."), code };
  }
}
