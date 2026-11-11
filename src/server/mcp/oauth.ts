import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { tk } from "@/lib/i18n";
import { hashToken, hmac, randomToken, safeEqual } from "../crypto";
import { db, schema } from "../db";
import type { AgentPermission } from "../db/schema";
import {
  ACCESS_TTL_MS,
  CODE_TTL_MS,
  isOurResource,
  issuer,
  OAuthError,
  REFRESH_REUSE_GRACE_MS,
  REFRESH_TTL_MS,
  SCOPE,
} from "./config";
import { identityFromRegistration } from "./identity";

/**
 * OAuth 2.1 authorization server for MCP clients: dynamic client registration (RFC 7591),
 * authorization code + PKCE (S256 only), refresh token rotation with reuse detection, revocation
 * (RFC 7009). Codes and tokens are opaque random strings stored as sha256, like app sessions.
 */

export type ClientRow = typeof schema.oauthClients.$inferSelect;
type AgentRow = typeof schema.agents.$inferSelect;

/* ------------------------------ Registration ------------------------------ */

const MAX = { redirectUris: 10, uri: 2000, name: 100 };
const AUTH_METHODS = ["none", "client_secret_post", "client_secret_basic"] as const;
type AuthMethod = (typeof AUTH_METHODS)[number];
/** Schemes a native app could register that would turn a redirect into script execution or a local file read. */
const BLOCKED_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "blob:", "about:", "ftp:", "ws:", "wss:"]);
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** https anywhere, http only on loopback (CLI clients), or a private-use scheme like `cursor://`. */
export function isAllowedRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX.uri) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === "https:") return !!url.hostname;
  if (url.protocol === "http:") return LOOPBACK.has(url.hostname);
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) && !BLOCKED_SCHEMES.has(url.protocol);
}

/** Display-only URLs (logo, homepage) must be plain https; anything else is dropped, not fatal. */
function displayUri(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX.uri) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export interface RegistrationResponse {
  client_id: string;
  client_id_issued_at: number;
  client_secret?: string;
  client_secret_expires_at?: number;
  redirect_uris: string[];
  client_name: string;
  logo_uri?: string;
  client_uri?: string;
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: AuthMethod;
  scope: string;
}

export async function registerClient(body: unknown): Promise<RegistrationResponse> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new OAuthError("invalid_client_metadata", "Expected a JSON object");
  const meta = body as Record<string, unknown>;

  const uris = meta.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0) throw new OAuthError("invalid_redirect_uri", "redirect_uris is required");
  if (uris.length > MAX.redirectUris) throw new OAuthError("invalid_redirect_uri", `At most ${MAX.redirectUris} redirect_uris`);
  for (const u of uris) {
    if (!isAllowedRedirectUri(u)) throw new OAuthError("invalid_redirect_uri", `Redirect URI not allowed: ${String(u).slice(0, 200)}`);
  }

  const method = (meta.token_endpoint_auth_method ?? "client_secret_basic") as AuthMethod;
  if (!AUTH_METHODS.includes(method)) throw new OAuthError("invalid_client_metadata", "Unsupported token_endpoint_auth_method");

  // Lenient on extras, strict on what matters: we only ever do authorization_code (+ refresh).
  const grantTypes = Array.isArray(meta.grant_types) ? meta.grant_types.filter((g) => g === "authorization_code" || g === "refresh_token") : ["authorization_code", "refresh_token"];
  if (!grantTypes.includes("authorization_code")) throw new OAuthError("invalid_client_metadata", "grant_types must include authorization_code");
  if (Array.isArray(meta.response_types) && !meta.response_types.includes("code")) {
    throw new OAuthError("invalid_client_metadata", "response_types must include code");
  }

  const rawName = typeof meta.client_name === "string" ? meta.client_name : "";
  const clientName = rawName.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX.name) || "AI agent";
  const logoUri = displayUri(meta.logo_uri);
  const clientUri = displayUri(meta.client_uri);

  const clientId = `mcp_${randomToken(18)}`;
  const secret = method === "none" ? null : randomToken(32);
  const [row] = await db()
    .insert(schema.oauthClients)
    .values({ id: clientId, secretHash: secret ? hashToken(secret) : null, redirectUris: uris as string[], clientName, logoUri, clientUri })
    .returning();

  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(row.createdAt.getTime() / 1000),
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    redirect_uris: row.redirectUris,
    client_name: clientName,
    ...(logoUri ? { logo_uri: logoUri } : {}),
    ...(clientUri ? { client_uri: clientUri } : {}),
    grant_types: grantTypes as string[],
    response_types: ["code"],
    token_endpoint_auth_method: method,
    scope: SCOPE,
  };
}

