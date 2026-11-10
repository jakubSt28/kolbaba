/**
 * Kolbaba's postcard for an empty Inbox: a small landscape drawn from scratch, a different one every
 * day, with the sky of the actual hour and the colours of the actual season (snow in winter, lit
 * windows in the evening). Everything here is our own: hills from noise, a village of a few houses
 * and a church, trees, a road. Pure and deterministic, so the same day draws the same card.
 */

export type Season = "winter" | "spring" | "summer" | "autumn";
export type Phase = "dawn" | "day" | "dusk" | "night";

export const W = 300;
export const H = 200;

/* ---------------------------------- Time ---------------------------------- */

// Rough sunrise and sunset in Central Europe by month (local time, hours).
const SUN: [number, number][] = [
  [7.9, 16.4], [7.3, 17.3], [6.3, 18.1], [6.4, 19.9], [5.4, 20.6], [4.9, 21.1],
  [5.2, 21.0], [5.9, 20.3], [6.7, 19.2], [7.3, 18.1], [7.2, 16.5], [7.8, 16.0],
];

export function seasonOf(d: Date): Season {
  const m = d.getMonth();
  return m === 11 || m <= 1 ? "winter" : m <= 4 ? "spring" : m <= 7 ? "summer" : "autumn";
}

export function phaseOf(d: Date): Phase {
  const [rise, set] = SUN[d.getMonth()];
  const h = d.getHours() + d.getMinutes() / 60;
  if (h < rise - 0.6 || h >= set + 0.7) return "night";
  if (h < rise + 1.2) return "dawn";
  if (h >= set - 1.2) return "dusk";
  return "day";
}

/** How far through the daylight the sun is, 0 at sunrise and 1 at sunset. */
function dayProgress(d: Date) {
  const [rise, set] = SUN[d.getMonth()];
  const h = d.getHours() + d.getMinutes() / 60;
  return Math.min(1, Math.max(0, (h - rise) / (set - rise)));
}

/** "2026-10-13" in local time: the card changes at midnight. */
export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/* --------------------------------- Random --------------------------------- */

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;
const between = (r: Rand, a: number, b: number) => a + (b - a) * r();
const pick = <T>(r: Rand, list: readonly T[]) => list[Math.floor(r() * list.length)];
const round = (n: number) => Math.round(n * 10) / 10;

/** Smooth 1D value noise in 0..1. */
function noise(r: Rand) {
  const values = Array.from({ length: 64 }, r);
  return (x: number) => {
    const i = Math.floor(x);
    const f = x - i;
    const t = (1 - Math.cos(f * Math.PI)) / 2;
    const a = values[((i % 64) + 64) % 64];
    const b = values[(((i + 1) % 64) + 64) % 64];
    return a + (b - a) * t;
  };
}

/* --------------------------------- Colour --------------------------------- */

