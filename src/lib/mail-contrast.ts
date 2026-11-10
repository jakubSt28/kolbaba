/** Below this the text is a struggle to read: WCAG's minimum for large text, so a sender's dark red or grey stays theirs. */
const MIN_CONTRAST = 3;

type Rgba = { r: number; g: number; b: number; a: number };

/** `#rrggbb` as the theme writes it, or `rgb()`/`rgba()` as browsers report computed colours. Anything else is null. */
export function parseColor(value: string): Rgba | null {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value.trim());
  if (hex) return { r: parseInt(hex[1], 16), g: parseInt(hex[2], 16), b: parseInt(hex[3], 16), a: 1 };
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+)(%?))?\s*\)$/i.exec(value.trim());
  if (!rgb) return null;
  const a = rgb[4] === undefined ? 1 : Number(rgb[4]) / (rgb[5] ? 100 : 1);
  return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a };
}

function luminance({ r, g, b }: Rgba) {
  const [lr, lg, lb] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/** Text this close to the background can't be read. Invisible text (preheaders) is hidden on purpose, so it stays. */
export function unreadable(color: string, background: string) {
  const text = parseColor(color);
  const bg = parseColor(background);
  if (!text || !bg || text.a < 0.5) return false;
  const [hi, lo] = [luminance(text), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05) < MIN_CONTRAST;
}

/**
 * Plain mail sits right on the app's background, but people's mail apps write its text colour in:
 * black from Outlook or Gmail is invisible in dark mode. Only what can't be read goes back to the
 * app's ink, so a sender's red warning stays red. Top down, because the fix is `inherit`.
 */
export function keepTextReadable(body: HTMLElement, background: string) {
  const view = body.ownerDocument.defaultView;
  if (!view) return;
  const walk = (el: Element) => {
    const style = view.getComputedStyle(el);
    // The sender painted a background behind this part (`<mark>`): its colours belong together.
    if ((parseColor(style.backgroundColor)?.a ?? 0) >= 0.5) return;
    if (unreadable(style.color, background)) (el as HTMLElement).style.setProperty("color", "inherit", "important");
    for (const child of Array.from(el.children)) walk(child);
  };
  walk(body);
}

/**
 * Newsletters bring their own dark mode (`@media (prefers-color-scheme: dark)`: white text), but
 * inside our frame browsers disagree on what that asks: Chrome and Safari 27 answer with the frame's
 * `color-scheme`, older Safari with the system. Rich mail sits on a white sheet either way, so on a
 * dark Mac Revolut's text went white on white. Every such query is answered here for the look the
 * frame really has: always true, or never.
 */
export function pinColorScheme(html: string, scheme: "light" | "dark") {
  return html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (style) =>
    style.replace(/\(\s*prefers-color-scheme\s*:\s*(light|dark)\s*\)/gi, (_all, asked: string) =>
      asked.toLowerCase() === scheme ? "(min-width:0)" : "(not (min-width:0))",
    ),
  );
}
