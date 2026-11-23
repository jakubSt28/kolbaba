"use client";

import { animate, useMotionValue, type MotionValue } from "motion/react";
import { useEffect, useRef, useState } from "react";

/**
 * Swipes on a phone, the way iPhone apps have them: a screen that came in from the right goes back
 * with a swipe to the right from anywhere on it, a sheet from the bottom goes away with a swipe down,
 * the drawer with a swipe to the left, and a swipe in from the left edge opens the drawer.
 *
 * Touch events, not pointer events: once iOS starts scrolling it cancels the pointer, while a touch
 * keeps coming, and preventDefault on the first sideways move keeps the page from scrolling under it.
 * The finger is followed through a motion value: give it to the element's style (x or y), and its
 * own exit animation carries on from where the finger let go.
 */

/** Which way the finger moves to close (or open) the thing. */
export type SwipeWay = "right" | "left" | "down";

/** Where a swipe in from the edge of the screen starts, at most. */
export const EDGE = 24;

/** A finger moves this far before the swipe decides whether it's for us or a scroll. */
const SLOP = 10;

/** Not ours: a slider, or anything that asks for its own swipes. */
const OWN_SWIPES = '[data-no-swipe], input[type="range"], [role="slider"]';

export interface SwipeDecision {
  dx: number;
  dy: number;
  way: SwipeWay;
}

/**
 * Whether a move that has gone past the slop is a swipe the given way: mostly along it, not across,
 * and in the right direction. Pure, for the tests.
 */
export function isSwipe({ dx, dy, way }: SwipeDecision) {
  const along = way === "down" ? dy : way === "right" ? dx : -dx;
  const across = way === "down" ? Math.abs(dx) : Math.abs(dy);
  return along > 0 && along > across * 1.2;
}

/** Whether a swipe let go here closes the thing: far enough, or a flick. Pure, for the tests. */
export function swipeGoes({ offset, velocity, size }: { offset: number; velocity: number; size: number }) {
  return offset > Math.min(size * 0.3, 140) || (velocity > 0.45 && offset > 24);
}

/**
 * Something between the finger and the swiped element can still scroll the way the finger moves:
 * then the finger scrolls it (a list scrolled down scrolls back up before its sheet comes down).
 */
function scrollsFirst(from: Element, root: Element, way: SwipeWay) {
  // Not instanceof: in an email's frame the elements come from another window.
  for (let el: Element | null = from; el; el = el.parentElement) {
    const style = el.ownerDocument.defaultView?.getComputedStyle(el);
    if (style) {
      if (way === "down") {
        if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1 && el.scrollTop > 0) return true;
      } else if (/(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1) {
        if (way === "right" ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1) return true;
      }
    }
    if (el === root) break;
  }
  return false;
}

export interface SwipeOptions {
  way: SwipeWay;
  /** The swipe went far or fast enough. */
  onSwipe: () => void;
  enabled?: boolean;
  /** Only touches that start this close to the left edge of the screen: a swipe in from the edge. */
  edge?: number;
  /** Only touches that start inside this (a sheet's header, where a swipe down can't be meant for the text). */
  handle?: string;
  /**
   * The element has no exit animation of its own (a Radix dialog): the hook moves it itself, and
   * slides it the rest of the way out before calling onSwipe.
   */
  slideOut?: boolean;
  /** The element stays put and only onSwipe is called: a swipe that opens something. */
  follow?: boolean;
}

type Attach = (target: EventTarget) => () => void;
/** The swipes on each element, for forwardSwipes. */
const swipesOn = new WeakMap<Element, Attach>();

/**
 * Lets a swipe go on over an iframe inside the swiped element (an email's HTML body): its document
 * gets its own touches, which never reach the page. The frame must be same-origin.
 */
export function forwardSwipes(frame: HTMLIFrameElement) {
  const doc = frame.contentDocument;
  if (!doc) return () => {};
  const detach: (() => void)[] = [];
  for (let el: Element | null = frame.parentElement; el; el = el.parentElement) {
    const attach = swipesOn.get(el);
    if (attach) detach.push(attach(doc));
  }
  return () => detach.forEach((fn) => fn());
}

/**
 * Follows a finger swiping an element the given way and calls onSwipe when it goes far enough.
 * Returns the ref to put on the element, and the offset to put in its style (x for right and left,
 * y for down); it springs back when the swipe falls short. A callback ref: a Radix dialog's content
 * comes a render after it opens.
 */
