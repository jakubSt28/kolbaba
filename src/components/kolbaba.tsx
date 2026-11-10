"use client";

import { motion, useAnimationControls } from "motion/react";
import { useCallback, useEffect } from "react";
import { haptic } from "@/lib/haptics";
import { ICON_COLORS, MARK_FIT, MUSTACHE } from "@/lib/kolbaba-icon";

/**
 * What Kolbaba is up to: tips his cap (an empty Inbox), sleeps with the cap over his nose (late at
 * night), twitches his mustache (a pull that's far enough) or keeps twitching it (busy fetching).
 */
export type KolbabaMood = "idle" | "tip" | "sleep" | "twitch" | "busy";

/**
 * The app's mark come to life. He only shows up where the app has nothing else to show (an empty
 * Inbox, the desktop's empty reader, pull to refresh) and never says a word out loud. `interactive`:
 * the pointer over him twitches his mustache, a click or tap makes him tip his cap, and now and then
 * he twitches on his own.
 */
export function Kolbaba({
  size = 44,
  mood = "idle",
  snow = false,
  interactive = false,
  className,
}: {
  size?: number;
  mood?: KolbabaMood;
  snow?: boolean;
  interactive?: boolean;
  className?: string;
}) {
  const { tile, mark } = ICON_COLORS;
  const small = size <= 32;
  const cap = useAnimationControls();
  const stache = useAnimationControls();

  const tip = useCallback(
    (delay = 0) => {
      void cap.start({ y: [0, -11, -11, 0], rotate: [0, -20, -20, 0], transition: { duration: 1.3, delay, times: [0, 0.28, 0.66, 1], ease: "easeInOut" } });
      void stache.start({ rotate: [0, -9, 8, -5, 0], transition: { duration: 0.7, delay: delay + 1.05 } });
    },
    [cap, stache],
  );
  const twitch = useCallback(
    () => void stache.start({ rotate: [0, -10, 9, -6, 4, 0], scaleX: [1, 1.14, 0.94, 1.06, 1, 1], transition: { duration: 0.6 } }),
    [stache],
  );

  useEffect(() => {
    if (mood === "sleep") {
      void cap.start({ y: 10, rotate: 0, transition: { type: "spring", stiffness: 160, damping: 18 } });
      void stache.start({ scaleY: [1, 0.86, 1], y: [0, 1, 0], transition: { duration: 3.2, repeat: Infinity, ease: "easeInOut" } });
      return;
    }
    void cap.start({ y: 0, rotate: 0, transition: { type: "spring", stiffness: 200, damping: 18 } });
    if (mood === "tip") tip(0.4);
    if (mood === "twitch") twitch();
    if (mood === "busy") void stache.start({ rotate: [0, -10, 9, -6, 0], scaleX: [1, 1.12, 0.95, 1.04, 1], transition: { duration: 0.55, repeat: Infinity, repeatDelay: 0.3 } });
    else if (mood !== "twitch") void stache.start({ rotate: 0, scaleX: 1, scaleY: 1, y: 0 });
  }, [mood, cap, stache, tip, twitch]);

  // Now and then, while he's on screen and awake, he twitches his mustache on his own.
  useEffect(() => {
    if (!interactive || mood === "sleep" || mood === "busy") return;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      timer = setTimeout(() => {
        if (document.visibilityState === "visible") twitch();
        next();
      }, 7000 + Math.random() * 6000);
    };
    next();
    return () => clearTimeout(timer);
  }, [interactive, mood, twitch]);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      aria-hidden
      className={className}
      overflow="visible"
      onPointerEnter={interactive && mood !== "sleep" ? twitch : undefined}
      onClick={
        interactive
          ? () => {
              haptic("tick");
              tip();
            }
          : undefined
      }
      style={interactive ? { cursor: "pointer" } : undefined}
    >
      <rect x={1.5} y={1.5} width={117} height={117} rx={27} fill={tile} stroke="rgba(255,255,255,0.12)" strokeWidth={3} />
      {snow && <Snow />}
      <g transform={small ? MARK_FIT.compact : MARK_FIT.regular}>
        <circle cx={60} cy={69} r={9} fill={mark} />
        <motion.g style={{ originX: 0.5, originY: 0.5 }} animate={stache}>
          <path d={MUSTACHE} transform="translate(60 89) scale(1.5) translate(-60 -84)" fill={mark} />
        </motion.g>
        {/* Hinged at the left end of the brim, like a hand lifting it by the peak. */}
        <motion.g style={{ originX: 0.08, originY: 1 }} animate={cap}>
          <path d="M26 48 L32 14 Q60 4 88 14 L94 48 Z" fill={mark} />
          <rect x={18} y={44} width={84} height={11} rx={5.5} fill={mark} />
          <rect x={51} y={22} width={18} height={12} rx={2.2} fill={tile} />
          {!small && <path d="M52 23.4 L60 29.2 L68 23.4" stroke={mark} strokeWidth={1.7} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
        </motion.g>
      </g>
      {mood === "sleep" && <Zzz />}
    </svg>
  );
}

/** Three small z's drifting up from the top corner. */
function Zzz() {
  return (
    <g fill="#ffffff" fontFamily="var(--font-sans)" fontWeight={700}>
      {[0, 1, 2].map((i) => (
        <motion.text
          key={i}
          x={92 + i * 5}
          y={34 - i * 2}
          fontSize={11 + i * 3}
          initial={{ opacity: 0, y: 0 }}
          animate={{ opacity: [0, 0.9, 0], y: [4, -10] }}
          transition={{ duration: 2.6, delay: i * 0.85, repeat: Infinity, repeatDelay: 0.2, ease: "easeOut" }}
        >
          z
        </motion.text>
      ))}
    </g>
  );
}

/** December: a little snow falling behind him. */
function Snow() {
  const flakes = [
    [18, 0.2, 2.2],
    [34, 1.1, 1.6],
    [52, 0.6, 2],
    [74, 1.6, 1.5],
    [90, 0.3, 2.3],
    [104, 1.3, 1.7],
  ];
  return (
    <g fill="#ffffff">
      {flakes.map(([x, delay, r], i) => (
        <motion.circle
          key={i}
          cx={x}
          r={r}
          initial={{ cy: 6, opacity: 0 }}
          animate={{ cy: [6, 112], opacity: [0, 0.7, 0.7, 0] }}
          transition={{ duration: 5.5, delay, repeat: Infinity, ease: "linear" }}
        />
      ))}
    </g>
  );
}
