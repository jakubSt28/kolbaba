import { describe, expect, it } from "vitest";
import { SESSION_COOKIE_NAME } from "./cookie-name";
import { parseGoogleIdToken } from "./google-signin";
import { passkeyLabel, relyingParty } from "./passkeys";
import { safeNext } from "./safe-next";
import { SESSION_COOKIE } from "./session";
import { isSignupAllowed } from "./users";

describe("safeNext", () => {
  it("keeps same-origin paths with query and hash", () => {
    expect(safeNext("/")).toBe("/");
    expect(safeNext("/inbox?thread=thr_1#m2")).toBe("/inbox?thread=thr_1#m2");
    expect(safeNext("/oauth/authorize?client_id=x&redirect_uri=https%3A%2F%2Fa.b")).toBe(
      "/oauth/authorize?client_id=x&redirect_uri=https%3A%2F%2Fa.b",
    );
  });

  it.each([
    ["//evil.com", "protocol-relative"],
    ["///evil.com", "triple slash"],
    ["/\\evil.com", "backslash"],
    ["https://evil.com/", "absolute URL"],
    ["javascript:alert(1)", "javascript scheme"],
    ["evil.com", "relative without slash"],
    ["/\t/evil.com", "tab smuggling"],
    ["/\n/evil.com", "newline smuggling"],
    ["", "empty"],
    ["/login", "login loop"],
    ["/api/auth/logout", "auth endpoints"],
  ])("rejects %j (%s)", (input) => {
    expect(safeNext(input)).toBe("/");
  });

  it("handles missing values and custom fallbacks", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext(undefined, "/inbox")).toBe("/inbox");
    expect(safeNext("/" + "a".repeat(3000))).toBe("/");
  });

  it("normalises dot segments instead of escaping the origin", () => {
    expect(safeNext("/a/../../b")).toBe("/b");
    // Normalising these used to produce "//evil.com", a protocol-relative URL to another host.
    for (const input of ["/..//evil.com", "/.//evil.com", "/%2e%2e//evil.com", "/%2e//evil.com", "/a/..//evil.com/x"]) {
      expect(safeNext(input)).toBe("/");
    }
  });
});

describe("passkeyLabel", () => {
  it.each([
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", "iPhone"],
    ["Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15", "iPad"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", "Mac"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36", "Windows PC"],
    ["Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36", "Android phone"],
    ["Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/130.0 Safari/537.36", "Android tablet"],
    ["Mozilla/5.0 (X11; CrOS x86_64 15359.58.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36", "Chromebook"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0", "Linux PC"],
    ["curl/8.0", "Passkey"],
    [null, "Passkey"],
  ])("%s → %s", (ua, label) => {
    expect(passkeyLabel(ua)).toBe(label);
  });
});

describe("isSignupAllowed", () => {
  it("lets anyone in when the allowlist is empty", () => {
    expect(isSignupAllowed("anyone@example.com", [])).toBe(true);
  });

  it("matches full addresses case-insensitively", () => {
    const list = ["daniel@example.com"];
    expect(isSignupAllowed("Daniel@Example.com ", list)).toBe(true);
    expect(isSignupAllowed("someone@example.com", list)).toBe(false);
    expect(isSignupAllowed("daniel@example.com.evil.io", list)).toBe(false);
  });

  it("supports whole domains written as @domain", () => {
    const list = ["@team.example"];
    expect(isSignupAllowed("a@team.example", list)).toBe(true);
    expect(isSignupAllowed("a@sub.team.example", list)).toBe(false);
    expect(isSignupAllowed("a@evilteam.example", list)).toBe(false);
  });

  it("reads SIGNUP_ALLOWLIST by default", () => {
    const before = process.env.SIGNUP_ALLOWLIST;
    process.env.SIGNUP_ALLOWLIST = " Friend@Example.com , @kolbaba.test";
    try {
      expect(isSignupAllowed("friend@example.com")).toBe(true);
      expect(isSignupAllowed("x@kolbaba.test")).toBe(true);
      expect(isSignupAllowed("x@example.com")).toBe(false);
    } finally {
      if (before === undefined) delete process.env.SIGNUP_ALLOWLIST;
      else process.env.SIGNUP_ALLOWLIST = before;
    }
  });
});

describe("relyingParty", () => {
  it("derives RP ID and origin from APP_URL", () => {
    expect(relyingParty(null, "https://mail.example.com/", false)).toMatchObject({ id: "mail.example.com", origin: "https://mail.example.com" });
  });

  it("ignores the request origin in production", () => {
    expect(relyingParty("https://evil.com", "https://mail.example.com", false).id).toBe("mail.example.com");
    expect(relyingParty("http://localhost:3105", "https://mail.example.com", false).id).toBe("mail.example.com");
  });

  it("accepts any localhost port in development", () => {
    expect(relyingParty("http://localhost:3105", "http://localhost:3000", true)).toMatchObject({ id: "localhost", origin: "http://localhost:3105" });
    expect(relyingParty("http://192.168.0.5:3000", "http://localhost:3000", true).origin).toBe("http://localhost:3000");
  });
});

describe("parseGoogleIdToken", () => {
  const clientId = "client-123.apps.googleusercontent.com";
  const now = Date.UTC(2026, 9, 8);
  const jwt = (claims: Record<string, unknown>) =>
    [{ alg: "RS256", typ: "JWT" }, claims].map((p) => Buffer.from(JSON.stringify(p)).toString("base64url")).join(".") + ".sig";
  const base = { iss: "https://accounts.google.com", aud: clientId, sub: "1234", email: "a@b.cz", email_verified: true, exp: now / 1000 + 600 };

  it("returns the claims we use", () => {
    expect(parseGoogleIdToken(jwt({ ...base, name: "A B", picture: "https://x/y.png" }), clientId, now)).toEqual({
      sub: "1234",
      email: "a@b.cz",
      emailVerified: true,
      name: "A B",
      picture: "https://x/y.png",
    });
  });

  it.each([
    ["wrong audience", { aud: "someone-else" }],
    ["wrong issuer", { iss: "https://evil.example" }],
    ["expired", { exp: now / 1000 - 1 }],
    ["no email", { email: undefined }],
  ])("rejects a token with %s", (_, patch) => {
    expect(() => parseGoogleIdToken(jwt({ ...base, ...patch }), clientId, now)).toThrow();
  });

  it("treats a missing email_verified as unverified", () => {
    expect(parseGoogleIdToken(jwt({ ...base, email_verified: undefined }), clientId, now).emailVerified).toBe(false);
  });
});

it("proxy and session agree on the cookie name", () => {
  expect(SESSION_COOKIE_NAME).toBe(SESSION_COOKIE);
});
