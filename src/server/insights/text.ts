/**
 * Email HTML as plain text for the model: table cells and blocks keep their breaks (order lines and
 * totals live in tables), links keep their URL when it's a tracking link, everything else goes.
 */

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ndash: "–", mdash: "—", euro: "€", hellip: "…" };

function decode(s: string) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

const TRACKING_LINK = /track|sledov|zasilk|parcel|package|shipment|baliky|delivery|doruc/i;

export function emailText(html: string | null, text: string | null, max = 6000): string {
  if (!html) return (text ?? "").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
  const out = html
    .replace(/<(script|style|head|title)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Tracking links are worth their URL; other links are just their text.
    .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, inner: string) =>
      TRACKING_LINK.test(href + inner) && /^https?:/.test(href) ? `${inner} (${href})` : inner,
    )
    .replace(/<\/(td|th)>/gi, "\t")
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d|\/table|hr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decode(out)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}