export async function findClient(clientId: string | null | undefined): Promise<ClientRow | null> {
  if (!clientId || clientId.length > 200) return null;
  const [row] = await db().select().from(schema.oauthClients).where(eq(schema.oauthClients.id, clientId));
  return row ?? null;
}

/* ------------------------------ Authorization ----------------------------- */

export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  scope: string;
  resource: string | null;
}

export type AuthorizeCheck =
  /** Can't trust where to send the user back: show the error on our page (English, marked with tk()). */
  | { kind: "fatal"; message: string }
  /** Client and redirect are fine but the request isn't: report back to the client (RFC 6749 §4.1.2.1). */
  | { kind: "client_error"; redirect: string; message: string }
  | { kind: "ok"; client: ClientRow; params: AuthorizeParams };

const one = (v: string | string[] | undefined | null) => (Array.isArray(v) ? v[0] : v) ?? null;
const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export function redirectWith(redirectUri: string, params: Record<string, string | null | undefined>) {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  return url.toString();
}

/** Validate an /authorize request (query string on GET, form fields on the consent POST). */
export async function checkAuthorizeRequest(input: Record<string, string | string[] | undefined>): Promise<AuthorizeCheck> {
  const clientId = one(input.client_id);
  const client = await findClient(clientId);
  if (!client) return { kind: "fatal", message: tk("This app isn't registered with us (unknown client_id). Try connecting again from the app.") };

  // Exact match only; a single registered URI may be omitted (RFC 6749 §3.1.2.3), OAuth 2.1 still wants it, we're lenient.
  const requested = one(input.redirect_uri);
  const redirectUri = requested ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : null);
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
    return { kind: "fatal", message: tk("The app asked to send you back to an address it didn't register. For your safety we stopped here.") };
  }

  const state = one(input.state);
  const fail = (error: string, description: string): AuthorizeCheck => ({
    kind: "client_error",
    message: description,
    redirect: redirectWith(redirectUri, { error, error_description: description, state, iss: issuer() }),
  });

  if (one(input.response_type) !== "code") return fail("unsupported_response_type", "Only response_type=code is supported");
  const codeChallenge = one(input.code_challenge);
  if (!codeChallenge || !PKCE_CHALLENGE.test(codeChallenge)) return fail("invalid_request", "PKCE code_challenge is required");
  if (one(input.code_challenge_method) !== "S256") return fail("invalid_request", "code_challenge_method must be S256");
  const resource = one(input.resource);
  if (resource && !isOurResource(resource)) return fail("invalid_target", "Unknown resource");
  if (state && state.length > 1000) return fail("invalid_request", "state is too long");

  return {
    kind: "ok",
    client,
    params: { clientId: client.id, redirectUri, state, codeChallenge, scope: SCOPE, resource },
  };
}

/** Binds the consent form to the signed-in user and this exact request (defence in depth next to SameSite + Origin checks). */
export function consentToken(userId: string, p: AuthorizeParams) {
  return hmac(`mcp-consent|${userId}|${p.clientId}|${p.redirectUri}|${p.codeChallenge}|${p.state ?? ""}`);
}

export function verifyConsentToken(token: string | null, userId: string, p: AuthorizeParams) {
  return !!token && safeEqual(token, consentToken(userId, p));
}

/** The user said yes: create or update the grant and hand out a one-time code. */
/** `calendar`: whether the agent may use the calendar; left out, a new agent starts without it and a known one keeps what it had. */
export async function approve(userId: string, client: ClientRow, p: AuthorizeParams, permission: AgentPermission, accountIds: string[] = [], calendar?: boolean) {
  // An impostor of a known app is stored under the name it gave, never as that app.
  const { name, app, logo } = identityFromRegistration(client);
  const [agent] = await db()
    .insert(schema.agents)
    .values({ userId, clientId: client.id, name, app, logo, permission, accountIds, enabled: true, ...(calendar === undefined ? {} : { calendar }) })
    .onConflictDoUpdate({
      target: [schema.agents.userId, schema.agents.clientId],
      // Keep a name refined from MCP clientInfo; only the grant itself changes.
      set: { permission, accountIds, enabled: true, ...(calendar === undefined ? {} : { calendar }) },
    })
    .returning();

  const code = randomToken(32);
  await db()
    .insert(schema.oauthCodes)
    .values({
      id: hashToken(code),
      clientId: client.id,
      userId,
      agentId: agent.id,
      redirectUri: p.redirectUri,
      codeChallenge: p.codeChallenge,
      scope: p.scope,
      resource: p.resource,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });
  return { agent, redirect: redirectWith(p.redirectUri, { code, state: p.state, iss: issuer() }) };
}

