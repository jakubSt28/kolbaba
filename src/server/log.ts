/**
 * Error text that's safe to log or store. Drizzle puts every bound parameter of a failed query into
 * the error message (and so into the stack), and those parameters are mail: bodies, addresses,
 * subjects, drafts. Logs and status fields must only ever get the kind of failure.
 */
export function safeError(err: unknown): string {
  if (err && typeof err === "object" && "query" in err && "params" in err) {
    const cause = (err as { cause?: { code?: string; constraint_name?: string } }).cause;
    const detail = [cause?.code, cause?.constraint_name].filter(Boolean).join(" ");
    return `Database query failed${detail ? ` (${detail})` : ""}`;
  }
  const message = err instanceof Error ? err.message : String(err);
  return `${message}${connectionDetail(err)}`.slice(0, 300);
}

/**
 * imapflow's "Connection not available" says nothing on its own; it carries why (the server's BYE)
 * and where it happened (connecting, a command, opening a folder). Folder names and the server's
 * words, never mail.
 */
function connectionDetail(err: unknown): string {
  if (!err || typeof err !== "object" || !("rejectedFrom" in err || "reason" in err)) return "";
  const e = err as { code?: unknown; reason?: unknown; rejectedFrom?: unknown; command?: unknown; path?: unknown };
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, 120) : null);
  const parts = [
    text(e.reason) && `server said "${text(e.reason)}"`,
    text(e.rejectedFrom) && `at ${text(e.rejectedFrom)}${text(e.command) ? ` ${text(e.command)}` : ""}${text(e.path) ? ` "${text(e.path)}"` : ""}`,
    text(e.code),
  ].filter(Boolean);
  return parts.length ? ` (${parts.join("; ")})` : "";
}

/** console.error for server failures: the safe text plus where it happened, never the raw error. */
export function logError(tag: string, err: unknown) {
  const frames = err instanceof Error ? (err.stack ?? "").split("\n").slice(1, 6).join("\n") : "";
  console.error(`${tag} ${safeError(err)}${frames ? `\n${frames}` : ""}`);
}

export function logWarn(tag: string, err: unknown) {
  console.warn(`${tag} ${safeError(err)}`);
}
