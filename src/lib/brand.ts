import { tk } from "./i18n";
// Everything brand-specific reads from here.
export const BRAND = {
  name: "Kolbaba",
  tagline: "All the good stuff. None of the fluff.",
} as const;

/**
 * App colours (Settings → App colour). Each is an oklch lightness, chroma and hue; globals.css has
 * the same numbers under [data-accent="…"]. Ink is the neutral default and is special-cased there.
 */
export const ACCENTS = [
  { id: "ink", label: tk("Ink"), swatch: "#1a1e27" },
  { id: "slate", label: tk("Slate"), swatch: "oklch(0.52 0.035 255)" },
  { id: "cocoa", label: tk("Cocoa"), swatch: "oklch(0.52 0.07 50)" },
  { id: "ember", label: tk("Ember"), swatch: "oklch(0.65 0.17 38)" },
  { id: "amber", label: tk("Amber"), swatch: "oklch(0.74 0.15 75)" },
  { id: "moss", label: tk("Moss"), swatch: "oklch(0.58 0.12 150)" },
  { id: "pine", label: tk("Pine"), swatch: "oklch(0.5 0.08 175)" },
  { id: "lagoon", label: tk("Lagoon"), swatch: "oklch(0.6 0.115 200)" },
  { id: "ocean", label: tk("Ocean"), swatch: "oklch(0.56 0.17 255)" },
  { id: "iris", label: tk("Iris"), swatch: "oklch(0.56 0.2 285)" },
  { id: "orchid", label: tk("Orchid"), swatch: "oklch(0.6 0.19 330)" },
  { id: "rose", label: tk("Rose"), swatch: "oklch(0.62 0.19 12)" },
] as const;

export type Accent = (typeof ACCENTS)[number]["id"];
export const ACCENT_IDS = ACCENTS.map((a) => a.id) as [Accent, ...Accent[]];
