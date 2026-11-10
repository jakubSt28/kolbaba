import { renderAppIcon } from "@/lib/app-icon";

const SIZES = new Set([192, 512]);

export async function GET(_req: Request, ctx: RouteContext<"/pwa-icon/[size]">) {
  const size = Number((await ctx.params).size);
  if (!SIZES.has(size)) return new Response("Not found", { status: 404 });
  return renderAppIcon(size);
}

export function generateStaticParams() {
  return [...SIZES].map((size) => ({ size: String(size) }));
}
