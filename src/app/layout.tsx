import type { Metadata, Viewport } from "next";
import { Caveat, Inter } from "next/font/google";
import { InstallStamp } from "@/components/install-stamp";
import { BRAND } from "@/lib/brand";
import { APPLE_WEB_APP } from "@/lib/install";
import { THEME_SCRIPT } from "@/lib/theme-script";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext"],
  axes: ["opsz"],
});

// Kolbaba's handwriting on his postcard (an empty Inbox): fetched when a postcard first shows, not up front.
const caveat = Caveat({
  variable: "--font-caveat",
  subsets: ["latin", "latin-ext"],
  preload: false,
});

export const metadata: Metadata = {
  title: BRAND.name,
  description: `${BRAND.name} — ${BRAND.tagline}`,
  // Frozen at install on iOS, like the manifest: see src/lib/install.ts before changing it.
  appleWebApp: { ...APPLE_WEB_APP, title: BRAND.name },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e9edf3" },
    { media: "(prefers-color-scheme: dark)", color: "#090b0f" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme is set before the first paint by the script below (and later by the app), not by React.
    <html lang="en" data-accent="ink" suppressHydrationWarning className={`${inter.variable} ${caveat.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="h-full font-sans">
        {/* The status bar strip of the iOS Home Screen app; first in the page so it's there from the first paint (see globals.css). */}
        <div id="top-edge" aria-hidden />
        <InstallStamp />
        {children}
      </body>
    </html>
  );
}
