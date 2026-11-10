// Kolbaba mark: a postman reduced to his cap, nose and mustache. Shared by the in-app BrandMark
// and the generated PNG icons so both stay identical. Geometry lives in a 120×120 box; the mark's
// bounding box spans y 9–96.5 (centre 52.75), so every fit re-centres it on the tile.
export const ICON_COLORS = {
  tile: "#1A1E27",
  mark: "#FFFFFF",
} as const;

const fit = (scale: number) => `translate(60 60) scale(${scale}) translate(-60 -52.75)`;

export const MARK_FIT = {
  // In-app sizes above 32 px: even ~17% margins.
  regular: fit(0.92),
  // ≤ 32 px (favicon, sidebar): a little larger so it stays legible, ~14% margins.
  compact: fit(1),
  // Full-bleed PNGs: kept inside the maskable safe zone (centre 80%).
  maskable: fit(0.8),
} as const;

export const MUSTACHE =
  "M60 82 C56 78.5 50 78 45 80.5 C41 82.5 37.5 82 36.5 78.5 C35.5 84 39.5 88.5 45 88.8 C51 89 56 86.5 60 85.2 C64 86.5 69 89 75 88.8 C80.5 88.5 84.5 84 83.5 78.5 C82.5 82 79 82.5 75 80.5 C70 78 64 78.5 60 82 Z";

/**
 * Rounded ink tile with the mark, drawn entirely in SVG (the hairline edge included) so the
 * favicon PNG and the in-app BrandMark render identically and stay centred.
 */
export function kolbabaTile({ small = false } = {}) {
  return (
    <g>
      <rect x={1.5} y={1.5} width={117} height={117} rx={27} fill={ICON_COLORS.tile} stroke="rgba(255,255,255,0.12)" strokeWidth={3} />
      {small ? kolbabaFeatures(MARK_FIT.compact, { small: true }) : kolbabaFeatures(MARK_FIT.regular)}
    </g>
  );
}

/**
 * Called as a plain function (not a component) so Satori can render it inside ImageResponse.
 * `small` drops the envelope's flap line, which only adds noise below ~32 px.
 */
export function kolbabaFeatures(transform: string, { small = false } = {}) {
  const { tile, mark } = ICON_COLORS;
  return (
    <g transform={transform}>
      <path d="M26 48 L32 14 Q60 4 88 14 L94 48 Z" fill={mark} />
      <rect x={18} y={44} width={84} height={11} rx={5.5} fill={mark} />
      {/* Envelope badge cut out of the cap */}
      <rect x={51} y={22} width={18} height={12} rx={2.2} fill={tile} />
      {!small && (
        <path d="M52 23.4 L60 29.2 L68 23.4" stroke={mark} strokeWidth={1.7} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {/* Nose sits high enough to keep a clear gap from both the brim and the mustache */}
      <circle cx={60} cy={69} r={9} fill={mark} />
      <path d={MUSTACHE} transform="translate(60 89) scale(1.5) translate(-60 -84)" fill={mark} />
    </g>
  );
}
