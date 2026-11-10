"use client";

import { motion } from "motion/react";
import { useEffect, useId, useMemo, useState } from "react";
import { getLocale, t, tn } from "@/lib/i18n";
import { MORNING_LINE, NIGHT_LINE, PADLA_LINE, POSTCARD_LINES } from "@/lib/kolbaba-lines";
import { LIVE } from "@/lib/live";
import { ME_NAME } from "@/lib/mock-data";
import { buildScene, dayKey, H, isPadla, phaseOf, pickLine, W, type Scene, type Tree } from "@/lib/postcard";
import { useMail } from "@/lib/store";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { Kolbaba } from "./kolbaba";
import { KolbabaStamp, Postmark } from "./stamp-art";
import { useCoarsePointer } from "./swipe-row";

/* ----------------------------- Inbox zero block ---------------------------- */

/**
 * An empty Inbox: Kolbaba tips his cap (or sleeps, late at night) and leaves a postcard. "list" is
 * the desktop's list column while the postcard itself is in the reader next to it.
 */
export function InboxZero({ where }: { where: "phone" | "list" | "reader" }) {
  const now = new Date(useNow());
  const night = phaseOf(now) === "night";
  const padla = isPadla(now);
  const touch = useCoarsePointer();
  const loadStats = useMail((s) => s.loadStats);
  useEffect(() => void loadStats(), [loadStats]);
  // Stamps for an empty Inbox (Clean Desk, Padla, Early Bird, Clean Week), once the user's album is here.
  const hasUser = useMail((s) => !!s.user);
  const noteInboxZero = useMail((s) => s.noteInboxZero);
  useEffect(() => noteInboxZero(), [noteInboxZero, hasUser]);

  const title = padla ? t("Padla!") : t("Inbox zero");
  const body = padla
    ? t("Czech for “that's a wrap”. Kolbaba brought you a postcard.")
    : night
      ? t("It's late. Kolbaba is asleep, and you should go too.")
      : t("Kolbaba brought you a postcard.");
  const card = where !== "list";
  // Something is open in the reader: the postcard waits behind it, one click away.
  const readerBusy = useMail((s) => where === "list" && s.tabs.some((tab) => tab.id === s.activeTabId));

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1, type: "spring", stiffness: 300, damping: 30 }}
      className={cn("flex flex-col items-center text-center", where === "phone" ? "px-6 pt-10" : where === "reader" ? "px-8" : "px-4 py-10")}
    >
      <Kolbaba size={where === "reader" ? 52 : 44} mood={night ? "sleep" : "tip"} snow={now.getMonth() === 11} interactive />
      <div className="mt-3 text-[16px] font-semibold tracking-[-0.01em]">{title}</div>
      <div className="mt-0.5 max-w-[320px] text-[13px] text-balance text-ink-3">{body}</div>
      {readerBusy && (
        <button
          onClick={() => useMail.setState({ activeTabId: null })}
          className="press mt-3 h-8 rounded-full bg-hover px-3.5 text-[12.5px] font-medium text-ink hover:bg-selected"
        >
          {t("Show the postcard")}
        </button>
      )}
      {card && (
        <>
          <div className={cn("mt-6 w-full", where === "reader" ? "max-w-[min(580px,92%)]" : "max-w-[360px]")}>
            <Postcard />
          </div>
          <div className="mt-3 text-[12px] text-ink-3">{touch ? t("Tap it to turn it over") : t("Click it to turn it over")}</div>
        </>
      )}
    </motion.div>
  );
}

/* --------------------------------- Postcard -------------------------------- */

/** Today's postcard, or (with `at`) one from the collection, drawn as it was that day and hour. */
export function Postcard({ at }: { at?: Date }) {
  const live = new Date(useNow());
  const now = at ?? live;
  const key = dayKey(now);
  const phase = phaseOf(now);
  const hour = now.getHours();
  // The landscape is the day's; the light follows the hour.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scene = useMemo(() => buildScene(now, key), [key, phase, hour]);
  const [flipped, setFlipped] = useState(false);
  return (
    <motion.div
      initial={{ opacity: 0, y: 40, rotate: 9, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, rotate: -1.6, scale: 1 }}
      whileHover={{ rotate: 0, y: -3 }}
      transition={{ type: "spring", stiffness: 170, damping: 18, delay: 0.15 }}
      style={{ perspective: 1100 }}
    >
      <motion.button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        aria-label={flipped ? t("Turn the postcard back over") : t("Turn the postcard over")}
        animate={{ rotateY: flipped ? 180 : 0 }}
        whileTap={{ scale: 0.98 }}
        transition={{ type: "spring", stiffness: 150, damping: 19 }}
        style={{ transformStyle: "preserve-3d" }}
        className="@container relative block aspect-[3/2.08] w-full cursor-pointer text-left outline-none"
      >
        <Front scene={scene} />
        <Back scene={scene} date={now} dayKey={key} archived={!!at} />
      </motion.button>
    </motion.div>
  );
}

