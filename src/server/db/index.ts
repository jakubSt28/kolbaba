import { getTableColumns, type Table } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

/**
 * One pool per process. On Vercel each function instance keeps a small pool; Neon's pooled
 * connection string (…-pooler…) is expected there. The worker gets a slightly bigger pool.
 */
function connect() {
  const client = postgres(env.databaseUrl, {
    max: Number(process.env.DATABASE_POOL_SIZE ?? (process.env.VERCEL ? 3 : 10)),
    // PgBouncer (Neon pooler) in transaction mode doesn't support prepared statements.
    prepare: !/-pooler\./.test(env.databaseUrl),
    onnotice: () => {},
  });
  return drizzle(client, { schema, casing: "snake_case" });
}

export type Db = ReturnType<typeof connect>;

const globalForDb = globalThis as unknown as { __paneDb?: Db };

/** Lazily connected, and reused across hot reloads in dev. */
export function db(): Db {
  globalForDb.__paneDb ??= connect();
  return globalForDb.__paneDb;
}

/**
 * A table's columns minus some, for `select(...)`: what a query doesn't use (email bodies, the search
 * vector, a mailbox picture) shouldn't travel. Neon bills every byte that leaves the database.
 */
export function columnsWithout<T extends Table, K extends keyof T["_"]["columns"] & string>(table: T, ...omit: K[]) {
  const columns = getTableColumns(table);
  return Object.fromEntries(Object.entries(columns).filter(([key]) => !omit.includes(key as K))) as Omit<T["_"]["columns"], K>;
}

/** A mailbox without its picture (a data URL of up to 200 KB): all that syncing and sending need. */
export const ACCOUNT_COLUMNS = columnsWithout(schema.accounts, "image");

export { schema };
