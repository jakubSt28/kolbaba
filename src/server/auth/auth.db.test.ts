import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { eq, like } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, schema } from "../db";
import { consumeChallenge, createChallenge } from "./challenges";
import { finishAddPasskey, finishPasskeyLogin, startAddPasskey, startPasskeyLogin } from "./passkeys";
import { HttpError } from "./session";
import { createUser, findOrCreateUser, linkIdentity, resolveIdentityUser } from "./users";

vi.mock("@simplewebauthn/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@simplewebauthn/server")>()),
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));
const webauthn = await import("@simplewebauthn/server");
const verifyRegistration = vi.mocked(webauthn.verifyRegistrationResponse);
const verifyAuthentication = vi.mocked(webauthn.verifyAuthenticationResponse);

/** Every row these tests create hangs off users with this domain (or challenges with this prefix). */
const DOMAIN = "auth-test.invalid";
const CHALLENGE_PREFIX = "test-challenge-";
let seq = 0;
const email = (label: string) => `${label}-${Date.now()}-${seq++}@${DOMAIN}`;
const rp = { id: "localhost", name: "Kolbaba", origin: "http://localhost:3000" };

async function cleanup() {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
  await db().delete(schema.authChallenges).where(like(schema.authChallenges.challenge, `${CHALLENGE_PREFIX}%`));
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return err instanceof HttpError ? err.code : String(err);
  }
  return "resolved";
};

beforeEach(() => {
  delete process.env.SIGNUP_ALLOWLIST;
});
afterEach(() => vi.clearAllMocks());
afterAll(cleanup);

describe("challenges", () => {
  it("can be used exactly once", async () => {
    const token = await createChallenge({ kind: "passkey-login", challenge: `${CHALLENGE_PREFIX}once` });
    expect((await consumeChallenge(token, "passkey-login"))?.challenge).toBe(`${CHALLENGE_PREFIX}once`);
    expect(await consumeChallenge(token, "passkey-login")).toBeNull();
  });

  it("expire after their TTL", async () => {
    const token = await createChallenge({ kind: "passkey-login", challenge: `${CHALLENGE_PREFIX}old`, ttlMs: 5 * 60_000 });
    expect(await consumeChallenge(token, "passkey-login", new Date(Date.now() + 5 * 60_000 + 1))).toBeNull();
    // ...and the expired row is gone, not left for a later retry.
    expect(await consumeChallenge(token, "passkey-login")).toBeNull();
  });

  it("only match their own kind, and only by token", async () => {
    const token = await createChallenge({ kind: "passkey-register", challenge: `${CHALLENGE_PREFIX}kind`, data: { a: 1 } });
    expect(await consumeChallenge(token, "passkey-login")).toBeNull();
    expect(await consumeChallenge("not-the-token", "passkey-register")).toBeNull();
    expect(await consumeChallenge(undefined, "passkey-register")).toBeNull();
    expect(await consumeChallenge(token, "passkey-register")).toMatchObject({ data: { a: 1 } });
  });

  it("store only a hash of the token", async () => {
    const token = await createChallenge({ kind: "passkey-login", challenge: `${CHALLENGE_PREFIX}hash` });
    const rows = await db().select().from(schema.authChallenges).where(eq(schema.authChallenges.challenge, `${CHALLENGE_PREFIX}hash`));
    expect(rows[0].id).not.toBe(token);
  });
});

describe("users", () => {
  it("enforces the allowlist with a friendly message", async () => {
    const err = await createUser({ email: email("blocked") }, ["someone-else@example.com"]).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 403, code: "invite_only", message: "Kolbaba is invite-only for now" });
  });

  it("findOrCreateUser normalises the email and is idempotent", async () => {
    const address = email("Mixed");
    const first = await findOrCreateUser({ email: ` ${address.toUpperCase()} `, name: "Mixed Case" });
    expect(first.created).toBe(true);
    expect(first.user.email).toBe(address.toLowerCase());
    const second = await findOrCreateUser({ email: address });
    expect(second).toEqual({ user: first.user, created: false });
  });

  it("findOrCreateUser lets existing users in even when the allowlist would block a new one", async () => {
    const { user } = await findOrCreateUser({ email: email("existing") });
    expect((await findOrCreateUser({ email: user.email }, ["nobody@example.com"])).user.id).toBe(user.id);
  });
});