const face = "absolute inset-0 rounded-[10px] [backface-visibility:hidden] [-webkit-backface-visibility:hidden] shadow-[0_1px_2px_rgb(0_0_0/0.12),0_10px_28px_-10px_rgb(0_0_0/0.35)]";

function Front({ scene }: { scene: Scene }) {
  const caption = getLocale() === "cs" ? `Pozdrav ${scene.place.csFrom}` : `Greetings from ${scene.place.name}`;
  return (
    <div className={cn(face, "bg-[var(--paper)] p-[2.2cqw]")}>
      <div className="relative size-full overflow-hidden rounded-[4px]">
        <PostcardArt scene={scene} />
        <span className="absolute bottom-[3cqw] left-[3cqw] -rotate-2 rounded-[3px] bg-[var(--paper)] px-[2cqw] pt-[0.4cqw] pb-[0.2cqw] font-hand text-[5.6cqw] leading-tight text-[var(--paper-ink)] shadow-[0_1px_2px_rgb(0_0_0/0.2)]">
          {caption}
        </span>
      </div>
    </div>
  );
}

function Back({ scene, date, dayKey: key, archived }: { scene: Scene; date: Date; dayKey: string; archived: boolean }) {
  const user = useMail((s) => s.user);
  // The P.S. is about this week, so only today's card has one.
  const week = useMail((s) => (archived ? 0 : (s.stats?.trackersWeek ?? 0)));
  const name = LIVE ? (user?.name || user?.email.split("@")[0] || "").split(" ")[0] : ME_NAME.split(" ")[0];
  const line = isPadla(date) ? PADLA_LINE : scene.phase === "night" ? NIGHT_LINE : date.getHours() < 10 && scene.phase !== "dawn" ? MORNING_LINE : pickLine(key, POSTCARD_LINES);
  return (
    <div className={cn(face, "grid grid-cols-[1.3fr_1fr] gap-[3cqw] bg-[var(--paper)] p-[4cqw] text-[var(--paper-ink)] [transform:rotateY(180deg)]")}>
      <div className="flex min-h-0 flex-col border-r border-[var(--paper-line)] pr-[3cqw] font-hand leading-[1.12]">
        <p className="text-[5.6cqw]">{t(line)}</p>
        {!archived && (
          <p className="mt-[1.6cqw] text-[4.6cqw] opacity-85">
            P.S.{" "}
            {week > 0
              ? tn(week, "This week I didn't let {n} email see when you open it.", "This week I didn't let {n} emails see when you open them.")
              : t("No email has tried to see when you open it this week. I'm keeping watch.")}
          </p>
        )}
        <p className="mt-auto text-right text-[5.6cqw]">Kolbaba</p>
      </div>
      <div className="relative flex min-h-0 flex-col">
        <div className="relative flex justify-end">
          <span className="block w-[17cqw] rotate-3">
            <KolbabaStampFill />
          </span>
          <Postmark place={scene.place.name} date={date} size={40} className="absolute top-[9cqw] right-[2cqw] w-[30cqw] -rotate-12 text-[var(--paper-ink)] opacity-70" />
        </div>
        <div className="mt-auto flex flex-col gap-[1.4cqw] font-hand text-[5cqw] leading-none">
          {[name, t("Inbox no. 0"), scene.place.name].map((text, i) => (
            <span key={i} className="truncate border-b border-dotted border-[var(--paper-line)] pb-[0.6cqw]">
              {text}
            </span>
          ))}
        </div>
      </div>
      <span className="absolute bottom-[1.8cqw] left-[4cqw] text-[2.2cqw] font-semibold tracking-[0.22em] text-[var(--paper-ink)] uppercase opacity-45">
        {t("Postcard")} · Kolbaba
      </span>
    </div>
  );
}

/** The stamp sized by its box (the SVG fills the width it's given). */
function KolbabaStampFill() {
  return (
    <span className="block [&>svg]:h-auto [&>svg]:w-full">
      <KolbabaStamp />
    </span>
  );
}

/* ---------------------------------- Art ----------------------------------- */

