"use client";

import { LoaderCircle } from "lucide-react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { ZoomBar } from "./viewer-zoom";

type Pdfjs = typeof import("pdfjs-dist");

/** pdf.js's worker, fonts and decoders, copied from the package when the app builds (next.config.ts). */
const ASSETS = "/pdfjs";

let library: Promise<Pdfjs> | undefined;
/** pdf.js is big, so it loads when the first PDF is opened. The build for older browsers: a phone a few years old still opens it. */
function loadPdfjs() {
  if (!library) {
    library = import("pdfjs-dist/legacy/build/pdf.mjs").then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = `${ASSETS}/pdf.worker.min.js`;
      return lib;
    });
    // A failed load (offline for a moment) mustn't stick: the next PDF tries again.
    library.catch(() => (library = undefined));
  }
  return library;
}

interface Size {
  w: number;
  h: number;
}

const coarse = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** On a computer a page is at most this wide at 100 %, or a wide window would blow one page up over the whole screen. */
const MAX_FIT_WIDTH = 920;
const MAX_ZOOM = 5;
const GAP = 12;

/**
 * How many canvas pixels per CSS pixel: the screen's density, less when the page would need a canvas
 * bigger than the device can hold (an iPhone draws nothing past about 16 million pixels).
 */
function outputRatio(width: number, height: number) {
  const density = Math.min(window.devicePixelRatio || 1, 3);
  const maxArea = coarse() ? 16_000_000 : 32_000_000;
  return width * height * density * density > maxArea ? Math.sqrt(maxArea / (width * height)) : density;
}

