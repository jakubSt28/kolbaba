import { NextResponse } from "next/server";
import { assertSameOrigin, handle } from "@/server/auth/http";
import { destroySession } from "@/server/auth/session";

/** Sign out. JSON callers get `{ ok: true }`; a plain HTML form post is sent to /login. */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  await destroySession();
  // Attachments and pictures the browser kept must not outlive the session on a shared device.
  const headers = { "Clear-Site-Data": '"cache"' };
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    const res = NextResponse.redirect(new URL("/login", req.url), 303);
    res.headers.set("Clear-Site-Data", headers["Clear-Site-Data"]);
    return res;
  }
  return Response.json({ ok: true }, { headers });
});
