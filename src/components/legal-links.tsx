import { translate, type Locale } from "@/lib/i18n";
import { legalUrl, SOURCE_CODE_URL } from "@/lib/legal";
import { cn } from "@/lib/utils";

const link = "text-ink-2 underline decoration-ink-3/40 underline-offset-[3px] hover:text-ink hover:decoration-ink-3";

/** Under the sign-in buttons: signing up accepts the Terms (they say so), and the Privacy Policy is one tap away. */
export function ConsentLine({ locale, className }: { locale: Locale; className?: string }) {
  const parts = translate(locale, "By continuing you agree to the {terms} and acknowledge the {privacy}.").split(/\{(terms|privacy)\}/);
  return (
    <p className={className}>
      {parts.map((part, i) =>
        part === "terms" || part === "privacy" ? (
          <a key={part} href={legalUrl(locale, part)} target="_blank" rel="noopener noreferrer" className={link}>
            {part === "terms" ? translate(locale, "Terms of Service@@consent") : translate(locale, "Privacy Policy@@consent")}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  );
}

/** Kolbaba's source code on GitHub: Kolbaba is open source (AGPL-3.0-or-later). */
export function SourceCodeLink({ locale }: { locale: Locale }) {
  return (
    <a href={SOURCE_CODE_URL} target="_blank" rel="noopener noreferrer" className={link}>
      {translate(locale, "Source code")}
    </a>
  );
}

/** The two documents and the source code as a quiet line, at the foot of Settings → Account. */
export function LegalLinks({ locale, className }: { locale: Locale; className?: string }) {
  return (
    <p className={cn("flex flex-wrap justify-center gap-x-3 gap-y-1", className)}>
      <a href={legalUrl(locale, "terms")} target="_blank" rel="noopener noreferrer" className={link}>
        {translate(locale, "Terms of Service")}
      </a>
      <a href={legalUrl(locale, "privacy")} target="_blank" rel="noopener noreferrer" className={link}>
        {translate(locale, "Privacy Policy")}
      </a>
      <SourceCodeLink locale={locale} />
    </p>
  );
}
