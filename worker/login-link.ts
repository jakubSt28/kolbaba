/**
 * `kolbaba-link`, run on a self-hosted server: prints a one-time link that creates an account or signs in
 * (src/server/auth/setup-link.ts). The way in for the first account, and the way back without a passkey.
 *
 *   kolbaba-link              the first account, or the only one there is
 *   kolbaba-link me@mail.cz   sign in as this account
 *   kolbaba-link --new        another account on this server
 */
import { eq } from "drizzle-orm";
import { randomToken, hashToken } from "@/server/crypto";
import { db, schema } from "@/server/db";
import { env } from "@/server/env";

const LINK_TTL_MS = 3600_000;

async function userForLink(arg: string | undefined): Promise<string | undefined> {
  if (arg === "--new") return undefined;
  if (arg) {
    const [user] = await db().select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, arg.trim().toLowerCase()));
    if (!user) throw new Error(`No account with the address ${arg}. To create one: kolbaba-link --new`);
    return user.id;
  }
  const users = await db().select({ id: schema.users.id, email: schema.users.email }).from(schema.users);
  if (users.length > 1) throw new Error(`There are several accounts here. Say which one: kolbaba-link ${users[0].email}`);
  return users[0]?.id;
}

async function main() {
  const userId = await userForLink(process.argv[2]);
  const token = randomToken();
  await db()
    .insert(schema.authChallenges)
    .values({ id: hashToken(token), kind: "setup-link", challenge: "", data: userId ? { userId } : {}, expiresAt: new Date(Date.now() + LINK_TTL_MS) });
  console.log(`\n  ${userId ? "Sign in" : "Create your account"} (works once, for an hour):\n\n  ${env.appUrl}/login?setup=${token}\n`);
}

main().then(
  () => process.exit(0),
  (err: Error) => {
    console.error(err.message);
    process.exit(1);
  },
);
