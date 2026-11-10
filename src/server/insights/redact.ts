import { findCode } from "@/lib/otp";

/**
 * Before an email goes to an AI provider (TypeSafe for sorting, OpenAI for cards and summaries), the
 * secrets in it are blanked: sign-in codes, passwords sent in plain text, card numbers and their CVC,
 * PINs. Sorting and reading don't need them, and they never leave Kolbaba. Rules only; what they miss
 * is still covered by the providers not keeping or training on the mail.
 */

const CODE = "[code]";
const PASSWORD = "[password]";
const CARD = "[card number]";

/** "heslo je Xy7!abc", "Password: hunter2", "Ihr Kennwort lautet …". */
const PASSWORD_VALUE = /\b(password|passwort|kennwort|heslo(?:\s+k\s+\S+)?)(\s*(?:[:=]|\bje\b|\bis\b|\bist\b|\blautet\b)\s*[:=]?\s*)(?!\[)([^\s<>"']{4,64})/gi;
/** "CVV: 123", "PIN 4821". */
const SHORT_SECRET = /\b(cvv2?|cvc2?|csc|pin)(\s*(?:k[oó]d)?\s*[:=]?\s*)(\d{3,8})\b/gi;
/** "4111 1111 1111 1111", "4111-1111-1111-1111": card-like groups of four. */
const GROUPED_CARD = /\b\d{4}([ -])\d{4}\1\d{4}\1\d{1,7}\b/g;
/** Fifteen or sixteen digits in one go, only right after a card word (a parcel number can look the same). */
const PLAIN_CARD = /\b(card|karta|kart[uyě]|kreditn\S*|debetn\S*|visa|mastercard|amex)\b([^\d\n]{0,24})(\d{15,16})\b/gi;

function luhn(digits: string) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The email's subject and text with its secrets blanked (the same code in both places goes in both). */
export function redactSecrets(subject: string, text: string): { subject: string; text: string } {
  // Cards, passwords and CVCs first: a card number's groups of four could pass for a code.
  const rest = (x: string) =>
    x
      .replace(PASSWORD_VALUE, (_m, word: string, sep: string) => `${word}${sep}${PASSWORD}`)
      .replace(SHORT_SECRET, (_m, word: string, sep: string) => `${word}${sep}${CODE}`)
      .replace(GROUPED_CARD, (m) => (luhn(m.replace(/\D/g, "")) ? CARD : m))
      .replace(PLAIN_CARD, (m, word: string, between: string, digits: string) => (luhn(digits) ? `${word}${between}${CARD}` : m));
  let s = rest(subject);
  let t = rest(text);
  const otp = findCode(s, t);
  if (otp && otp.code.length >= 4) {
    // As it was written: "123 456" or "123-456" as well as "123456".
    const spaced = otp.code.length === 6 && /^\d+$/.test(otp.code) ? `|${otp.code.slice(0, 3)}[ -]${otp.code.slice(3)}` : "";
    const re = new RegExp(`(?<![\\w])(?:${escapeRe(otp.code)}${spaced})(?![\\w])`, "g");
    s = s.replace(re, CODE);
    t = t.replace(re, CODE);
  }
  return { subject: s, text: t };
}