/** The picture side. `lite` (small thumbnails in the collection) skips the paper grain, which is costly in numbers. */
export function PostcardArt({ scene, lite = false }: { scene: Scene; lite?: boolean }) {
  const id = useId().replace(/[^\w-]/g, "");
  const s = scene;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="block size-full" aria-hidden>
      <defs>
        <linearGradient id={`sky-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={s.sky[0]} />
          <stop offset="1" stopColor={s.sky[1]} />
        </linearGradient>
        {s.sun && (
          <radialGradient id={`glow-${id}`}>
            <stop offset="0" stopColor={s.sun.color} stopOpacity={0.6} />
            <stop offset="1" stopColor={s.sun.color} stopOpacity={0} />
          </radialGradient>
        )}
        <clipPath id={`mid-${id}`}>
          <path d={s.mid.d} />
        </clipPath>
        <mask id={`moon-${id}`}>
          <rect width={W} height={H} fill="#fff" />
          {s.moon && <circle cx={s.moon.x + 4.5} cy={s.moon.y - 2.5} r={s.moon.r} fill="#000" />}
        </mask>
        <radialGradient id={`vignette-${id}`} cx="0.5" cy="0.45" r="0.75">
          <stop offset="0.62" stopColor="#000" stopOpacity={0} />
          <stop offset="1" stopColor="#000" stopOpacity={0.22} />
        </radialGradient>
        <filter id={`grain-${id}`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} stitchTiles="stitch" />
          <feColorMatrix type="matrix" values="0 0 0 0 0.2  0 0 0 0 0.16  0 0 0 0 0.1  0.55 0 0 0 -0.2" />
        </filter>
      </defs>

      <rect width={W} height={H} fill={`url(#sky-${id})`} />
      {s.stars.map((star, i) => (
        <circle key={i} cx={star.x} cy={star.y} r={star.r} fill="#fff" opacity={star.o} />
      ))}
      {s.moon && <circle cx={s.moon.x} cy={s.moon.y} r={s.moon.r} fill="#fdf3cf" mask={`url(#moon-${id})`} />}
      {s.sun && (
        <>
          <circle cx={s.sun.x} cy={s.sun.y} r={s.sun.r * 3.2} fill={`url(#glow-${id})`} />
          <circle cx={s.sun.x} cy={s.sun.y} r={s.sun.r} fill={s.sun.color} />
        </>
      )}
      {s.clouds.map((c, i) => (
        <g key={i} fill={c.color} opacity={c.o}>
          <ellipse cx={c.x + c.w * 0.5} cy={c.y + 4} rx={c.w * 0.5} ry={4.5} />
          <circle cx={c.x + c.w * 0.32} cy={c.y} r={c.w * 0.16} />
          <circle cx={c.x + c.w * 0.56} cy={c.y - 2} r={c.w * 0.2} />
          <circle cx={c.x + c.w * 0.76} cy={c.y + 1} r={c.w * 0.13} />
        </g>
      ))}
      {s.birds.map((b, i) => (
        <path
          key={i}
          d={`M${b.x - b.s} ${b.y} q${b.s * 0.5} ${-b.s * 0.6} ${b.s} 0 q${b.s * 0.5} ${-b.s * 0.6} ${b.s} 0`}
          fill="none"
          stroke="#3b4656"
          strokeWidth={0.7}
          strokeLinecap="round"
        />
      ))}

      <path d={s.far.d} fill={s.far.fill} />
      <path d={s.mid.d} fill={s.mid.fill} />
      <g clipPath={`url(#mid-${id})`} opacity={0.85}>
        {s.mid.fields.map((f, i) => (
          <path key={i} d={f.d} fill={f.fill} />
        ))}
      </g>

      <Church scene={s} />
      {s.houses.map((h, i) => (
        <g key={i}>
          {h.chimney && <rect x={h.x + h.w - 3.2} y={h.y - h.roof * 0.75 - 1.5} width={1.7} height={3.5} fill={h.roofColor} />}
          <path d={`M${h.x - 1} ${h.y} L${h.x + h.w / 2} ${h.y - h.roof} L${h.x + h.w + 1} ${h.y} Z`} fill={h.roofColor} />
          <rect x={h.x} y={h.y} width={h.w} height={h.h} fill={h.wall} />
          {h.windows.map((w, k) => (
            <rect key={k} x={w.x} y={w.y} width={1.8} height={2} fill={s.windowsLit ? "#ffd66b" : "#5c4b3d"} opacity={s.windowsLit ? 1 : 0.65} />
          ))}
        </g>
      ))}
      {s.smoke && (
        <g fill="#ffffff">
          <circle cx={s.smoke.x} cy={s.smoke.y} r={1.3} opacity={0.55} />
          <circle cx={s.smoke.x + 1.6} cy={s.smoke.y - 3.4} r={1.8} opacity={0.4} />
          <circle cx={s.smoke.x + 4} cy={s.smoke.y - 7.4} r={2.4} opacity={0.25} />
        </g>
      )}

      <path d={s.near.d} fill={s.near.fill} />
      <path d={s.road.d} fill={s.road.fill} />
      {s.trees.map((tree, i) => (
        <TreeShape key={i} tree={tree} trunk={s.trunk} winter={s.season === "winter"} />
      ))}
      {s.snow.map((f, i) => (
        <circle key={i} cx={f.x} cy={f.y} r={f.r} fill="#fff" opacity={0.85} />
      ))}

      {!lite && <rect width={W} height={H} filter={`url(#grain-${id})`} />}
      <rect width={W} height={H} fill={`url(#vignette-${id})`} />
    </svg>
  );
}

function Church({ scene }: { scene: Scene }) {
  const c = scene.church;
  const tx = c.x - 3.5;
  const tw = 5.5;
  const top = c.y + c.h - (c.h + c.tower);
  return (
    <g>
      <path d={`M${c.x - 0.8} ${c.y} L${c.x + c.w / 2} ${c.y - 5} L${c.x + c.w + 0.8} ${c.y} Z`} fill={c.roof} />
      <rect x={c.x} y={c.y} width={c.w} height={c.h} fill={c.wall} />
      <rect x={c.x + c.w / 2 - 0.9} y={c.y + 3} width={1.8} height={3} rx={0.9} fill={scene.windowsLit ? "#ffd66b" : "#5c4b3d"} opacity={scene.windowsLit ? 0.9 : 0.6} />
      <rect x={tx} y={top} width={tw} height={c.h + c.tower} fill={c.wall} />
      <rect x={tx + tw / 2 - 0.8} y={top + 2.5} width={1.6} height={2.4} rx={0.8} fill="#5c4b3d" opacity={0.6} />
      {c.dome ? (
        <>
          <ellipse cx={tx + tw / 2} cy={top - 2.2} rx={3.4} ry={2.8} fill={c.roof} />
          <path d={`M${tx + tw / 2 - 1.6} ${top - 4.2} Q${tx + tw / 2} ${top - 8} ${tx + tw / 2 + 1.6} ${top - 4.2} Z`} fill={c.roof} />
          <path d={`M${tx + tw / 2} ${top - 7} v-3`} stroke={c.roof} strokeWidth={0.6} />
        </>
      ) : (
        <>
          <path d={`M${tx - 0.6} ${top} L${tx + tw / 2} ${top - 9} L${tx + tw + 0.6} ${top} Z`} fill={c.roof} />
          <path d={`M${tx + tw / 2} ${top - 9} v-2.5`} stroke={c.roof} strokeWidth={0.6} />
        </>
      )}
    </g>
  );
}

function TreeShape({ tree, trunk, winter }: { tree: Tree; trunk: string; winter: boolean }) {
  const { x, y, size: z, color } = tree;
  if (tree.kind === "conifer") {
    return (
      <g>
        <rect x={x - 0.6} y={y - z * 0.3} width={1.2} height={z * 0.3} fill={trunk} />
        <path d={`M${x} ${y - z * 1.35} L${x + z * 0.36} ${y - z * 0.7} L${x - z * 0.36} ${y - z * 0.7} Z`} fill={color} />
        <path d={`M${x} ${y - z * 1.05} L${x + z * 0.48} ${y - z * 0.26} L${x - z * 0.48} ${y - z * 0.26} Z`} fill={color} />
        {winter && <path d={`M${x} ${y - z * 1.35} L${x + z * 0.18} ${y - z * 1.03} L${x - z * 0.18} ${y - z * 1.03} Z`} fill="#ffffff" opacity={0.95} />}
      </g>
    );
  }
  return (
    <g>
      <rect x={x - 0.7} y={y - z * 0.55} width={1.4} height={z * 0.55} fill={trunk} />
      <circle cx={x} cy={y - z * 0.78} r={z * 0.46} fill={color} />
      <circle cx={x + z * 0.24} cy={y - z * 0.95} r={z * 0.3} fill={color} />
      {tree.blossom &&
        [
          [-0.2, -0.85],
          [0.15, -0.7],
          [0.28, -1.05],
          [-0.05, -1.08],
          [-0.3, -0.62],
        ].map(([dx, dy], i) => <circle key={i} cx={x + dx * z} cy={y + dy * z} r={0.7} fill="#f6bfd0" />)}
    </g>
  );
}
