"use client";

import { X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { intlLocale, t } from "@/lib/i18n";
import { STAMPS, type StampDef, type StampId } from "@/lib/stamps";
import { useMail } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Postmark, StampArt } from "./stamp-art";

/* ---------------------------------- Album ---------------------------------- */

/**
 * Kolbaba's stamp album, a tab of What's new and tips: what's collected (cancelled with the day it
 * came), what's still to find, and question marks for the surprises.
 */
export function StampAlbum() {
  const stamps = useMail((s) => s.stamps);
  const counts = useMail((s) => s.stampCounts);
  const trackers = useMail((s) => s.stats?.trackersTotal ?? 0);
  const markStampsSeen = useMail((s) => s.markStampsSeen);
  const loadStats = useMail((s) => s.loadStats);
  // What was new when the album opened stays marked while it's open.
  const [seenBefore] = useState(() => useMail.getState().stampsSeen);
  useEffect(() => {
    markStampsSeen();
    void loadStats();
  }, [markStampsSeen, loadStats]);

  const collected = STAMPS.filter((d) => stamps[d.id]).length;
  return (
    <div>
      <div className="mb-4 rounded-[14px] bg-solid/70 px-3.5 py-3 shadow-[inset_0_0_0_0.5px_var(--line)]">
        <div className="text-[14px] font-semibold">{t("{n} of {total} collected", { n: collected, total: STAMPS.length })}</div>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-3">{t("Small moments, kept as stamps. A few of them are a surprise.")}</p>
      </div>
      <ul className="grid grid-cols-3 gap-x-2 gap-y-5 sm:grid-cols-4">
        {STAMPS.map((def) => (
          <AlbumSlot key={def.id} def={def} at={stamps[def.id]} isNew={!!stamps[def.id] && stamps[def.id] > seenBefore} progress={def.id === "spy-catcher" ? trackers : def.counter ? (counts[def.counter] ?? 0) : undefined} />
        ))}
      </ul>
    </div>
  );
}

function AlbumSlot({ def, at, isNew, progress }: { def: StampDef; at?: number; isNew: boolean; progress?: number }) {
  const mystery = def.hidden && !at;
  // A hand-placed look: each stamp sits at its own small angle.
  const tilt = ((def.no * 37) % 7) - 3;
  return (
    <li className="flex flex-col items-center text-center">
      <div className={cn("relative", at ? "text-ink" : "text-ink-3")} style={{ rotate: `${at ? tilt : 0}deg` }}>
        <StampArt id={def.id} width={66} muted={!at}  />
        {mystery && <span className="absolute inset-0 flex items-center justify-center text-[24px] font-bold opacity-40">?</span>}
        {at && (
          <Postmark place="Kolbaba" date={new Date(at)} size={38} waves={false} className="absolute -right-3 -bottom-2 -rotate-12 text-[var(--paper-ink)] opacity-60 dark:text-white/70" />
        )}
        {isNew && <span className="absolute -top-2 -right-2.5 rounded-full bg-accent px-1.5 py-px text-[10px] font-semibold text-on-accent">{t("New@@stamp")}</span>}
      </div>
      <div className={cn("mt-2 text-[12.5px] leading-tight font-medium", !at && "text-ink-2")}>{mystery ? t("A surprise") : t(def.name)}</div>
      <div className="mt-0.5 text-[11px] leading-snug text-ink-3">
        {mystery ? t("You'll know it when it happens.") : t(def.how)}
        {!at && def.goal && progress !== undefined && (
          <span className="mt-0.5 block font-medium text-ink-2 tabular-nums">
            {Math.min(progress, def.goal)} / {def.goal}
          </span>
        )}
        {at && <span className="mt-0.5 block">{new Intl.DateTimeFormat(intlLocale(), { day: "numeric", month: "short", year: "numeric" }).format(new Date(at))}</span>}
      </div>
    </li>
  );
}

/* ------------------------------- New stamp card ------------------------------- */

/**
 * A stamp just came: it slides in, a postmark lands on it, and after a few seconds the card goes.
 * Never over a window or while writing; NewsHost gives it the card slot.
 */
export function StampCard({ id, mobile }: { id: StampId; mobile: boolean }) {
  const dismiss = useMail((s) => s.dismissStampCard);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hold = () => clearTimeout(timer.current);
  const later = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(dismiss, 6000);
  };
  useEffect(() => {
    later();
    return hold;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const def = STAMPS.find((d) => d.id === id)!;
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12 }}
      transition={{ type: "spring", stiffness: 300, damping: 32 }}
      role="status"
      onPointerEnter={hold}
      onPointerLeave={later}
      className={cn("glass-strong fixed z-40 flex gap-3.5 rounded-[20px] p-4", mobile ? "inset-x-2.5 bottom-[calc(88px+var(--safe-bottom))]" : "right-5 bottom-5 w-[360px]")}
    >
      <button onClick={dismiss} aria-label={t("Close")} className="absolute top-3 right-3 flex size-7 items-center justify-center rounded-lg text-ink-3 hover:bg-hover hover:text-ink">
        <X size={14} />
      </button>
      <div className="relative shrink-0">
        <motion.div initial={{ x: 26, rotate: 18, opacity: 0, scale: 0.85 }} animate={{ x: 0, rotate: -4, opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.1 }}>
          <StampArt id={id} width={56} />
        </motion.div>
        <motion.div
          className="absolute -right-3 -bottom-2"
          initial={{ scale: 1.9, opacity: 0, rotate: -30 }}
          animate={{ scale: 1, opacity: 0.7, rotate: -12 }}
          transition={{ type: "spring", stiffness: 900, damping: 26, mass: 0.6, delay: 0.55 }}
        >
          <Postmark place="Kolbaba" date={new Date()} size={36} waves={false} className="text-[var(--paper-ink)] dark:text-white/75" />
        </motion.div>
      </div>
      <div className="min-w-0 flex-1 pr-6">
        <div className="text-[11.5px] font-medium text-ink-3">{t("New stamp")}</div>
        <div className="mt-0.5 text-[14px] font-semibold">{t(def.name)}</div>
        <p className="mt-0.5 text-[12.5px] leading-snug text-ink-2">{t(def.how)}</p>
        <button
          onClick={() => {
            dismiss();
            useMail.getState().setCollectionOpen("stamps");
          }}
          className="press mt-2 text-[12.5px] font-medium text-accent-text hover:underline"
        >
          {t("Open the album")}
        </button>
      </div>
    </motion.div>
  );
}