describe("Google identity linking", () => {
  const identity = (address: string, subject = `sub-${seq++}`, emailVerified = true) => ({
    provider: "google" as const,
    subject,
    email: address,
    emailVerified,
    name: "Google Person",
    avatarUrl: "https://example.com/a.png",
  });

  it("creates a user on first sign-in, then finds them by subject", async () => {
    const id = identity(email("new"));
    const first = await resolveIdentityUser(id);
    expect(first.outcome).toBe("created");
    expect(first.user).toMatchObject({ email: id.email, name: "Google Person", avatarUrl: "https://example.com/a.png" });
    // Even if they later change their Google address, the subject still identifies them.
    const again = await resolveIdentityUser({ ...id, email: email("renamed") });
    expect(again).toMatchObject({ outcome: "signed-in", user: { id: first.user.id } });
  });

  it("links to an existing user whose email is already verified", async () => {
    const address = email("verified");
    const { user } = await resolveIdentityUser(identity(address));
    const other = await resolveIdentityUser(identity(address, `another-${seq++}`));
    expect(other).toMatchObject({ outcome: "linked", user: { id: user.id } });
  });

  it("links Google to the account made with a code for the same address (every address is proved)", async () => {
    const user = await createUser({ email: email("code-account") });
    await db().insert(schema.passkeys).values({ id: `cred-${seq++}`, userId: user.id, publicKey: "AA" });
    expect(await resolveIdentityUser(identity(user.email))).toMatchObject({ outcome: "linked", user: { id: user.id } });
    // From inside the app (signed in), linking another Google account is explicit and fine.
    await linkIdentity(user.id, identity(user.email, "explicit-link"));
    expect(await resolveIdentityUser(identity(user.email, "explicit-link"))).toMatchObject({ outcome: "signed-in", user: { id: user.id } });
  });

  it("refuses unverified Google emails and respects the allowlist", async () => {
    expect(await code(resolveIdentityUser(identity(email("unverified"), undefined, false)))).toBe("email_unverified");
    expect(await code(resolveIdentityUser(identity(email("blocked")), ["x@example.com"]))).toBe("invite_only");
  });

  it("won't move a Google identity between accounts", async () => {
    const a = await createUser({ email: email("a") });
    const b = await createUser({ email: email("b") });
    const id = identity(a.email, `shared-${seq++}`);
    await linkIdentity(a.id, id);
    await linkIdentity(a.id, id); // idempotent
    expect(await code(linkIdentity(b.id, id))).toBe("identity_taken");
  });
});

