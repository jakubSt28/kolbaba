import { isFreeMail } from "./mail-domains";
import type { MailRule } from "./types";

/** Lowercase without accents, so "faktura" matches "Faktúra" and "FAKTURA". */
export const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

/**
 * Who a rule is about, typed by the user: "petr@firma.cz" stays an address, "@alza.cz", "alza.cz"
 * or "Alza.cz" mean everyone at that domain. Empty stays empty; anything else is null (not valid).
 */
export function normalizeFrom(input: string): string | null {
  const v = input.trim().toLowerCase().replace(/^mailto:/, "");
  if (!v) return "";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return v;
  const domain = v.replace(/^@/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) ? `@${domain}` : null;
}

/** A company writes from many addresses (info@, objednavky@…): its domain. A person at Gmail or Seznam: their address. */
export function senderKey(email: string): string {
  const e = email.trim().toLowerCase();
  const domain = e.slice(e.lastIndexOf("@") + 1);
  return !domain || isFreeMail(domain) ? e : `@${domain}`;
}

/** Whether an address is the rule's sender: the same address, or anyone at the domain (and its subdomains). */
export function fromMatches(match: string, email: string): boolean {
  if (!match) return true;
  const e = email.trim().toLowerCase();
  if (!match.startsWith("@")) return e === match;
  return e.endsWith(match) || e.endsWith(`.${match.slice(1)}`);
}

/** Every word of the rule's subject is in the email's subject (in any order). */
export function subjectMatches(match: string, subject: string): boolean {
  const words = fold(match).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold(subject);
  return words.every((w) => hay.includes(w));
}

/** Whether a rule applies to an email. A rule with neither a sender nor a subject applies to nothing. */
export function ruleMatches(rule: Pick<MailRule, "accountId" | "from" | "subject">, mail: { accountId: string; from: string; subject: string }): boolean {
  if (!rule.from && !rule.subject.trim()) return false;
  if (rule.accountId && rule.accountId !== mail.accountId) return false;
  return fromMatches(rule.from, mail.from) && subjectMatches(rule.subject, mail.subject);
}

/** The first rule (oldest first) that applies, if any. */
export function firstMatch<R extends Pick<MailRule, "accountId" | "from" | "subject">>(rules: R[], mail: { accountId: string; from: string; subject: string }): R | null {
  return rules.find((r) => ruleMatches(r, mail)) ?? null;
}
