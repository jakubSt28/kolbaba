/**
 * The status bar strip of the iOS Home Screen app (#top-edge, see globals.css) sits above everything,
 * overlays included, so it paints itself what a backdrop would have shown there. While a backdrop is on
 * screen or fading, every frame mixes its colour, at the opacity it has right then, over the strip's
 * own colour: the strip fades in and out exactly with it, instead of on a clock of its own that flashed
 * a band of the wrong colour at the top. Backdrops opt in with the class `top-dim`.
 */

const BACKDROPS = ".top-dim";
/** Frames without a change before the loop rests; a tap or a change to the page wakes it. */
const REST_AFTER = 30;

export type Rgba = [number, number, number, number];

const toByte = (linear: number) => {
  const v = Math.max(0, Math.min(1, linear));
  return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
};

/** A computed colour as WebKit and Chrome write it: rgb(), color(srgb …), oklab() or oklch(). */
export function parseColour(colour: string): Rgba | null {
  const m = /^(rgba?|color|oklab|oklch)\((.*)\)$/.exec(colour.trim());
  if (!m) return null;
  const parts = m[2].replace(/^srgb\s+/, "").split(/[\s,/]+/).filter(Boolean);
  const n = parts.map((p) => (p.endsWith("%") ? Number(p.slice(0, -1)) / 100 : Number(p)));
  if (n.length < 3 || n.some(Number.isNaN)) return null;
  const alpha = n[3] ?? 1;
  if (m[1].startsWith("rgb")) return [n[0], n[1], n[2], alpha];
  if (m[1] === "color") {
    if (!/^srgb\s/.test(m[2])) return null;
    return [n[0] * 255, n[1] * 255, n[2] * 255, alpha];
  }
  const L = n[0];
  const hue = (n[2] * Math.PI) / 180;
  const [a, b] = m[1] === "oklch" ? [n[1] * Math.cos(hue), n[1] * Math.sin(hue)] : [n[1], n[2]];
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    toByte(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s),
    toByte(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s),
    toByte(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s),
    alpha,
  ];
}

/** Layers painted over an opaque base, bottom first. */
export function composite(base: Rgba, layers: Rgba[]): string {
  let [r, g, b] = base;
  for (const [lr, lg, lb, a] of layers) {
    r = r * (1 - a) + lr * a;
    g = g * (1 - a) + lg * a;
    b = b * (1 - a) + lb * a;
  }
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

/** Starts following the backdrops; returns the stop. Does nothing where the strip isn't shown (a computer). */
export function watchTopEdge(): () => void {
  const edge = document.getElementById("top-edge");
  if (!edge || getComputedStyle(edge).display === "none") return () => {};
  // The strip's own colour (the canvas, a thread's surface), resolved, while the strip itself shows the mix.
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "");
  probe.style.cssText = "position:fixed;width:0;height:0;visibility:hidden;pointer-events:none;background:var(--top-edge, var(--canvas))";
  document.body.append(probe);

  let frame = 0;
  let still = 0;
  let shown = "";
  const paint = () => {
    frame = 0;
    const layers: Rgba[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(BACKDROPS)) {
      const colour = parseColour(getComputedStyle(el).backgroundColor);
      if (!colour) continue;
      // Faded as a whole by itself or by what holds it (a dialog's wrapper fading in).
      let opacity = 1;
      for (let node: HTMLElement | null = el; node && node !== document.body; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
      const alpha = colour[3] * opacity;
      if (alpha > 0.002) layers.push([colour[0], colour[1], colour[2], alpha]);
    }
    const base = layers.length ? parseColour(getComputedStyle(probe).backgroundColor) : null;
    const next = base ? composite(base, layers) : "";
    if (next !== shown) {
      shown = next;
      still = 0;
      // Its own transition (for the strip's colour changing on its own) would lag behind the backdrop.
      edge.style.transition = next ? "none" : "";
      edge.style.background = next;
    } else still++;
    if (still < REST_AFTER) frame = requestAnimationFrame(paint);
  };
  const wake = () => {
    still = 0;
    if (!frame) frame = requestAnimationFrame(paint);
  };

  // Backdrops come and go with a change to the page, or start fading out after a tap or a key.
  const observer = new MutationObserver(wake);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "data-state"] });
  const events = ["pointerdown", "pointerup", "keydown", "touchend"] as const;
  for (const type of events) window.addEventListener(type, wake, { capture: true, passive: true });
  wake();

  return () => {
    observer.disconnect();
    for (const type of events) window.removeEventListener(type, wake, { capture: true });
    cancelAnimationFrame(frame);
    probe.remove();
    edge.style.background = "";
    edge.style.transition = "";
  };
}
