import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { tk } from "@/lib/i18n";
import type { Snippet } from "@/lib/types";
import { db, schema } from "../db";
import { HttpError } from "../http-error";
import { cleanSignatureHtml } from "./email-html";

/** Templates and snippets: named pieces of text inserted with "/" while writing. */

const MAX_SNIPPETS = 200;

export const SnippetBody = z.object({
  name: z.string().trim().min(1, { error: tk("Give it a name") }).max(80, { error: tk("That name is a little long") }),
  html: z.string().max(200_000),
});

const dto = (r: typeof schema.snippets.$inferSelect): Snippet => ({ id: r.id, name: r.name, html: r.html });

export async function listSnippets(userId: string): Promise<Snippet[]> {
  const rows = await db().select().from(schema.snippets).where(eq(schema.snippets.userId, userId)).orderBy(asc(schema.snippets.name));
  return rows.map(dto);
}

export async function createSnippet(userId: string, input: z.output<typeof SnippetBody>): Promise<Snippet> {
  const [{ n }] = await db().select({ n: sql<number>`count(*)::int` }).from(schema.snippets).where(eq(schema.snippets.userId, userId));
  if (n >= MAX_SNIPPETS) throw new HttpError(400, "That's a lot of snippets. Delete some first.", "too_many");
  const [row] = await db()
    .insert(schema.snippets)
    .values({ userId, name: input.name, html: cleanSignatureHtml(input.html) })
    .returning();
  return dto(row);
}

export async function updateSnippet(userId: string, id: string, input: z.output<typeof SnippetBody>): Promise<Snippet> {
  const [row] = await db()
    .update(schema.snippets)
    .set({ name: input.name, html: cleanSignatureHtml(input.html), updatedAt: new Date() })
    .where(and(eq(schema.snippets.id, id), eq(schema.snippets.userId, userId)))
    .returning();
  if (!row) throw new HttpError(404, "Not found", "not_found");
  return dto(row);
}

export async function deleteSnippet(userId: string, id: string) {
  await db().delete(schema.snippets).where(and(eq(schema.snippets.id, id), eq(schema.snippets.userId, userId)));
}
