import type { NextConfig } from "next";

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
