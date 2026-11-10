/**
 * Cookie names without importing the session module (which pulls in the database), for the proxy.
 *
 * Over HTTPS the names carry a prefix the browser enforces: `__Host-` (this exact host, path /, Secure,
 * no Domain) for the session, `__Secure-` for the short flow cookies that live under one API path. A
 * sibling subdomain can't plant or overwrite those. Plain http (local development) can't carry them.
 */
export const SECURE_COOKIES = process.env.NODE_ENV === "production";

/** Must equal SESSION_COOKIE in ./session.ts; a test asserts it. */
export const SESSION_COOKIE_NAME = SECURE_COOKIES ? "__Host-kolbaba_session" : "kolbaba_session";

/** The session cookie's name before 26 Oct 2026: still read (and moved over) so nobody is signed out by the rename. */
export const LEGACY_SESSION_COOKIE_NAME = "kolbaba_session";

/** A cookie that lives under one API path (sign-in round trips): `__Secure-` over HTTPS. */
export const pathCookie = (name: string) => (SECURE_COOKIES ? `__Secure-${name}` : name);