export const denyRedirect = (p: AuthorizeParams) =>
  redirectWith(p.redirectUri, { error: "access_denied", error_description: "The user declined access", state: p.state, iss: issuer() });

/* ---------------------------------- Tokens --------------------------------- */

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

async function issueTokens(agent: { id: string; userId: string; clientId: string }, scope: string): Promise<TokenResponse> {
  const access = randomToken(32);
  const refresh = randomToken(32);
  const now = Date.now();
  await db()
    .insert(schema.oauthTokens)
    .values([
      { id: hashToken(access), kind: "access", agentId: agent.id, userId: agent.userId, clientId: agent.clientId, scope, expiresAt: new Date(now + ACCESS_TTL_MS) },
      { id: hashToken(refresh), kind: "refresh", agentId: agent.id, userId: agent.userId, clientId: agent.clientId, scope, expiresAt: new Date(now + REFRESH_TTL_MS) },
    ]);
  return { access_token: access, token_type: "Bearer", expires_in: Math.floor(ACCESS_TTL_MS / 1000), refresh_token: refresh, scope };
}

/**
 * Client authentication at the token/revoke endpoints: Basic header, `client_secret` in the body,
 * or nothing for public clients (PKCE carries the proof then).
 */
export async function authenticateClient(form: URLSearchParams, authorization: string | null): Promise<ClientRow> {
  let clientId = form.get("client_id");
  let secret = form.get("client_secret");
  if (authorization?.toLowerCase().startsWith("basic ")) {
    const decoded = Buffer.from(authorization.slice(6).trim(), "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    if (sep < 0) throw new OAuthError("invalid_client", "Malformed Basic credentials", 401);
    try {
      // RFC 6749 §2.3.1: both parts are form-urlencoded before base64.
      clientId = decodeURIComponent(decoded.slice(0, sep).replace(/\+/g, " "));
      secret = decodeURIComponent(decoded.slice(sep + 1).replace(/\+/g, " "));
    } catch {
      throw new OAuthError("invalid_client", "Malformed Basic credentials", 401);
    }
  }
  const client = await findClient(clientId);
  if (!client) throw new OAuthError("invalid_client", "Unknown client", 401);
  if (client.secretHash) {
    if (!secret || !safeEqual(hashToken(secret), client.secretHash)) throw new OAuthError("invalid_client", "Client authentication failed", 401);
  }
  return client;
}

const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

async function liveAgent(agentId: string): Promise<AgentRow> {
  const [agent] = await db().select().from(schema.agents).where(eq(schema.agents.id, agentId));
  if (!agent) throw new OAuthError("invalid_grant", "This connection was removed. Connect again.");
  if (!agent.enabled) throw new OAuthError("invalid_grant", "Access for this agent is turned off in AI activity.");
  return agent;
}

export async function exchangeCode(client: ClientRow, form: URLSearchParams): Promise<TokenResponse> {
  const code = form.get("code");
  const verifier = form.get("code_verifier");
  if (!code) throw new OAuthError("invalid_request", "code is required");
  if (!verifier || !VERIFIER.test(verifier)) throw new OAuthError("invalid_request", "A valid code_verifier is required");

  // Delete-on-read makes codes single use even under concurrent requests.
  const [row] = await db().delete(schema.oauthCodes).where(eq(schema.oauthCodes.id, hashToken(code))).returning();
  if (!row || row.expiresAt.getTime() < Date.now()) throw new OAuthError("invalid_grant", "The authorization code is invalid or expired");
  if (row.clientId !== client.id) throw new OAuthError("invalid_grant", "The code was issued to another client");
  const redirectUri = form.get("redirect_uri");
  if (redirectUri !== null && redirectUri !== row.redirectUri) throw new OAuthError("invalid_grant", "redirect_uri doesn't match the authorization request");
  if (!safeEqual(s256(verifier), row.codeChallenge)) throw new OAuthError("invalid_grant", "PKCE verification failed");
  const resource = form.get("resource");
  if (resource && !isOurResource(resource)) throw new OAuthError("invalid_target", "Unknown resource");

  const agent = await liveAgent(row.agentId);
  return issueTokens(agent, row.scope || SCOPE);
}

export async function refresh(client: ClientRow, form: URLSearchParams): Promise<TokenResponse> {
  const token = form.get("refresh_token");
  if (!token) throw new OAuthError("invalid_request", "refresh_token is required");
  const t = schema.oauthTokens;
  const [row] = await db()
    .select()
    .from(t)
    .where(and(eq(t.id, hashToken(token)), eq(t.kind, "refresh")));
  if (!row || row.clientId !== client.id) throw new OAuthError("invalid_grant", "Unknown refresh token");

  if (row.revokedAt) {
    // Grace, once: a retry right after rotation (the answer got lost), while the newer token in the chain
    // is still alive. The retry spends the token (it expires now), so a second reuse counts as theft.
    const recent = Date.now() - row.revokedAt.getTime() < REFRESH_REUSE_GRACE_MS;
    const [alive] = recent
      ? await db()
          .select({ id: t.id })
          .from(t)
          .where(and(eq(t.agentId, row.agentId), eq(t.kind, "refresh"), isNull(t.revokedAt), gt(t.createdAt, row.createdAt)))
          .limit(1)
      : [];
    const [spent] = alive
      ? await db()
          .update(t)
          .set({ expiresAt: new Date() })
          .where(and(eq(t.id, row.id), gt(t.expiresAt, new Date())))
          .returning({ id: t.id })
      : [];
    if (!spent) {
      // Reuse of a rotated token: someone else may hold the chain. Cut every token of this grant.
      await revokeAgentTokens(row.agentId);
      throw new OAuthError("invalid_grant", "This refresh token was already used. Connect again.");
    }
  } else {
    if (row.expiresAt.getTime() < Date.now()) throw new OAuthError("invalid_grant", "The refresh token expired. Connect again.");
    // Rotate: the conditional update makes concurrent refreshes race safely.
    const [rotated] = await db()
      .update(t)
      .set({ revokedAt: new Date() })
      .where(and(eq(t.id, row.id), isNull(t.revokedAt)))
      .returning({ id: t.id });
    if (!rotated) return refresh(client, form);
  }

  const agent = await liveAgent(row.agentId);
  return issueTokens(agent, row.scope || SCOPE);
}

export async function revokeAgentTokens(agentId: string) {
  await db()
    .update(schema.oauthTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.oauthTokens.agentId, agentId), isNull(schema.oauthTokens.revokedAt)));
}