/** Gives a canvas's memory back right away; a phone runs out of it long before the garbage collector comes. */
function release(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * A PDF drawn by pdf.js, page under page. The browser's own PDF viewer in a frame was unreliable: blank under
 * the app's security headers, first page only on an iPhone, nothing on Android, and it swallowed Escape.
 */
export function PdfView({ blob, onFail, onBackdrop }: { blob: Blob; onFail: () => void; onBackdrop: () => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<{ pdfjs: Pdfjs; pdf: PDFDocumentProxy; sizes: Size[] } | null>(null);
  const [width, setWidth] = useState(0);
  // `zoom` is what the pages are drawn at; `live` runs ahead of it during a pinch, when only the CSS size changes.
  const [zoom, setZoom] = useState(1);
  const live = useRef(1);
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [current, setCurrent] = useState(1);
  const [touch] = useState(coarse);
  const failed = useRef(onFail);
  useEffect(() => {
    failed.current = onFail;
  });

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | undefined;
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        const data = new Uint8Array(await blob.arrayBuffer());
        if (cancelled) return;
        task = pdfjs.getDocument({
          data,
          cMapUrl: `${ASSETS}/cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${ASSETS}/standard_fonts/`,
          wasmUrl: `${ASSETS}/wasm/`,
          iccUrl: `${ASSETS}/iccs/`,
          // A PDF is someone else's file: its forms' scripts are never run.
          enableXfa: false,
        });
        const pdf = await task.promise;
        const sizeOf = async (n: number): Promise<Size> => {
          const viewport = (await pdf.getPage(n)).getViewport({ scale: 1 });
          return { w: viewport.width, h: viewport.height };
        };
        const first = await sizeOf(1);
        if (cancelled) return;
        // The first page shows at once; the others take its size until theirs is known.
        setDoc({ pdfjs, pdf, sizes: Array.from({ length: pdf.numPages }, () => first) });
        if (pdf.numPages === 1) return;
        const sizes = await Promise.all(Array.from({ length: pdf.numPages }, (_, i) => (i === 0 ? first : sizeOf(i + 1).catch(() => first))));
        if (!cancelled && sizes.some((s) => s.w !== first.w || s.h !== first.h)) setDoc((d) => d && { ...d, sizes });
      } catch (err) {
        if (cancelled) return;
        // Locked with a password, damaged, or not a PDF at all: the viewer offers the file itself.
        console.warn("Couldn't open the PDF", err);
        failed.current();
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [blob]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const margin = width < 640 ? 0 : 24;
  const widest = doc ? Math.max(...doc.sizes.map((s) => s.w)) : 1;
  // PDF points to CSS pixels at 100 %: the widest page fills the width.
  const fit = width ? Math.max(40, Math.min(width - 2 * margin, MAX_FIT_WIDTH)) / widest : 0;
  const fitRef = useRef(fit);
  const minZoom = touch ? 1 : 0.5;

  // Before paint, so a resize or a new size of a page never shows one frame at the old scale.
  useLayoutEffect(() => {
    fitRef.current = fit;
    content.current?.style.setProperty("--total-scale-factor", String(fit * live.current));
  }, [fit]);

  /** Zooms to `next`, keeping the point at (x, y) of the window where it is: under the cursor or between the fingers. */
  const zoomTo = useCallback(
    (next: number, clientX?: number, clientY?: number) => {
      const el = scroller.current;
      const pages = content.current;
      next = clamp(next, minZoom, MAX_ZOOM);
      const previous = live.current;
      if (!el || !pages || next === previous) return;
      const box = el.getBoundingClientRect();
      const x = clientX === undefined ? el.clientWidth / 2 : clientX - box.left;
      const y = clientY === undefined ? el.clientHeight / 2 : clientY - box.top;
      const down = (el.scrollTop + y) / el.scrollHeight;
      const fromCentre = (el.scrollLeft + x - el.scrollWidth / 2) / previous;
      live.current = next;
      pages.style.setProperty("--total-scale-factor", String(fitRef.current * next));
      el.scrollTop = down * el.scrollHeight - y;
      el.scrollLeft = el.scrollWidth / 2 + fromCentre * next - x;
      // The pages stretch while the zoom moves and are drawn sharp once it rests.
      clearTimeout(settle.current);
      settle.current = setTimeout(() => setZoom(next), 160);
    },
    [minZoom],
  );
  useEffect(() => () => clearTimeout(settle.current), []);

  // Pinch on a phone, pinch on a trackpad, Ctrl + wheel and a double tap. Listened to directly: React's
  // touch and wheel listeners are passive and couldn't stop the browser zooming the whole app instead.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !doc) return;
    let pinch: { distance: number; zoom: number } | null = null;
    let tap: { x: number; y: number; at: number } | null = null;
    let lastTap: { x: number; y: number; at: number } | null = null;
    let gesture = 1;
    const spread = (e: TouchEvent) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomTo(live.current * Math.exp(-clamp(e.deltaY, -30, 30) * 0.01), e.clientX, e.clientY);
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinch = { distance: spread(e), zoom: live.current };
        tap = null;
      } else if (e.touches.length === 1) {
        tap = { x: e.touches[0].clientX, y: e.touches[0].clientY, at: Date.now() };
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (pinch && e.touches.length === 2) {
        e.preventDefault();
        zoomTo(
          (pinch.zoom * spread(e)) / pinch.distance,
          (e.touches[0].clientX + e.touches[1].clientX) / 2,
          (e.touches[0].clientY + e.touches[1].clientY) / 2,
        );
      } else if (tap && Math.hypot(e.touches[0].clientX - tap.x, e.touches[0].clientY - tap.y) > 10) {
        tap = null;
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
      if (e.touches.length > 0 || !tap || Date.now() - tap.at > 250) return;
      const now = { ...tap, at: Date.now() };
      tap = null;
      if (lastTap && now.at - lastTap.at < 320 && Math.hypot(now.x - lastTap.x, now.y - lastTap.y) < 30) {
        // A double tap zooms in on the spot, and back out again.
        e.preventDefault();
        zoomTo(live.current > 1.05 ? 1 : 2.5, now.x, now.y);
        lastTap = null;
      } else {
        lastTap = now;
      }
    };
    // Safari on a Mac reports a trackpad pinch as gesture events; on an iPhone the touches above already cover it.
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gesture = live.current;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      if (pinch) return;
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      zoomTo(gesture * g.scale, g.clientX, g.clientY);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: false });
    el.addEventListener("touchcancel", onTouchEnd, { passive: false });
    el.addEventListener("gesturestart", onGestureStart);
    el.addEventListener("gesturechange", onGestureChange);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
    };
  }, [doc, zoomTo]);

  // + and − zoom, 0 goes back to the whole width. With Cmd or Ctrl they stay the browser's own.
  useEffect(() => {
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "+" || e.key === "=") zoomTo(live.current * 1.25);
      else if (e.key === "-") zoomTo(live.current / 1.25);
      else if (e.key === "0") zoomTo(1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [doc, zoomTo]);

  // The arrows, Space and Page Down scroll the pages once they have the focus. Escape still reaches the viewer.
  const loaded = !!doc;
  useEffect(() => {
    if (loaded) scroller.current?.focus({ preventScroll: true });
  }, [loaded]);

  // Which page is in the middle of the window, for "3 / 12".
  useEffect(() => {
    const el = scroller.current;
    if (!el || !doc) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const middle = el.scrollTop + el.clientHeight / 2;
        const pages = content.current?.querySelectorAll<HTMLElement>("[data-page]") ?? [];
        let page = pages.length;
        for (let i = 0; i < pages.length; i++) {
          if (pages[i].offsetTop + pages[i].offsetHeight + GAP / 2 >= middle) {
            page = i + 1;
            break;
          }
        }
        setCurrent(Math.max(1, page));
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [doc]);

  // A click beside the pages closes the file, like a tap around a photo. Not a drag that ends there (selecting text).
  const pressedOutside = useRef(false);
  const isOutside = (target: EventTarget) => target === scroller.current || target === content.current;

  const count = doc?.sizes.length ?? 0;
  return (
    <div className="relative size-full">
      <div
        ref={scroller}
        tabIndex={-1}
        onMouseDown={(e) => (pressedOutside.current = isOutside(e.target))}
        onClick={(e) => pressedOutside.current && isOutside(e.target) && onBackdrop()}
        className="absolute inset-0 touch-pan-x touch-pan-y overflow-auto overscroll-contain rounded-lg outline-none"
      >
        <div ref={content} className="pdf-pages mx-auto flex w-max min-w-full flex-col items-center" style={{ gap: GAP, padding: `0 ${margin}px 56px` }}>
          {doc &&
            fit > 0 &&
            doc.sizes.map((size, i) => (
              <PdfPage key={i} pdfjs={doc.pdfjs} pdf={doc.pdf} number={i + 1} size={size} scale={fit * zoom} root={scroller} />
            ))}
        </div>
      </div>

      {!doc && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <LoaderCircle size={28} className="animate-spin text-white/70" />
        </div>
      )}

      {doc && (
        <ZoomBar zoom={zoom} min={minZoom} max={MAX_ZOOM} onZoom={(by) => zoomTo(by === "fit" ? 1 : live.current * by)} buttons={!touch}>
          {count > 1 && (
            <span className={touch ? "px-2.5" : "border-l border-white/20 py-0.5 pr-2.5 pl-3"} aria-label={t("Page {i} of {n}", { i: current, n: count })}>
              {current} / {count}
            </span>
          )}
        </ZoomBar>
      )}
    </div>
  );
}

