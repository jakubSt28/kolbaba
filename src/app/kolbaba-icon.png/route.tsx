import { renderAppIcon } from "@/lib/app-icon";

/** The app icon at an address ending in .png, for places that insist on one (Stripe Checkout's branding). */
export function GET() {
  return renderAppIcon(512);
}
