/**
 * Agents write bodies as plain text or light Markdown. Drafts are stored as editor HTML (the
 * composer opens them in TipTap), so convert the small subset people actually use in email:
 * paragraphs, line breaks, lists, quotes, headings, bold/italic/code and links. Everything else is
 * escaped text — the agent can never inject markup.
 */

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(text: string) {
  const links: string[] = [];
  const stash = (html: string) => `\u0000${links.push(html) - 1}\u0000`;
  let s = escape(text);
  s = s.replace(/`([^`]+)`/g, (_, code: string) => stash(`<code>${code}</code>`));
  s = s.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, (_, label: string, href: string) => stash(`<a href="${href}">${label}</a>`));
  s = s.replace(/(^|[\s(])((?:https?:\/\/)[^\s<]+[^\s<.,;:!?)])/g, (_, pre: string, url: string) => `${pre}${stash(`<a href="${url}">${url}</a>`)}`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, "$1<em>$2</em>").replace(/(^|[^_\w])_([^_\s][^_]*)_(?!\w)/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => links[Number(i)]);
}

const BULLET = /^\s*[-*•]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;
const QUOTE = /^\s*>\s?/;
const HEADING = /^(#{1,3})\s+/;

export function textToEditorHtml(body: string): string {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  const take = (re: RegExp) => {
    const items: string[] = [];
    while (i < lines.length && re.test(lines[i])) items.push(lines[i++].replace(re, ""));
    return items;
  };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      out.push("<hr>");
      i++;
    } else if (HEADING.test(line)) {
      const level = line.match(HEADING)![1].length;
      out.push(`<h${level}>${inline(line.replace(HEADING, ""))}</h${level}>`);
      i++;
    } else if (BULLET.test(line)) {
      out.push(`<ul>${take(BULLET).map((t) => `<li><p>${inline(t)}</p></li>`).join("")}</ul>`);
    } else if (NUMBERED.test(line)) {
      out.push(`<ol>${take(NUMBERED).map((t) => `<li><p>${inline(t)}</p></li>`).join("")}</ol>`);
    } else if (QUOTE.test(line)) {
      out.push(`<blockquote><p>${take(QUOTE).map(inline).join("<br>")}</p></blockquote>`);
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i]) && !QUOTE.test(lines[i]) && !HEADING.test(lines[i])) {
        para.push(inline(lines[i++].trim()));
      }
      out.push(`<p>${para.join("<br>")}</p>`);
    }
  }
  return out.join("") || "<p></p>";
}
