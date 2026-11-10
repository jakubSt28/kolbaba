// The self-hosted container's main process: this server's secrets, the database schema, then the web app
// and the sync worker side by side. One container, so an update swaps both at once. If either stops, the
// container stops and Docker restarts it.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import webpush from "web-push";

const SECRETS_FILE = process.env.SECRETS_FILE || "/data/secrets.json";
const b64 = () => randomBytes(32).toString("base64");

/** Made once on the first start and kept in the data volume. Anything set in the environment wins. */
function loadSecrets() {
  const saved = existsSync(SECRETS_FILE) ? JSON.parse(readFileSync(SECRETS_FILE, "utf8")) : null;
  if (saved) return saved;
  const vapid = webpush.generateVAPIDKeys();
  const secrets = {
    CREDENTIALS_KEK: `v1:${b64()}`,
    SESSION_SECRET: b64(),
    WORKER_SECRET: b64(),
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
  };
  writeFileSync(SECRETS_FILE, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  console.log(`start: created this server's secrets in ${SECRETS_FILE}. Back them up: without them, saved mailbox passwords can't be read.`);
  return secrets;
}

function run(command, args, extraEnv = {}) {
  return spawn(command, args, { stdio: "inherit", env: { ...process.env, ...extraEnv } });
}

/** The database may still be starting: keep trying for a while. */
async function migrate() {
  for (let attempt = 1; ; attempt++) {
    const code = await new Promise((resolve) => run("node", ["scripts/migrate.mjs"]).on("exit", resolve));
    if (code === 0) return;
    if (attempt >= 30) process.exit(1);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

for (const [key, value] of Object.entries(loadSecrets())) process.env[key] ||= value;
process.env.VAPID_SUBJECT ||= process.env.APP_URL;
process.env.WORKER_URL ||= "http://127.0.0.1:3001";

await migrate();

const children = [
  run("node", ["server.js"], { PORT: "3000", HOSTNAME: "0.0.0.0" }),
  run("node_modules/.bin/tsx", ["worker/index.ts"], { PORT: "3001" }),
];

let stopping = false;
function stopAll(signal) {
  stopping = true;
  for (const child of children) child.kill(signal);
}
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => stopAll(signal));
for (const child of children) {
  child.on("exit", (code) => {
    if (!stopping) stopAll("SIGTERM");
    if (children.every((c) => c.exitCode !== null || c.signalCode !== null)) process.exit(stopping && code !== null ? code : 0);
  });
}
