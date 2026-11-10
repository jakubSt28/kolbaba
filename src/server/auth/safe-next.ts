/**
 * Where to send someone after signing in. Only same-origin paths are allowed, so `?next=` can't be
 * turned into an open redirect (`//evil.com`, `/\evil.com`, `https://…`, `javascript:` and friends).
 * Pure and dependency-free so the proxy can use it too.
 */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 2048) return fallback;
  // Must be an absolute path, but not protocol-relative ("//host") or backslash tricks ("/\host").
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  // Control characters (tabs/newlines are stripped by URL parsers and can smuggle a "//").
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
  try {
    const base = "http://n.invalid";
    const url = new URL(next, base);
    if (url.origin !== base) return fallback;
    // Never bounce back into the auth flow itself.
    if (url.pathname === "/login" || url.pathname.startsWith("/api/auth/")) return fallback;
    const out = url.pathname + url.search + url.hash;
    // Dot segments can normalise "/..//evil.com" into "//evil.com", which a browser reads as another host.
    if (out.startsWith("//") || out.startsWith("/\\")) return fallback;
    return out;
  } catch {
    return fallback;
  }
}
