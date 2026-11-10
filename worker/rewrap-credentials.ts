/**
 * After rotating CREDENTIALS_KEK (adding `v2:…` at the end, see CONTRIBUTING.md): wrap every mailbox
 * secret's key with the new master key, so the old one can be removed from CREDENTIALS_KEK later.
 * The secrets themselves aren't decrypted or changed. Safe to run more than once.
 *
 *   fly ssh console --app kolbaba-worker -C "npx tsx worker/rewrap-credentials.ts"
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { rewrap } from "@/server/crypto";
import { db, schema } from "@/server/db";

async function main() {
  const rows = await db().select({ id: schema.accounts.id, credentials: schema.accounts.credentials }).from(schema.accounts);
  let moved = 0;
  for (const row of rows) {
    const next = rewrap(row.credentials, row.id);
    if (next === row.credentials) continue;
    await db().update(schema.accounts).set({ credentials: next }).where(eq(schema.accounts.id, row.id));
    moved++;
  }
  console.log(`${rows.length} mailboxes, ${moved} re-wrapped with the current key`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
