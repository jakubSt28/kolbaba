"use client";

import { CrashScreen } from "@/components/crash-screen";

/** The app or a page threw while drawing: Kolbaba's own error screen, inside the usual frame. */
export default function PageError({ error }: { error: Error & { digest?: string } }) {
  return <CrashScreen error={error} where="page" />;
}
