import { eq, like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, schema } from "./db";

const mail = vi.hoisted(() => [] as { to: string; subject: string; text: string; replyTo?: string }[]);
vi.mock("./system-mail", () => ({ sendSystemEmail: vi.fn(async (m: (typeof mail)[number]) => void mail.push(m)) }));

const { requestSelfHost, SelfHostRequestBody } = await import("./selfhost-request");

const IP = "self-host-test-ip";
const EMAIL = "petra@example.com";
const clean = () =>
  Promise.all([db().delete(schema.rateLimits).where(like(schema.rateLimits.key, `self-host:%${IP}`)), db().delete(schema.waitlist).where(eq(schema.waitlist.email, EMAIL))]);
const onList = () => db().select().from(schema.waitlist).where(eq(schema.waitlist.email, EMAIL));
const body = (more = {}) => SelfHostRequestBody.parse({ email: "petra@example.com", runsOn: "vps", ...more });

beforeEach(async () => {
  mail.length = 0;
  await clean();
});
afterAll(clean);

describe("asking for a copy on one's own server", () => {
  it("lands in the team's inbox with Reply going to whoever asked, and nothing goes to the address they typed", async () => {
    await requestSelfHost(body({ note: "Pro malou firmu", lang: "cs" }), IP);
    expect(mail).toHaveLength(1);
    expect(mail[0].to).not.toBe("petra@example.com");
    expect(mail[0].replyTo).toBe("petra@example.com");
    expect(mail[0].subject).toContain("petra@example.com");
    expect(mail[0].text).toContain("Pro malou firmu");
  });

  it("keeps one row per person for the admin page, however often and however they type it", async () => {
    await requestSelfHost(body({ note: "Pro malou firmu" }), IP);
    const [first] = await onList();
    await requestSelfHost(body({ email: "Petra@Example.com", runsOn: "home", note: "Radši doma", lang: "cs" }), IP);
    const rows = await onList();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ runsOn: "home", note: "Radši doma", lang: "cs", createdAt: first.createdAt });
  });

  it("remembers where they first came from, and an odd source never stops the form", async () => {
    await requestSelfHost(body({ ref: "TT" }), IP);
    await requestSelfHost(body({ ref: "ig" }), IP);
    expect((await onList())[0].ref).toBe("tt");
    expect(mail[0].text).toContain("Odkud: tt");
    expect(SelfHostRequestBody.parse({ email: EMAIL, runsOn: "vps", ref: "<script>" }).ref).toBeNull();
    expect(SelfHostRequestBody.parse({ email: EMAIL, runsOn: "vps" }).ref).toBeNull();
  });

  it("quietly drops a bot that filled in the hidden field", async () => {
    await requestSelfHost(body({ website: "https://spam.example" }), IP);
    expect(mail).toHaveLength(0);
    expect(await onList()).toHaveLength(0);
  });

  it("stops after a few requests from one address", async () => {
    for (let i = 0; i < 5; i++) await requestSelfHost(body(), IP);
    await expect(requestSelfHost(body(), IP)).rejects.toMatchObject({ status: 429 });
    expect(mail).toHaveLength(5);
  });

  it("wants a real address", () => {
    expect(SelfHostRequestBody.safeParse({ email: "nope", runsOn: "vps" }).success).toBe(false);
  });
});
