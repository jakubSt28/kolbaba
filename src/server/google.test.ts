import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exchangeGmailCode, gmailAuthUrl, refreshAccessToken, revokeGoogleToken } from "./google";
import { json, mockFetch, tokenResponse } from "./mail/gmail/test-fixtures";
import { MailAuthError } from "./mail/types";

const MODIFY = "https://www.googleapis.com/auth/gmail.modify";

/** Unsigned JWT; the code only decodes the payload. */
const idToken = (claims: object) =>
  ["{}", JSON.stringify(claims), "sig"].map((p) => Buffer.from(p).toString("base64url")).join(".");

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = "client-id";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret";
});
afterEach(() => {
  vi.unstubAllGlobals();
});

it("builds the authorization URL with offline access, consent and PKCE", () => {
  const verifier = "verifier-0123456789-0123456789-0123456789-0123";
  const url = gmailAuthUrl({ state: "st", codeVerifier: verifier, loginHint: "me@gmail.com" });
  const p = url.searchParams;
  expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
  expect(p.get("client_id")).toBe("client-id");
  expect(p.get("redirect_uri")).toBe("http://localhost:3000/api/accounts/google/callback");
  expect(p.get("response_type")).toBe("code");
  expect(p.get("state")).toBe("st");
  expect(p.get("scope")).toBe(`openid email profile ${MODIFY}`);
  expect(p.get("access_type")).toBe("offline");
  expect(p.get("prompt")).toBe("consent");
  expect(p.get("include_granted_scopes")).toBe("true");
  expect(p.get("login_hint")).toBe("me@gmail.com");
  expect(p.get("code_challenge_method")).toBe("S256");
  expect(p.get("code_challenge")).toBe(createHash("sha256").update(verifier).digest("base64url"));
});

describe("exchangeGmailCode", () => {
  it("returns tokens and profile from the id_token", async () => {
    const calls = mockFetch(() =>
      tokenResponse("access-1", {
        refresh_token: "refresh-1",
        scope: `openid ${MODIFY} https://www.googleapis.com/auth/userinfo.email`,
        id_token: idToken({ email: "Me@Gmail.com", name: "Daniel Žďárský", picture: "https://lh3/x" }),
      }),
    );
    const grant = await exchangeGmailCode("code-1", "verifier");
    expect(grant).toMatchObject({
      refreshToken: "refresh-1",
      accessToken: "access-1",
      email: "me@gmail.com",
      name: "Daniel Žďárský",
      picture: "https://lh3/x",
    });
    expect(grant.scope).toContain(MODIFY);
    expect(grant.expiresAt).toBeGreaterThan(Date.now() + 3500_000);
    const form = new URLSearchParams(calls[0].body);
    expect(form.get("code")).toBe("code-1");
    expect(form.get("code_verifier")).toBe("verifier");
    expect(form.get("redirect_uri")).toBe("http://localhost:3000/api/accounts/google/callback");
  });

  it("rejects a grant without the Gmail scope (unticked on the consent screen)", async () => {
    mockFetch(() =>
      tokenResponse("a", { refresh_token: "r", scope: "openid email", id_token: idToken({ email: "me@gmail.com" }) }),
    );
    await expect(exchangeGmailCode("c", "v")).rejects.toBeInstanceOf(MailAuthError);
  });
});

describe("refreshAccessToken", () => {
  it("returns the new access token", async () => {
    mockFetch(() => tokenResponse("access-2"));
    const t = await refreshAccessToken("refresh-1");
    expect(t).toMatchObject({ accessToken: "access-2", scope: MODIFY, refreshToken: undefined });
  });

  it("maps invalid_grant to oauth_revoked", async () => {
    mockFetch(() => json({ error: "invalid_grant" }, { status: 400 }));
    await expect(refreshAccessToken("bad")).rejects.toMatchObject({ name: "MailAuthError", reason: "oauth_revoked" });
  });
});

describe("revokeGoogleToken", () => {
  it("posts the token to Google's revoke endpoint", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await revokeGoogleToken("refresh-1");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/revoke");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toBe("token=refresh-1");
  });

  it("never throws, so a disconnect goes through even when Google is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(revokeGoogleToken("refresh-1")).resolves.toBeUndefined();
  });
});
