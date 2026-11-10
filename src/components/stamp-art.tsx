"use client";

import { useId } from "react";
import { MUSTACHE } from "@/lib/kolbaba-icon";
import { stampDef, type StampId } from "@/lib/stamps";

/**
 * Our own postage stamps, drawn here: perforated paper, an engraved-looking picture (fine hatching
 * over one colour), KOLBABA where a country would be and a catalogue number instead of a value, so
 * nobody mistakes them for real postage.
 */

const PAPER = "#fbf8f1";
export const STAMP_W = 80;
export const STAMP_H = 100;

/**
 * The perforated edge as one outline: half-round bites every 8 units along each side. A path,
 * not a mask, so a page full of stamps scrolls without repainting them.
 */
const PERFORATED = (() => {
  const r = 2.4;
  const bite = (x: number, y: number) => `A${r} ${r} 0 0 0 ${x} ${y}`;
  let d = "M0 0";
  for (let x = 4; x <= STAMP_W - 4; x += 8) d += ` L${x - r} 0 ${bite(x + r, 0)}`;
  d += ` L${STAMP_W} 0`;
  for (let y = 4; y <= STAMP_H - 4; y += 8) d += ` L${STAMP_W} ${y - r} ${bite(STAMP_W, y + r)}`;
  d += ` L${STAMP_W} ${STAMP_H}`;
  for (let x = STAMP_W - 4; x >= 4; x -= 8) d += ` L${x + r} ${STAMP_H} ${bite(x - r, STAMP_H)}`;
  d += ` L0 ${STAMP_H}`;
  for (let y = STAMP_H - 4; y >= 4; y -= 8) d += ` L0 ${y + r} ${bite(0, y - r)}`;
  return `${d} Z`;
})();

export function StampFrame({
  colour,
  no,
  children,
  width = 64,
  className,
  muted = false,
}: {
  /** The ink of the picture. */
  colour: string;
  no: number | string;
  children: React.ReactNode;
  width?: number;
  className?: string;
  /** Not collected yet: a faint outline of where it goes. */
  muted?: boolean;
}) {
  const id = useId().replace(/[^\w-]/g, "");
  return (
    <svg width={width} height={(width * STAMP_H) / STAMP_W} viewBox={`0 0 ${STAMP_W} ${STAMP_H}`} className={className} aria-hidden>
      <defs>
        <pattern id={`hatch-${id}`} width={2.4} height={2.4} patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1={0} y1={0} x2={0} y2={2.4} stroke="#fff" strokeWidth={0.7} strokeOpacity={0.22} />
        </pattern>
        <clipPath id={`pic-${id}`}>
          <rect x={7} y={7} width={STAMP_W - 14} height={STAMP_H - 14} rx={1} />
        </clipPath>
      </defs>
      {muted ? (
        <g>
          <path d={PERFORATED} fill="currentColor" opacity={0.06} />
          <rect x={7} y={7} width={STAMP_W - 14} height={STAMP_H - 14} rx={1} fill="none" stroke="currentColor" strokeOpacity={0.25} strokeDasharray="2 2" />
        </g>
      ) : (
        <g>
          <path d={PERFORATED} fill={PAPER} stroke="rgb(0 0 0 / 0.08)" strokeWidth={0.5} />
          <g clipPath={`url(#pic-${id})`}>
            <rect x={7} y={7} width={STAMP_W - 14} height={STAMP_H - 14} fill={colour} />
            {children}
            <rect x={7} y={7} width={STAMP_W - 14} height={STAMP_H - 14} fill={`url(#hatch-${id})`} />
          </g>
          <rect x={7} y={7} width={STAMP_W - 14} height={STAMP_H - 14} rx={1} fill="none" stroke={colour} strokeWidth={0.8} />
          <text x={STAMP_W / 2} y={17} textAnchor="middle" fontSize={7} fontWeight={700} letterSpacing={1.6} fill={PAPER} fontFamily="var(--font-sans)">
            KOLBABA
          </text>
          <text x={STAMP_W - 11} y={STAMP_H - 11} textAnchor="end" fontSize={6.5} fontWeight={600} fill={PAPER} fontFamily="var(--font-sans)">
            Nº {no}
          </text>
        </g>
      )}
    </svg>
  );
}

