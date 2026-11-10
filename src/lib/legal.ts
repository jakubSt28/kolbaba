import type { Locale } from "./i18n";

/**
 * Where Kolbaba's source code is (AGPL-3.0-or-later). The app links to it at the foot of Settings → Account.
 * Running a changed copy for other people? Point this at your own code: the AGPL asks you to offer it to them.
 */
export const SOURCE_CODE_URL = "https://github.com/jakubSt28/kolbaba";

/** The Terms and the Privacy Policy on kolbaba.app, in the reader's language. */
export const legalUrl = (locale: Locale, page: "terms" | "privacy") => `https://kolbaba.app${locale === "cs" ? "/cs" : ""}/${page}`;
