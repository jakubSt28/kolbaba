import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Contact, ContactDetail } from "@/lib/types";
import { signatureHints } from "@/lib/signature-hints";
import { db, schema } from "./db";
import { HttpError } from "./http-error";
import { logWarn } from "./log";

/**
 * The address book. Anyone the user writes to comes in on their own (name and address, from sent
 * mail), and the user adds the rest: phone, company, links, a note, more addresses of the same person.
 * Removing someone keeps a hidden row, so the next scan doesn't bring them back.
 */

type Row = typeof schema.contacts.$inferSelect;

export const MAX_CONTACT_EMAILS = 20;
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
/** Addresses that are machines, not people. */
const NOT_A_PERSON = /^(no-?reply|do-?not-?reply|notifications?|mailer-daemon|postmaster|bounce[s]?)([+.-]|@)/i;

const dto = (r: Row): Contact => ({
  id: r.id,
  name: r.name,
  emails: r.emails,
  phone: r.phone,
  company: r.company,
  jobTitle: r.jobTitle,
  links: r.links,
  note: r.note,
  ...(r.vip ? { vip: true } : {}),
  ...(r.lastContactedAt ? { lastContactedAt: r.lastContactedAt.getTime() } : {}),
});

async function owned(userId: string, id: string) {
  const [row] = await db()
    .select()
    .from(schema.contacts)
    .where(and(eq(schema.contacts.id, id), eq(schema.contacts.userId, userId), eq(schema.contacts.hidden, false)));
  if (!row) throw new HttpError(404, "That contact no longer exists", "not_found");
  return row;
}

/** Contacts (of this user) that already have one of these addresses. */
async function holding(userId: string, emails: string[]) {
  if (!emails.length) return [];
  return db()
    .select()
    .from(schema.contacts)
    .where(and(eq(schema.contacts.userId, userId), sql`${schema.contacts.emails} ?| array[${sql.join(emails.map((e) => sql`${e}`), sql`, `)}]::text[]`));
}

export async function listContacts(userId: string): Promise<Contact[]> {
  const rows = await db()
    .select()
    .from(schema.contacts)
    .where(and(eq(schema.contacts.userId, userId), eq(schema.contacts.hidden, false)))
    .orderBy(desc(schema.contacts.lastContactedAt));
  return rows.map(dto);
}

/** One person: recent conversations with them, and what their signatures say that isn't saved yet. */
export async function getContact(userId: string, id: string): Promise<ContactDetail> {
  const row = await owned(userId, id);
  const t = schema.threads;
  const emails = row.emails.length ? row.emails : ["-"];
  const threads = await db()
    .select({ id: t.id, accountId: t.accountId, subject: t.subject, snippet: t.snippet, lastMessageAt: t.lastMessageAt, folder: t.folder })
    .from(t)
    .where(
      and(
        eq(t.userId, userId),
        sql`${t.folder} not in ('trash', 'spam')`,
        sql`exists (select 1 from jsonb_array_elements(${t.participants}) p where lower(p->>'email') in (${sql.join(emails.map((e) => sql`${e}`), sql`, `)}))`,
      ),
    )
    .orderBy(desc(t.lastMessageAt))
    .limit(30);

  // Their latest few emails: signatures change, the newest one wins.
  const m = schema.messages;
  const recent = await db()
    .select({ text: m.bodyText, from: m.from })
    .from(m)
    .where(and(eq(m.userId, userId), eq(m.isOutgoing, false), sql`lower(${m.from}->>'email') in (${sql.join(emails.map((e) => sql`${e}`), sql`, `)})`))
    .orderBy(desc(m.date))
    .limit(3);
  const hints: ContactDetail["hints"] = { phones: [], links: [], company: null };
  for (const r of recent) {
    if (!r.text) continue;
    const h = signatureHints(r.text, r.from.email);
    for (const p of h.phones) if (!hints.phones.includes(p)) hints.phones.push(p);
    for (const l of h.links) if (!hints.links.includes(l)) hints.links.push(l);
    hints.company ??= h.company;
  }
  const digits = (s: string) => s.replace(/\D/g, "");
  return {
    ...dto(row),
    threads: threads.map((x) => ({ ...x, lastMessageAt: x.lastMessageAt.getTime() })),
    // Only what's not saved already.
    hints: {
      phones: hints.phones.filter((p) => !row.phone || !digits(row.phone).endsWith(digits(p).slice(-9))).slice(0, 2),
      links: hints.links.filter((l) => !row.links.some((x) => x.replace(/\/$/, "") === l.replace(/\/$/, ""))).slice(0, 3),
      company: hints.company && hints.company.toLowerCase() !== row.company.toLowerCase() ? hints.company : null,
    },
  };
}