/** The definitive stamp: Kolbaba himself, cap, nose and mustache. */
export function KolbabaStamp({ width }: { width?: number }) {
  return (
    <StampFrame colour="#b8432f" no={0} width={width}>
      <g transform="translate(40 56) scale(0.42) translate(-60 -52.75)" fill={PAPER}>
        <path d="M26 48 L32 14 Q60 4 88 14 L94 48 Z" />
        <rect x={18} y={44} width={84} height={11} rx={5.5} />
        <rect x={51} y={22} width={18} height={12} rx={2.2} fill="#b8432f" />
        <circle cx={60} cy={69} r={9} />
        <path d={MUSTACHE} transform="translate(60 89) scale(1.5) translate(-60 -84)" />
      </g>
    </StampFrame>
  );
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

/** "13 X 26": the day, the month in Roman numerals and the year, as on old Czech postmarks. */
export const postmarkDate = (d: Date) => `${d.getDate()} ${ROMAN[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;

/** A round postmark: the place around the top, the date across the middle, wavy lines beside it. */
export function Postmark({ place, date, size = 64, className, waves = true }: { place: string; date: Date; size?: number; className?: string; waves?: boolean }) {
  const id = useId().replace(/[^\w-]/g, "");
  const width = waves ? size * 1.7 : size;
  return (
    <svg width={width} height={size} viewBox={`0 0 ${waves ? 68 : 40} 40`} className={className} aria-hidden fill="none" stroke="currentColor">
      <defs>
        <path id={`arc-${id}`} d="M6.6 20 A13.4 13.4 0 0 1 33.4 20" />
      </defs>
      <circle cx={20} cy={20} r={17} strokeWidth={1.3} />
      <circle cx={20} cy={20} r={12.5} strokeWidth={0.6} />
      {/* Long names get smaller letters, so they fit the arc between the rings. */}
      <text fontSize={Math.min(4.6, 38 / (place.length * 0.72))} fontWeight={700} letterSpacing={0.5} fill="currentColor" stroke="none" fontFamily="var(--font-sans)">
        <textPath href={`#arc-${id}`} startOffset="50%" textAnchor="middle">
          {place.toUpperCase()}
        </textPath>
      </text>
      <text x={20} y={23.6} textAnchor="middle" fontSize={6} fontWeight={700} fill="currentColor" stroke="none" fontFamily="var(--font-sans)">
        {postmarkDate(date)}
      </text>
      {waves && (
        <g strokeWidth={1.1}>
          <path d="M39 11q3-3 6 0t6 0t6 0t6 0" />
          <path d="M40 17q3-3 6 0t6 0t6 0t6 0" />
          <path d="M40 23q3-3 6 0t6 0t6 0t6 0" />
          <path d="M39 29q3-3 6 0t6 0t6 0t6 0" />
        </g>
      )}
    </svg>
  );
}

/* --------------------------------- The set -------------------------------- */

const P = PAPER;

