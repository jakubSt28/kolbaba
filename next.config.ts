import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

/**
 * The attachment viewer draws PDFs with pdf.js, which fetches its worker, fonts and image decoders by URL.
 * They're copied from the package into public/pdfjs (not in git) whenever `next dev` or `next build` starts,
 * so they always match the installed pdf.js, on Vercel and in the self-hosted image alike.
 */
function copyPdfjsAssets() {
  try {
    const from = join(process.cwd(), "node_modules/pdfjs-dist");
    const to = join(process.cwd(), "public/pdfjs");
    const { version } = JSON.parse(readFileSync(join(from, "package.json"), "utf8")) as { version: string };
    const stamp = join(to, "version.txt");
    if (existsSync(stamp) && readFileSync(stamp, "utf8") === version) return;
    rmSync(to, { recursive: true, force: true });
    mkdirSync(to, { recursive: true });
    for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) cpSync(join(from, dir), join(to, dir), { recursive: true });
    // As .js: every server sends that with a JavaScript type, which a worker must have.
    cpSync(join(from, "legacy/build/pdf.worker.min.mjs"), join(to, "pdf.worker.min.js"));
    writeFileSync(stamp, version);
  } catch (err) {
    console.warn("Couldn't copy pdf.js's files to public/pdfjs; PDFs won't open in the attachment viewer.", err);
  }
}
copyPdfjsAssets();

const nextConfig: NextConfig = {
  // The self-hosted image (Dockerfile.selfhost) runs server.js; Vercel keeps its own output.
  output: process.env.BUILD_STANDALONE ? "standalone" : undefined,
  devIndicators: false,
  // Lets a phone on the same Wi-Fi open the dev server (e.g. http://192.168.1.20:3000).
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "*.local"],
  cacheComponents: true,
  partialPrefetching: true,
  // pdf.js (PDF text for MCP agents) runs as Node loads it, the way the tests run it, not re-bundled.
  serverExternalPackages: ["unpdf"],
  env: {
    // Which deployment this build is (src/lib/build.ts): an app left open compares it with /api/version
    // and picks up a newer one (src/lib/app-update.ts). On a self-hosted image, its version number.
    APP_BUILD: process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.APP_VERSION ?? "dev",
  },
  async headers() {
    return [
      {
        // Every page of the app: never framed by another site, no MIME sniffing, and links opened from
        // mail don't tell the other site where they came from. (API routes set their own headers.)
        source: "/((?!api/).*)",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
        ],
      },
      {
        // The OAuth consent page must never be framed (clickjacking an "Allow" click).
        source: "/oauth/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        // The service worker must never be served stale, or updates get stuck on devices.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
