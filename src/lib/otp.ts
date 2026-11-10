/**
 * Finds a one-time code (sign-in, verification, 2FA) in an email, so the app can offer it for copying
 * and put it straight into the push notification. Rules only, no AI: a code needs a code word nearby,
 * and amounts, years, times, dates, order numbers and promo codes don't count. Shared by the client
 * and the worker (push).
 */

/** A mail is a code mail only with one of these (English, Czech, Slovak, German; matched without diacritics). */
const STRONG = /\b(codes?|kod\w*|verification|verify|overovac\w*|one[-\s]time|jednorazov\w*|passcode|otp|2fa|two[-\s]factor|pin|heslo|bestatigungscode|sicherheitscode)\b/;
/** Where the code sits: next to a code word, or next to what it's for. */
const NEARBY =
  /\b(codes?|kod\w*|verif\w*|overov\w*|overen\w*|one[-\s]time|jednorazov\w*|passcode|otp|2fa|two[-\s]factor|pin|heslo|security|bezpecnost\w*|log[-\s]?in|sign[-\s]?in|prihlas\w*|authenticat\w*|confirm\w*|potvrz\w*|potvrd\w*|bestatigung\w*|sicherheit\w*)\b/g;
/** Marketing: "use code SAVE20", "sleva 20 %". */
const PROMO = /\b(promo\w*|coupon|kupon\w*|voucher|discount|sleva|slevov\w*|unsubscribe|odhlasit|odhlaseni)\b|% off/;

/** "123456", "123 456", "123-456", "G-123456". */
const DIGITS = /(?<![\w.,/:#-])(?:[A-Z]-)?(\d{3}[ -]\d{3}|\d{4,8})(?![\w%]|[.,:/]\d)/g;
/** Letters and digits like "K7X2QP": only right next to a code word. */
const ALNUM = /(?<![\w-])(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])([A-Z0-9]{6,8})(?![\w-])/g;

const UNIT_AFTER = /^\s*(kc\b|czk|eur|usd|€|\$|£|,-|ks\b|x\b|min|hod|h\b|days?\b|dni\b|let\b|%)/;
const NUMBER_BEFORE = /(#|\bc\.|\bno\.|\bnr\.|order\w*|objednav\w*|faktur\w*|invoice|tel\.?|phone|telefon\w*|cislo|number)\s*:?\s*$/;

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export interface FoundCode {
  /** Digits and letters only, ready to paste. */
  code: string;
}

export function findCode(subject: string, text: string): FoundCode | null {
  const parts = [subject, text.slice(0, 1500)];
  const folded = parts.map(fold);
  if (!folded.some((p) => STRONG.test(p)) || folded.some((p) => PROMO.test(p))) return null;

  let best: { code: string; distance: number } | null = null;
  const codeSubject = STRONG.test(folded[0]);
  parts.forEach((part, i) => {
    const low = folded[i];
    const words = [...low.matchAll(NEARBY)].map((m) => [m.index!, m.index! + m[0].length] as const);
    // "Your verification code" as the subject, "Enter 731 204 to continue" as the body: the subject is the code word.
    if (i === 1 && codeSubject) words.push([0, 0]);
    if (!words.length) return;
    const consider = (raw: string, start: number, strict: boolean) => {
      const end = start + raw.length;
      if (UNIT_AFTER.test(low.slice(end, end + 8)) || NUMBER_BEFORE.test(low.slice(Math.max(0, start - 18), start))) return;
      const distance = Math.min(...words.map(([a, b]) => (start >= b ? start - b : a >= end ? a - end : 0)));
      const code = raw.replace(/[\s-]/g, "");
      // A year looks like a code; only right next to "code" is it one.
      if (/^(19|20)\d\d$/.test(code) && distance > 12) return;
      if (distance > (strict ? 24 : 100)) return;
      if (!best || distance < best.distance) best = { code, distance };
    };
    for (const m of part.matchAll(DIGITS)) consider(m[1], m.index! + m[0].length - m[1].length, false);
    for (const m of part.matchAll(ALNUM)) consider(m[1], m.index!, true);
  });
  const found = best as { code: string } | null;
  return found ? { code: found.code } : null;
}

/** "482913" → "482 913" for reading; other codes stay as they are. */
export function formatCode(code: string) {
  return /^\d{6}$/.test(code) ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/** Codes expire within minutes; after this the list stops offering them. */
export const CODE_FRESH_MS = 30 * 60_000;
