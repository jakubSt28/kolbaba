import { describe, expect, it } from "vitest";
import { bold, cleanIntent } from "./activity";
import { identityFromRegistration, refineIdentity } from "./identity";
import { textToEditorHtml } from "./markdown";
import { authorizationServerMetadata, protectedResourceMetadata } from "./metadata";
import { formatWhen } from "./tools";

const reg = (clientName: string, extra: Partial<{ clientUri: string; logoUri: string; redirectUris: string[] }> = {}) => ({
  clientName,
  clientUri: extra.clientUri ?? null,
  logoUri: extra.logoUri ?? null,
  redirectUris: extra.redirectUris ?? [],
});

describe("agent identity", () => {
  it("maps known clients that return to their own site, this computer or their own app", () => {
    expect(identityFromRegistration(reg("Claude Code (kolbaba)", { redirectUris: ["http://localhost:33418/callback"] }))).toEqual({
      name: "Claude",
      app: "Claude Code",
      logo: "claude.ai",
      verified: true,
    });
    expect(identityFromRegistration(reg("ChatGPT", { redirectUris: ["https://chatgpt.com/connector_platform_oauth_redirect"] }))).toMatchObject({
      app: "ChatGPT",
      logo: "chatgpt.com",
      verified: true,
    });
    expect(identityFromRegistration(reg("Cursor", { redirectUris: ["cursor://anysphere.cursor-retrieval/oauth/callback"] })).verified).toBe(true);
    const base = identityFromRegistration(reg("Claude", { redirectUris: ["https://claude.ai/api/mcp/auth_callback"] }));
    expect(refineIdentity(base, { name: "claude-ai" }, true)).toEqual({ name: "Claude", app: "Claude", logo: "claude.ai" });
    expect(refineIdentity(base, { name: "claude-code" }, true).app).toBe("Claude Code");
    expect(refineIdentity(base, { name: "openai-mcp" }, true).app).toBe("ChatGPT");
  });

  it("doesn't lend a known app's name or logo to someone else's redirect", () => {
    const impostor = reg("Claude Desktop", { logoUri: "https://evil.example/claude.png", redirectUris: ["https://evil.example/cb"] });
    expect(identityFromRegistration(impostor)).toEqual({ name: "Claude Desktop", app: "Claude Desktop", logo: null, verified: false });
    expect(identityFromRegistration(reg("Claude", { redirectUris: ["https://claude.ai.evil.example/cb"] })).verified).toBe(false);
    expect(identityFromRegistration(reg("ChatGPT")).verified).toBe(false);
    // Nor through the MCP handshake: an unverified client saying it's Claude keeps no logo and gets just its own label.
    const unknown = identityFromRegistration(reg("AI agent"));
    expect(refineIdentity(unknown, { name: "claude-ai" }, false)).toMatchObject({ name: "claude-ai", app: "claude-ai", logo: null });
    expect(refineIdentity(identityFromRegistration(reg("Helper")), { name: "claude-ai" }, false).app).toBe("Helper");
  });

  it("falls back to what the client told us", () => {
    expect(identityFromRegistration(reg("Acme Bot", { clientUri: "https://acme.example/about" }))).toEqual({
      name: "Acme Bot",
      app: "Acme Bot",
      logo: "acme.example",
      verified: false,
    });
    expect(identityFromRegistration(reg("", { redirectUris: ["https://bot.example/cb"] }))).toEqual({ name: "AI agent", app: "AI agent", logo: "bot.example", verified: false });
    const unknown = identityFromRegistration(reg("AI agent"));
    expect(refineIdentity(unknown, { name: "my-agent", title: "My Agent" }, false).app).toBe("My Agent");
    // A known registration isn't overwritten by an unknown clientInfo.
    expect(refineIdentity(identityFromRegistration(reg("Acme Bot")), { name: "whatever" }, false).app).toBe("Acme Bot");
  });
});

describe("activity text", () => {
  it("keeps bold markers intact and intents short", () => {
    expect(bold("**Sale** 50% *off*")).toBe("**Sale 50% off**");
    expect(bold("  ")).toBe("**(no subject)**");
    expect(cleanIntent("  Triage\n the **inbox** ")).toBe("Triage the inbox");
    expect(cleanIntent("x".repeat(300))?.length).toBe(120);
    expect(cleanIntent("")).toBeNull();
  });

  it("formats times in the offset the agent used", () => {
    expect(formatWhen("2026-10-09T08:00:00+02:00", new Date("2026-10-09T06:00:00Z"))).toBe("Fri 9 Oct, 08:00");
    expect(formatWhen("2026-10-09T06:00:00Z", new Date("2026-10-09T06:00:00Z"))).toBe("Fri 9 Oct, 06:00 UTC");
  });
});

describe("markdown → editor HTML", () => {
  it("converts the email subset and escapes everything else", () => {
    expect(textToEditorHtml("Hi Petr,\nthanks!\n\nBest")).toBe("<p>Hi Petr,<br>thanks!</p><p>Best</p>");
    expect(textToEditorHtml("1. one\n2. two")).toBe("<ol><li><p>one</p></li><li><p>two</p></li></ol>");
    expect(textToEditorHtml("> quoted")).toBe("<blockquote><p>quoted</p></blockquote>");
    expect(textToEditorHtml("## Plan")).toBe("<h2>Plan</h2>");
    expect(textToEditorHtml("<script>alert(1)</script> [x](javascript:alert(1))")).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt; [x](javascript:alert(1))</p>");
    expect(textToEditorHtml("see [docs](https://a.example/x?a=1&b=2) and _this_")).toBe(
      '<p>see <a href="https://a.example/x?a=1&amp;b=2">docs</a> and <em>this</em></p>',
    );
  });
});

describe("discovery metadata", () => {
  it("points the MCP resource at our authorization server", () => {
    expect(protectedResourceMetadata()).toMatchObject({ resource: "http://localhost:3000/api/mcp", authorization_servers: ["http://localhost:3000"] });
    expect(authorizationServerMetadata()).toMatchObject({
      issuer: "http://localhost:3000",
      authorization_endpoint: "http://localhost:3000/oauth/authorize",
      token_endpoint: "http://localhost:3000/api/oauth/token",
      registration_endpoint: "http://localhost:3000/api/oauth/register",
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    });
  });
});
