import { eq, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomToken, seal } from "./crypto";
import { db, schema } from "./db";
import { contactFor, createContact, getContact, hideContact, listContacts, mergeContacts, scanContacts, updateContact } from "./contacts";

const DOMAIN = "contacts-test.invalid";
let user: typeof schema.users.$inferSelect;
let accountId = "";

async function message(opts: { outgoing: boolean; from: string; to?: string[]; text?: string; subject?: string; date?: Date }) {
  const [t] = await db()
    .insert(schema.threads)
    .values({
      userId: user.id,
      accountId,
      providerThreadId: `<${randomToken(6)}@x>`,
      subject: opts.subject ?? "Nabídka",
      lastMessageAt: opts.date ?? new Date(),
      messageCount: 1,
      folder: opts.outgoing ? "sent" : "inbox",
      participants: [{ name: "", email: opts.outgoing ? opts.to![0] : opts.from }],
    })
    .returning();
  await db()
    .insert(schema.messages)
    .values({
      userId: user.id,
      accountId,
      threadId: t.id,
      providerMessageId: `INBOX:1:${randomToken(4)}`,
      from: { name: opts.outgoing ? "Me" : "Jana Dvořáková", email: opts.from },
      to: (opts.to ?? [`me@${DOMAIN}`]).map((email) => ({ name: email.startsWith("jana") ? "Jana Dvořáková" : "", email })),
      subject: opts.subject ?? "Nabídka",
      date: opts.date ?? new Date(),
      isOutgoing: opts.outgoing,
      bodyText: opts.text ?? null,
      labels: [],
    });
  return t.id;
}

beforeEach(async () => {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
  [user] = await db().insert(schema.users).values({ email: `me@${DOMAIN}` }).returning();
  const [a] = await db()
    .insert(schema.accounts)
    .values({ userId: user.id, provider: "imap", email: `me@${DOMAIN}`, name: "Me", hue: 200, credentials: seal({ kind: "password", password: "x" }, "x"), status: "ok" })
    .returning();
  accountId = a.id;
});

afterAll(async () => {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
});

const fresh = async () => (await db().select().from(schema.users).where(eq(schema.users.id, user.id)))[0];

describe("address book", () => {
  it("takes in whoever the user writes to, but not machines, and not twice", async () => {
    await message({ outgoing: true, from: `me@${DOMAIN}`, to: [`jana@firma.cz`, `noreply@shop.cz`] });
    await scanContacts(user);
    const [jana] = await listContacts(user.id);
    expect(await listContacts(user.id)).toHaveLength(1);
    expect(jana).toMatchObject({ name: "Jana Dvořáková", emails: ["jana@firma.cz"] });

    // Removed: the next scan leaves them out.
    await hideContact(user.id, jana.id);
    await message({ outgoing: true, from: `me@${DOMAIN}`, to: [`jana@firma.cz`] });
    await scanContacts(await fresh());
    expect(await listContacts(user.id)).toHaveLength(0);
  });

  it("one address belongs to one person; merging joins two entries", async () => {
    const a = await createContact(user.id, { name: "Petr", emails: ["petr@firma.cz"], phone: "+420 777 111 222" });
    const b = await createContact(user.id, { name: "", emails: ["Petr.Novak@gmail.com"], company: "Firma s.r.o." });
    await expect(updateContact(user.id, b.id, { emails: ["petr.novak@gmail.com", "petr@firma.cz"] })).rejects.toMatchObject({ status: 409 });
    const merged = await mergeContacts(user.id, a.id, b.id);
    expect(merged).toMatchObject({ name: "Petr", emails: ["petr@firma.cz", "petr.novak@gmail.com"], phone: "+420 777 111 222", company: "Firma s.r.o." });
    expect(await listContacts(user.id)).toHaveLength(1);
  });

  it("shows conversations with them and what their signature says that isn't saved", async () => {
    await message({
      outgoing: false,
      from: "jana@modralipa.example",
      subject: "Spolupráce",
      text: "Dobrý den,\nposílám podklady.\n\nJana Dvořáková\nModrá lípa s.r.o.\n+420 777 123 456\nhttps://www.linkedin.com/in/jana-example/",
    });
    const contact = await contactFor(user.id, "Jana@ModraLipa.example", "Jana Dvořáková");
    expect(contact.emails).toEqual(["jana@modralipa.example"]);
    const detail = await getContact(user.id, contact.id);
    expect(detail.threads.map((t) => t.subject)).toEqual(["Spolupráce"]);
    expect(detail.hints).toEqual({ phones: ["+420 777 123 456"], links: ["https://www.linkedin.com/in/jana-example/"], company: "Modrá lípa s.r.o." });

    await updateContact(user.id, contact.id, { phone: "777 123 456", company: "Modrá lípa s.r.o." });
    expect((await getContact(user.id, contact.id)).hints).toEqual({ phones: [], links: ["https://www.linkedin.com/in/jana-example/"], company: null });
    // The same address again finds the same person.
    expect((await contactFor(user.id, "jana@modralipa.example", "")).id).toBe(contact.id);
  });

  it("refuses what isn't an address", async () => {
    await expect(createContact(user.id, { emails: ["not an address"] })).rejects.toMatchObject({ status: 400 });
    await expect(createContact(user.id, {})).rejects.toMatchObject({ status: 400 });
  });
});
