/**
 * Which build this is: the Vercel deployment or the self-hosted image's version, baked in by next.config.ts
 * when it's built ("dev" locally).
 * /api/version says which one is deployed now; src/lib/app-update.ts compares the two.
 */
export const BUILD_ID = process.env.APP_BUILD ?? "dev";
