import { like } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashToken, randomToken } from "../crypto";
import { db, schema } from "../db";
import { getPlus } from "../plus";
import { peekSetupLink, redeemSetupLink } from "./setup-link";
import { findOrCreateUser, findUserByEmail, isSignupAllowed } from "./users";

const DOMAIN = "setup-link.invalid";
let seq = 0;
const address = (label: string) => `${label}-${Date.now()}-${seq++}@${DOMAIN}`;

/** What `kolbaba-link` writes (worker/login-link.ts). */
async function link(userId?: string, ttlMs = 3600_000) {
  const token = randomToken();
  await db()
    .insert(schema.authChallenges)
    .values({ id: hashToken(token), kind: "setup-link", challenge: "", data: userId ? { userId } : {}, expiresAt: new Date(Date.now() + ttlMs) });
  return token;
}

beforeEach(() => {
  process.env.SELF_HOSTED = "1";
  delete process.env.SIGNUP_ALLOWLIST;
});

afterEach(() => {
  delete process.env.SELF_HOSTED;
});

afterAll(async () => {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
});

describe("setup link", () => {
  it("creates the account once, and looking at it doesn't use it up", async () => {
    const token = await link();
    expect(await peekSetupLink(token)).toEqual({ mode: "new" });
    expect(await peekSetupLink(token)).toEqual({ mode: "new" });
    const email = address("owner");
    const user = await redeemSetupLink(token, { email, name: "Owner" });
    expect(user).toMatchObject({ email, name: "Owner" });
    await expect(redeemSetupLink(token, { email: address("again"), name: "Again" })).rejects.toMatchObject({ code: "setup_link_invalid" });
  });

  it("signs in the account it was made for", async () => {
    const email = address("member");
    const { user } = await findOrCreateUser({ email, name: "Member" }, [email]);
    const token = await link(user.id);
    expect(await peekSetupLink(token)).toEqual({ mode: "sign-in", email });
    expect((await redeemSetupLink(token)).id).toBe(user.id);
  });

  it("stays usable when the typed address is taken", async () => {
    const email = address("taken");
    await findOrCreateUser({ email }, [email]);
    const token = await link();
    await expect(redeemSetupLink(token, { email, name: "X" })).rejects.toMatchObject({ code: "account_exists" });
    expect((await redeemSetupLink(token, { email: address("free"), name: "X" })).name).toBe("X");
  });

  it("refuses an unknown or expired link", async () => {
    await expect(peekSetupLink(randomToken())).rejects.toMatchObject({ code: "setup_link_invalid" });
    await expect(peekSetupLink(await link(undefined, -1000))).rejects.toMatchObject({ code: "setup_link_invalid" });
  });
});

describe("a self-hosted server", () => {
  it("is closed to new sign-ups unless the owner lists someone", async () => {
    expect(isSignupAllowed("anyone@example.com")).toBe(false);
    expect(isSignupAllowed("anyone@example.com", ["anyone@example.com"])).toBe(true);
    const email = address("stranger");
    await expect(findOrCreateUser({ email })).rejects.toMatchObject({ code: "invite_only" });
    expect(await findUserByEmail(email)).toBeNull();
    delete process.env.SELF_HOSTED;
    expect(isSignupAllowed("anyone@example.com")).toBe(true);
  });

  it("gives everyone every feature, with no trial to run out", async () => {
    const email = address("plus");
    const { user } = await findOrCreateUser({ email }, [email]);
    expect(await getPlus(user.id)).toMatchObject({ level: "plus", source: "self" });
    delete process.env.SELF_HOSTED;
    expect(await getPlus(user.id)).toMatchObject({ level: "none", source: null });
  });

  it("sends nothing to the makers of Kolbaba", async () => {
    const { env } = await import("../env");
    expect(env.feedbackTo).toBeUndefined();
    delete process.env.SELF_HOSTED;
    expect(env.feedbackTo).toBe("hello@kolbaba.app");
  });
});
