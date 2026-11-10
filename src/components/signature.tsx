"use client";

import { motion, type Transition } from "motion/react";
import type { Signature } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * Every action has its own small gesture: a postmark thumps onto a sent letter, a letter drops into
 * the archive box, scissors snip a newsletter. It plays in the toast that confirms it, while the row
 * itself leaves the way it went (components/message-list.tsx). Each plays once, slow enough to be
 * seen, and never holds anything up.
 */
export function SignatureIcon({ sig, className }: { sig: Signature; className?: string }) {
  const Icon = ICONS[sig];
  return (
    <span className={cn("flex shrink-0 items-center justify-center", TONE[sig], className)} aria-hidden>
      <Icon />
    </span>
  );
}

const TONE: Record<Signature, string> = {
  send: "text-accent-text",
  schedule: "text-accent-text",
  archive: "text-success",
  trash: "text-danger",
  spam: "text-danger",
  inbox: "text-accent-text",
  snooze: "text-warning",
  wake: "text-warning",
  pin: "text-pin",
  folder: "text-accent-text",
  snip: "text-accent-text",
  done: "text-success",
};

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const thump: Transition = { type: "spring", stiffness: 560, damping: 18, mass: 0.7 };
const settle: Transition = { type: "spring", stiffness: 240, damping: 15, mass: 0.8 };

/** SVG transforms turn around their own box; an invisible circle makes that box centre where it should. */
const Pivot = ({ x, y, r = 14 }: { x: number; y: number; r?: number }) => <circle cx={x} cy={y} r={r} fill="none" stroke="none" />;

/** A postmark lands on the envelope: a quick stamp from above, a ring of ink, the wavy cancel lines. */
function Postmark() {
  return (
    <motion.svg
      width={27}
      height={18}
      viewBox="0 0 30 20"
      initial={{ scale: 1.9, rotate: -26, opacity: 0 }}
      animate={{ scale: 1, rotate: -8, opacity: 1 }}
      transition={thump}
      {...stroke}
    >
      <motion.circle cx={9} cy={10} initial={{ r: 7, opacity: 0.55 }} animate={{ r: 13, opacity: 0 }} transition={{ delay: 0.16, duration: 0.85, ease: "easeOut" }} strokeWidth={1} />
      <circle cx={9} cy={10} r={7} strokeWidth={1.6} />
      <circle cx={9} cy={10} r={4.4} strokeWidth={0.9} opacity={0.55} />
      <path d="M6.6 10h4.8" strokeWidth={1.3} />
      <path d="M17.5 6q1.5-1.5 3 0t3 0t3 0" strokeWidth={1.4} />
      <path d="M17.5 10q1.5-1.5 3 0t3 0t3 0" strokeWidth={1.4} />
      <path d="M17.5 14q1.5-1.5 3 0t3 0t3 0" strokeWidth={1.4} />
    </motion.svg>
  );
}

/** The clock's hand sweeps once round: it will go out later. */
function Clock() {
  return (
    <svg width={18} height={18} viewBox="0 0 20 20" {...stroke}>
      <circle cx={10} cy={10} r={7.5} />
      <motion.g initial={{ rotate: -360 }} animate={{ rotate: 0 }} transition={{ duration: 1.15, ease: [0.2, 0.7, 0.2, 1] }}>
        <Pivot x={10} y={10} r={9} />
        <path d="M10 10V5.6" />
      </motion.g>
      <path d="M10 10l2.8 1.6" />
    </svg>
  );
}

/** A letter drops into the box; the lid lifts for it and settles. */
function ArchiveBox() {
  return (
    <svg width={18} height={18} viewBox="0 0 20 20" {...stroke} overflow="visible">
      <motion.rect
        x={7.2}
        y={4}
        width={5.6}
        height={4}
        rx={0.6}
        strokeWidth={1.3}
        initial={{ y: -9, opacity: 0 }}
        animate={{ y: 3, opacity: [0, 1, 1, 0] }}
        transition={{ duration: 0.7, ease: "easeIn", times: [0, 0.2, 0.75, 1] }}
      />
      <path d="M4.5 8.5v6.8a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5V8.5" />
      <path d="M8.5 11.8h3" />
      <motion.g
        style={{ originX: 0, originY: 1 }}
        initial={{ rotate: 0, y: 0 }}
        animate={{ rotate: [0, -22, -22, 0], y: [0, -2, -2, 0] }}
        transition={{ duration: 0.85, times: [0, 0.3, 0.6, 1], ease: "easeInOut" }}
      >
        <rect x={3} y={4.5} width={14} height={4} rx={1} />
      </motion.g>
    </svg>
  );
}

/** The bin's lid tips open and drops shut. */
function Bin() {
  return (
    <svg width={18} height={18} viewBox="0 0 20 20" {...stroke} overflow="visible">
      <motion.g style={{ originX: 0, originY: 1 }} initial={{ rotate: 0 }} animate={{ rotate: [0, -32, -32, 0] }} transition={{ duration: 0.8, times: [0, 0.3, 0.6, 1], ease: "easeInOut" }}>
        <path d="M3.5 6h13" />
        <path d="M8 6V4.6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V6" />
      </motion.g>
      <path d="M5 6l.8 9.6a1.6 1.6 0 0 0 1.6 1.4h5.2a1.6 1.6 0 0 0 1.6-1.4L15 6" />
      <path d="M8.5 9.2v4.6M11.5 9.2v4.6" strokeWidth={1.4} />
    </svg>
  );
}

