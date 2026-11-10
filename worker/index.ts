/**
 * The always-on sync worker. Vercel functions can't hold connections open, so this small process
 * does everything that has to happen when nobody is looking at the app:
 *
 * - keeps an IMAP IDLE connection per mailbox and syncs the moment something changes
 * - keeps Gmail push (users.watch → Pub/Sub → /api/webhooks/gmail → nudge) registered
 * - polls every mailbox now and then as a safety net
 * - sends due outbox entries (undo window over, scheduled time reached)
 * - wakes snoozed conversations and fires "nobody replied" reminders
 * - turns new mail into Web Push notifications
 *
 * Run: `npm run worker` (dev, watch mode) / `npm run worker:start`. Same env as the web app.
 */
import "dotenv/config";
import { createServer } from "node:http";
import { env } from "@/server/env";
import { Supervisor } from "./supervisor";
import { startJobs } from "./jobs";
import { logError, logWarn } from "@/server/log";
import { safeEqual } from "@/server/crypto";
import { HttpError } from "@/server/http-error";
import { summarizeThread } from "@/server/insights/summary";

const port = Number(process.env.PORT ?? process.env.WORKER_PORT ?? 3001);
const supervisor = new Supervisor();

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    // Public endpoint (Fly health checks): nothing about the users behind it.
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === "POST" && req.url === "/nudge") {
    if (!env.workerSecret || !safeEqual(req.headers.authorization ?? "", `Bearer ${env.workerSecret}`)) {
      res.writeHead(401).end();
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    res.writeHead(202).end();
    try {
      await supervisor.handleNudge(JSON.parse(body));
    } catch (err) {
      logWarn("nudge failed", err);
    }
    return;
  }
  if (req.method === "POST" && req.url === "/summarize") {
    if (!env.workerSecret || !safeEqual(req.headers.authorization ?? "", `Bearer ${env.workerSecret}`)) {
      res.writeHead(401).end();
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      // The web app checked who is asking; the worker holds the OpenAI key.
      const { userId, threadId, locale } = JSON.parse(body) as { userId: string; threadId: string; locale: "en" | "cs" };
      const summary = await summarizeThread(userId, threadId, locale === "cs" ? "cs" : "en");
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(summary));
    } catch (err) {
      if (!(err instanceof HttpError)) logWarn("summary failed", err);
      const status = err instanceof HttpError ? err.status : 500;
      res
        .writeHead(status, { "content-type": "application/json" })
        .end(JSON.stringify(err instanceof HttpError ? { error: err.text, code: err.code } : { error: "Something went wrong on our side" }));
    }
    return;
  }
  res.writeHead(404).end();
});

async function main() {
  // Health checks, nudges and the outbox can't wait for the first sync: importing a big mailbox
  // takes minutes, so mailboxes start in the background.
  server.listen(port, () => console.log(`worker listening on :${port}`));
  const stopJobs = startJobs(supervisor);
  supervisor.start().then(
    () => console.log(`${supervisor.size} mailbox(es) live`),
    (err) => {
      logError("couldn't load mailboxes", err);
      process.exit(1);
    },
  );

  const shutdown = async (signal: string) => {
    console.log(`${signal}: shutting down`);
    stopJobs();
    server.close();
    await supervisor.stop();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

process.on("unhandledRejection", (err) => logError("unhandled rejection", err));

main().catch((err) => {
  logError("[worker]", err);
  process.exit(1);
});
