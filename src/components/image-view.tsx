"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ZoomBar } from "./viewer-zoom";

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

type Gesture =
  | { kind: "pan"; id: number; startX: number; startY: number; x: number; y: number }
  | { kind: "pinch"; distance: number; zoom: number }
  /** One finger on a picture that isn't zoomed: sideways goes to the next file, down closes it. */
  | { kind: "swipe"; id: number; startX: number; startY: number; at: number; axis: "x" | "y" | null };

/**
 * A picture you can look at properly: pinch, the wheel or a double tap zooms where you point, a drag moves a
 * zoomed picture. On a phone a swipe sideways goes to the next file and a swipe down closes the viewer.
 */
export function ImageView({
  url,
  name,
  onFail,
  onClose,
  onStep,
}: {
  url: string;
  name: string;
  onFail: () => void;
  onClose: () => void;
  /** Goes to the previous (-1) or next (1) file; `false` when there is none. */
  onStep: (by: -1 | 1) => boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  // Where the picture is: zoom 1 fits the window, x and y move its centre off the window's.
  const view = useRef({ zoom: 1, x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [maxZoom, setMaxZoom] = useState(5);
  const [shown, setShown] = useState(false);
  const [touch] = useState(() => matchMedia("(pointer: coarse)").matches);
  // The newest callbacks, without restarting a gesture in progress each time the viewer draws again.
  const actions = useRef({ onClose, onStep });
  useEffect(() => {
    actions.current = { onClose, onStep };
  });

  const draw = useCallback((animate = false) => {
    const el = img.current;
    if (!el) return;
    const { zoom, x, y } = view.current;
    el.style.transition = animate ? "transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)" : "none";
    el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${zoom})`;
    setZoom(zoom);
  }, []);

  /** A zoomed picture can't be dragged off: its edge stops at the window's edge. */
  const hold = useCallback(() => {
    const el = img.current;
    const frame = box.current;
    if (!el || !frame) return;
    const v = view.current;
    const overX = Math.max(0, (el.offsetWidth * v.zoom - frame.clientWidth) / 2);
    const overY = Math.max(0, (el.offsetHeight * v.zoom - frame.clientHeight) / 2);
    v.x = clamp(v.x, -overX, overX);
    v.y = clamp(v.y, -overY, overY);
  }, []);

  /** Zooms to `next`, keeping the point of the picture under (clientX, clientY) where it is. */
  const zoomTo = useCallback(
    (next: number, clientX?: number, clientY?: number, animate = false) => {
      const frame = box.current;
      if (!frame) return;
      const v = view.current;
      next = clamp(next, 1, maxZoom);
      const rect = frame.getBoundingClientRect();
      const px = clientX === undefined ? 0 : clientX - (rect.left + rect.width / 2);
      const py = clientY === undefined ? 0 : clientY - (rect.top + rect.height / 2);
      v.x = px - (next / v.zoom) * (px - v.x);
      v.y = py - (next / v.zoom) * (py - v.y);
      v.zoom = next;
      if (next === 1) v.x = v.y = 0;
      hold();
      draw(animate);
    },
    [draw, hold, maxZoom],
  );

  // Pointer events for mouse, pen and fingers alike; the wheel and Safari's trackpad pinch beside them.
  useEffect(() => {
    const frame = box.current;
    const el = img.current;
    if (!frame || !el) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let gesture: Gesture | null = null;
    let down: { x: number; y: number; at: number; onPicture: boolean } | null = null;
    let lastTap: { x: number; y: number; at: number } | null = null;
    let trackpad = 1;
    const two = () => [...pointers.values()];
    const spread = () => Math.hypot(two()[0].x - two()[1].x, two()[0].y - two()[1].y);

    /** The picture follows the finger during a swipe, and the dark behind it fades as it's pulled down. */
    const follow = (dx: number, dy: number, animate = false) => {
      el.style.transition = animate ? "transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 200ms" : "none";
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(${1 - Math.min(dy, 300) / 1500})`;
      el.style.opacity = String(1 - Math.min(dy, 300) / 500);
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // The picture keeps getting the moves when the pointer leaves it.
      frame.setPointerCapture(e.pointerId);
      const v = view.current;
      if (pointers.size === 2) {
        gesture = { kind: "pinch", distance: spread() || 1, zoom: v.zoom };
        down = null;
        return;
      }
      down = { x: e.clientX, y: e.clientY, at: Date.now(), onPicture: e.target === el };
      if (v.zoom > 1.01) gesture = { kind: "pan", id: e.pointerId, startX: e.clientX, startY: e.clientY, x: v.x, y: v.y };
      else if (e.pointerType !== "mouse") gesture = { kind: "swipe", id: e.pointerId, startX: e.clientX, startY: e.clientY, at: Date.now(), axis: null };
    };

    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const v = view.current;
      if (gesture?.kind === "pinch" && pointers.size === 2) {
        const [a, b] = two();
        zoomTo((gesture.zoom * spread()) / gesture.distance, (a.x + b.x) / 2, (a.y + b.y) / 2);
      } else if (gesture?.kind === "pan" && gesture.id === e.pointerId) {
        v.x = gesture.x + e.clientX - gesture.startX;
        v.y = gesture.y + e.clientY - gesture.startY;
        hold();
        draw();
      } else if (gesture?.kind === "swipe" && gesture.id === e.pointerId) {
        const dx = e.clientX - gesture.startX;
        const dy = e.clientY - gesture.startY;
        if (!gesture.axis && Math.hypot(dx, dy) > 8) gesture.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        if (gesture.axis === "x") follow(dx, 0);
        else if (gesture.axis === "y") follow(0, Math.max(0, dy));
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return;
      const v = view.current;
      const ended = gesture;
      gesture = null;
      if (ended?.kind === "pinch") {
        // A pinch back under the fitted size settles at it. The finger that stays goes on moving the picture.
        if (v.zoom < 1.02) zoomTo(1, undefined, undefined, true);
        const [id, rest] = [...pointers.entries()][0] ?? [];
        if (id !== undefined && v.zoom > 1.01) gesture = { kind: "pan", id, startX: rest.x, startY: rest.y, x: v.x, y: v.y };
        return;
      }
      if (ended?.kind === "swipe" && ended.axis) {
        const dx = e.clientX - ended.startX;
        const dy = e.clientY - ended.startY;
        const fast = Date.now() - ended.at < 250;
        if (ended.axis === "x" && (Math.abs(dx) > 80 || (fast && Math.abs(dx) > 30)) && actions.current.onStep(dx < 0 ? 1 : -1)) return;
        if (ended.axis === "y" && (dy > 110 || (fast && dy > 40))) return actions.current.onClose();
        follow(0, 0, true);
        return;
      }
      // A tap: twice zooms in on the spot and back, once beside the picture closes it.
      if (!down || Date.now() - down.at > 300 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return;
      const tap = { x: e.clientX, y: e.clientY, at: Date.now() };
      if (!down.onPicture) return actions.current.onClose();
      if (lastTap && tap.at - lastTap.at < 320 && Math.hypot(tap.x - lastTap.x, tap.y - lastTap.y) < 30) {
        lastTap = null;
        zoomTo(v.zoom > 1.05 ? 1 : Math.min(2.5, maxZoom), tap.x, tap.y, true);
      } else {
        lastTap = tap;
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // A trackpad pinch arrives as Ctrl + wheel in small steps; a mouse wheel in big ones.
      const step = clamp(e.deltaY, -40, 40) * (e.ctrlKey ? 0.012 : 0.006);
      zoomTo(view.current.zoom * Math.exp(-step), e.clientX, e.clientY);
    };
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      trackpad = view.current.zoom;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      if (pointers.size) return;
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      zoomTo(trackpad * g.scale, g.clientX, g.clientY);
    };

    frame.addEventListener("pointerdown", onDown);
    frame.addEventListener("pointermove", onMove);
    frame.addEventListener("pointerup", onUp);
    frame.addEventListener("pointercancel", onUp);
    frame.addEventListener("wheel", onWheel, { passive: false });
    frame.addEventListener("gesturestart", onGestureStart);
    frame.addEventListener("gesturechange", onGestureChange);
    return () => {
      frame.removeEventListener("pointerdown", onDown);
      frame.removeEventListener("pointermove", onMove);
      frame.removeEventListener("pointerup", onUp);
      frame.removeEventListener("pointercancel", onUp);
      frame.removeEventListener("wheel", onWheel);
      frame.removeEventListener("gesturestart", onGestureStart);
      frame.removeEventListener("gesturechange", onGestureChange);
    };
  }, [draw, hold, zoomTo, maxZoom]);

  // + and − zoom, 0 fits the picture again. With Cmd or Ctrl they stay the browser's own.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "+" || e.key === "=") zoomTo(view.current.zoom * 1.25, undefined, undefined, true);
      else if (e.key === "-") zoomTo(view.current.zoom / 1.25, undefined, undefined, true);
      else if (e.key === "0") zoomTo(1, undefined, undefined, true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [zoomTo]);

  // A turned phone or a resized window: the picture stays inside.
  useEffect(() => {
    const frame = box.current;
    if (!frame) return;
    const observer = new ResizeObserver(() => {
      hold();
      draw();
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [draw, hold]);

  return (
    <div className="relative size-full">
      <div
        ref={box}
        className={cn("absolute inset-0 flex touch-none items-center justify-center overflow-hidden select-none", zoom > 1.01 && "cursor-grab active:cursor-grabbing")}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={img}
          src={url}
          alt={name}
          draggable={false}
          onError={onFail}
          onLoad={(e) => {
            const el = e.currentTarget;
            // Up to twice the picture's own pixels, and always at least 4×: a small picture can still be looked into.
            if (el.offsetWidth) setMaxZoom(Math.max(4, (el.naturalWidth / el.offsetWidth) * 2));
            setShown(true);
          }}
          className={cn("max-h-full max-w-full rounded-md bg-white object-contain shadow-2xl", shown ? "opacity-100" : "opacity-0")}
        />
      </div>
      <ZoomBar zoom={zoom} min={1} max={maxZoom} onZoom={(by) => zoomTo(by === "fit" ? 1 : view.current.zoom * by, undefined, undefined, true)} buttons={!touch && shown} />
    </div>
  );
}