/** The shield shakes its head. */
function Shield() {
  return (
    <motion.svg
      width={18}
      height={18}
      viewBox="0 0 20 20"
      {...stroke}
      initial={{ x: 0 }}
      animate={{ x: [0, -2.4, 2.4, -1.8, 1.8, -1, 1, 0] }}
      transition={{ duration: 0.75, ease: "easeInOut" }}
    >
      <path d="M10 2.8l6 2.4v4.6c0 3.8-2.6 6.4-6 7.4-3.4-1-6-3.6-6-7.4V5.2z" />
      <path d="M10 7v3.4" />
      <path d="M10 13.2h.01" strokeWidth={2.2} />
    </motion.svg>
  );
}

/** A letter slides back into the tray. */
function Tray() {
  return (
    <svg width={18} height={18} viewBox="0 0 20 20" {...stroke} overflow="visible">
      <motion.rect
        x={7.2}
        y={5}
        width={5.6}
        height={4}
        rx={0.6}
        strokeWidth={1.3}
        initial={{ y: -8, opacity: 0 }}
        animate={{ y: 2.5, opacity: [0, 1, 1, 0.9] }}
        transition={{ duration: 0.7, ease: [0.3, 0, 0.3, 1] }}
      />
      <path d="M3 11.5h3.5l1.5 2h4l1.5-2H17" />
      <path d="M5.2 4.5h9.6l2.2 7V15a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15v-3.5z" />
    </svg>
  );
}

/** The moon rises and a small z drifts off. */
function Moon() {
  return (
    <svg width={18} height={18} viewBox="0 0 20 20" {...stroke} overflow="visible">
      <motion.path
        d="M15.2 12.6A6.2 6.2 0 0 1 7.4 4.8a6.4 6.4 0 1 0 7.8 7.8z"
        initial={{ y: 5, rotate: -30, opacity: 0 }}
        animate={{ y: 0, rotate: 0, opacity: 1 }}
        transition={settle}
      />
      <motion.path
        d="M13.2 2.8h3l-3 3.4h3"
        strokeWidth={1.3}
        initial={{ y: 3, opacity: 0 }}
        animate={{ y: -3, opacity: [0, 1, 0] }}
        transition={{ delay: 0.3, duration: 1.5, ease: "easeOut" }}
      />
    </svg>
  );
}

/** The sun comes up over the edge: it's back. */
function Sun() {
  return (
    <svg width={18} height={18} viewBox="0 0 20 20" {...stroke} overflow="hidden">
      <motion.g initial={{ y: 6, rotate: -45 }} animate={{ y: 0, rotate: 0 }} transition={settle}>
        <Pivot x={10} y={11} r={7.5} />
        <circle cx={10} cy={11} r={3.2} />
        <path d="M10 4.6v1.2M10 16.2v1.2M3.6 11h1.2M15.2 11h1.2M5.5 6.5l.85.85M13.65 14.65l.85.85M5.5 15.5l.85-.85M13.65 7.35l.85-.85" strokeWidth={1.4} />
      </motion.g>
    </svg>
  );
}

/** The pin drops in and bounces once. */
function PushPin() {
  return (
    <motion.svg
      width={18}
      height={18}
      viewBox="0 0 20 20"
      {...stroke}
      initial={{ y: -8, rotate: -20, opacity: 0 }}
      animate={{ y: 0, rotate: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 11, mass: 0.7 }}
    >
      <path d="M7.5 3.2h5" />
      <path d="M8.6 3.2v4.4L6 10.4V12h8v-1.6l-2.6-2.8V3.2" />
      <path d="M10 12v5" />
    </motion.svg>
  );
}

/** A letter slips into the folder. */
function Folder() {
  return (
    <svg width={18} height={18} viewBox="0 0 20 20" {...stroke} overflow="visible">
      <motion.rect
        x={8}
        y={4}
        width={5.6}
        height={4}
        rx={0.6}
        strokeWidth={1.3}
        initial={{ y: -8, x: 3, opacity: 0, rotate: 15 }}
        animate={{ y: 3, x: 0, opacity: [0, 1, 1, 0], rotate: 0 }}
        transition={{ duration: 0.7, ease: "easeIn", times: [0, 0.2, 0.75, 1] }}
      />
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h3.2l1.6 1.8h6.2A1.5 1.5 0 0 1 17 8.3V14a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14z" />
    </svg>
  );
}

/** Snip, snip: the scissors close twice. */
function Scissors() {
  const blade = (dir: 1 | -1) => (
    <motion.g initial={{ rotate: 14 * dir }} animate={{ rotate: [14 * dir, 0, 14 * dir, 0] }} transition={{ duration: 0.9, times: [0, 0.3, 0.6, 1], ease: "easeInOut" }}>
      <Pivot x={10} y={9.6} r={16} />
      <circle cx={dir === 1 ? 6 : 14} cy={14.6} r={2.3} />
      <path d={dir === 1 ? "M7.6 12.9L14.6 3.4" : "M12.4 12.9L5.4 3.4"} />
    </motion.g>
  );
  return (
    <svg width={18} height={18} viewBox="0 0 20 20" {...stroke} overflow="visible">
      {blade(1)}
      {blade(-1)}
    </svg>
  );
}

/** A check that draws itself. */
function Check() {
  return (
    <svg width={16} height={16} viewBox="0 0 20 20" {...stroke} strokeWidth={2.1}>
      <motion.path d="M4.5 10.5l3.6 3.6 7.4-8" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6, ease: [0.3, 0, 0.2, 1] }} />
    </svg>
  );
}

const ICONS: Record<Signature, () => React.JSX.Element> = {
  send: Postmark,
  schedule: Clock,
  archive: ArchiveBox,
  trash: Bin,
  spam: Shield,
  inbox: Tray,
  snooze: Moon,
  wake: Sun,
  pin: PushPin,
  folder: Folder,
  snip: Scissors,
  done: Check,
};
