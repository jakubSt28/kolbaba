import { z } from "zod";
import { assertSameOrigin, readJson } from "@/server/auth/http";
import { withUser } from "@/server/auth/session";
import { getAccountImage, setAccountImage } from "@/server/mail/service";

type Ctx = RouteContext<"/api/accounts/[id]/image">;

/** The URL carries a content hash (see accountDto), so the picture can be cached for good. */
export const GET = withUser<Ctx>(async (user, _req, ctx) => {
  const { id } = await ctx.params;
  const { mime, bytes } = await getAccountImage(user.id, id);
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": mime, "Cache-Control": "private, max-age=31536000, immutable" },
  });
});

/** A picture the client already cropped to a square and compressed, as a data: URL. */
export const PUT = withUser<Ctx>(async (user, req, ctx) => {
  assertSameOrigin(req);
  const { id } = await ctx.params;
  const { dataUrl } = await readJson(req, z.object({ dataUrl: z.string().max(300_000) }));
  await setAccountImage(user.id, id, dataUrl);
  return Response.json({ ok: true });
});

export const DELETE = withUser<Ctx>(async (user, req, ctx) => {
  assertSameOrigin(req);
  const { id } = await ctx.params;
  await setAccountImage(user.id, id, null);
  return Response.json({ ok: true });
});
