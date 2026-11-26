"use client";

import { Minus, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";

const button = "flex size-7 items-center justify-center rounded-full transition-colors hover:bg-white/15 disabled:opacity-40";

/** The small bar at the bottom of a PDF or a picture: − 100 % + on a computer (a phone pinches), and what `children` adds. */
export function ZoomBar({
  zoom,
  min,
  max,
  onZoom,
  buttons,
  children,
}: {
  /** 1 is the whole file fitted to the window. */
  zoom: number;
  min: number;
  max: number;
  /** Zooms by a factor (1.25 in, 0.8 out), or back to the fitted size with `"fit"`. */
  onZoom: (by: number | "fit") => void;
  buttons: boolean;
  children?: ReactNode;
}) {
  if (!buttons && !children) return null;
  return (
    <div className="absolute bottom-3 left-1/2 z-10 flex h-9 -translate-x-1/2 items-center gap-0.5 rounded-full bg-black/75 px-1 text-[12.5px] font-medium text-white tabular-nums shadow-lg backdrop-blur">
      {buttons && (
        <>
          <button onClick={() => onZoom(0.8)} disabled={zoom <= min * 1.001} aria-label={t("Zoom out")} className={button}>
            <Minus size={15} />
          </button>
          <button onClick={() => onZoom("fit")} aria-label={t("Zoom")} className="h-7 min-w-12 rounded-full px-1.5 text-center transition-colors hover:bg-white/15">
            {Math.round(zoom * 100)} %
          </button>
          <button onClick={() => onZoom(1.25)} disabled={zoom >= max * 0.999} aria-label={t("Zoom in")} className={button}>
            <Plus size={15} />
          </button>
        </>
      )}
      {children}
    </div>
  );
}
