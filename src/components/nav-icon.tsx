"use client";

import { Globe, Plane, type LucideIcon } from "lucide-react";
import { motion, useAnimationControls, type TargetAndTransition } from "motion/react";
import { createContext, useContext, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { hueStyle } from "./ui";

/**
 * Sidebar icons that do something when clicked: the inbox takes a letter in, the paper plane flies
 * off and comes back, the alarm clock rings, the plane circles the globe. A row bumps PlayContext on
 * each click; the icon inside plays its gesture.
 */
export const PlayContext = createContext(0);

export type IconGesture =
  | "drop"
  | "pin"
  | "ring"
  | "flip"
  | "write"
  | "fly"
  | "swallow"
  | "shake"
  | "tip"
  | "hop"
  | "spin"
  | "pulse"
  | "talk"
  | "wave"
  | "wiggle"
  | "rewind"
  | "twinkle"
  | "glow"
  | "tune";

const GESTURES: Record<IconGesture, TargetAndTransition> = {
  drop: { y: [0, -5, 2, 0], scaleY: [1, 1.08, 0.84, 1], transition: { duration: 0.6 } },
  pin: { y: [0, -7, 0, -2, 0], rotate: [0, -32, 0, -8, 0], transition: { duration: 0.75 } },
  ring: { rotate: [0, -20, 18, -16, 14, -10, 6, 0], transition: { duration: 0.85 } },
  flip: { rotateY: [0, 180, 360], transition: { duration: 0.75, ease: "easeInOut" } },
  write: { x: [0, 1.5, -1.5, 1.5, -1, 0], rotate: [0, -10, 8, -8, 4, 0], transition: { duration: 0.75 } },
  fly: {
    x: [0, 24, 24, -24, -24, 0],
    y: [0, -24, -24, 24, 24, 0],
    opacity: [1, 0, 0, 0, 0, 1],
    transition: { duration: 1, times: [0, 0.36, 0.38, 0.42, 0.5, 1], ease: "easeInOut" },
  },
  swallow: { y: [0, 2, -1.5, 0], scaleY: [1, 0.78, 1.1, 1], scaleX: [1, 1.14, 0.95, 1], transition: { duration: 0.6 } },
  shake: { x: [0, -3, 3, -2.5, 2.5, -1.5, 0], transition: { duration: 0.6 } },
  tip: { rotate: [0, -22, 12, 0], transition: { duration: 0.65 } },
  hop: { y: [0, -9, 0, -3, 0], scaleY: [1, 1.1, 0.86, 1.04, 1], transition: { duration: 0.75 } },
  spin: { rotate: [0, 360], transition: { duration: 0.8, ease: [0.3, 0, 0.2, 1] } },
  pulse: { scale: [1, 1.4, 0.92, 1.08, 1], transition: { duration: 0.7 } },
  talk: { rotate: [0, -14, 10, -6, 0], scale: [1, 1.18, 1, 1.08, 1], transition: { duration: 0.75 } },
  wave: { rotate: [0, 18, -12, 14, -6, 0], transition: { duration: 0.8 } },
  wiggle: { rotate: [0, 30, -22, 14, -6, 0], transition: { duration: 0.8 } },
  rewind: { rotate: [0, -360], transition: { duration: 0.8, ease: [0.3, 0, 0.2, 1] } },
  twinkle: { rotate: [0, 24, -12, 0], scale: [1, 1.4, 0.9, 1], transition: { duration: 0.75 } },
  glow: {
    scale: [1, 1.35, 1],
    filter: ["drop-shadow(0 0 0px rgb(250 196 60 / 0))", "drop-shadow(0 0 6px rgb(250 196 60 / 0.95))", "drop-shadow(0 0 0px rgb(250 196 60 / 0))"],
    transition: { duration: 1 },
  },
  tune: { x: [0, -2.5, 2.5, -1.5, 0], rotate: [0, 0, 0, 0, 0], transition: { duration: 0.6 } },
};

/** Gestures that turn around the icon's foot rather than its middle. */
const FOOT: Partial<Record<IconGesture, true>> = { tip: true, pin: true, wave: true };

/** Plays when the row's PlayContext changes, never on the first render. */
function usePlay(run: () => void) {
  const play = useContext(PlayContext);
  const seen = useRef(play);
  useEffect(() => {
    if (play === seen.current) return;
    seen.current = play;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play]);
}

export function NavIcon({ icon: Icon, gesture, size = 15, className }: { icon: LucideIcon; gesture: IconGesture; size?: number; className?: string }) {
  const controls = useAnimationControls();
  usePlay(() => void controls.start(GESTURES[gesture]));
  return (
    <span className={cn("inline-flex size-[22px] items-center justify-center", className)}>
      <motion.span animate={controls} className="inline-flex" style={{ originX: 0.5, originY: FOOT[gesture] ? 0.9 : 0.5 }}>
        <Icon size={size} strokeWidth={1.9} />
      </motion.span>
    </span>
  );
}

/** Travel: the plane takes off and circles the globe once, then lands back in its place. */
export function TravelIcon({ size = 15 }: { size?: number }) {
  const plane = useAnimationControls();
  const globe = useAnimationControls();
  usePlay(() => {
    const r = 10;
    const steps = [0, 45, 90, 135, 180, 225, 270, 315, 360];
    void globe.start({ opacity: [0, 1, 1, 0], scale: [0.4, 1, 1, 0.4], transition: { duration: 1.4, times: [0, 0.15, 0.85, 1] } });
    void plane.start({
      x: [0, ...steps.map((a) => Math.sin((a * Math.PI) / 180) * r), 0],
      y: [0, ...steps.map((a) => -Math.cos((a * Math.PI) / 180) * r), 0],
      // Lucide's plane points up and to the right; turn it along its path round the globe.
      rotate: [0, ...steps.map((a) => a + 45), 405],
      scale: [1, ...steps.map(() => 0.62), 1],
      transition: { duration: 1.4, ease: "linear" },
    });
  });
  return (
    <span className="relative inline-flex size-[22px] items-center justify-center">
      <motion.span className="absolute inline-flex" initial={{ opacity: 0 }} animate={globe}>
        <Globe size={size - 3} strokeWidth={1.9} />
      </motion.span>
      <motion.span className="inline-flex" animate={plane}>
        <Plane size={size} strokeWidth={1.9} />
      </motion.span>
    </span>
  );
}

/**
 * An own folder: open while you're in it, with papers in it when it holds mail. The front flap
 * falls open and the papers rise; empty, you see right to the back.
 */
export function FolderGlyph({ hue, open, full, size = 15 }: { hue: number; open: boolean; full: boolean; size?: number }) {
  const bounce = useAnimationControls();
  usePlay(() => void bounce.start({ y: [0, -4, 0, -1, 0], transition: { duration: 0.6 } }));
  const spring = { type: "spring", stiffness: 320, damping: 22 } as const;
  return (
    <span className="inline-flex size-[22px] items-center justify-center">
      <motion.svg
        width={size + 2}
        height={size + 2}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinejoin="round"
        className="hue-text shrink-0"
        style={hueStyle(hue)}
        animate={bounce}
        overflow="visible"
      >
        <path d="M3 18V6a2 2 0 0 1 2-2h3.5a1 1 0 0 1 .8.4L11 6.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="currentColor" fillOpacity={0.14} />
        <motion.g initial={false} animate={{ y: full ? (open ? -3 : 0) : 6, opacity: full ? 1 : 0 }} transition={spring}>
          <rect x={7.5} y={7.4} width={10.5} height={8} rx={1} fill="var(--solid)" strokeWidth={1.3} transform="rotate(-7 12.7 11.4)" />
          <rect x={6} y={8.2} width={11} height={8} rx={1} fill="var(--solid)" strokeWidth={1.3} />
        </motion.g>
        {/* The front flap: solid, so papers only show above it until it falls open. */}
        <motion.g style={{ originX: 0.5, originY: 1 }} initial={false} animate={{ scaleY: open ? 0.58 : 1, skewX: open ? -16 : 0 }} transition={spring}>
          <path d="M3 10.5h18V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="var(--solid)" stroke="none" />
          <path d="M3 10.5h18V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="currentColor" fillOpacity={0.3} />
        </motion.g>
      </motion.svg>
    </span>
  );
}
