import { ImageResponse } from "next/og";
import { ICON_COLORS, MARK_FIT, kolbabaFeatures, kolbabaTile } from "./kolbaba-icon";

const TILE = ICON_COLORS.tile;

/**
 * App icon: the white Kolbaba mark on an ink tile. Rendered with next/og so we don't ship PNGs.
 * Full-bleed square because iOS and Android apply their own mask; the mark is scaled into the
 * maskable safe zone (centre 80%) so circular masks don't clip the cap.
 */
export function renderAppIcon(size: number) {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: TILE }}>
        <svg width={size} height={size} viewBox="0 0 120 120" fill="none">
          {kolbabaFeatures(MARK_FIT.maskable)}
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}

/**
 * Favicon: the same rounded tile as the in-app BrandMark, with transparent corners and a hairline
 * edge that keeps it visible on both light and dark tab bars.
 */
export function renderFavicon(size: number) {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex" }}>
        <svg width={size} height={size} viewBox="0 0 120 120" fill="none">
          {kolbabaTile({ small: true })}
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
