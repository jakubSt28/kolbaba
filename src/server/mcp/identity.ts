/**
 * Who is this agent? Dynamic client registration only gives us a self-chosen `client_name`, and the
 * MCP `initialize` handshake adds `clientInfo` ({ name: "claude-ai" | "claude-code" | …}). Known
 * clients get a friendly app name and a logo domain; anything else falls back to what it told us.
 */

export interface AgentIdentity {
  /** Model / agent family, e.g. "Claude". */
  name: string;
  /** Host app, e.g. "Claude Code". */
  app: string;
  /** Domain for the logo (the UI loads its favicon). */
  logo: string | null;
}

/** First match wins, so the more specific patterns go first. Tested against clientInfo.name and client_name. */
const KNOWN: { match: RegExp; name: string; app: string; logo: string; domains: string[] }[] = [
  { match: /claude[\s_-]*code/i, name: "Claude", app: "Claude Code", logo: "claude.ai", domains: ["claude.ai", "claude.com", "anthropic.com"] },
  { match: /claude[\s_-]*desktop/i, name: "Claude", app: "Claude Desktop", logo: "claude.ai", domains: ["claude.ai", "claude.com", "anthropic.com"] },
  { match: /claude|anthropic/i, name: "Claude", app: "Claude", logo: "claude.ai", domains: ["claude.ai", "claude.com", "anthropic.com"] },
  { match: /chatgpt|openai/i, name: "ChatGPT", app: "ChatGPT", logo: "chatgpt.com", domains: ["chatgpt.com", "openai.com"] },
  { match: /codex/i, name: "Codex", app: "Codex", logo: "chatgpt.com", domains: ["chatgpt.com", "openai.com"] },
  { match: /cursor/i, name: "Cursor", app: "Cursor", logo: "cursor.com", domains: ["cursor.com", "cursor.sh"] },
  { match: /windsurf|codeium/i, name: "Windsurf", app: "Windsurf", logo: "windsurf.com", domains: ["windsurf.com", "codeium.com"] },
  { match: /visual studio code|vscode|copilot/i, name: "Copilot", app: "VS Code", logo: "code.visualstudio.com", domains: ["vscode.dev", "github.com"] },
  { match: /\bzed\b/i, name: "Zed", app: "Zed", logo: "zed.dev", domains: ["zed.dev"] },
  { match: /raycast/i, name: "Raycast", app: "Raycast", logo: "raycast.com", domains: ["raycast.com"] },
  { match: /gemini/i, name: "Gemini", app: "Gemini", logo: "gemini.google.com", domains: ["google.com"] },
  { match: /goose/i, name: "Goose", app: "Goose", logo: "block.xyz", domains: ["block.xyz"] },
  { match: /inspector/i, name: "MCP Inspector", app: "MCP Inspector", logo: "modelcontextprotocol.io", domains: [] },
];

export function knownClient(label: string | null | undefined): AgentIdentity | null {
  if (!label) return null;
  const hit = KNOWN.find((k) => k.match.test(label));
  return hit ? { name: hit.name, app: hit.app, logo: hit.logo } : null;
}

/**
 * A well-known app sends people back to its own website, to this computer (loopback) or to its own
 * installed app (a custom scheme). Anything else claiming to be Claude or ChatGPT is someone else.
 */
function trustedRedirect(uri: string, domains: string[]) {
  try {
    const u = new URL(uri);
    if (u.protocol === "https:") return domains.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`));
    if (u.protocol === "http:") return u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
    return true;
  } catch {
    return false;
  }
}

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.hostname : null;
  } catch {
    return null;
  }
}

const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);

/**
 * Identity at consent time, from the client's registration. Registration is open, so a known name
 * only counts when the redirect belongs to that app; `verified: false` makes the consent page warn and
 * show neither that brand's logo nor the client's own logo_uri.
 */
export function identityFromRegistration(client: {
  clientName: string;
  clientUri: string | null;
  logoUri: string | null;
  redirectUris: string[];
}): AgentIdentity & { verified: boolean } {
  const hit = KNOWN.find((k) => k.match.test(client.clientName));
  if (hit && client.redirectUris.length && client.redirectUris.every((u) => trustedRedirect(u, hit.domains))) {
    return { name: hit.name, app: hit.app, logo: hit.logo, verified: true };
  }
  const name = clean(client.clientName) || "AI agent";
  const httpsRedirect = client.redirectUris.find((u) => u.startsWith("https://"));
  // An impostor of a known app gets no logo at all; an unknown app gets the icon of its own website.
  const logo = hit ? null : (hostOf(client.clientUri) ?? hostOf(httpsRedirect));
  return { name, app: name, logo, verified: false };
}

/**
 * Refine with MCP clientInfo. It is the better signal for the *app* (one DCR client name like
 * "Claude" covers claude.ai, Desktop and mobile), so a known clientInfo wins, but only for a client
 * whose registration proved it's that company's app (`verified`): anyone can send clientInfo
 * "claude-ai", and a known brand's name and logo aren't theirs to take. An unknown one (or a known one
 * from an unverified client, as its plain label) only fills in when registration told us nothing useful.
 */
export function refineIdentity(current: AgentIdentity, info: { name?: string; title?: string } | null | undefined, verified: boolean): AgentIdentity {
  const known = knownClient(info?.name) ?? knownClient(info?.title);
  if (known && verified) return known;
  const label = clean(info?.title || info?.name || "");
  if (label && (current.app === "AI agent" || !current.app)) return { ...current, name: label, app: label };
  return current;
}
