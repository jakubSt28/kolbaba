import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { hashToken } from "../crypto";
import { db, schema } from "../db";
import { OAuthError } from "./config";
import { applyConsent } from "./consent";
import {
  approve,
  authenticateClient,
  checkAuthorizeRequest,
  consentToken,
  exchangeCode,
  findClient,
  isAllowedRedirectUri,
  refresh,
  registerClient,
  revokeToken,
  verifyAccessToken,
} from "./oauth";
import { handleMcpRequest } from "./server";
import { cleanup, pkce, REDIRECT, seed, trackClient } from "./test-helpers";

afterAll(cleanup);

const oauthCode = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return err instanceof OAuthError ? err.error : String(err);
  }
  return "resolved";
};

describe("dynamic client registration", () => {
  it("accepts https, loopback http and native app schemes", () => {
    expect(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isAllowedRedirectUri("http://localhost:6274/oauth/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://127.0.0.1:33418/callback")).toBe(true);
    expect(isAllowedRedirectUri("cursor://anysphere.cursor-retrieval/oauth/callback")).toBe(true);
  });

  it("rejects remote http, script schemes and fragments", () => {
    expect(isAllowedRedirectUri("http://evil.example/cb")).toBe(false);
    expect(isAllowedRedirectUri("javascript:alert(1)")).toBe(false);
    expect(isAllowedRedirectUri("data:text/html,hi")).toBe(false);
    expect(isAllowedRedirectUri("https://claude.ai/cb#frag")).toBe(false);
    expect(isAllowedRedirectUri("not a url")).toBe(false);
    expect(isAllowedRedirectUri(`https://x.example/${"a".repeat(3000)}`)).toBe(false);
  });

  it("registers a public client without a secret and echoes RFC 7591 metadata", async () => {
    const res = await registerClient({
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      client_name: "Claude",
      logo_uri: "javascript:alert(1)",
      client_uri: "https://claude.ai",
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    trackClient(res.client_id);
    expect(res.client_secret).toBeUndefined();
    expect(res.token_endpoint_auth_method).toBe("none");
    expect(res.logo_uri).toBeUndefined();
    expect(res.client_uri).toBe("https://claude.ai/");
    const row = await findClient(res.client_id);
    expect(row?.secretHash).toBeNull();
  });

  it("gives confidential clients a secret (stored hashed) and authenticates basic + post", async () => {
    const res = await registerClient({ redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"], client_name: "ChatGPT" });
    trackClient(res.client_id);
    expect(res.token_endpoint_auth_method).toBe("client_secret_basic");
    expect(res.client_secret).toBeTruthy();
    const row = await findClient(res.client_id);
    expect(row?.secretHash).toBe(hashToken(res.client_secret!));

    const basic = `Basic ${Buffer.from(`${res.client_id}:${res.client_secret}`).toString("base64")}`;
    expect((await authenticateClient(new URLSearchParams(), basic)).id).toBe(res.client_id);
    expect((await authenticateClient(new URLSearchParams({ client_id: res.client_id, client_secret: res.client_secret! }), null)).id).toBe(res.client_id);
    expect(await oauthCode(authenticateClient(new URLSearchParams({ client_id: res.client_id, client_secret: "nope" }), null))).toBe("invalid_client");
    expect(await oauthCode(authenticateClient(new URLSearchParams({ client_id: res.client_id }), null))).toBe("invalid_client");
  });

  it("rejects bad metadata", async () => {
    expect(await oauthCode(registerClient({}))).toBe("invalid_redirect_uri");
    expect(await oauthCode(registerClient({ redirect_uris: ["http://evil.example/cb"] }))).toBe("invalid_redirect_uri");
    expect(await oauthCode(registerClient({ redirect_uris: Array(11).fill("https://a.example/cb") }))).toBe("invalid_redirect_uri");
    expect(await oauthCode(registerClient({ redirect_uris: ["https://a.example/cb"], token_endpoint_auth_method: "private_key_jwt" }))).toBe(
      "invalid_client_metadata",
    );
    expect(await oauthCode(registerClient({ redirect_uris: ["https://a.example/cb"], grant_types: ["client_credentials"] }))).toBe("invalid_client_metadata");
  });
});

describe("authorization request", () => {
  it("refuses unknown clients and unregistered redirect URIs without redirecting", async () => {
    expect((await checkAuthorizeRequest({ client_id: "mcp_nope" })).kind).toBe("fatal");
    const { clientId } = await seed();
    const res = await checkAuthorizeRequest({ client_id: clientId, redirect_uri: "http://127.0.0.1:1/other" });
    expect(res.kind).toBe("fatal");
  });

  it("reports protocol errors back to the client with state and iss", async () => {
    const { clientId } = await seed();
    const base = { client_id: clientId, redirect_uri: REDIRECT, response_type: "code", state: "s1" };
    const noPkce = await checkAuthorizeRequest(base);
    expect(noPkce.kind).toBe("client_error");
    const url = new URL((noPkce as { redirect: string }).redirect);
    expect(url.searchParams.get("error")).toBe("invalid_request");
    expect(url.searchParams.get("state")).toBe("s1");
    expect(url.searchParams.get("iss")).toBe("http://localhost:3000");

    const { challenge } = pkce();
    expect((await checkAuthorizeRequest({ ...base, code_challenge: challenge, code_challenge_method: "plain" })).kind).toBe("client_error");
    expect((await checkAuthorizeRequest({ ...base, code_challenge: challenge, code_challenge_method: "S256", resource: "https://other.example/mcp" })).kind).toBe(
      "client_error",
    );
    const ok = await checkAuthorizeRequest({ ...base, code_challenge: challenge, code_challenge_method: "S256", resource: "http://localhost:3000/api/mcp/" });
    expect(ok.kind).toBe("ok");
  });

  it("consent form: needs the HMAC token, confirms Full access, sets this agent's mailboxes", async () => {
    const { user, clientId, shared, hidden } = await seed();
    const { challenge } = pkce();
    const fields = { client_id: clientId, redirect_uri: REDIRECT, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "st" };
    const check = await checkAuthorizeRequest(fields);
    if (check.kind !== "ok") throw new Error("expected ok");
    const form = (extra: Record<string, string>, mailboxes: string[] = []) => {
      const f = new FormData();
      for (const [k, v] of Object.entries({ ...fields, ...extra })) f.set(k, v);
      for (const m of mailboxes) f.append("mailbox", m);
      return f;
    };
    const token = consentToken(user.id, check.params);

    expect((await applyConsent(user.id, form({ decision: "allow", consent: "forged" }))).ok).toBe(false);
    expect(await applyConsent(null, form({ decision: "allow", consent: token }))).toMatchObject({ ok: false, status: 401 });
    expect(await applyConsent(user.id, form({ decision: "allow", consent: token, permission: "full" }))).toMatchObject({ ok: false, status: 400 });

    const denied = await applyConsent(user.id, form({ decision: "deny", consent: token }));
    expect(denied.ok && new URL(denied.redirect).searchParams.get("error")).toBe("access_denied");

    const allowed = await applyConsent(user.id, form({ decision: "allow", consent: token, permission: "full", understand: "1", mailboxes_shown: "1" }, [hidden.id]));
    expect(allowed.ok && new URL(allowed.redirect).searchParams.get("code")).toBeTruthy();
    const [agent] = await db().select().from(schema.agents).where(eq(schema.agents.clientId, clientId));
    expect(agent.permission).toBe("full");
    // Only what was ticked, and only for this agent.
    expect(agent.accountIds).toEqual([hidden.id]);
    expect(agent.accountIds).not.toContain(shared.id);
  });
});

describe("token endpoint", () => {
  async function codeFor(permission: "read" | "draft" | "full" = "draft") {
    const s = await seed(permission);
    const { verifier, challenge } = pkce();
    const check = await checkAuthorizeRequest({ client_id: s.clientId, redirect_uri: REDIRECT, response_type: "code", code_challenge: challenge, code_challenge_method: "S256" });
    if (check.kind !== "ok") throw new Error("expected ok");
    const { redirect } = await approve(s.user.id, check.client, check.params, permission);
    const code = new URL(redirect).searchParams.get("code")!;
    const client = (await findClient(s.clientId))!;
    const form = (extra: Record<string, string> = {}) =>
      new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT, ...extra });
    return { ...s, client, code, verifier, form };
  }

  it("exchanges a code once, with PKCE", async () => {
    const { client, form } = await codeFor();
    const tokens = await exchangeCode(client, form());
    expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "mail" });
    expect(await oauthCode(exchangeCode(client, form()))).toBe("invalid_grant");
  });

  it("rejects a wrong verifier, redirect_uri or client, and burns the code", async () => {
    const a = await codeFor();
    expect(await oauthCode(exchangeCode(a.client, a.form({ code_verifier: pkce().verifier })))).toBe("invalid_grant");
    expect(await oauthCode(exchangeCode(a.client, a.form()))).toBe("invalid_grant");

    const b = await codeFor();
    expect(await oauthCode(exchangeCode(b.client, b.form({ redirect_uri: "http://127.0.0.1:1/x" })))).toBe("invalid_grant");

    const c = await codeFor();
    const other = await registerClient({ redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" });
    trackClient(other.client_id);
    expect(await oauthCode(exchangeCode((await findClient(other.client_id))!, c.form()))).toBe("invalid_grant");
  });

  it("expires codes after 60 seconds", async () => {
    const { client, code, form } = await codeFor();
    await db().update(schema.oauthCodes).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(schema.oauthCodes.id, hashToken(code)));
    expect(await oauthCode(exchangeCode(client, form()))).toBe("invalid_grant");
  });

  it("rotates refresh tokens and revokes the grant on reuse", async () => {
    const { tokens, clientId } = await seed();
    const client = (await findClient(clientId))!;
    const r = (token: string) => refresh(client, new URLSearchParams({ grant_type: "refresh_token", refresh_token: token }));

    const second = await r(tokens.refresh_token);
    expect(second.refresh_token).not.toBe(tokens.refresh_token);
    // A retry right away is a lost response, not theft: tolerated.
    const retry = await r(tokens.refresh_token);
    expect(retry.access_token).toBeTruthy();

    // Past the grace window, the old token coming back means someone else has it.
    await db().update(schema.oauthTokens).set({ revokedAt: new Date(Date.now() - 60_000) }).where(eq(schema.oauthTokens.id, hashToken(tokens.refresh_token)));
    expect(await oauthCode(r(tokens.refresh_token))).toBe("invalid_grant");
    expect(await oauthCode(r(second.refresh_token))).toBe("invalid_grant");
    expect((await verifyAccessToken(`Bearer ${second.access_token}`)).ok).toBe(false);
  });

  it("tolerates one retry of a rotated refresh token, not two", async () => {
    const { tokens, clientId } = await seed();
    const client = (await findClient(clientId))!;
    const r = (token: string) => refresh(client, new URLSearchParams({ grant_type: "refresh_token", refresh_token: token }));

    await r(tokens.refresh_token);
    const retry = await r(tokens.refresh_token);
    expect((await verifyAccessToken(`Bearer ${retry.access_token}`)).ok).toBe(true);
    // The same old token a third time, even within seconds: someone else has it, and the grant ends.
    expect(await oauthCode(r(tokens.refresh_token))).toBe("invalid_grant");
    expect((await verifyAccessToken(`Bearer ${retry.access_token}`)).ok).toBe(false);
  });

  it("revocation of a refresh token ends the grant's access tokens", async () => {
    const { tokens, clientId } = await seed();
    const client = (await findClient(clientId))!;
    expect((await verifyAccessToken(`Bearer ${tokens.access_token}`)).ok).toBe(true);
    await revokeToken(client, tokens.refresh_token);
    expect((await verifyAccessToken(`Bearer ${tokens.access_token}`)).ok).toBe(false);
    await revokeToken(client, "unknown-token"); // RFC 7009: no error
  });

  it("won't issue tokens for a disabled agent", async () => {
    const { client, form, agent } = await codeFor();
    await db().update(schema.agents).set({ enabled: false }).where(eq(schema.agents.id, agent.id));
    expect(await oauthCode(exchangeCode(client, form()))).toBe("invalid_grant");
  });
});

describe("bearer auth on /api/mcp", () => {
  const post = (auth?: string) =>
    handleMcpRequest(
      new Request("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(auth ? { authorization: auth } : {}) },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );

  it("answers 401 with the resource metadata pointer", async () => {
    const res = await post();
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe('Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"');
    expect(res.headers.get("access-control-expose-headers")).toContain("www-authenticate");

    const bad = await post("Bearer not-a-token");
    expect(bad.status).toBe(401);
    expect(bad.headers.get("www-authenticate")).toMatch(/^Bearer error="invalid_token".*resource_metadata="http:\/\/localhost:3000\/\.well-known\/oauth-protected-resource"$/);
  });

  it("answers 403 when the user turned the agent off, and 401 once the token expires", async () => {
    const { tokens, agent } = await seed();
    expect((await post(`Bearer ${tokens.access_token}`)).status).toBe(200);
    await db().update(schema.agents).set({ enabled: false }).where(eq(schema.agents.id, agent.id));
    expect((await post(`Bearer ${tokens.access_token}`)).status).toBe(403);
    await db().update(schema.agents).set({ enabled: true }).where(eq(schema.agents.id, agent.id));
    await db().update(schema.oauthTokens).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(schema.oauthTokens.id, hashToken(tokens.access_token)));
    expect((await post(`Bearer ${tokens.access_token}`)).status).toBe(401);
  });
});
