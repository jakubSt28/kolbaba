import { CS } from "./cs";

/**
 * The app in English and Czech. The English text is the key: `t("Archive")` shows "Archivovat" to a
 * Czech reader and "Archive" to everyone else, and a missing translation falls back to English.
 * Placeholders in braces: `t("Copied {value}", { value })`. Counts: `tn(n, "{n} order", "{n} orders")`.
 * `tk("…")` marks text kept in a constant and translated where it's shown (`t(LABELS[x])`).
 * One English text with two Czech meanings gets a context after "@@", which English never shows:
 * `t("Archive@@folder")` is "Archiv", `t("Archive")` (the action) is "Archivovat".
 * Every literal passed to t / tn / tk needs an entry in ./cs (src/lib/i18n/i18n.test.ts checks).
 */

export type Locale = "en" | "cs";
export type LanguageSetting = "auto" | Locale;
export const LANGUAGE_SETTINGS = ["auto", "en", "cs"] as const satisfies readonly LanguageSetting[];

/** A Czech text, or the three Czech forms of a text with a count (1 · 2–4 · 0 and 5+). */
export type Translation = string | { one: string; few: string; other: string };
export type Dictionary = Record<string, Translation>;

type Vars = Record<string, string | number>;

let current: Locale = "en";

/** The browser's language if Kolbaba speaks it; Slovak readers get Czech. */
export function detectLocale(languages?: readonly string[]): Locale {
  const list = languages ?? (typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]);
  for (const l of list) {
    const base = l.toLowerCase().slice(0, 2);
    if (base === "cs" || base === "sk") return "cs";
    if (base === "en") return "en";
  }
  return "en";
}

export const resolveLocale = (setting: LanguageSetting | undefined): Locale => (setting === "en" || setting === "cs" ? setting : detectLocale());

/** Switch the language of the app (the caller re-renders it). The cookie lets server pages (sign-in) follow. */
export function setLocale(locale: Locale) {
  current = locale;
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
  document.cookie = `kolbaba_lang=${locale}; path=/; max-age=31536000; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
}

export const getLocale = () => current;

/** The locale for Intl formatters (dates, numbers, money). */
export const intlLocale = (locale: Locale = current) => (locale === "cs" ? "cs-CZ" : "en-GB");

const fill = (text: string, vars?: Vars) => (vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text);

function csForm(n: number): "one" | "few" | "other" {
  if (!Number.isInteger(n)) return "other";
  const a = Math.abs(n);
  return a === 1 ? "one" : a >= 2 && a <= 4 ? "few" : "other";
}

const english = (text: string) => {
  const at = text?.indexOf("@@") ?? -1;
  return at < 0 ? text : text.slice(0, at);
};

/** UI text in a given language (server pages, push notifications). */
export function translate(locale: Locale, text: string, vars?: Vars): string {
  const tr = locale === "cs" ? CS[text] : undefined;
  return fill(typeof tr === "string" ? tr : english(text), vars);
}

export function translateCount(locale: Locale, n: number, one: string, other: string, vars?: Vars): string {
  const all = { n, ...vars };
  if (locale === "cs") {
    const tr = CS[other];
    if (tr && typeof tr === "object") return fill(tr[csForm(n)], all);
  }
  return fill(n === 1 ? one : other, all);
}

/** UI text in the app's language. */
export const t = (text: string, vars?: Vars) => translate(current, text, vars);

/** UI text with a count; `{n}` is the count. The Czech forms live under the `other` text in ./cs. */
export const tn = (n: number, one: string, other: string, vars?: Vars) => translateCount(current, n, one, other, vars);

/** Marks text in a constant for translation; translate it with t() where it's shown. */
export const tk = <T extends string>(text: T) => text;
