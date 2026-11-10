import { sql } from "drizzle-orm";
import { withUser } from "@/server/auth/session";
import { db } from "@/server/db";

/**
 * Recipient suggestions: the address book first (every address of a person, under their name), then
 * people from recent mail, the ones you write to first.
 */
export const GET = withUser(async (user) => {
  const book = await db().execute<{ name: string; email: string }>(sql`
    select c.name, e.email
    from contacts c, jsonb_array_elements_text(c.emails) e(email)
    where c.user_id = ${user.id} and not c.hidden
    order by c.last_contacted_at desc nulls last
    limit 1000`);
  const rows = await db().execute<{ name: string; email: string; score: number }>(sql`
    with people as (
      select p->>'name' as name, lower(p->>'email') as email, case when m.is_outgoing then 3 else 1 end as weight
      from messages m, jsonb_array_elements(case when m.is_outgoing then m."to" || m.cc else jsonb_build_array(m."from") end) p
      where m.user_id = ${user.id} and m.date > now() - interval '365 days'
    )
    select max(name) as name, email, sum(weight)::int as score
    from people
    where email not in (select lower(email) from accounts where user_id = ${user.id})
      and email !~ '^(no-?reply|do-?not-?reply|notifications?|mailer-daemon)'
    group by email order by score desc limit 500`);
  const seen = new Set(book.map((r) => r.email));
  return Response.json([
    ...book.map((r) => ({ name: r.name || r.email.split("@")[0], email: r.email })),
    ...rows.filter((r) => !seen.has(r.email)).map((r) => ({ name: r.name || r.email.split("@")[0], email: r.email })),
  ]);
});
