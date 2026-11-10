import { BUILD_ID } from "@/lib/build";

/**
 * The build deployed right now, for an app that's been open since an older one (src/lib/app-update.ts).
 * Public and tiny. Never cached, or an open app would keep hearing the old answer.
 */
export function GET() {
  return Response.json({ build: BUILD_ID }, { headers: { "Cache-Control": "no-store" } });
}
