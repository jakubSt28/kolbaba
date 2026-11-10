import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginScreen } from "@/components/auth/login-screen";
import { BRAND } from "@/lib/brand";
import { translate } from "@/lib/i18n";
import { env } from "@/server/env";
import { pageLocale } from "@/server/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await pageLocale();
  return {
    title: translate(locale, "Sign in · {app}", { app: BRAND.name }),
    robots: { index: false },
  };
}

/**
 * The screen streams in once the language is known (cookie or Accept-Language), so it sits behind
 * Suspense as Cache Components requires. Everything else request-specific (?next, ?error, an existing
 * session) is read on the client.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<main className="canvas min-h-dvh" />}>
      <LocalizedLogin />
    </Suspense>
  );
}

async function LocalizedLogin() {
  const locale = await pageLocale();
  // After the language (which reads the request), so these are this server's settings, not the build's.
  return <LoginScreen locale={locale} ways={{ selfHosted: env.selfHosted, google: env.hasGoogle || !env.selfHosted, emailCode: env.canSendMail || !env.selfHosted }} />;
}
