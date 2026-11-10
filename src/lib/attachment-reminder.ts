import { htmlToText } from "./utils";

/** Lowercase without accents, so "přikládám" and "prikladam" are the same word. */
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

/**
 * Words that promise a file, in Czech (folded, so with or without accents), English and German:
 * "přikládám", "v příloze", "přiložený", "posílám přílohu", "attached", "anbei".
 */
const PROMISE =
  /(^|[^a-z])(priklada(m|me)|prilozen\w*|prilozi(m|me)|v prilo(ze|hach)|prilohu|prilohou|attached|attaching|i attach|enclosed|anbei|im anhang|anhang)([^a-z]|$)/;

/** The email's own text (what's quoted from earlier mail doesn't count) promises an attachment. */
export function mentionsAttachment(html: string): boolean {
  const own = html.replace(/<blockquote[\s\S]*?<\/blockquote>/gi, " ");
  return PROMISE.test(fold(htmlToText(own)));
}
