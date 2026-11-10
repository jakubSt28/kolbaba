import "server-only";
import { cookies, headers } from "next/headers";
import { detectLocale, type Locale } from "@/lib/i18n";

/** Set by the app whenever its language changes (see setLocale in @/lib/i18n). */
const LANG_COOKIE = "kolbaba_lang";

/** Language tags from an Accept-Language header, most preferred first ("cs-CZ,cs;q=0.9,en;q=0.8"). */
function acceptedLanguages(header: string | null): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { tag: tag.trim(), q: q ? Number(q.slice(2)) : 1, i };
    })
    .filter((l) => l.tag && l.tag !== "*" && l.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i)
    .map((l) => l.tag);
}

/** The app's language cookie wins; otherwise the browser's languages; otherwise English. */
function localeFrom(cookie: string | undefined, acceptLanguage: string | null): Locale {
  if (cookie === "en" || cookie === "cs") return cookie;
  return detectLocale(acceptedLanguages(acceptLanguage));
}

/** The language for a route handler's response (error messages). */
export function requestLocale(req: Request): Locale {
  const cookie = req.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${LANG_COOKIE}=`))
    ?.slice(LANG_COOKIE.length + 1);
  return localeFrom(cookie, req.headers.get("accept-language"));
}

/**
 * The language for a server-rendered page. Reads request data, so with Cache Components call it
 * inside a <Suspense> boundary (or from generateMetadata on a page that has one).
 */
export async function pageLocale(): Promise<Locale> {
  const [jar, h] = await Promise.all([cookies(), headers()]);
  return localeFrom(jar.get(LANG_COOKIE)?.value, h.get("accept-language"));
}
