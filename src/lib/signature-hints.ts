/**
 * What a signature says about its writer: phone numbers, LinkedIn and a website, and the company
 * when a line names one (s.r.o., a.s., Inc…). Rules only, read from the end of the message above any
 * quoted reply; the address book offers these, it never fills them in by itself.
 */
export interface SignatureHints {
  phones: string[];
  links: string[];
  company: string | null;
}

/** Where a quoted reply starts (Gmail, Apple Mail, Outlook, Seznam, Czech and English). */
const QUOTE_START = [
  /^>/,
  /^On .{4,120} wrote:\s*$/i,
  /^Dne .{4,120} napsal\(a\):\s*$/i,
  /^Dne .{4,120} napsal[a]?:\s*$/i,
  /^-{2,}\s*(Original Message|Původní zpráva|Forwarded message|Přeposlaná zpráva)\s*-{2,}/i,
  /^(From|Od):\s.+/i,
];

const PHONE = /(?:\+|00)?\d[\d\s().-]{7,}\d/g;
const URL_RE = /\bhttps?:\/\/[^\s<>"')]+|\b(?:www\.)[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s<>"')]*/gi;
const LINKEDIN = /linkedin\.com\/(in|company)\//i;
const SOCIAL = /(facebook|instagram|twitter|x)\.com|youtube\.com|tiktok\.com|calendly\.com\/?$/i;
const COMPANY = /\b(s\.\s?r\.\s?o\.|spol\.\s?s\s?r\.\s?o\.|a\.\s?s\.|v\.\s?o\.\s?s\.|z\.\s?s\.|z\.\s?ú\.|o\.\s?p\.\s?s\.|Inc\.?|Ltd\.?|LLC|GmbH|S\.A\.|B\.V\.|AG)(?=$|[\s,.;)])/;

/** The writer's own part of a message: above the quoted reply, the last lines (where signatures are). */
export function ownText(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const end = lines.findIndex((l) => QUOTE_START.some((re) => re.test(l.trim())));
  return (end >= 0 ? lines.slice(0, end) : lines)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-14);
}

const digits = (s: string) => s.replace(/\D/g, "");

export function signatureHints(text: string, email?: string): SignatureHints {
  const lines = ownText(text);
  const phones: string[] = [];
  const links: string[] = [];
  let company: string | null = null;
  for (const line of lines) {
    for (const raw of line.match(URL_RE) ?? []) {
      const url = raw.replace(/[.,;:]+$/, "");
      const full = /^https?:/i.test(url) ? url : `https://${url}`;
      if (SOCIAL.test(full) && !LINKEDIN.test(full)) continue;
      if (!links.some((l) => l.replace(/\/$/, "") === full.replace(/\/$/, ""))) links.push(full);
    }
    // Phone numbers outside of links and dates.
    const plain = line.replace(URL_RE, " ");
    for (const raw of plain.match(PHONE) ?? []) {
      const n = digits(raw);
      if (n.length < 9 || n.length > 15) continue;
      if (/^\d{4}[-./]\d{1,2}[-./]\d{1,2}$/.test(raw.trim()) || /^\d{1,2}\.\s?\d{1,2}\.\s?\d{4}$/.test(raw.trim())) continue;
      const pretty = raw.trim().replace(/\s+/g, " ");
      if (!phones.some((p) => digits(p).endsWith(n.slice(-9)))) phones.push(pretty);
    }
    if (!company && COMPANY.test(line) && line.length <= 80 && !line.includes("@")) {
      // "sales director | Acme s.r.o.": the part that names the company.
      const part = line.split(/\s[|•·–—]\s|\s-\s/).find((p) => COMPANY.test(p)) ?? line;
      company = part.replace(/^[|•·\-–—\s]+|[|•·\-–—\s]+$/g, "").trim();
    }
  }
  // The company's own site first, then LinkedIn, then the rest.
  const domain = email?.split("@")[1]?.toLowerCase();
  const rank = (url: string) => (domain && url.toLowerCase().includes(domain) ? 0 : LINKEDIN.test(url) ? 1 : 2);
  return { phones: phones.slice(0, 3), links: links.sort((a, b) => rank(a) - rank(b)).slice(0, 3), company };
}
