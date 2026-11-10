import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";
import { INSTALL_VERSION } from "@/lib/install";

/** iOS keeps all of this from the moment the icon is added: see src/lib/install.ts before changing it. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // The app's identity stays "/" (what it was before start_url carried the install version).
    id: "/",
    name: BRAND.name,
    short_name: BRAND.name,
    description: BRAND.tagline,
    start_url: `/?install=${INSTALL_VERSION}`,
    display: "standalone",
    background_color: "#e9edf3",
    theme_color: "#e9edf3",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