function mix(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

interface Palette {
  sky: [string, string];
  far: string;
  mid: string;
  fields: [string, string];
  near: string;
  leaves: string[];
  conifer: string;
  road: string;
}

const SEASONS: Record<Season, Palette> = {
  spring: {
    sky: ["#8ec5ee", "#dcf0fb"],
    far: "#9fb9b0",
    mid: "#8cc27a",
    fields: ["#a9d27f", "#e2df8e"],
    near: "#62a05a",
    leaves: ["#77b562", "#8cc46c", "#f2b8c9"],
    conifer: "#3f7a50",
    road: "#eadbb8",
  },
  summer: {
    sky: ["#6db4ea", "#d2ecfb"],
    far: "#94aec2",
    mid: "#82b35e",
    fields: ["#e4c65c", "#9fc866"],
    near: "#4f8f47",
    leaves: ["#4c8d44", "#5f9c4c", "#3f7f3e"],
    conifer: "#335f3f",
    road: "#e8d5a8",
  },
  autumn: {
    sky: ["#93b8da", "#f2e3c9"],
    far: "#a9a8ba",
    mid: "#b8a35c",
    fields: ["#d49c4b", "#8f6c4b"],
    near: "#8a7b3e",
    leaves: ["#d9772c", "#e4a53c", "#b6462f", "#c98b30"],
    conifer: "#3f6a4a",
    road: "#ddcba4",
  },
  winter: {
    sky: ["#b2cbe2", "#eef3f8"],
    far: "#c6d2df",
    mid: "#eef2f7",
    fields: ["#f6f8fb", "#e2e8f1"],
    near: "#f3f6fa",
    leaves: ["#2f5642"],
    conifer: "#2f5642",
    road: "#dfe5ee",
  },
};

const SKY: Record<Exclude<Phase, "day">, [string, string]> = {
  dawn: ["#8fa6d8", "#ffd3b2"],
  dusk: ["#6c6fae", "#ffb27c"],
  night: ["#0f1733", "#2c3b68"],
};

/** The light of the hour over the season's colours. */
function light(phase: Phase) {
  if (phase === "night") return (c: string) => mix(c, "#1a2446", 0.62);
  if (phase === "dusk") return (c: string) => mix(c, "#e98a55", 0.16);
  if (phase === "dawn") return (c: string) => mix(c, "#ffcfb4", 0.12);
  return (c: string) => c;
}

/* ---------------------------------- Scene --------------------------------- */

export interface House {
  x: number;
  y: number;
  w: number;
  h: number;
  roof: number;
  wall: string;
  roofColor: string;
  windows: { x: number; y: number }[];
  chimney?: boolean;
}

export interface Tree {
  x: number;
  y: number;
  size: number;
  kind: "round" | "conifer";
  color: string;
  blossom?: boolean;
}

export interface Scene {
  season: Season;
  phase: Phase;
  sky: [string, string];
  sun?: { x: number; y: number; r: number; color: string };
  moon?: { x: number; y: number; r: number };
  stars: { x: number; y: number; r: number; o: number }[];
  clouds: { x: number; y: number; w: number; o: number; color: string }[];
  birds: { x: number; y: number; s: number }[];
  far: { d: string; fill: string };
  mid: { d: string; fill: string; fields: { d: string; fill: string }[] };
  near: { d: string; fill: string };
  road: { d: string; fill: string };
  houses: House[];
  church: { x: number; y: number; w: number; h: number; tower: number; wall: string; roof: string; dome: boolean; window: boolean };
  trees: Tree[];
  snow: { x: number; y: number; r: number }[];
  smoke: { x: number; y: number } | null;
  windowsLit: boolean;
  trunk: string;
  place: Place;
}

export interface Place {
  /** As it's written on the address side. */
  name: string;
  /** "Pozdrav …" in Czech needs the right preposition and case. */
  csFrom: string;
}

export const PLACES: Place[] = [
  { name: "Horní Lhota", csFrom: "z Horní Lhoty" },
  { name: "Dolní Lhota", csFrom: "z Dolní Lhoty" },
  { name: "Lhota pod Lesem", csFrom: "z Lhoty pod Lesem" },
  { name: "Lhotka", csFrom: "z Lhotky" },
  { name: "Nová Ves", csFrom: "z Nové Vsi" },
  { name: "Stará Ves", csFrom: "ze Staré Vsi" },
  { name: "Zálesí", csFrom: "ze Zálesí" },
  { name: "Podhradí", csFrom: "z Podhradí" },
  { name: "Újezd", csFrom: "z Újezdu" },
  { name: "Bukovina", csFrom: "z Bukoviny" },
  { name: "Kopaniny", csFrom: "z Kopanin" },
  { name: "Zahrádky", csFrom: "ze Zahrádek" },
  { name: "Paseky", csFrom: "z Pasek" },
  { name: "Hájek", csFrom: "z Hájku" },
  { name: "Mlýnec", csFrom: "z Mlýnce" },
  { name: "Dubová", csFrom: "z Dubové" },
];

/** A ridge line: heights sampled across the width, and the closed hill shape under it. */
function ridge(r: Rand, base: number, amp: number, freq: number) {
  const n1 = noise(r);
  const n2 = noise(r);
  const off = r() * 40;
  const ys: number[] = [];
  for (let x = 0; x <= W; x += 10) ys.push(base - amp * (0.65 * n1(off + x * freq) + 0.35 * n2(off + x * freq * 2.3)));
  const at = (x: number) => {
    const i = Math.min(ys.length - 2, Math.max(0, Math.floor(x / 10)));
    const f = (x - i * 10) / 10;
    return ys[i] + (ys[i + 1] - ys[i]) * f;
  };
  return { line: smoothLine(ys), at };
}

/** A smooth path through points spaced 10 apart (midpoint quadratics). */
function smoothLine(ys: number[]) {
  let d = `M-2 ${round(ys[0])}`;
  for (let i = 0; i < ys.length - 1; i++) {
    const x = i * 10;
    d += ` Q${x} ${round(ys[i])} ${x + 5} ${round((ys[i] + ys[i + 1]) / 2)}`;
  }
  return `${d} L${W + 2} ${round(ys[ys.length - 1])}`;
}

const closed = (line: string) => `${line} L${W + 2} ${H + 2} L-2 ${H + 2} Z`;

export function buildScene(at: Date, key = dayKey(at)): Scene {
  const r = mulberry32(hash(`kolbaba-postcard-${key}`));
  const season = seasonOf(at);
  const phase = phaseOf(at);
  const pal = SEASONS[season];
  const lit = light(phase);
  const winter = season === "winter";

  const far = ridge(r, between(r, 112, 124), between(r, 16, 26), 0.012);
  const mid = ridge(r, between(r, 140, 148), between(r, 10, 16), 0.016);
  const near = ridge(r, between(r, 176, 182), between(r, 8, 13), 0.02);

  // Fields: slanted bands across the middle hill, every other one a different crop.
  const fields: Scene["mid"]["fields"] = [];
  const slant = between(r, -0.5, 0.5);
  let fx = -60;
  let alt = 0;
  while (fx < W + 60) {
    const w = between(r, 24, 46);
    fields.push({
      d: `M${round(fx)} ${H} L${round(fx + slant * 80)} 100 L${round(fx + w + slant * 80)} 100 L${round(fx + w)} ${H} Z`,
      fill: lit(pal.fields[alt % 2]),
    });
    fx += w;
    alt++;
  }

  // The village sits on the middle hill, the road climbs to it from the bottom of the card.
  const vx = between(r, 85, 215);
  const vy = mid.at(vx) + 3;
  const roofs = ["#b5533c", "#9c4a3a", "#c4673f", "#7d5a4d"];
  const walls = ["#f4ecdc", "#efe4cf", "#f7f1e6", "#e9dcc4"];
  const houses: House[] = [];
  const count = 3 + Math.floor(r() * 4);
  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = vx + side * (10 + Math.floor(i / 2) * between(r, 12, 17)) + between(r, -3, 3);
    const w = between(r, 9, 13);
    const h = between(r, 6, 8.5);
    houses.push({
      x: round(x - w / 2),
      y: round(mid.at(x) + 3 - h),
      w: round(w),
      h: round(h),
      roof: round(between(r, 4, 6.5)),
      wall: lit(pick(r, walls)),
      roofColor: lit(pick(r, roofs)),
      windows: Array.from({ length: w > 11 ? 2 : 1 }, (_, k) => ({ x: round(x - w / 2 + (w > 11 ? 2.5 + k * 4.5 : w / 2 - 1)), y: round(mid.at(x) + 3 - h + 2.5) })),
      chimney: r() < 0.5,
    });
  }
  const church = {
    x: round(vx - 5),
    y: round(vy - 11),
    w: 10,
    h: 11,
    tower: round(between(r, 12, 16)),
    wall: lit("#f6efe2"),
    roof: lit(pick(r, ["#5f6b74", "#7a5a48", "#4f6a5c"])),
    dome: r() < 0.55,
    window: true,
  };

  const rx = between(r, 120, 180);
  const c1 = between(r, -40, 40);
  const road = {
    d: `M${round(rx - 18)} ${H + 2} C${round(rx - 14 + c1)} ${H - 22} ${round(vx - 6 - c1 * 0.6)} ${round(vy + 22)} ${round(vx - 1.2)} ${round(vy + 2)} L${round(vx + 1.2)} ${round(vy + 2)} C${round(vx + 6 - c1 * 0.6)} ${round(vy + 22)} ${round(rx + 14 + c1)} ${H - 22} ${round(rx + 18)} ${H + 2} Z`,
    fill: lit(pal.road),
  };

  // Trees on the near hill, out of the road's way, and a few small ones around the village.
  const trees: Tree[] = [];
  const nearCount = 6 + Math.floor(r() * 5);
  for (let i = 0; i < nearCount; i++) {
    let x = between(r, 6, W - 6);
    if (Math.abs(x - rx) < 26) x += x < rx ? -26 : 26;
    const kind = winter || r() < 0.35 ? "conifer" : "round";
    trees.push({
      x: round(x),
      y: round(near.at(x) + 2),
      size: round(between(r, 10, 16)),
      kind,
      color: lit(kind === "conifer" ? pal.conifer : pick(r, pal.leaves.filter((c) => c !== "#f2b8c9"))),
      blossom: season === "spring" && kind === "round" && r() < 0.6,
    });
  }
  for (let i = 0; i < 3 + Math.floor(r() * 3); i++) {
    const x = vx + (i % 2 ? 1 : -1) * between(r, 34, 70);
    const kind = winter || r() < 0.5 ? "conifer" : "round";
    trees.push({ x: round(x), y: round(mid.at(x) + 3), size: round(between(r, 4.5, 6.5)), kind, color: lit(kind === "conifer" ? pal.conifer : pal.leaves[0]) });
  }
  trees.sort((a, b) => a.y - b.y);

  const sky: [string, string] = phase === "day" ? pal.sky : SKY[phase];
  const progress = dayProgress(at);
  const sun =
    phase === "day"
      ? { x: round(30 + progress * 240), y: round(78 - Math.sin(progress * Math.PI) * 50), r: 11, color: "#fff3c4" }
      : phase === "dawn"
        ? { x: round(between(r, 50, 90)), y: 100, r: 12, color: "#ffd59c" }
        : phase === "dusk"
          ? { x: round(between(r, 210, 250)), y: 98, r: 12, color: "#ffb06a" }
          : undefined;
  const moon = phase === "night" ? { x: round(between(r, 200, 260)), y: round(between(r, 32, 52)), r: 9 } : undefined;
  const stars =
    phase === "night"
      ? Array.from({ length: 34 }, () => ({ x: round(between(r, 4, W - 4)), y: round(between(r, 4, 108)), r: round(between(r, 0.4, 1.1)), o: round(between(r, 0.35, 0.95)) }))
      : [];
  const cloudColor = phase === "dusk" ? "#ffd9c4" : phase === "dawn" ? "#ffe8dc" : phase === "night" ? "#55608a" : "#ffffff";
  const clouds = Array.from({ length: 2 + Math.floor(r() * 2) }, (_, i) => ({
    x: round(between(r, 10, 230) + i * 20),
    y: round(between(r, 22, 70)),
    w: round(between(r, 34, 58)),
    o: phase === "night" ? 0.35 : between(r, 0.7, 0.92),
    color: cloudColor,
  }));
  const birds = phase === "day" && !winter ? Array.from({ length: 2 + Math.floor(r() * 2) }, () => ({ x: round(between(r, 40, 260)), y: round(between(r, 30, 80)), s: round(between(r, 2.2, 3.4)) })) : [];
  const snow = winter ? Array.from({ length: 46 }, () => ({ x: round(between(r, 0, W)), y: round(between(r, 0, H)), r: round(between(r, 0.6, 1.5)) })) : [];
  const chimney = houses.find((h) => h.chimney);
  const smoke = chimney && (winter || season === "autumn" || phase === "dusk" || phase === "night") ? { x: round(chimney.x + chimney.w - 3), y: round(chimney.y - chimney.roof - 3) } : null;

  return {
    season,
    phase,
    sky,
    sun,
    moon,
    stars,
    clouds,
    birds,
    far: { d: closed(far.line), fill: lit(pal.far) },
    mid: { d: closed(mid.line), fill: lit(pal.mid), fields },
    near: { d: closed(near.line), fill: lit(pal.near) },
    road,
    houses,
    church,
    trees,
    snow,
    smoke,
    windowsLit: phase === "dusk" || phase === "night",
    trunk: lit("#6b4f3a"),
    place: PLACES[hash(`kolbaba-place-${key}`) % PLACES.length],
  };
}

/** Today's line on the back, the same all day. */
export function pickLine<T>(key: string, lines: readonly T[]): T {
  return lines[hash(`kolbaba-line-${key}`) % lines.length];
}

/** "Padla!" (Czech for knocking off): a workday afternoon, when Inbox is empty. */
export function isPadla(d: Date) {
  const day = d.getDay();
  const h = d.getHours();
  return day >= 1 && day <= 5 && h >= 15 && h < 21;
}

export const SEASONS_ORDER: Season[] = ["spring", "summer", "autumn", "winter"];

/** Every postcard there is to collect: each village, once per season. */
export const POSTCARD_TOTAL = PLACES.length * SEASONS_ORDER.length;

/** Today's postcard in the collection: which village and season, and the day and hour to draw it again. */
export function postcardKey(at: Date) {
  const place = buildScene(at).place;
  return { key: `${place.name}|${seasonOf(at)}`, at: `${dayKey(at)}T${String(at.getHours()).padStart(2, "0")}` };
}

/** The moment a collected postcard was drawn ("2026-12-21T16"), to draw it the same way again. */
export const postcardDate = (at: string) => new Date(`${at}:30:00`);
