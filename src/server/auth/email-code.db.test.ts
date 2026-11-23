import { like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, schema } from "../db";
import { LIMITS } from "../rate-limit";
import { createAccountWithCode, MAX_WRONG_PER_CODE, sendConfirmCode, sendEmailCode, verifyConfirmCode, verifyEmailCode } from "./email-code";

const sent = vi.hoisted(() => [] as { to: string; text: string }[]);
vi.mock("../system-mail", () => ({
  sendSystemEmail: vi.fn(async (m: { to: string; text: string }) => void sent.push(m)),
  simpleEmailHtml: () => "",
}));

const DOMAIN = "email-code.invalid";
const ip = () => `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
const lastCode = () => sent.at(-1)!.text.match(/(\d{3}) (\d{3})/)!.slice(1).join("");
const wrongCode = () => (lastCode() === "000000" ? "111111" : "000000");
let seq = 0;
const address = (label: string) => `${label}-${Date.now()}-${seq++}@${DOMAIN}`;

beforeEach(() => {
  delete process.env.SIGNUP_ALLOWLIST;
});

afterAll(async () => {
  await db().delete(schema.rateLimits).where(like(schema.rateLimits.key, `%${DOMAIN}%`));
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
});

describe("code by email", () => {
  it("signs in an existing account, once", async () => {
    const email = address("member");
    const [user] = await db().insert(schema.users).values({ email }).returning();
    const token = await sendEmailCode({ email: email.toUpperCase(), ip: ip(), locale: "en" });
    expect(sent.at(-1)).toMatchObject({ to: email });
    expect(sent.at(-1)!.text).toMatch(/signing in/);

    await expect(verifyEmailCode(token, wrongCode())).rejects.toMatchObject({ status: 400, code: "wrong_code" });
    const right = lastCode();
    expect(await verifyEmailCode(token, `${right.slice(0, 3)} ${right.slice(3)}`)).toMatchObject({ email, user: { id: user.id } });
    // Used up.
    await expect(verifyEmailCode(token, right)).rejects.toMatchObject({ code: "code_expired" });
  });

  it("lets a new address create its account only after the code, with the name it gives", async () => {
    const email = address("new");
    const token = await sendEmailCode({ email, ip: ip(), locale: "en" });
    expect(sent.at(-1)!.text).toMatch(/creating/);
    await expect(createAccountWithCode(token, "Too Early")).rejects.toMatchObject({ code: "email_unconfirmed" });

    expect(await verifyEmailCode(token, lastCode())).toEqual({ email, user: null });
    // Another browser (someone else's token) can't create it.
    await expect(createAccountWithCode("someone-else", "Intruder")).rejects.toMatchObject({ code: "email_unconfirmed" });
    const user = await createAccountWithCode(token, "  New Person ");
    expect(user).toMatchObject({ email, name: "New Person" });
    await expect(createAccountWithCode(token, "Again")).rejects.toMatchObject({ code: "email_unconfirmed" });
  });

  it("keeps new accounts to the allowlist, but always lets members in", async () => {
    process.env.SIGNUP_ALLOWLIST = "only-me@example.com";
    await expect(sendEmailCode({ email: address("stranger"), ip: ip(), locale: "en" })).rejects.toMatchObject({ code: "invite_only" });
    const email = address("member");
    await db().insert(schema.users).values({ email });
    await sendEmailCode({ email, ip: ip(), locale: "en" });
  });

  it("throws a code away after a few wrong tries", async () => {
    const email = address("mistype");
    const token = await sendEmailCode({ email, ip: ip(), locale: "en" });
    for (let i = 1; i < MAX_WRONG_PER_CODE; i++) await expect(verifyEmailCode(token, wrongCode())).rejects.toMatchObject({ code: "wrong_code" });
    await expect(verifyEmailCode(token, wrongCode())).rejects.toMatchObject({ code: "code_used_up" });
    await expect(verifyEmailCode(token, lastCode())).rejects.toMatchObject({ code: "code_expired" });
  });

  it("stops guessing after a few wrong codes, across new codes", async () => {
    const email = address("guess");
    const first = await sendEmailCode({ email, ip: ip(), locale: "en" });
    for (let i = 1; i < MAX_WRONG_PER_CODE; i++) await expect(verifyEmailCode(first, wrongCode())).rejects.toMatchObject({ code: "wrong_code" });
    const second = await sendEmailCode({ email, ip: ip(), locale: "en" });
    for (let i = MAX_WRONG_PER_CODE; i <= 8; i++) await expect(verifyEmailCode(second, wrongCode())).rejects.toMatchObject({ code: "wrong_code" });
    // Even the right code is refused now, until the window is over.
    await expect(verifyEmailCode(second, lastCode())).rejects.toMatchObject({ status: 429 });
  });

  it("has a daily ceiling on tries for one address", async () => {
    const email = address("daily");
    const token = await sendEmailCode({ email, ip: ip(), locale: "en" });
    // As if the 15-minute windows had passed all day long.
    await db().insert(schema.rateLimits).values({ key: LIMITS.codeAttemptsDaily(email).key, windowStart: new Date(), count: LIMITS.codeAttemptsDaily(email).max });
    await expect(verifyEmailCode(token, lastCode())).rejects.toMatchObject({ status: 429 });
  });

  it("confirms it's you before deleting the account, for that account only", async () => {
    const [me] = await db().insert(schema.users).values({ email: address("me") }).returning();
    const [other] = await db().insert(schema.users).values({ email: address("other") }).returning();
    const token = await sendConfirmCode(me, "en");
    expect(sent.at(-1)).toMatchObject({ to: me.email });
    await expect(verifyConfirmCode(other, token, lastCode())).rejects.toMatchObject({ code: "code_expired" });
    await expect(verifyConfirmCode(me, token, wrongCode())).rejects.toMatchObject({ code: "wrong_code" });
    await verifyConfirmCode(me, token, lastCode());
    await expect(verifyConfirmCode(me, token, lastCode())).rejects.toMatchObject({ code: "code_expired" });
  });
});
