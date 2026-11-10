// Applies pending Drizzle migrations. Runs before `next build` on Vercel (see "vercel-build"),
// so every deploy brings the database schema up to date first.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Migrations need a direct (non-pooled) connection; fall back to DATABASE_URL.
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.log("migrate: no DATABASE_URL, skipping");
  process.exit(0);
}

const client = postgres(url, { max: 1, onnotice: () => {} });
try {
  // A self-hosted container restarting during an update: one migration at a time. (Not through Neon's pooler.)
  if (process.env.SELF_HOSTED === "1") await client`select pg_advisory_lock(7203551)`;
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  console.log("migrate: database is up to date");
} finally {
  await client.end();
}
