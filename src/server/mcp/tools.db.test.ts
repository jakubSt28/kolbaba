import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, schema } from "../db";
import type { AgentPermission } from "../db/schema";
import { GET } from "@/app/api/attachment-links/[token]/[name]/route";
import { activityFor, undoEvent } from "./activity";
import { openAttachmentLink } from "./attachment-links";
import { json } from "./config";
import { authorizationServerMetadata, protectedResourceMetadata } from "./metadata";
import { approve, authenticateClient, checkAuthorizeRequest, exchangeCode, readForm, refresh, registerClient } from "./oauth";
import { handleMcpRequest } from "./server";
import { cleanup, seed, trackClient } from "./test-helpers";
import { createFolder } from "../mail/folders";

/** Provider write-through is faked: these tests are about the MCP layer, not IMAP. */
const adapter = vi.hoisted(() => ({
  setFlags: vi.fn(async () => {}),
  move: vi.fn(async () => {}),
  fetchBody: vi.fn(async () => ({ html: "<p>fetched</p>", text: "fetched", attachments: [] })),
  fetchAttachment: vi.fn(),
  createFolder: vi.fn(async (name: string) => ({ ref: `INBOX.${name}` })),
  moveToFolder: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
}));
vi.mock("../mail/adapters", () => ({
  withAdapter: async (_row: unknown, fn: (a: typeof adapter) => Promise<unknown>) => fn(adapter),
  adapterFor: () => adapter,
}));
vi.mock("../worker-client", () => ({ hasWorker: () => true, nudgeWorker: vi.fn(async () => true) }));
const push = vi.hoisted(() => ({ notifyUser: vi.fn(async () => {}), userLocale: vi.fn(async () => "en" as const) }));
vi.mock("../push", () => push);

afterAll(cleanup);
beforeEach(() => vi.clearAllMocks());

const ORIGIN = "http://localhost:3000";

/** Routes the SDK client's requests to our handlers, as Next would. */
async function appFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const req = input instanceof Request ? input : new Request(input, init);
  const path = new URL(req.url).pathname;
  if (path.startsWith("/.well-known/oauth-protected-resource")) return json(protectedResourceMetadata());
  if (path.startsWith("/.well-known/oauth-authorization-server")) return json(authorizationServerMetadata());
  if (path === "/api/oauth/register") return json(await registerClient(await req.json()), 201);
  if (path === "/api/oauth/token") {
    const form = await readForm(req);
    const client = await authenticateClient(form, req.headers.get("authorization"));
    return json(form.get("grant_type") === "refresh_token" ? await refresh(client, form) : await exchangeCode(client, form));
  }
  if (path === "/api/mcp") return handleMcpRequest(req);
  return new Response("not found", { status: 404 });
}

