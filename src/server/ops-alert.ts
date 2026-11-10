import { sql } from "drizzle-orm";
import { db, schema } from "./db";
import { env } from "./env";
import { logWarn } from "./log";
import { sendSystemEmail } from "./system-mail";

/** Hours before the same alert can go out again. */
const QUIET_HOURS = 12;

/**
 * An email to the team when something about the AI providers needs a person: credit ran out, a key
 * stopped working, the daily budget is nearly spent. Smart categories keep going without them (mail
 * waits or the rules decide), so nobody would notice otherwise. One per `key` per half a day, kept in
 * the database so restarts don't repeat it.
 */
export async function alertOperator(key: string, subject: string, lines: string[]) {
  const to = env.feedbackTo;
  if (!to) return logWarn(`[ops alert] ${subject}`, lines.join(" "));
  try {
    const claimed = await db().execute<{ key: string }>(sql`
      insert into ${schema.opsAlerts} (key, sent_at) values (${key}, now())
      on conflict (key) do update set sent_at = now()
        where ${schema.opsAlerts}.sent_at < now() - make_interval(hours => ${QUIET_HOURS})
      returning key`);
    if (!claimed.length) return;
    await sendSystemEmail({ to, subject: `[Kolbaba] ${subject}`, text: lines.join("\n") });
  } catch (err) {
    logWarn(`[ops alert] ${key}`, err);
  }
}
