import { like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { createSnippet, deleteSnippet, listSnippets, updateSnippet } from "./snippets";

const DOMAIN = "snippets-test.invalid";
let a = "";
let b = "";

beforeEach(async () => {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
  [{ id: a }, { id: b }] = await db().insert(schema.users).values([{ email: `a@${DOMAIN}` }, { email: `b@${DOMAIN}` }]).returning();
});
afterAll(async () => {
  await db().delete(schema.users).where(like(schema.users.email, `%@${DOMAIN}`));
});

describe("snippets", () => {
  it("are kept per user, sorted by name, with their HTML cleaned", async () => {
    await createSnippet(a, { name: "Pozdrav", html: "<p>Ahoj <b>všichni</b></p><script>alert(1)</script>" });
    const price = await createSnippet(a, { name: "Ceník", html: "<p>100 Kč</p>" });
    expect((await listSnippets(a)).map((s) => s.name)).toEqual(["Ceník", "Pozdrav"]);
    expect((await listSnippets(a))[1].html).not.toContain("script");
    expect(await listSnippets(b)).toEqual([]);

    await expect(updateSnippet(b, price.id, { name: "x", html: "" })).rejects.toMatchObject({ status: 404 });
    await deleteSnippet(b, price.id);
    expect((await listSnippets(a)).length).toBe(2);

    expect((await updateSnippet(a, price.id, { name: "Ceník 2026", html: "<p>120 Kč</p>" })).name).toBe("Ceník 2026");
    await deleteSnippet(a, price.id);
    expect((await listSnippets(a)).map((s) => s.name)).toEqual(["Pozdrav"]);
  });
});