async function connect(token: string, name = "claude-code") {
  const client = new Client({ name, version: "2.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/api/mcp`), {
    fetch: appFetch,
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return { client, transport };
}

const text = (r: unknown) => ((r as CallToolResult).content[0] as { text: string }).text;
/** A tool's JSON, also when it comes fenced as third parties' content (lists of conversations). */
const data = (r: unknown) => JSON.parse(text(r).replace(/^[\s\S]*?<untrusted_email_content>\n/, "").replace(/\n<\/untrusted_email_content>\s*$/, ""));

async function setup(permission: AgentPermission = "draft") {
  const s = await seed(permission);
  const { client, transport } = await connect(s.tokens.access_token);
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
  return { ...s, client, transport, call };
}

/** A one-page PDF with these lines in Helvetica (none: a page with no text, like a scan). */
function pdf(lines: string[]) {
  const stream = lines.length ? `BT /F1 12 Tf 72 720 Td ${lines.map((l, i) => `${i ? "0 -16 Td " : ""}(${l}) Tj`).join(" ")} ET` : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = objects.map((o, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const events = (agentId: string) => db().select().from(schema.agentEvents).where(eq(schema.agentEvents.agentId, agentId)).orderBy(schema.agentEvents.at);

describe("MCP over Streamable HTTP (SDK client)", () => {
  it("initializes, lists tools with annotations, and records clientInfo", async () => {
    const { client, transport, agent } = await setup();
    expect(client.getServerVersion()?.name).toBe("kolbaba");
    expect(client.getInstructions()).toContain("untrusted");
    expect(transport.sessionId).toBeTruthy();

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "list_mailboxes",
        "search",
        "list_threads",
        "read_thread",
        "create_draft",
        "update_draft",
        "delete_draft",
        "send",
        "archive",
        "move_to_inbox",
        "mark_read",
        "mark_unread",
        "pin",
        "unpin",
        "snooze",
        "list_folders",
        "move_to_folder",
        "trash",
        "remind_if_no_reply",
        "set_note",
        "screen_sender",
        "unsubscribe",
        "get_attachment",
      ]),
    );
    expect(tools.find((t) => t.name === "search")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "send")?.annotations?.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === "archive")?.inputSchema.properties).toHaveProperty("intent");

    const [row] = await db().select().from(schema.agents).where(eq(schema.agents.id, agent.id));
    expect(row.clientInfo).toMatchObject({ name: "claude-code", version: "2.0.0" });
    expect(row).toMatchObject({ app: "Claude Code", logo: "claude.ai" });
  });

  it("only ever shows mailboxes the user shared", async () => {
    const { call, shared, hidden, secret } = await setup("read");
    const boxes = data(await call("list_mailboxes")).mailboxes.map((m: { id: string }) => m.id);
    expect(boxes).toEqual([shared.id]);

    const found = data(await call("search", { query: "invoice" })).results.map((t: { thread_id: string }) => t.thread_id);
    expect(found).toHaveLength(1);
    expect(found).not.toContain(secret.id);

    expect((await call("read_thread", { thread_id: secret.id })).isError).toBe(true);
    expect((await call("search", { query: "invoice", mailbox: hidden.email })).isError).toBe(true);
    expect(data(await call("list_threads", { folder: "inbox" })).threads.map((t: { thread_id: string }) => t.thread_id)).not.toContain(secret.id);
  });

  it("reads a thread as fenced plain text and can't be broken out of the fence", async () => {
    const { call, invoice } = await setup("read");
    const out = text(await call("read_thread", { thread_id: invoice.id }));
    // The subject and the message's people are fenced too, not only its body.
    expect(out).toContain("Subject:\n<untrusted_email_content>\nInvoice #2026-114\n</untrusted_email_content>");
    expect(out).toMatch(/<untrusted_email_content>\nFrom: Martina Dvořáková/);
    expect(out).toContain("Hello, here is Invoice #2026-114.");
    // One fence for the subject, one for the message: the body's fake closing tag didn't add another.
    expect(out.match(/<\/untrusted_email_content>/g)).toHaveLength(2);
    expect(out).toContain("[removed]");
    expect(out).not.toContain("<p>");
  });

  it("enforces the permission on every call, even mid-session", async () => {
    const { call, invoice, agent } = await setup("read");
    const denied = await call("archive", { thread_id: invoice.id });
    expect(denied.isError).toBe(true);
    expect(text(denied)).toContain("Organize & draft");

    await db().update(schema.agents).set({ permission: "draft" }).where(eq(schema.agents.id, agent.id));
    expect((await call("archive", { thread_id: invoice.id })).isError).toBeFalsy();
    expect((await call("send", { mailbox: "x", to: "a@b.cz", body: "hi" })).isError).toBe(true);

    // The mailbox taken away from this agent: its mail is out of reach at once.
    await db().update(schema.agents).set({ accountIds: [] }).where(eq(schema.agents.id, agent.id));
    expect((await call("mark_read", { thread_id: invoice.id })).isError).toBe(true);
  });

  it("logs every step in one run titled by the intent, with undo data", async () => {
    const { call, invoice, agent } = await setup();
    await call("search", { query: "invoice", intent: "Triaging this morning's inbox" });
    await call("mark_read", { thread_id: invoice.id, intent: "Triaging this morning's inbox" });
    await call("archive", { thread_id: invoice.id, intent: "Triaging this morning's inbox" });
    expect(adapter.move).toHaveBeenCalledOnce();

    const rows = await events(agent.id);
    expect(rows.map((r) => r.action)).toEqual(["search", "mark_read", "archive"]);
    expect(new Set(rows.map((r) => r.sessionId)).size).toBe(1);
    expect(rows[2].summary).toBe("Archived **Invoice #2026-114**");
    expect(rows[1].undo).toEqual({ kind: "thread", unread: true });
    expect(rows[2].undo).toMatchObject({ kind: "thread", folder: "inbox" });
    expect(rows[0].undo).toBeNull();

    const [session] = await db().select().from(schema.agentSessions).where(eq(schema.agentSessions.id, rows[0].sessionId));
    expect(session.title).toBe("Triaging this morning's inbox");
    expect(session.mcpSessionId).toBeTruthy();

    // A different task in the same MCP session is a new run.
    await call("pin", { thread_id: invoice.id, intent: "Flag things for the accountant" });
    const later = await events(agent.id);
    expect(later[3].sessionId).not.toBe(rows[0].sessionId);

    const [a] = await db().select().from(schema.agents).where(eq(schema.agents.id, agent.id));
    expect(a.lastActiveAt).toBeTruthy();
  });

  it("titles a run without intent generically, then adopts the first intent", async () => {
    const { call, invoice, agent } = await setup();
    await call("mark_unread", { thread_id: invoice.id });
    let [session] = await db().select().from(schema.agentSessions).where(eq(schema.agentSessions.agentId, agent.id));
    expect(session.title).toBe("Inbox triage");
    await call("pin", { thread_id: invoice.id, intent: "Sort the invoices" });
    [session] = await db().select().from(schema.agentSessions).where(eq(schema.agentSessions.agentId, agent.id));
    expect(session.title).toBe("Sort the invoices");
  });

  it("drafts a reply in Markdown and undo removes it", async () => {
    const { call, invoice, agent, user } = await setup();
    const res = data(await call("create_draft", { reply_to_thread_id: invoice.id, body: "Hi Martina,\n\n- **paid** today\n- see https://example.com" }));
    expect(res.subject).toBe("Re: Invoice #2026-114");
    expect(res.to).toContain("martina@");
    const [draft] = await db().select().from(schema.drafts).where(eq(schema.drafts.id, res.draft_id));
    expect(draft.agentId).toBe(agent.id);
    expect(draft.html).toBe('<p>Hi Martina,</p><ul><li><p><strong>paid</strong> today</p></li><li><p>see <a href="https://example.com">https://example.com</a></p></li></ul>');

    const [ev] = await events(agent.id);
    expect(ev.summary).toBe("Drafted a reply to **Martina Dvořáková**");
    const undone = await undoEvent(user.id, ev.id);
    expect(undone.event.undone).toBe(true);
    expect(undone.draft?.removed).toBe(res.draft_id);
    expect(await db().select().from(schema.drafts).where(eq(schema.drafts.id, res.draft_id))).toHaveLength(0);
    await expect(undoEvent(user.id, ev.id)).rejects.toMatchObject({ status: 409 });
  });

  it("files a conversation in the user's folder by name, and undo takes it back out", async () => {
    const { call, invoice, agent, user } = await setup();
    const folder = await createFolder(user.id, { name: "Faktury" });
    expect(data(await call("list_folders")).folders).toEqual([expect.objectContaining({ folder_id: folder.id, name: "Faktury" })]);

    const missing = await call("move_to_folder", { thread_id: invoice.id, folder: "Účty" });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toContain("Faktury");

    const res = data(await call("move_to_folder", { thread_id: invoice.id, folder: "faktury" }));
    expect(res.folder).toBe("Faktury");
    expect(adapter.moveToFolder).toHaveBeenCalledOnce();
    const filed = async () => (await db().select().from(schema.threads).where(eq(schema.threads.id, invoice.id)))[0];
    expect((await filed()).folderId).toBe(folder.id);

    const [ev] = (await events(agent.id)).filter((e) => e.action === "move");
    expect(ev.summary).toBe("Moved **Invoice #2026-114** to Faktury");
    await undoEvent(user.id, ev.id);
    expect(await filed()).toMatchObject({ folderId: null, folder: "inbox" });
  });

  it("won't file mail out of Spam or Trash", async () => {
    const { call, invoice, user } = await setup();
    await createFolder(user.id, { name: "Faktury" });
    await db().update(schema.threads).set({ folder: "spam" }).where(eq(schema.threads.id, invoice.id));
    expect((await call("move_to_folder", { thread_id: invoice.id, folder: "Faktury" })).isError).toBe(true);
  });

  it("won't let an agent edit or delete the user's own drafts", async () => {
    const { call, shared, user } = await setup();
    const [mine] = await db().insert(schema.drafts).values({ userId: user.id, accountId: shared.id, subject: "Mine" }).returning();
    expect((await call("update_draft", { draft_id: mine.id, subject: "Hacked" })).isError).toBe(true);
    expect((await call("delete_draft", { draft_id: mine.id })).isError).toBe(true);
  });

  it("sends with Full access through the outbox, notifies, and can be undone while queued", async () => {
    const { call, shared, agent, user } = await setup("full");
    const day = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const res = data(await call("send", { mailbox: shared.email, to: "Petr <petr@example.com>", subject: "Hello", body: "Hi!", schedule_at: `${day}T08:00:00+01:00` }));
    expect(res.status).toBe("scheduled");
    const [out] = await db().select().from(schema.outbox).where(eq(schema.outbox.id, res.outbox_id));
    expect(out).toMatchObject({ agentId: agent.id, scheduled: true, status: "pending" });
    expect(push.notifyUser).toHaveBeenCalledWith(user.id, expect.objectContaining({ title: "Claude Code scheduled an email" }));

    const [ev] = await events(agent.id);
    expect(ev.summary).toMatch(/^Scheduled \*\*Hello\*\* to Petr for \w{3} \d{1,2} \w{3}, 08:00$/);
    const before = await activityFor(user.id);
    expect(before.events.find((e) => e.id === ev.id)?.undoable).toBe(true);

    const undone = await undoEvent(user.id, ev.id);
    expect(undone.draft?.restored?.subject).toBe("Hello");
    const [cancelled] = await db().select().from(schema.outbox).where(eq(schema.outbox.id, res.outbox_id));
    expect(cancelled.status).toBe("cancelled");
  });

  it("can't undo a send that already went out", async () => {
    const { call, shared, agent, user } = await setup("full");
    const res = data(await call("send", { mailbox: shared.id, to: "petr@example.com", subject: "Now", body: "Hi" }));
    expect(res.status).toBe("sending");
    await db().update(schema.outbox).set({ status: "sent" }).where(eq(schema.outbox.id, res.outbox_id));
    const [ev] = await events(agent.id);
    expect((await activityFor(user.id)).events.find((e) => e.id === ev.id)?.undoable).toBeUndefined();
    await expect(undoEvent(user.id, ev.id)).rejects.toMatchObject({ status: 409 });
    const [row] = await db().select().from(schema.agentEvents).where(eq(schema.agentEvents.id, ev.id));
    expect(row.undone).toBe(false);
  });

  it("undo restores archive, read state, pin and snooze through the service", async () => {
    const { call, invoice, agent, user } = await setup();
    await call("archive", { thread_id: invoice.id });
    await call("mark_read", { thread_id: invoice.id });
    await call("pin", { thread_id: invoice.id });
    const until = new Date(Date.now() + 86_400_000).toISOString();
    await call("snooze", { thread_id: invoice.id, until });
    const thread = async () => (await db().select().from(schema.threads).where(eq(schema.threads.id, invoice.id)))[0];
    expect(await thread()).toMatchObject({ folder: "inbox", unread: false, pinned: true });

    const rows = await events(agent.id);
    for (const ev of [...rows].reverse()) await undoEvent(user.id, ev.id);
    expect(await thread()).toMatchObject({ folder: "inbox", unread: true, pinned: false, snoozedUntil: null });
    expect(adapter.move).toHaveBeenLastCalledWith(expect.anything(), "inbox");
  });

  it("trashes, notes and sets a reminder, all undoable; unsubscribing needs Full access", async () => {
    const { call, invoice, agent, user } = await setup();
    const thread = async () => (await db().select().from(schema.threads).where(eq(schema.threads.id, invoice.id)))[0];
    await call("set_note", { thread_id: invoice.id, note: "Paid by bank transfer on the 15th." });
    const at = new Date(Date.now() + 3 * 86_400_000).toISOString();
    await call("remind_if_no_reply", { thread_id: invoice.id, at });
    expect(await thread()).toMatchObject({ note: "Paid by bank transfer on the 15th." });
    expect((await thread()).followUpAt?.toISOString()).toBe(at);
    expect(text(await call("read_thread", { thread_id: invoice.id }))).toContain("Paid by bank transfer on the 15th.");
    await call("trash", { thread_id: invoice.id });
    expect(await thread()).toMatchObject({ folder: "trash" });
    expect(adapter.move).toHaveBeenLastCalledWith(expect.anything(), "trash");

    const unsubscribe = await call("unsubscribe", { thread_id: invoice.id });
    expect((unsubscribe as CallToolResult).isError).toBe(true);
    expect(text(unsubscribe)).toContain("Full access");

    const rows = await events(agent.id);
    expect(rows.map((r) => r.action)).toEqual(["note", "remind", "read", "trash"]);
    for (const ev of [...rows].reverse()) if (ev.undo) await undoEvent(user.id, ev.id);
    expect(await thread()).toMatchObject({ folder: "inbox", note: "", followUpAt: null });
  });

  it("hands over a PDF's text, not only the file many MCP apps can't open", async () => {
    const { call, invoice } = await setup("read");
    const [m] = await db().select().from(schema.messages).where(eq(schema.messages.threadId, invoice.id));
    const files = [
      { id: "att/1", name: "vyuctovani.pdf", size: 700, mime: "application/pdf" },
      { id: "att/2", name: "scan.pdf", size: 400, mime: "application/pdf" },
      { id: "att/3", name: "broken.pdf", size: 9, mime: "application/pdf" },
    ];
    await db().update(schema.messages).set({ attachments: files }).where(eq(schema.messages.id, m.id));
    const pdfs: Record<string, Buffer> = { "att/1": pdf(["Vyuctovani za rijen 2026", "Celkem k uhrade: 1 234 Kc"]), "att/2": pdf([]), "att/3": Buffer.from("not a pdf") };
    adapter.fetchAttachment.mockImplementation(async (_ref: unknown, id: string) => ({ name: "", mime: "", content: pdfs[id] }));
    const get = async (id: string) => (await call("get_attachment", { message_id: m.id, attachment_id: id })) as CallToolResult;

    const bill = await get("att/1");
    expect(text(bill)).toContain("vyuctovani.pdf (application/pdf, 1 KB), 1 page. Its text:\n\nVyuctovani za rijen 2026\nCelkem k uhrade: 1 234 Kc\n</untrusted_email_content>");
    const link = `${ORIGIN}/api/attachments/${m.id}/att%2F1?download`;
    expect(text(bill)).toContain(`The user can open it in Kolbaba wherever they're signed in: ${link}`);
    // The file itself still goes along for the apps that do open it.
    expect(bill.content[1]).toEqual({ type: "resource", resource: { uri: link, mimeType: "application/pdf", blob: pdfs["att/1"].toString("base64") } });

    expect(text(await get("att/2"))).toContain("no text layer (probably a scan)");
    expect(text(await get("att/3"))).toContain("couldn't be read");
  });

  it("gives a download link that works without signing in, for a few minutes, while the agent has access", async () => {
    const { call, invoice, agent, shared } = await setup("read");
    const [m] = await db().select().from(schema.messages).where(eq(schema.messages.threadId, invoice.id));
    await db()
      .update(schema.messages)
      .set({ attachments: [{ id: "att/0", name: "logo.png", size: 10, mime: "image/png" }, { id: "att/1", name: "smlouva č. 5.docx", size: 4, mime: "application/msword" }] })
      .where(eq(schema.messages.id, m.id));
    const docx = Buffer.from("PK\x03\x04");
    adapter.fetchAttachment.mockResolvedValue({ name: "", mime: "", content: docx });
    const out = text(await call("get_attachment", { message_id: m.id, attachment_id: "att/1" }));
    const url = out.match(/download it from (\S+) /)![1];
    expect(url).toMatch(new RegExp(`^${ORIGIN}/api/attachment-links/[^/]+/smlouva%20%C4%8D.%205.docx$`));
    const token = url.split("/").at(-2)!;
    const download = (t = token) => GET(new Request(url), { params: Promise.resolve({ token: t, name: "x" }) });

    const res = await download();
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(docx);
    expect(res.headers.get("content-disposition")).toBe("attachment; filename*=UTF-8''smlouva%20%C4%8D.%205.docx");
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    // The second attachment, not the first: the link points at its place in the message.
    expect(adapter.fetchAttachment).toHaveBeenLastCalledWith(expect.anything(), "att/1");

    // A changed link, an old one, or one of an agent that lost access opens nothing.
    expect((await download(token.replace(/\.(\d+)\./, ".0."))).status).toBe(404);
    expect(await openAttachmentLink(token, Date.now() + 16 * 60_000)).toBeNull();
    await db().update(schema.agents).set({ accountIds: [] }).where(eq(schema.agents.id, agent.id));
    expect((await download()).status).toBe(404);
    await db().update(schema.agents).set({ accountIds: [shared.id], enabled: false }).where(eq(schema.agents.id, agent.id));
    expect((await download()).status).toBe(404);
  });

  it("serves the activity feed in the client's shapes and maps extra actions", async () => {
    const { call, invoice, agent, user } = await setup();
    await call("mark_unread", { thread_id: invoice.id, intent: "Check" });
    const feed = await activityFor(user.id);
    expect(feed.agents).toEqual([expect.objectContaining({ id: agent.id, app: "Claude Code", logo: "claude.ai", permission: "draft", enabled: true })]);
    expect(feed.sessions).toEqual([{ id: expect.any(String), agentId: agent.id, title: "Check" }]);
    expect(feed.events[0]).toMatchObject({ action: "mark_read", summary: "Marked **Invoice #2026-114** as unread", threadId: invoice.id, undoable: true });
    // Other users never see it.
    const other = await seed();
    expect((await activityFor(other.user.id)).events).toHaveLength(0);
    await expect(undoEvent(other.user.id, feed.events[0].id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("full OAuth discovery from a bare 401 (what Claude Code / Cursor do)", () => {
  it("discovers, registers, authorizes with PKCE + resource, and calls a tool", async () => {
    const { user } = await seed();
    let tokens: OAuthTokens | undefined;
    let info: OAuthClientInformationMixed | undefined;
    let verifier = "";
    let authUrl: URL | undefined;
    const provider = {
      redirectUrl: "http://127.0.0.1:33418/callback",
      clientMetadata: { redirect_uris: ["http://127.0.0.1:33418/callback"], client_name: "Cursor", token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] },
      clientInformation: () => info,
      saveClientInformation: (i: OAuthClientInformationMixed) => {
        info = i;
        trackClient(i.client_id);
      },
      tokens: () => tokens,
      saveTokens: (t: OAuthTokens) => void (tokens = t),
      redirectToAuthorization: (url: URL) => void (authUrl = url),
      saveCodeVerifier: (v: string) => void (verifier = v),
      codeVerifier: () => verifier,
    };
    const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/api/mcp`), { fetch: appFetch, authProvider: provider });
    const client = new Client({ name: "cursor-vscode", version: "1.0.0" });
    await expect(client.connect(transport)).rejects.toThrow(/Unauthorized/i);
    expect(authUrl?.origin + authUrl!.pathname).toBe(`${ORIGIN}/oauth/authorize`);
    expect(authUrl!.searchParams.get("resource")).toBe(`${ORIGIN}/api/mcp`);

    // The user clicks Allow on the consent screen.
    const check = await checkAuthorizeRequest(Object.fromEntries(authUrl!.searchParams));
    if (check.kind !== "ok") throw new Error(`consent failed: ${check.kind}`);
    const { redirect } = await approve(user.id, check.client, check.params, "read");
    await transport.finishAuth(new URL(redirect).searchParams.get("code")!);

    const again = new Client({ name: "cursor-vscode", version: "1.0.0" });
    await again.connect(new StreamableHTTPClientTransport(new URL(`${ORIGIN}/api/mcp`), { fetch: appFetch, authProvider: provider }));
    const res = await again.callTool({ name: "list_mailboxes", arguments: {} });
    expect(res.isError).toBeFalsy();
    const [agent] = await db().select().from(schema.agents).where(and(eq(schema.agents.userId, user.id), eq(schema.agents.app, "Cursor")));
    expect(agent).toMatchObject({ logo: "cursor.com", permission: "read" });
  });
});
