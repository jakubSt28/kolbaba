import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Envelope encryption for mailbox credentials (passwords, OAuth refresh tokens).
 *
 * Every secret gets its own random data key (DEK). The DEK encrypts the secret with AES-256-GCM and is
 * itself wrapped by the master key (KEK) from the environment. Rotating the KEK only means re-wrapping
 * DEKs (see `rewrap`), and a database dump alone is useless without the KEK.
 */

export interface Sealed {
  /** Which KEK wrapped the DEK, so old rows keep working after rotation. */
  kid: string;
  /** DEK wrapped by the KEK: iv(12) | tag(16) | ciphertext(32), base64. */
  dek: string;
  /** Secret encrypted by the DEK: iv(12) | tag(16) | ciphertext, base64. */
  data: string;
}

type KeyRing = { current: string; keys: Map<string, Buffer> };

let cachedRing: { source: string; ring: KeyRing } | null = null;

export function parseKeyRing(source: string): KeyRing {
  const keys = new Map<string, Buffer>();
  let current = "";
  for (const entry of source.split(",").map((s) => s.trim()).filter(Boolean)) {
    const sep = entry.indexOf(":");
    const [kid, b64] = sep > 0 ? [entry.slice(0, sep), entry.slice(sep + 1)] : ["v1", entry];
    const key = Buffer.from(b64, "base64");
    if (key.length !== 32) throw new Error(`CREDENTIALS_KEK ${kid} must be 32 bytes of base64`);
    keys.set(kid, key);
    current = kid;
  }
  if (!current) throw new Error("CREDENTIALS_KEK is empty");
  return { current, keys };
}

function ring(): KeyRing {
  const source = env.kekRing;
  if (cachedRing?.source !== source) cachedRing = { source, ring: parseKeyRing(source) };
  return cachedRing.ring;
}

/** GCM's authentication tag, always the full 16 bytes. */
const TAG_BYTES = 16;

function gcmEncrypt(key: Buffer, plaintext: Buffer, aad?: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

function gcmDecrypt(key: Buffer, payload: string, aad?: string) {
  const buf = Buffer.from(payload, "base64");
  // The tag length is fixed, not taken from the data: a shortened tag would be easier to forge.
  if (buf.length < 12 + TAG_BYTES) throw new Error("Sealed data is too short");
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12), { authTagLength: TAG_BYTES });
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(buf.subarray(12, 12 + TAG_BYTES));
  return Buffer.concat([decipher.update(buf.subarray(12 + TAG_BYTES)), decipher.final()]);
}

/**
 * Encrypt a JSON-serialisable secret. `context` (e.g. the account id) is bound as associated data,
 * so a sealed blob copied onto another row fails to decrypt.
 */
export function seal(value: unknown, context: string, keyRing: KeyRing = ring()): Sealed {
  const dek = randomBytes(32);
  const kek = keyRing.keys.get(keyRing.current)!;
  return {
    kid: keyRing.current,
    dek: gcmEncrypt(kek, dek, context),
    data: gcmEncrypt(dek, Buffer.from(JSON.stringify(value)), context),
  };
}

export function unseal<T>(sealed: Sealed, context: string, keyRing: KeyRing = ring()): T {
  const kek = keyRing.keys.get(sealed.kid);
  if (!kek) throw new Error(`Unknown key id ${sealed.kid}; is an old key missing from CREDENTIALS_KEK?`);
  const dek = gcmDecrypt(kek, sealed.dek, context);
  return JSON.parse(gcmDecrypt(dek, sealed.data, context).toString("utf8")) as T;
}

/** Re-wrap the DEK with the current KEK (key rotation). The secret itself is not touched. */
export function rewrap(sealed: Sealed, context: string, keyRing: KeyRing = ring()): Sealed {
  if (sealed.kid === keyRing.current) return sealed;
  const oldKek = keyRing.keys.get(sealed.kid);
  if (!oldKek) throw new Error(`Unknown key id ${sealed.kid}`);
  const dek = gcmDecrypt(oldKek, sealed.dek, context);
  return { ...sealed, kid: keyRing.current, dek: gcmEncrypt(keyRing.keys.get(keyRing.current)!, dek, context) };
}

/** URL-safe random token (session ids, OAuth codes, tracking ids). */
export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

/** Tokens are stored hashed, so a leaked table can't be replayed. */
export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

export function hmac(value: string, secret = env.sessionSecret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
