"use client";

import { Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Output size of a mailbox picture: sharp at 3× for the largest badge (32 px) and still tiny. */
const OUT = 256;
const MAX_ZOOM = 4;

type View = { zoom: number; x: number; y: number };

/**
 * Square crop like a contact photo: drag to move, pinch / wheel / slider to zoom. The result is
 * resized and compressed here, so any picture from a phone or a Mac works without size limits.
 */
export function ImageCropper({
  file,
  frame = 232,
  onCancel,
  onDone,
}: {
  file: File;
  frame?: number;
  onCancel: () => void;
  onDone: (dataUrl: string) => void | Promise<void>;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      setImg(image);
      const base = frame / Math.min(image.naturalWidth, image.naturalHeight);
      setView({ zoom: 1, x: (frame - image.naturalWidth * base) / 2, y: (frame - image.naturalHeight * base) / 2 });
    };
    image.onerror = () => setError(t("This picture can't be opened here. Try a PNG or JPEG."));
    image.src = url;
    return () => {
      // A load we gave up on (another file, or React re-running the effect) mustn't report back.
      image.onload = image.onerror = null;
      URL.revokeObjectURL(url);
    };
  }, [file, frame]);

  const base = img ? frame / Math.min(img.naturalWidth, img.naturalHeight) : 1;

  /** Keep the picture covering the whole frame. */
  const clamp = (v: View): View => {
    if (!img) return v;
    const zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom));
    const w = img.naturalWidth * base * zoom;
    const h = img.naturalHeight * base * zoom;
    return { zoom, x: Math.min(0, Math.max(frame - w, v.x)), y: Math.min(0, Math.max(frame - h, v.y)) };
  };

  /** Zoom around a point of the frame (the pinch centre, the cursor, or the middle). */
  const zoomTo = (zoom: number, cx = frame / 2, cy = frame / 2) =>
    setView((v) => {
      const next = Math.min(MAX_ZOOM, Math.max(1, zoom));
      const k = next / v.zoom;
      return clamp({ zoom: next, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k });
    });

  const local = (e: React.PointerEvent | React.WheelEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    // Panning the picture mustn't also drag the sheet it sits in.
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.zoom };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      zoomTo((pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.dist, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
    } else if (pointers.current.size === 1) {
      setView((v) => clamp({ ...v, x: v.x + e.clientX - prev.x, y: v.y + e.clientY - prev.y }));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const save = async () => {
    if (!img || busy) return;
    setBusy(true);
    try {
      const scale = base * view.zoom;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = OUT;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, -view.x / scale, -view.y / scale, frame / scale, frame / scale, 0, 0, OUT, OUT);
      await onDone(await encode(canvas));
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[12.5px] leading-relaxed text-ink-2">{error}</p>
        <button onClick={onCancel} className="h-8 rounded-[10px] bg-hover text-[12.5px] font-medium text-ink-2 hover:bg-selected">
          {t("Back")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="relative cursor-grab touch-none overflow-hidden rounded-[22%] bg-hover shadow-[inset_0_0_0_0.5px_var(--line)] select-none active:cursor-grabbing"
        style={{ width: frame, height: frame }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(e) => {
          const p = local(e);
          zoomTo(view.zoom * Math.exp(-e.deltaY / 300), p.x, p.y);
        }}
      >
        {img && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={img.src}
            alt=""
            draggable={false}
            className="pointer-events-none absolute top-0 left-0 max-w-none origin-top-left"
            style={{
              width: img.naturalWidth,
              height: img.naturalHeight,
              transform: `translate(${view.x}px, ${view.y}px) scale(${base * view.zoom})`,
            }}
          />
        )}
      </div>
      <div className="flex w-full items-center gap-2 text-ink-3">
        <button aria-label={t("Zoom out")} onClick={() => zoomTo(view.zoom / 1.25)} className="flex size-6 items-center justify-center rounded-md hover:bg-hover hover:text-ink">
          <Minus size={14} />
        </button>
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={view.zoom}
          onChange={(e) => zoomTo(Number(e.target.value))}
          aria-label={t("Zoom")}
          className="h-1 flex-1 accent-[var(--accent)]"
        />
        <button aria-label={t("Zoom in")} onClick={() => zoomTo(view.zoom * 1.25)} className="flex size-6 items-center justify-center rounded-md hover:bg-hover hover:text-ink">
          <Plus size={14} />
        </button>
      </div>
      <div className="flex w-full gap-1.5">
        <button onClick={onCancel} className="h-8 flex-1 rounded-[10px] bg-hover text-[12.5px] font-medium text-ink-2 transition-colors hover:bg-selected">
          {t("Cancel")}
        </button>
        <button
          onClick={save}
          disabled={!img || busy}
          className={cn(
            "h-8 flex-1 rounded-[10px] bg-accent text-[12.5px] font-medium text-on-accent transition-[background-color,opacity] hover:bg-accent-hover disabled:opacity-60",
          )}
        >
          {busy ? t("Saving…") : t("Use picture")}
        </button>
      </div>
    </div>
  );
}

/**
 * WebP where the browser can encode it; otherwise PNG for pictures with transparency (logos) and
 * JPEG for photos, which keeps every result at a few tens of kB.
 */
async function encode(canvas: HTMLCanvasElement): Promise<string> {
  const webp = canvas.toDataURL("image/webp", 0.86);
  if (webp.startsWith("data:image/webp")) return webp;
  const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
  let transparent = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) {
      transparent = true;
      break;
    }
  }
  return transparent ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.86);
}