/**
 * One page: a white sheet of the right size at once, the drawing when it comes near the window. The canvas,
 * the selectable text and the links are placed by hand into `holder`, which React leaves empty.
 */
function PdfPage({
  pdfjs,
  pdf,
  number,
  size,
  scale,
  root,
}: {
  pdfjs: Pdfjs;
  pdf: PDFDocumentProxy;
  number: number;
  size: Size;
  scale: number;
  root: RefObject<HTMLDivElement | null>;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    // A screen above and below the window is kept drawn, so scrolling doesn't show blank sheets.
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { root: root.current, rootMargin: "100% 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    const el = holder.current;
    if (!near || !el) return;
    let cancelled = false;
    let task: RenderTask | undefined;
    let text: InstanceType<Pdfjs["TextLayer"]> | undefined;
    (async () => {
      try {
        const page = await pdf.getPage(number);
        if (cancelled) return;
        const viewport = page.getViewport({ scale });
        const ratio = outputRatio(viewport.width, viewport.height);
        // Drawn aside and swapped in when done: on a zoom the old drawing stays, stretched, instead of a white flash.
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
        canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
        canvas.className = "absolute inset-0 block size-full";
        task = page.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
        try {
          await task.promise;
        } catch (err) {
          release(canvas);
          throw err;
        }
        if (cancelled) return release(canvas);
        const old = el.querySelector("canvas");
        el.prepend(canvas);
        if (old) {
          release(old);
          old.remove();
        }

        // The text and the links scale with the page by themselves, so they're made once. A try that a zoom
        // interrupted left them half done: those go and are made again.
        if (el.dataset.layers === "done") return;
        el.querySelectorAll(".textLayer, .pdfLink").forEach((node) => node.remove());
        const layer = document.createElement("div");
        layer.className = "textLayer";
        el.append(layer);
        text = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport });
        await text.render();
        if (cancelled) return;
        for (const a of await page.getAnnotations()) {
          if (cancelled) return;
          if (a.subtype !== "Link" || typeof a.url !== "string" || !/^(https?:|mailto:)/i.test(a.url) || !Array.isArray(a.rect)) continue;
          const [x1, y1] = viewport.convertToViewportPoint(a.rect[0], a.rect[1]) as number[];
          const [x2, y2] = viewport.convertToViewportPoint(a.rect[2], a.rect[3]) as number[];
          const link = document.createElement("a");
          link.href = a.url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.title = a.url;
          link.className = "pdfLink";
          link.style.left = `${(Math.min(x1, x2) / viewport.width) * 100}%`;
          link.style.top = `${(Math.min(y1, y2) / viewport.height) * 100}%`;
          link.style.width = `${(Math.abs(x2 - x1) / viewport.width) * 100}%`;
          link.style.height = `${(Math.abs(y2 - y1) / viewport.height) * 100}%`;
          el.append(link);
        }
        el.dataset.layers = "done";
      } catch (err) {
        if (!cancelled && (err as Error)?.name !== "RenderingCancelledException") console.warn(`Couldn't draw page ${number} of the PDF`, err);
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
      text?.cancel();
    };
  }, [near, scale, pdf, pdfjs, number]);

  // Far from the window a page gives its memory back, and when the file closes.
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const clear = () => {
      el.querySelectorAll("canvas").forEach(release);
      el.replaceChildren();
      delete el.dataset.layers;
    };
    if (!near) clear();
    return clear;
  }, [near]);

  return (
    <div
      data-page={number}
      className="relative shrink-0 bg-white shadow-lg"
      style={{ width: `calc(var(--total-scale-factor) * ${size.w}px)`, height: `calc(var(--total-scale-factor) * ${size.h}px)` }}
    >
      <div ref={holder} className="absolute inset-0 overflow-hidden" />
    </div>
  );
}