export function useSwipe(options: SwipeOptions): [ref: (el: HTMLElement | null) => void, offset: MotionValue<number>] {
  const offset = useMotionValue(0);
  const [el, setEl] = useState<HTMLElement | null>(null);
  const opts = useRef(options);
  useEffect(() => {
    opts.current = options;
  });
  const enabled = options.enabled ?? true;

  useEffect(() => {
    if (!el || !enabled) return;
    const axis = opts.current.way === "down" ? "y" : "x";
    // Moved by the hook itself, for elements that motion doesn't move.
    const unsubscribe = opts.current.slideOut
      ? offset.on("change", (v) => (el.style.transform = v ? `translate${axis.toUpperCase()}(${v}px)` : ""))
      : undefined;

    let touch: { x: number; y: number; target: Element; decided: boolean | null; samples: { t: number; v: number }[]; along: number } | null = null;
    let leaving = false;

    const start = (e: TouchEvent) => {
      const { edge, handle } = opts.current;
      const f = e.touches.length === 1 ? e.touches[0] : null;
      const target = (e.target as Node | null)?.nodeType === Node.ELEMENT_NODE ? (e.target as Element) : null;
      touch = null;
      if (!f || !target || leaving) return;
      if (target.closest(OWN_SWIPES)) return;
      if (handle && !target.closest(handle)) return;
      if (edge !== undefined && f.clientX > edge) return;
      touch = { x: f.clientX, y: f.clientY, target, decided: null, samples: [], along: 0 };
    };

    const move = (e: TouchEvent) => {
      const f = e.touches[0];
      if (!touch || touch.decided === false || !f) return;
      const { way, follow = true } = opts.current;
      const dx = f.clientX - touch.x;
      const dy = f.clientY - touch.y;
      if (touch.decided === null) {
        if (Math.hypot(dx, dy) < SLOP) return;
        const text = window.getSelection?.()?.toString();
        touch.decided = isSwipe({ dx, dy, way }) && !scrollsFirst(touch.target, el, way) && !text;
        if (!touch.decided) return;
        offset.stop();
      }
      if (e.cancelable) e.preventDefault();
      const along = Math.max(0, (way === "down" ? dy : way === "right" ? dx : -dx) - SLOP);
      touch.along = along;
      touch.samples.push({ t: e.timeStamp, v: along });
      if (touch.samples.length > 6) touch.samples.shift();
      if (follow) offset.set(way === "left" ? -along : along);
    };

    const end = () => {
      const was = touch;
      touch = null;
      if (!was?.decided) return;
      const { way, onSwipe, slideOut, follow = true } = opts.current;
      const first = was.samples[0];
      const last = was.samples[was.samples.length - 1];
      const velocity = first && last && last.t > first.t ? (last.v - first.v) / (last.t - first.t) : 0;
      const size = way === "down" ? el.offsetHeight : el.offsetWidth;
      if (!swipeGoes({ offset: was.along, velocity, size: follow ? size : 160 })) {
        void animate(offset, 0, { type: "spring", stiffness: 520, damping: 42 });
        return;
      }
      if (!slideOut || !follow) return onSwipe();
      leaving = true;
      const out = way === "left" ? -size : size;
      const speed = Math.max(velocity * 1000, 1600);
      void animate(offset, out, { duration: Math.min(0.25, Math.abs(out - offset.get()) / speed), ease: [0.25, 0.6, 0.4, 1] }).then(() => {
        leaving = false;
        onSwipe();
        // Back in place for the next time it opens, when the element itself stays mounted.
        offset.jump(0);
      });
    };

    const attach: Attach = (target) => {
      target.addEventListener("touchstart", start as EventListener, { passive: true });
      target.addEventListener("touchmove", move as EventListener, { passive: false });
      target.addEventListener("touchend", end, { passive: true });
      target.addEventListener("touchcancel", end, { passive: true });
      return () => {
        target.removeEventListener("touchstart", start as EventListener);
        target.removeEventListener("touchmove", move as EventListener);
        target.removeEventListener("touchend", end);
        target.removeEventListener("touchcancel", end);
      };
    };
    const detach = attach(el);
    swipesOn.set(el, attach);

    // A swipe in from the edge is ours: a row under the finger (a conversation) doesn't start its own
    // swipe or long press. Taps still go through: a click comes from the touch, not this pointerdown.
    const claimEdge = (e: PointerEvent) => {
      const { edge } = opts.current;
      if (edge !== undefined && e.pointerType === "touch" && e.clientX <= edge) e.stopPropagation();
    };
    if (opts.current.edge !== undefined) el.addEventListener("pointerdown", claimEdge, true);

    return () => {
      detach();
      swipesOn.delete(el);
      el.removeEventListener("pointerdown", claimEdge, true);
      unsubscribe?.();
    };
  }, [el, enabled, offset]);

  return [setEl, offset];
}
