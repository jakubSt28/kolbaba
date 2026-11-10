"use client";

import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Dialog } from "radix-ui";
import { useMemo, useState } from "react";
import { t, tk } from "@/lib/i18n";
import { buildScene, PLACES, POSTCARD_TOTAL, postcardDate, SEASONS_ORDER, type Season } from "@/lib/postcard";
import { useMail } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Postcard, PostcardArt } from "./postcard";
import { StampAlbum } from "./stamps";
import { Segmented } from "./ui";

/**
 * Kolbaba's collection: the stamp album, and the postcards he brought for an empty Inbox. Its own
 * window, reached from the sidebar's foot, ⌘K, Settings → Account and the "new stamp" card.
 */
export function CollectionHost() {
  const tab = useMail((s) => s.collectionOpen);
  const setOpen = useMail((s) => s.setCollectionOpen);
  return (
    <Dialog.Root open={!!tab} onOpenChange={(o) => !o && setOpen(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/20 data-[state=open]:animate-[fade-in_140ms_ease-out] dark:bg-black/45" />
        <Dialog.Content
          aria-describedby={undefined}
          className="sheet fixed top-1/2 left-1/2 z-50 flex max-h-[min(760px,calc(100dvh-32px))] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[22px] outline-none data-[state=open]:animate-[dialog-in_180ms_cubic-bezier(0.32,0.72,0,1)]"
        >
          <div className="flex items-center gap-3 px-5 pt-5 pb-3">
            <Dialog.Title className="flex-1 text-[16px] font-semibold tracking-[-0.01em]">{t("Collection")}</Dialog.Title>
            <Dialog.Close aria-label={t("Close")} className="flex size-8 items-center justify-center rounded-full text-ink-3 hover:bg-hover hover:text-ink">
              <X size={16} />
            </Dialog.Close>
          </div>
          <div className="px-5 pb-3">
            <Segmented
              id="collection-tab"
              value={tab || "stamps"}
              options={[
                { value: "stamps", label: t("Stamps") },
                { value: "postcards", label: t("Postcards") },
              ]}
              onChange={(v) => setOpen(v)}
            />
          </div>
          <div className="relative min-h-0 flex-1 overflow-y-auto px-5 pb-5">{tab === "postcards" ? <PostcardAlbum /> : <StampAlbum />}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const SEASON_LABELS: Record<Season, string> = {
  spring: tk("Spring"),
  summer: tk("Summer"),
  autumn: tk("Autumn"),
  winter: tk("Winter"),
};

/**
 * Every postcard there is: each village once per season, 64 in all. The ones that came show as
 * they were drawn that day and hour; the rest are outlines with the village's name.
 */
function PostcardAlbum() {
  const postcards = useMail((s) => s.postcards);
  const [open, setOpen] = useState<string | null>(null);
  const collected = Object.keys(postcards).length;
  return (
    <div>
      <div className="mb-4 rounded-[14px] bg-solid/70 px-3.5 py-3 shadow-[inset_0_0_0_0.5px_var(--line)]">
        <div className="text-[14px] font-semibold">{t("{n} of {total} collected", { n: collected, total: POSTCARD_TOTAL })}</div>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-3">
          {t("Empty your Inbox and Kolbaba brings a postcard from a different village every day. Each village sends one per season.")}
        </p>
      </div>
      {SEASONS_ORDER.map((season) => {
        const inSeason = PLACES.filter((p) => postcards[`${p.name}|${season}`]).length;
        return (
          <section key={season} className="mb-5 last:mb-0">
            <div className="mb-2 flex items-baseline justify-between px-0.5">
              <h3 className="text-[13px] font-semibold">{t(SEASON_LABELS[season])}</h3>
              <span className="text-[12px] text-ink-3 tabular-nums">
                {inSeason} / {PLACES.length}
              </span>
            </div>
            <ul className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
              {PLACES.map((place) => {
                const key = `${place.name}|${season}`;
                const at = postcards[key];
                return (
                  <li key={key} className="min-w-0">
                    {at ? (
                      <button onClick={() => setOpen(key)} className="press block w-full [--press-scale:0.96]" aria-label={t("Open the postcard from {place}", { place: place.name })}>
                        <Thumb at={at} />
                      </button>
                    ) : (
                      <div className="aspect-[3/2.08] rounded-[6px] shadow-[inset_0_0_0_1px_var(--line)] [background:repeating-linear-gradient(135deg,transparent_0_6px,var(--hover)_6px_7px)]" />
                    )}
                    <div className={cn("mt-1 truncate text-[11px]", at ? "text-ink-2" : "text-ink-3")}>{place.name}</div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <AnimatePresence>
        {open && postcards[open] && (
          <motion.div
            key="lightbox"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(null)}
            className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/45 p-5 backdrop-blur-sm"
          >
            <div className="w-full max-w-[560px]" onClick={(e) => e.stopPropagation()}>
              <Postcard at={postcardDate(postcards[open])} />
            </div>
            <div className="mt-4 text-[12.5px] text-white/80">{t("Tap the card to turn it over, anywhere else to close")}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A collected postcard, small: the picture side as it was drawn when it came. */
function Thumb({ at }: { at: string }) {
  const scene = useMemo(() => buildScene(postcardDate(at)), [at]);
  return (
    <div className="aspect-[3/2.08] rounded-[6px] bg-[var(--paper)] p-[3px] shadow-[0_1px_2px_rgb(0_0_0/0.15),0_4px_10px_-4px_rgb(0_0_0/0.25)]">
      <div className="size-full overflow-hidden rounded-[3px]">
        <PostcardArt scene={scene} lite />
      </div>
    </div>
  );
}
