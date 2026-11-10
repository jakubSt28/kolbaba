import { handle, readJson } from "@/server/auth/http";
import { clientIp } from "@/server/rate-limit";
import { requestSelfHost, SelfHostRequestBody } from "@/server/selfhost-request";

/** The only pages allowed to send this: the form on kolbaba.app, and the website running locally. */
function allowedOrigin(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  if (origin === "https://kolbaba.app") return origin;
  if (process.env.NODE_ENV !== "production" && /^http:\/\/localhost:\d+$/.test(origin)) return origin;
  return null;
}

const cors = (origin: string) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "POST",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
});

export function OPTIONS(req: Request) {
  const origin = allowedOrigin(req);
  return origin ? new Response(null, { status: 204, headers: cors(origin) }) : new Response(null, { status: 403 });
}

/** The form on kolbaba.app asking for a copy to run on one's own server. No account needed. */
export async function POST(req: Request) {
  const origin = allowedOrigin(req);
  if (!origin) return new Response(null, { status: 403 });
  const res = await handle(async (r: Request) => {
    await requestSelfHost(await readJson(r, SelfHostRequestBody), clientIp(r));
    return Response.json({ ok: true }, { status: 201 });
  })(req);
  for (const [k, v] of Object.entries(cors(origin))) res.headers.set(k, v);
  return res;
}
