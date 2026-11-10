/**
 * Czech changes the end of a word (kšiltovka, kšiltovky, kšiltovek, kšiltovce), and a prefix search
 * matches only the start: "kšiltovka:*" missed "U kšiltovek se nám…", which Gmail found. So a search
 * word also looks for its stem and the shapes the stem's end takes in the other cases.
 */

/**
 * Case endings, without diacritics like the index, longest first: the light stemmer of Dolamic and
 * Savoy (Lucene's CzechStemmer), less -os, -us and -at, which cut English and Latin words (status,
 * bonus, format) more than they help.
 */
const ENDINGS = [
  ...["atech", "etem", "atum"],
  ...["ech", "ich", "eho", "emi", "emu", "ete", "eti", "iho", "imi", "imu", "ach", "ata", "aty", "ych", "ama", "ami", "ove", "ovi", "ymi"],
  ...["em", "es", "im", "um", "am", "ym", "mi", "ou"],
  ...["a", "e", "i", "o", "u", "y"],
];

/** Shorter than this, a stem matches too much: "auto" stays auto:*, not aut:* (autor, autorizace…). */
const MIN_STEM = 4;

/** k and h soften before e and i (Praha → v Praze, zákazník → zákazníci); c and z come back. */
const SOFTER: Record<string, string> = { k: "c", h: "z" };
const HARDER: Record<string, string> = { c: "k", z: "h" };

const VOWELS = ["a", "e", "i", "o", "u", "y"];
const consonant = (c: string | undefined) => !!c && !VOWELS.includes(c);

/**
 * The starts of a word's forms, for a prefix search, without diacritics: "kšiltovka" → ksiltovk
 * (-a, -y, -u, -ou), ksiltovce and ksiltovek; "dárek" → darek and darku, darky… A form that starts
 * with another one is left out, as that one's prefix covers it. Words other than Latin letters
 * (numbers, Cyrillic…) stay as they are.
 */
export function wordForms(word: string): string[] {
  const w = word.toLowerCase();
  if (!/^[a-zÀ-ɏ]+$/.test(w)) return [w];
  const plain = w.normalize("NFD").replace(/[̀-ͯ]/g, "").normalize("NFC");
  const found = ENDINGS.find((e) => plain.endsWith(e));
  const ending = found && plain.length - found.length >= MIN_STEM ? found : "";
  const stem = plain.slice(0, plain.length - ending.length);
  const forms = [plain, stem];
  // "ch" is one letter in Czech: it neither softens like h nor takes an e (střecha, střech).
  if (stem.length >= MIN_STEM && !stem.endsWith("ch")) {
    const last = stem.slice(-1);
    const head = stem.slice(0, -1);
    // Only with the e or i that softens it: "praz:*" alone would find prázdniny too.
    if (SOFTER[last]) forms.push(`${head}${SOFTER[last]}e`, `${head}${SOFTER[last]}i`);
    // "v Praze" finds Praha, "kšiltovce" kšiltovka.
    if (HARDER[last] && /^[ei]/.test(ending)) forms.push(head + HARDER[last]);
    // An e comes in between two consonants: kšiltovka → kšiltovek, platba → plateb.
    if (consonant(last) && consonant(stem.at(-2))) forms.push(`${head}e${last}`);
    // Or goes: dárek → dárku, účet → účtu. A vowel follows then, so "dárek" doesn't find "dark".
    if (consonant(last) && stem.at(-2) === "e" && consonant(stem.at(-3))) forms.push(...VOWELS.map((v) => stem.slice(0, -2) + last + v));
  }
  return [...new Set(forms)].filter((f, _, all) => !all.some((g) => g !== f && f.startsWith(g)));
}
