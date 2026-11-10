"use client";

import dynamic from "next/dynamic";
import { CrashBoundary } from "@/components/crash-screen";

// The prototype runs entirely on mock data with relative timestamps, so render it on the client only.
const MailApp = dynamic(() => import("@/components/mail-app").then((m) => m.MailApp), {
  ssr: false,
  loading: () => <div className="canvas app-height" />,
});

export function ClientApp() {
  return (
    <CrashBoundary>
      <MailApp />
    </CrashBoundary>
  );
}