export interface ContactInput {
  name?: string;
  emails?: string[];
  phone?: string;
  company?: string;
  jobTitle?: string;
  links?: string[];
  note?: string;
  vip?: boolean;
}

function clean(input: ContactInput) {
  const out: Partial<Row> = {};
  if (input.name !== undefined) out.name = input.name.trim().slice(0, 120);
  if (input.phone !== undefined) out.phone = input.phone.trim().slice(0, 60);
  if (input.company !== undefined) out.company = input.company.trim().slice(0, 120);
  if (input.jobTitle !== undefined) out.jobTitle = input.jobTitle.trim().slice(0, 120);
  if (input.note !== undefined) out.note = input.note.slice(0, 2000);
  if (input.vip !== undefined) out.vip = input.vip;
  if (input.links !== undefined) {
    out.links = [...new Set(input.links.map((l) => l.trim()).filter(Boolean))]
      .map((l) => (/^https?:\/\//i.test(l) ? l : `https://${l}`))
      .filter((l) => {
        try {
          return ["http:", "https:"].includes(new URL(l).protocol);
        } catch {
          return false;
        }
      })
      .slice(0, 10);
  }
  if (input.emails !== undefined) {
    const emails = [...new Set(input.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
    const bad = emails.find((e) => !EMAIL.test(e));
    if (bad) throw new HttpError(400, "That doesn't look like an email address: {email}", "bad_email", { email: bad });
    out.emails = emails.slice(0, MAX_CONTACT_EMAILS);
  }
  return out;
}

/** An address can be in one contact only: say who has it (merging is the way to join them). */
async function assertFree(userId: string, emails: string[], self?: string) {
  const taken = (await holding(userId, emails)).find((c) => c.id !== self && !c.hidden);
  if (taken) {
    const email = emails.find((e) => taken.emails.includes(e))!;
    throw new HttpError(409, "{email} is already with {name}. Merge the two instead.", "contact_exists", { email, name: taken.name || taken.emails[0] });
  }
}

export async function createContact(userId: string, input: ContactInput): Promise<Contact> {
  const fields = clean(input);
  if (!fields.emails?.length && !fields.name) throw new HttpError(400, "Give them a name or an address", "contact_empty");
  await assertFree(userId, fields.emails ?? []);
  // Someone removed earlier and added back by hand: the old hidden row makes way.
  if (fields.emails?.length) {
    const hidden = (await holding(userId, fields.emails)).filter((c) => c.hidden).map((c) => c.id);
    if (hidden.length) await db().delete(schema.contacts).where(inArray(schema.contacts.id, hidden));
  }
  const [row] = await db().insert(schema.contacts).values({ userId, ...fields }).returning();
  return dto(row);
}

export async function updateContact(userId: string, id: string, input: ContactInput): Promise<Contact> {
  await owned(userId, id);
  const fields = clean(input);
  if (fields.emails) await assertFree(userId, fields.emails, id);
  const [row] = await db()
    .update(schema.contacts)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(schema.contacts.id, id))
    .returning();
  return dto(row);
}

/** Removed from the address book (and kept hidden, so sent mail doesn't add them again). */
export async function hideContact(userId: string, id: string) {
  await owned(userId, id);
  await db().update(schema.contacts).set({ hidden: true, updatedAt: new Date() }).where(eq(schema.contacts.id, id));
}

/** One person with two entries: `from`'s addresses and details join `into`, `from` goes. */
export async function mergeContacts(userId: string, intoId: string, fromId: string): Promise<Contact> {
  if (intoId === fromId) throw new HttpError(400, "That's the same contact", "same_contact");
  const into = await owned(userId, intoId);
  const from = await owned(userId, fromId);
  const pick = (a: string, b: string) => a || b;
  const last = [into.lastContactedAt, from.lastContactedAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const [row] = await db()
    .update(schema.contacts)
    .set({
      name: pick(into.name, from.name),
      emails: [...new Set([...into.emails, ...from.emails])].slice(0, MAX_CONTACT_EMAILS),
      phone: pick(into.phone, from.phone),
      company: pick(into.company, from.company),
      jobTitle: pick(into.jobTitle, from.jobTitle),
      links: [...new Set([...into.links, ...from.links])].slice(0, 10),
      note: [into.note, from.note].filter(Boolean).join("\n\n").slice(0, 2000),
      lastContactedAt: last,
      updatedAt: new Date(),
    })
    .where(eq(schema.contacts.id, intoId))
    .returning();
  await db().delete(schema.contacts).where(eq(schema.contacts.id, fromId));
  return dto(row);
}

/** The contact an address belongs to, for "show contact" from an email (made now if there's none). */
export async function contactFor(userId: string, email: string, name: string): Promise<Contact> {
  const address = email.trim().toLowerCase();
  if (!EMAIL.test(address)) throw new HttpError(400, "That doesn't look like an email address: {email}", "bad_email", { email });
  const [found] = await holding(userId, [address]);
  if (found && !found.hidden) return dto(found);
  if (found) await db().delete(schema.contacts).where(eq(schema.contacts.id, found.id));
  const [row] = await db().insert(schema.contacts).values({ userId, name: name.trim().slice(0, 120), emails: [address] }).returning();
  return dto(row);
}

/**
 * Worker: everyone the user wrote to since the last scan comes in (or gets their "last contacted"
 * moved). The first scan reads three years back.
 */
export async function scanContacts(user: { id: string; settings: { contactsScannedAt?: number } }) {
  const since = new Date(user.settings.contactsScannedAt ?? Date.now() - 3 * 365 * 86_400_000);
  const until = new Date();
  const m = schema.messages;
  const people = await db().execute<{ email: string; name: string | null; last: string | Date }>(sql`
    select lower(p->>'email') as email, max(nullif(p->>'name', '')) as name, max(${m.date}) as last
    from ${m}, jsonb_array_elements(${m.to} || ${m.cc} || ${m.bcc}) p
    where ${m.userId} = ${user.id} and ${m.isOutgoing} and ${m.date} >= ${since.toISOString()}::timestamptz and ${m.date} < ${until.toISOString()}::timestamptz
    group by 1`);
  const own = new Set(
    (await db().select({ email: schema.accounts.email }).from(schema.accounts).where(eq(schema.accounts.userId, user.id))).map((a) => a.email.toLowerCase()),
  );
  const fresh = people.filter((p) => EMAIL.test(p.email) && !own.has(p.email) && !NOT_A_PERSON.test(p.email));
  for (const batch of chunk(fresh, 200)) {
    const known = await holding(
      user.id,
      batch.map((p) => p.email),
    );
    for (const p of batch) {
      const last = new Date(p.last);
      const contact = known.find((c) => c.emails.includes(p.email));
      if (contact) {
        if (contact.hidden) continue;
        if (!contact.lastContactedAt || contact.lastContactedAt < last || (!contact.name && p.name)) {
          await db()
            .update(schema.contacts)
            .set({ lastContactedAt: !contact.lastContactedAt || contact.lastContactedAt < last ? last : contact.lastContactedAt, name: contact.name || (p.name ?? "") })
            .where(eq(schema.contacts.id, contact.id));
        }
        continue;
      }
      await db()
        .insert(schema.contacts)
        .values({ userId: user.id, name: (p.name ?? "").slice(0, 120), emails: [p.email], lastContactedAt: last });
    }
  }
  await db()
    .update(schema.users)
    .set({ settings: sql`${schema.users.settings} || ${JSON.stringify({ contactsScannedAt: until.getTime() })}::jsonb` })
    .where(eq(schema.users.id, user.id));
  return fresh.length;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** One round over every user. */
export async function scanAllContacts() {
  const users = await db().select({ id: schema.users.id, settings: schema.users.settings }).from(schema.users);
  for (const user of users) await scanContacts(user).catch((err) => logWarn(`[contacts] ${user.id}`, err));
}