/** RFC 7009: always "ok", even for unknown tokens. Revoking a refresh token ends the whole grant's tokens. */
export async function revokeToken(client: ClientRow, token: string | null) {
  if (!token) throw new OAuthError("invalid_request", "token is required");
  const [row] = await db().select().from(schema.oauthTokens).where(eq(schema.oauthTokens.id, hashToken(token)));
  if (!row || row.clientId !== client.id) return;
  if (row.kind === "refresh") await revokeAgentTokens(row.agentId);
  else await db().update(schema.oauthTokens).set({ revokedAt: new Date() }).where(eq(schema.oauthTokens.id, row.id));
}

/* ------------------------------- Bearer auth ------------------------------- */

export type BearerResult =
  | { ok: true; agent: AgentRow; userId: string; tokenId: string }
  | { ok: false; reason: "missing" | "invalid" | "disabled" };

export async function verifyAccessToken(authorization: string | null): Promise<BearerResult> {
  const match = authorization?.match(/^Bearer\s+([A-Za-z0-9._~+/=-]+)\s*$/i);
  if (!match) return { ok: false, reason: authorization ? "invalid" : "missing" };
  const t = schema.oauthTokens;
  const [row] = await db()
    .select({ token: t, agent: schema.agents })
    .from(t)
    .innerJoin(schema.agents, eq(schema.agents.id, t.agentId))
    .where(and(eq(t.id, hashToken(match[1])), eq(t.kind, "access"), isNull(t.revokedAt), gt(t.expiresAt, new Date())));
  if (!row) return { ok: false, reason: "invalid" };
  if (!row.agent.enabled) return { ok: false, reason: "disabled" };
  return { ok: true, agent: row.agent, userId: row.token.userId, tokenId: row.token.id };
}

/** Body of POST /token as form fields; JSON is accepted too for lenient clients. */
export async function readForm(req: Request): Promise<URLSearchParams> {
  const type = req.headers.get("content-type") ?? "";
  const text = await req.text();
  if (text.length > 16_384) throw new OAuthError("invalid_request", "Request too large");
  if (type.includes("application/json")) {
    try {
      const obj = JSON.parse(text) as Record<string, unknown>;
      return new URLSearchParams(Object.entries(obj).filter(([, v]) => typeof v === "string") as [string, string][]);
    } catch {
      throw new OAuthError("invalid_request", "Malformed JSON body");
    }
  }
  return new URLSearchParams(text);
}