describe("passkey flows", () => {
  const regResponse = { id: "ignored", response: { transports: ["internal", "hybrid"] } } as unknown as RegistrationResponseJSON;
  const verified = (credentialId: string) =>
    ({
      verified: true,
      registrationInfo: {
        credential: { id: credentialId, publicKey: new Uint8Array([1, 2, 3, 4]), counter: 0, transports: ["internal"] },
        credentialDeviceType: "multiDevice",
        credentialBackedUp: true,
      },
    }) as unknown as Awaited<ReturnType<typeof webauthn.verifyRegistrationResponse>>;
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)";

  it("signs in with a discoverable credential and updates the counter", async () => {
    const user = await createUser({ email: email("login") });
    const credentialId = `cred-login-${seq++}`;
    await db().insert(schema.passkeys).values({ id: credentialId, userId: user.id, publicKey: "AQIDBA", counter: 3 });
    const authResponse = (handle: string) =>
      ({ id: credentialId, response: { userHandle: Buffer.from(handle).toString("base64url") } }) as unknown as AuthenticationResponseJSON;

    const { options, token } = await startPasskeyLogin(rp);
    expect(options.allowCredentials ?? []).toHaveLength(0);
    verifyAuthentication.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 7, credentialBackedUp: true, credentialDeviceType: "multiDevice" },
    } as unknown as Awaited<ReturnType<typeof webauthn.verifyAuthenticationResponse>>);

    expect(await finishPasskeyLogin({ token, response: authResponse(user.id), rp })).toMatchObject({ id: user.id });
    const call = verifyAuthentication.mock.calls[0][0];
    expect(call).toMatchObject({ expectedChallenge: options.challenge, credential: { id: credentialId, counter: 3 } });
    expect([...call.credential.publicKey]).toEqual([1, 2, 3, 4]);
    const [row] = await db().select().from(schema.passkeys).where(eq(schema.passkeys.id, credentialId));
    expect(row.counter).toBe(7);
    expect(row.lastUsedAt).toBeInstanceOf(Date);

    // Replay with the same challenge cookie fails.
    expect(await code(finishPasskeyLogin({ token, response: authResponse(user.id), rp }))).toBe("challenge_expired");
    // A user handle that doesn't belong to the credential is rejected.
    const second = await startPasskeyLogin(rp);
    expect(await code(finishPasskeyLogin({ token: second.token, response: authResponse("usr_someone_else"), rp }))).toBe("passkey_invalid");
  });

  it("reports unknown credentials so the client can tell the password manager", async () => {
    const { token } = await startPasskeyLogin(rp);
    const response = { id: "cred-that-does-not-exist", response: {} } as unknown as AuthenticationResponseJSON;
    expect(await code(finishPasskeyLogin({ token, response, rp }))).toBe("unknown_credential");
  });

  it("adds a passkey to the signed-in user only; the challenge is single use", async () => {
    const user = await createUser({ email: email("add") });
    const intruder = await createUser({ email: email("intruder") });
    await db().insert(schema.passkeys).values({ id: `cred-old-${seq++}`, userId: user.id, publicKey: "AA" });

    const { options, token } = await startAddPasskey(user, rp);
    expect(options.excludeCredentials).toHaveLength(1);
    expect(options.authenticatorSelection).toMatchObject({ residentKey: "required", userVerification: "required" });
    // The WebAuthn user handle is our user id.
    expect(Buffer.from(options.user.id, "base64url").toString()).toBe(user.id);
    expect(await code(finishAddPasskey({ user: intruder, token, response: regResponse, rp }))).toBe("challenge_expired");

    const again = await startAddPasskey(user, rp);
    const credentialId = `cred-added-${seq++}`;
    verifyRegistration.mockResolvedValue(verified(credentialId));
    const added = await finishAddPasskey({ user, token: again.token, response: regResponse, rp, userAgent: iphone });
    expect(added).toMatchObject({ id: credentialId, label: "iPhone" });
    expect(verifyRegistration.mock.calls[0][0]).toMatchObject({ expectedOrigin: rp.origin, expectedRPID: rp.id });
    const [passkey] = await db().select().from(schema.passkeys).where(eq(schema.passkeys.id, credentialId));
    expect(passkey).toMatchObject({ userId: user.id, backedUp: true, deviceType: "multiDevice", transports: ["internal", "hybrid"] });
    expect(passkey.publicKey).toBe(Buffer.from([1, 2, 3, 4]).toString("base64url"));
    expect(await code(finishAddPasskey({ user, token: again.token, response: regResponse, rp }))).toBe("challenge_expired");
  });

  it("saves nothing when a new passkey fails verification", async () => {
    const user = await createUser({ email: email("failed") });
    const { token } = await startAddPasskey(user, rp);
    verifyRegistration.mockRejectedValue(new Error("bad attestation"));
    expect(await code(finishAddPasskey({ user, token, response: regResponse, rp }))).toBe("passkey_invalid");
    expect(await db().select().from(schema.passkeys).where(eq(schema.passkeys.userId, user.id))).toHaveLength(0);
  });
});
