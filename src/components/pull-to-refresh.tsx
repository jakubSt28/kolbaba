"use client";

import { animate, motion, useMotionValue, useMotionValueEvent, useTransform, type MotionValue } from "motion/react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { haptic } from "@/lib/haptics";
import { useMail } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Kolbaba } from "./kolbaba";

const TRIGGER = 70;
const HOLD = 52;
const MAX = 120;
/** Even an instant refresh spins this long, so the gesture visibly did something. */
const MIN_SPIN_MS = 650;

/**
 * Pull down at the top of a list to refresh, on touch screens. An installed PWA on iPhone has no
 * browser pull-to-refresh, so the list does it itself: the content follows the finger with some
 * resistance, a ring fills up, and past the threshold it spins while the mailbox syncs.
 */
export function usePullToRefresh(scroller: RefObject<HTMLElement | null>, enabled = true) {
  const pull = useMotionValue(0);
  const [refreshing, setRefreshing] = useState(false);
  const state = useRef<{ startY: number; active: boolean; refreshing: boolean; armed: boolean }>({ startY: 0, active: false, refreshing: false, armed: false });

  useEffect(() => {
    const el = scroller.current;
    if (!el || !enabled) return;
    const st = state.current;

    const onStart = (e: TouchEvent) => {
      if (st.refreshing || e.touches.length !== 1 || el.scrollTop > 0) return;
      st.startY = e.touches[0].clientY;
      st.active = true;
      st.armed = false;
    };
    const onMove = (e: TouchEvent) => {
      if (!st.active) return;
      const dy = e.touches[0].clientY - st.startY;
      if (dy <= 0 || el.scrollTop > 0) {
        if (pull.get() !== 0) pull.set(0);
        // Scrolling up into the list is a normal scroll, not a pull.
        if (dy < 0) st.active = false;
        return;
      }
      // We move the content ourselves, so Safari's rubber band must not as well.
      if (e.cancelable) e.preventDefault();
      pull.set(Math.min(MAX, dy * 0.5));
      // Far enough to refresh: the finger feels it, once per pull.
      const armed = pull.get() >= TRIGGER;
      if (armed !== st.armed) {
        st.armed = armed;
        if (armed) haptic("tick");
      }
    };
    const onEnd = () => {
      if (!st.active) return;
      st.active = false;
      if (pull.get() < TRIGGER) {
        void animate(pull, 0, { type: "spring", stiffness: 420, damping: 36 });
        return;
      }
      st.refreshing = true;
      setRefreshing(true);
      void animate(pull, HOLD, { type: "spring", stiffness: 420, damping: 36 });
      const started = Date.now();
      const { refresh, refreshAccounts } = useMail.getState();
      void Promise.all([refresh(), refreshAccounts()])
        .catch(() => {})
        .then(() => new Promise((r) => setTimeout(r, Math.max(0, MIN_SPIN_MS - (Date.now() - started)))))
        .then(() => {
          st.refreshing = false;
          setRefreshing(false);
          void animate(pull, 0, { type: "spring", stiffness: 380, damping: 34 });
        });
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [scroller, enabled, pull]);

  return { pull, refreshing };
}

/**
 * Above the list: Kolbaba in a ring that fills and turns while pulling. Far enough, he twitches his
 * mustache; while the mailbox syncs the ring spins and he keeps at it.
 */
export function PullIndicator({ pull, refreshing, className }: { pull: MotionValue<number>; refreshing: boolean; className?: string }) {
  const opacity = useTransform(pull, [8, 40], [0, 1]);
  const dash = useTransform(pull, (v) => `${Math.min(1, v / TRIGGER) * 132} 200`);
  const turn = useTransform(pull, (v) => v * 2.4);
  const [armed, setArmed] = useState(false);
  useMotionValueEvent(pull, "change", (v) => setArmed(v >= TRIGGER));
  return (
    <motion.div style={{ opacity, height: pull }} className={cn("pointer-events-none flex items-end justify-center overflow-hidden", className)} aria-hidden>
      <div className="glass relative mb-2 flex size-9 items-center justify-center rounded-full">
        <motion.svg viewBox="0 0 36 36" style={{ rotate: refreshing ? undefined : turn }} className={cn("absolute inset-0 size-9 text-ink-2", refreshing && "animate-spin")}>
          <motion.circle
            cx="18"
            cy="18"
            r="16.2"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            pathLength={140}
            style={{ strokeDasharray: refreshing ? "90 200" : dash }}
          />
        </motion.svg>
        <Kolbaba size={22} mood={refreshing ? "busy" : armed ? "twitch" : "idle"} />
      </div>
    </motion.div>
  );
}
