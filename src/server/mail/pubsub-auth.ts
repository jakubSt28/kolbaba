import { createPublicKey, createVerify, type JsonWebKey } from "node:crypto";

/**
 * Pub/Sub's authenticated push: every request carries a Google-signed ID token (a JWT) for the service
 * account the subscription pushes as, meant for our endpoint. Checking it beats a shared token in the
 * URL, which ends up in request logs. Only RS256 tokens from Google, for the expected audience and
 * service account, unexpired, count.
 */

const CERTS = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
/** Clocks drift: a minute of slack each way. */
const SKEW_S = 60;

type Jwk = JsonWebKey & { kid?: string };
let cache: { until: number; keys: Map<string, Jwk> } | null = null;

/** Google's signing keys, kept as long as Google's Cache-Control says (and fetched again for a key we don't know yet). */
async function googleKey(kid: string, fetchFn: typeof fetch, now: number): Promise<Jwk | null> {
  if (!cache || now > cache.until || !cache.keys.has(kid)) {
    const res = await fetchFn(CERTS, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (!res?.ok) return cache?.keys.get(kid) ?? null;
    const body = (await res.json().catch(() => null)) as { keys?: Jwk[] } | null;
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1] ?? 3600);
    cache = { until: now + maxAge * 1000, keys: new Map((body?.keys ?? []).filter((k) => k.kid).map((k) => [k.kid!, k])) };
  }
  return cache.keys.get(kid) ?? null;
}

const json = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;

export interface PushIdentity {
  audience: string;
  serviceAccount: string;
}

export async function verifyPushToken(
  authorization: string | null,
  expected: PushIdentity,
  deps: { fetch?: typeof fetch; now?: number } = {},
): Promise<boolean> {
  const jwt = authorization?.match(/^Bearer\s+([\w-]+\.[\w-]+\.[\w-]+)\s*$/)?.[1];
  if (!jwt) return false;
  const [head, body, signature] = jwt.split(".");
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = json(head);
    claims = json(body);
  } catch {
    return false;
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string") return false;
  const now = deps.now ?? Date.now();
  const jwk = await googleKey(header.kid, deps.fetch ?? fetch, now);
  if (!jwk) return false;
  let signed = false;
  try {
    signed = createVerify("RSA-SHA256").update(`${head}.${body}`).verify(createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(signature, "base64url"));
  } catch {
    return false;
  }
  const seconds = now / 1000;
  return (
    signed &&
    ISSUERS.has(String(claims.iss)) &&
    claims.aud === expected.audience &&
    claims.email === expected.serviceAccount &&
    claims.email_verified === true &&
    typeof claims.exp === "number" &&
    claims.exp > seconds - SKEW_S &&
    (typeof claims.iat !== "number" || claims.iat < seconds + SKEW_S)
  );
}

/** For tests: forget the cached keys. */
export const forgetGoogleKeys = () => {
  cache = null;
};