/** Each stamp's picture, drawn in paper colour on its ink; the frame adds the hatching and the text. */
const PICTURES: Record<StampId, (c: string) => React.ReactNode> = {
  // An envelope with a wax seal.
  "first-letter": (c) => (
    <>
      <rect x={18} y={38} width={44} height={29} rx={2} fill={P} />
      <path d="M18 39 L40 55 L62 39" fill="none" stroke={c} strokeWidth={2} strokeLinejoin="round" />
      <circle cx={40} cy={56} r={6.2} fill={c} stroke={P} strokeWidth={1.6} />
      <path d="M37.4 56h5.2M40 53.4v5.2" stroke={P} strokeWidth={1.4} strokeLinecap="round" />
    </>
  ),
  // An empty letter tray under a desk lamp.
  "clean-desk": (c) => (
    <>
      <path d="M41 43 L28 64 H54 Z" fill={P} opacity={0.22} />
      <rect x={13} y={64} width={54} height={4} rx={1} fill={P} />
      <rect x={17} y={68} width={3} height={14} fill={P} />
      <rect x={60} y={68} width={3} height={14} fill={P} />
      <path d="M27 64 L30 55 H50 L53 64" fill="none" stroke={P} strokeWidth={2.2} strokeLinejoin="round" />
      <rect x={55} y={60} width={9} height={4} rx={1} fill={P} />
      <path d="M59.5 60 L55 45 L46 40" fill="none" stroke={P} strokeWidth={2} strokeLinecap="round" />
      <path d="M37 36.5 L48 35 L46 44 Z" fill={P} />
      <circle cx={46} cy={40} r={1.6} fill={c} />
    </>
  ),
  // Kolbaba's cap hung on its nail: the shift is over.
  padla: (c) => (
    <>
      <path d="M14 30 H66" stroke={P} strokeWidth={1.4} opacity={0.5} />
      <circle cx={40} cy={34} r={2.4} fill={P} />
      <path d="M40 34 L30 47 M40 34 L50 47" stroke={P} strokeWidth={1.3} />
      <g transform="translate(40 58) rotate(-7) scale(0.5) translate(-60 -35)" fill={P}>
        <path d="M26 48 L32 14 Q60 4 88 14 L94 48 Z" />
        <rect x={18} y={44} width={84} height={11} rx={5.5} />
        <rect x={51} y={22} width={18} height={12} rx={2.2} fill={c} />
      </g>
    </>
  ),
  // Scissors cutting a newsletter along a dashed line.
  snip: (c) => (
    <>
      <g transform="rotate(-8 32 52)">
        <rect x={17} y={31} width={30} height={40} rx={1.5} fill={P} />
        <path d="M21 37h22M21 42h22M21 47h14M21 52h22M21 57h18M21 62h22" stroke={c} strokeWidth={1.4} />
      </g>
      <path d="M14 70 L58 48" stroke={P} strokeWidth={1.4} strokeDasharray="3 2.5" />
      <path d="M51 51 L38 41 M51 51 L40 36" stroke={P} strokeWidth={2.6} strokeLinecap="round" />
      <path d="M51 51 L56 58 M51 51 L59 51" stroke={P} strokeWidth={2} strokeLinecap="round" />
      <circle cx={58.5} cy={61} r={3.8} fill="none" stroke={P} strokeWidth={2} />
      <circle cx={62.5} cy={50.5} r={3.8} fill="none" stroke={P} strokeWidth={2} />
    </>
  ),
  // A shut door with a no-entry sign.
  bouncer: (c) => (
    <>
      <path d="M16 77 H64" stroke={P} strokeWidth={2} strokeLinecap="round" />
      <rect x={22} y={31} width={25} height={46} rx={1.5} fill="none" stroke={P} strokeWidth={2.2} />
      <rect x={26} y={35} width={17} height={17} rx={1} fill={P} opacity={0.25} />
      <circle cx={42} cy={58} r={1.7} fill={P} />
      <circle cx={53} cy={43} r={10} fill={P} />
      <rect x={47} y={41} width={12} height={4} rx={1} fill={c} />
    </>
  ),
  // A filing cabinet, a letter going into the top drawer.
  "filing-clerk": (c) => (
    <>
      <rect x={24} y={31} width={32} height={47} rx={2} fill={P} />
      <g fill="none" stroke={c} strokeWidth={1.6}>
        <rect x={27} y={35} width={26} height={12} rx={1} />
        <rect x={27} y={50} width={26} height={12} rx={1} />
        <rect x={27} y={65} width={26} height={10} rx={1} />
      </g>
      <path d="M37 41h6M37 56h6M37 70h6" stroke={c} strokeWidth={2} strokeLinecap="round" />
      <g transform="rotate(-12 40 29)">
        <rect x={32} y={22} width={16} height={11} rx={1} fill={P} stroke={c} strokeWidth={1.2} />
        <path d="M32 22.5 l8 6 l8 -6" fill="none" stroke={c} strokeWidth={1.1} />
      </g>
    </>
  ),
  // Two letters crossing in the post, a heart between them.
  "pen-pal": (c) => (
    <>
      <g transform="rotate(-14 31 52)">
        <rect x={15} y={42} width={31} height={21} rx={1.5} fill={P} />
        <path d="M15 43 L30.5 54 L46 43" fill="none" stroke={c} strokeWidth={1.6} />
      </g>
      <g transform="rotate(12 49 59)">
        <rect x={34} y={49} width={31} height={21} rx={1.5} fill={P} stroke={c} strokeWidth={1.2} />
        <path d="M34 50 L49.5 61 L65 50" fill="none" stroke={c} strokeWidth={1.6} />
      </g>
      <path d="M40 38.5c-3.6-2.8-6-5-6-7.6 0-1.8 1.4-3.2 3.2-3.2 1.2 0 2.2.6 2.8 1.5.6-.9 1.6-1.5 2.8-1.5 1.8 0 3.2 1.4 3.2 3.2 0 2.6-2.4 4.8-6 7.6z" fill={P} />
    </>
  ),
  // A boomerang on its way back.
  boomerang: () => (
    <>
      <path d="M19 33 Q40 18 62 31" fill="none" stroke={P} strokeWidth={1.4} strokeDasharray="2.5 3" strokeLinecap="round" />
      <path d="M58 26 L62.5 31.5 L55.5 32.5" fill="none" stroke={P} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M27 42 Q24 62 33 67 Q42 71 60 63" fill="none" stroke={P} strokeWidth={7.5} strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  // A robot, in honour of the Čapek brothers' word.
  robot: (c) => (
    <>
      <path d="M40 25 v7" stroke={P} strokeWidth={2} />
      <circle cx={40} cy={24} r={2.6} fill={P} />
      <rect x={24} y={32} width={32} height={25} rx={5} fill={P} />
      <rect x={20} y={39} width={4} height={10} rx={1.5} fill={P} />
      <rect x={56} y={39} width={4} height={10} rx={1.5} fill={P} />
      <circle cx={33} cy={42.5} r={3.8} fill={c} />
      <circle cx={47} cy={42.5} r={3.8} fill={c} />
      <rect x={32} y={49.5} width={16} height={3.4} rx={1.2} fill={c} />
      <rect x={36} y={57} width={8} height={4} fill={P} />
      <rect x={26} y={61} width={28} height={17} rx={4} fill={P} />
      <path d="M40 72.6c-2.4-1.9-4-3.3-4-5 0-1.2.9-2.1 2.1-2.1.8 0 1.5.4 1.9 1 .4-.6 1.1-1 1.9-1 1.2 0 2.1.9 2.1 2.1 0 1.7-1.6 3.1-4 5z" fill={c} />
    </>
  ),
  // An eye that doesn't get to look.
  "spy-catcher": (c) => (
    <>
      <path d="M15 53 Q40 30 65 53 Q40 76 15 53 Z" fill={P} />
      <circle cx={40} cy={53} r={8.5} fill={c} />
      <circle cx={40} cy={53} r={3.6} fill={P} />
      <path d="M21 73 L59 33" stroke={c} strokeWidth={7} strokeLinecap="round" />
      <path d="M21 73 L59 33" stroke={P} strokeWidth={3} strokeLinecap="round" />
    </>
  ),
  // A calendar page with five days ticked.
  "clean-week": (c) => (
    <>
      <rect x={17} y={31} width={46} height={45} rx={3} fill={P} />
      <path d="M17 41 H63" stroke={c} strokeWidth={1.4} />
      <path d="M28 27 v7 M52 27 v7" stroke={P} strokeWidth={2.4} strokeLinecap="round" />
      <path d="M28 27 v7 M52 27 v7" stroke={c} strokeWidth={0.8} strokeLinecap="round" opacity={0.5} />
      {[23, 31, 39, 47, 55].map((x) => (
        <path key={x} d={`M${x - 2.6} 54 l2 2.4 l3.6 -4.6`} fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      <rect x={21} y={63} width={5} height={5} rx={0.8} fill="none" stroke={c} strokeWidth={1} opacity={0.5} />
      <rect x={29} y={63} width={5} height={5} rx={0.8} fill="none" stroke={c} strokeWidth={1} opacity={0.5} />
    </>
  ),
  // A bird on a branch before the sun is fully up.
  "early-bird": (c) => (
    <>
      <path d="M22 66 A18 18 0 0 1 58 66 Z" fill={P} opacity={0.9} />
      <path d="M40 42v-6M27 47l-4-4M53 47l4-4M20 58h-6M60 58h6" stroke={P} strokeWidth={1.6} strokeLinecap="round" />
      <path d="M12 72 Q40 66 68 73" fill="none" stroke={P} strokeWidth={2.4} strokeLinecap="round" />
      <ellipse cx={42} cy={61} rx={7.5} ry={5.6} fill={c} stroke={P} strokeWidth={1.6} />
      <circle cx={48.5} cy={55.5} r={3.8} fill={c} stroke={P} strokeWidth={1.6} />
      <path d="M52 55 l3.6 1 l-3.4 1.4 Z" fill={P} />
      <circle cx={49.4} cy={54.8} r={0.8} fill={P} />
      <path d="M34.6 60 L28.5 57.5 L30 63 Z" fill={c} stroke={P} strokeWidth={1.4} strokeLinejoin="round" />
      <path d="M41 66.5 v3 M44 66.5 v3" stroke={P} strokeWidth={1.2} />
    </>
  ),
  // A letter dug out of the ground, with the trowel that found it.
  archaeologist: (c) => (
    <>
      <g transform="rotate(-18 36 58)">
        <rect x={22} y={46} width={28} height={19} rx={1.5} fill={P} />
        <path d="M22 47 L36 57 L50 47" fill="none" stroke={c} strokeWidth={1.5} />
      </g>
      <rect x={7} y={62} width={66} height={31} fill={c} />
      <rect x={7} y={62} width={66} height={31} fill={P} opacity={0.18} />
      <path d="M7 62 H73" stroke={P} strokeWidth={1.6} />
      <path d="M7 71 H73" stroke={P} strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />
      <path d="M53 31 L60 45" stroke={P} strokeWidth={2.4} strokeLinecap="round" />
      <path d="M57.5 43 l5.5 -2.4 l2.6 6.6 l-5.6 2.2 z" fill={P} />
      <circle cx={47} cy={57} r={0.9} fill={P} />
      <circle cx={52} cy={54} r={0.7} fill={P} />
    </>
  ),
  // A letter with nobody to deliver it to.
  "no-address": (c) => (
    <>
      <rect x={15} y={36} width={50} height={33} rx={2} fill={P} />
      <rect x={52} y={40} width={9} height={10} fill="none" stroke={c} strokeWidth={1} strokeDasharray="1.6 1.6" />
      <text x={33} y={64} textAnchor="middle" fontSize={24} fontWeight={800} fill={c} fontFamily="var(--font-sans)">
        ?
      </text>
    </>
  ),
  // The long road to the horizon, sun on one side and snow on the other.
  "year-and-a-day": (c) => (
    <>
      <path d="M7 52 H73" stroke={P} strokeWidth={1.2} opacity={0.6} />
      <path d="M20 93 L35.5 52 H38.5 L46 93 Z" fill={P} />
      <path d="M36.8 57 l-.4 4 M36 66 l-.6 6 M35 78 l-.9 8" stroke={c} strokeWidth={1.4} />
      <circle cx={57} cy={37} r={6} fill={P} />
      <g stroke={P} strokeWidth={1.4} strokeLinecap="round">
        <path d="M23 30v13M17.4 33.2l11.2 6.6M17.4 39.8l11.2-6.6" />
      </g>
    </>
  ),
  // A Christmas tree with a letter under it.
  christmas: (c) => (
    <>
      <path d="M40 27 L52 43 H46 L56 56 H48.5 L58 70 H22 L31.5 56 H24 L34 43 H28 Z" fill={P} />
      <rect x={37} y={70} width={6} height={6} fill={P} />
      <path d="M40 21.5 l1.5 3.2 3.4 .4-2.6 2.2.8 3.4-3.1-1.8-3.1 1.8.8-3.4-2.6-2.2 3.4-.4z" fill={P} />
      <circle cx={36} cy={47} r={1.6} fill={c} />
      <circle cx={45} cy={60} r={1.6} fill={c} />
      <circle cx={33} cy={64} r={1.6} fill={c} />
      <g transform="rotate(-6 54 73)">
        <rect x={47} y={68} width={15} height={10} rx={1} fill={P} stroke={c} strokeWidth={1.2} />
        <path d="M47 68.5 l7.5 5 l7.5 -5" fill="none" stroke={c} strokeWidth={1.1} />
      </g>
    </>
  ),
};

/** A stamp from the album: its picture, or a faint outline of where it goes until it's collected. */
export function StampArt({ id, width = 64, muted = false, className }: { id: StampId; width?: number; muted?: boolean; className?: string }) {
  const def = stampDef(id);
  return (
    <StampFrame colour={def.colour} no={def.no} width={width} muted={muted} className={className}>
      {PICTURES[id](def.colour)}
    </StampFrame>
  );
}
