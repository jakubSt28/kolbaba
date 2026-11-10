import { createSign, generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { forgetGoogleKeys, verifyPushToken } from "./pubsub-auth";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };

const certs = (async () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { "cache-control": "max-age=600" } })) as unknown as typeof fetch;

const NOW = Date.UTC(2026, 9, 26, 12);
const expected = { audience: "https://app.kolbaba.app/api/webhooks/gmail", serviceAccount: "pubsub@example-project.iam.gserviceaccount.com" };
const good = {
  iss: "https://accounts.google.com",
  aud: expected.audience,
  email: expected.serviceAccount,
  email_verified: true,
  iat: NOW / 1000 - 10,
  exp: NOW / 1000 + 3600,
};

function token(claims: Record<string, unknown>, opts: { key?: typeof privateKey; kid?: string; alg?: string } = {}) {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = part({ alg: opts.alg ?? "RS256", kid: opts.kid ?? "k1", typ: "JWT" });
  const body = part(claims);
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(opts.key ?? privateKey).toString("base64url");
  return `Bearer ${head}.${body}.${sig}`;
}

const check = (authorization: string | null) => verifyPushToken(authorization, expected, { fetch: certs, now: NOW });

describe("authenticated Pub/Sub push", () => {
  beforeEach(forgetGoogleKeys);

  it("accepts Google's signed token for our service account and endpoint", async () => {
    expect(await check(token(good))).toBe(true);
  });

  it("refuses anything else", async () => {
    expect(await check(null)).toBe(false);
    expect(await check("Bearer nonsense")).toBe(false);
    expect(await check(token(good, { key: other.privateKey }))).toBe(false);
    expect(await check(token(good, { kid: "unknown" }))).toBe(false);
    expect(await check(token(good, { alg: "none" }))).toBe(false);
    expect(await check(token({ ...good, aud: "https://evil.example/hook" }))).toBe(false);
    expect(await check(token({ ...good, email: "someone@else.iam.gserviceaccount.com" }))).toBe(false);
    expect(await check(token({ ...good, email_verified: false }))).toBe(false);
    expect(await check(token({ ...good, iss: "https://evil.example" }))).toBe(false);
    expect(await check(token({ ...good, exp: NOW / 1000 - 3600 }))).toBe(false);
  });
});
