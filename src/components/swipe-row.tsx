"use client";

import { Archive, ArchiveRestore, Clock, Inbox, Mail, MailOpen, Pin, ShieldCheck, Trash2, type LucideIcon } from "lucide-react";
import { AnimatePresence, animate, motion, useIsPresent, useMotionValue, useMotionValueEvent, useTransform } from "motion/react";
import { memo, useEffect, useRef, useSyncExternalStore } from "react";
import { create } from "zustand";
import { haptic } from "@/lib/haptics";
import { t, tk, tn } from "@/lib/i18n";
import { isBin, useMail } from "@/lib/store";
import type { Draft, SwipeAction, Thread } from "@/lib/types";
import { track } from "@/lib/usage";
import { cn, formatFuture, snoozePresets } from "@/lib/utils";
import { DraftRow, ThreadRow } from "./message-list";
import { askDeleteForever, canDeleteForever } from "./thread-actions";

/** Touch-first device (phone, tablet without a trackpad): swipes and long-press instead of hover and ⌘-click. */
export function useCoarsePointer() {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia("(pointer: coarse)");
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    () => window.matchMedia("(pointer: coarse)").matches,
    () => false,
  );
}

/** English; show with t(). */
export const SWIPE_LABELS: Record<SwipeAction, string> = {
  archive: tk("Archive"),
  trash: tk("Delete"),
  pin: tk("Pin"),
  read: tk("Read / Unread"),
  snooze: tk("Snooze"),
  none: tk("Nothing"),
};

export const SWIPE_ICONS: Record<SwipeAction, LucideIcon | null> = {
  archive: Archive,
  trash: Trash2,
  pin: Pin,
  read: MailOpen,
  snooze: Clock,
  none: null,
};

interface Resolved {
  label: string;
  icon: LucideIcon;
  /** Background behind the row while swiping. */
  tone: string;
  run: () => void;
  /** The row flies out (it leaves this list) instead of springing back. */
  leaves: boolean;
}

/**
 * What a swipe does on this row. The setting says the intent; the row's folder decides the details
 * (Archive in Archive means back to Inbox). Trash and Spam have fixed swipes: right brings the
 * conversation back, left deletes it.
 */
function resolve(action: SwipeAction, thread: Thread, side: "left" | "right"): Resolved | null {
  const s = useMail.getState();
  const id = thread.id;
  if (isBin(thread.folder)) {
    if (side === "right") {
      return thread.folder === "spam"
        ? { label: t("Not spam"), icon: ShieldCheck, tone: "bg-success text-white", run: () => s.moveToInbox(id), leaves: true }
        : { label: t("Restore"), icon: ArchiveRestore, tone: "bg-success text-white", run: () => s.moveToInbox(id), leaves: true };
    }
    if (thread.folder === "spam") return { label: t("Delete"), icon: Trash2, tone: "bg-danger text-white", run: () => s.trash(id, null), leaves: true };
    if (!canDeleteForever(thread, s.accounts)) return null;
    return { label: t("Delete forever"), icon: Trash2, tone: "bg-danger text-white", run: () => askDeleteForever([id]), leaves: false };
  }
  switch (action) {
    case "archive":
      return thread.folder === "archive"
        ? { label: t("Inbox"), icon: Inbox, tone: "bg-accent text-on-accent", run: () => s.moveToInbox(id), leaves: true }
        : { label: t("Archive"), icon: Archive, tone: "bg-success text-white", run: () => s.archive(id, null), leaves: true };
    case "trash":
      return { label: t("Delete"), icon: Trash2, tone: "bg-danger text-white", run: () => s.trash(id, null), leaves: true };
    case "pin":
      // In the pin colour, like the pins in the list (the app colour is often near black).
      return { label: thread.pinned ? t("Unpin") : t("Pin"), icon: Pin, tone: "bg-pin text-white", run: () => s.togglePin(id), leaves: false };
    case "read":
      return {
        label: thread.unread ? t("Read") : t("Unread"),
        icon: thread.unread ? MailOpen : Mail,
        tone: "bg-[oklch(0.6_0.15_250)] text-white",
        run: () => s.setUnread(id, !thread.unread),
        leaves: false,
      };
    case "snooze":
      return { label: t("Snooze"), icon: Clock, tone: "bg-warning text-white", run: () => openSnoozeSheet([id]), leaves: false };
    case "none":
      return null;
  }
}

const THRESHOLD = 88;
const LONG_PRESS_MS = 420;

/**
 * A list row for touch: swipe left or right for the actions picked in Settings, long-press to start
 * selecting (then taps toggle rows). Used by the phone list and by the desktop layout on tablets.
 */
export const SwipeRow = memo(function SwipeRow({ thread, desktop = false }: { thread: Thread; desktop?: boolean }) {
  const openThread = useMail((s) => s.openThread);
  const checkThread = useMail((s) => s.checkThread);
  const selecting = useMail((s) => s.checked.length > 0);
  const checked = useMail((s) => s.checked.includes(thread.id));
  const swipeLeft = useMail((s) => s.swipeLeft);
  const swipeRight = useMail((s) => s.swipeRight);
  // In Inbox's Pinned group the row takes the group's sticky-note colour (mobile-shell.tsx).
  const pinnedGroup = useMail((s) => s.folder === "inbox") && thread.pinned;
  return (
    <Swipeable
      id={thread.id}
      left={resolve(swipeLeft, thread, "left")}
      right={resolve(swipeRight, thread, "right")}
      desktop={desktop}
      face={pinnedGroup ? "bg-pin-soft" : "bg-solid"}
    >
      <ThreadRow
        thread={thread}
        forceInactive={!desktop || selecting}
        selectMode={selecting}
        checked={checked}
        onOpen={() => (selecting ? checkThread(thread.id, "tap", []) : openThread(thread.id))}
      />
    </Swipeable>
  );
});

/** A draft in the Drafts list on touch: swipe left to delete it, long-press to select several. */
export const SwipeDraftRow = memo(function SwipeDraftRow({ draft, desktop = false }: { draft: Draft; desktop?: boolean }) {
  const openDraft = useMail((s) => s.openDraft);
  const checkThread = useMail((s) => s.checkThread);
  const selecting = useMail((s) => s.checked.length > 0);
  const checked = useMail((s) => s.checked.includes(draft.id));
  const left: Resolved = {
    label: t("Delete"),
    icon: Trash2,
    tone: "bg-danger text-white",
    run: () => useMail.getState().discardDrafts([draft.id]),
    leaves: true,
  };
  return (
    <Swipeable id={draft.id} left={left} right={null} desktop={desktop} face="bg-solid">
      <DraftRow
        draft={draft}
        selectMode={selecting}
        checked={checked}
        forceInactive={!desktop || selecting}
        onOpen={() => (selecting ? checkThread(draft.id, "tap", []) : openDraft(draft.id))}
      />
    </Swipeable>
  );
});

function Swipeable({
  id,
  left,
  right,
  desktop,
  face,
  children,
}: {
  id: string;
  left: Resolved | null;
  right: Resolved | null;
  desktop: boolean;
  /** The row's background on the phone, over the action colour while it moves. */
  face: string;
  children: React.ReactNode;
}) {
  const checkThread = useMail((s) => s.checkThread);
  const selecting = useMail((s) => s.checked.length > 0);

  const x = useMotionValue(0);
  // Motion shifts a dragged element along with any layout change under it, on both axes even when it
  // only moves sideways, and keeps the vertical part afterwards: the row's content then sits half out
  // of its slot. Handing it a y of its own that nothing reads keeps the row where it belongs.
  const ignoredY = useMotionValue(0);
  const isPresent = useIsPresent();
  const present = useRef(true);
  useEffect(() => {
    present.current = isPresent;
  }, [isPresent]);
  const busy = useRef(false);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const leftOpacity = useTransform(x, [-100, -24], [1, 0]);
  const rightOpacity = useTransform(x, [24, 100], [0, 1]);
  // Past the threshold the action is armed: its icon pops and the phone taps, like Mail on iPhone.
  const pop = useMotionValue(1);
  const armed = useRef<"left" | "right" | null>(null);
  useMotionValueEvent(x, "change", (v) => {
    const side = v <= -THRESHOLD && left ? "left" : v >= THRESHOLD && right ? "right" : null;
    if (side === armed.current) return;
    armed.current = side;
    if (!side) return;
    haptic("tick");
    pop.set(1.3);
    void animate(pop, 1, { type: "spring", stiffness: 520, damping: 12 });
  });
  const leftScale = useTransform(() => Math.min(1, Math.max(0.6, 0.6 + ((-x.get() - 56) / 84) * 0.4)) * pop.get());
  const rightScale = useTransform(() => Math.min(1, Math.max(0.6, 0.6 + ((x.get() - 56) / 84) * 0.4)) * pop.get());
  // Desktop rows are see-through glass; while moving, the row needs a solid face over the colour.
  const faceOpacity = useTransform(x, (v) => (v === 0 ? 0 : 1));

  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };

  return (
    <div
      className="relative [-webkit-touch-callout:none] select-none"
      onPointerDown={(e) => {
        if (e.pointerType === "mouse") return;
        busy.current = false;
        cancelPress();
        press.current = {
          x: e.clientX,
          y: e.clientY,
          timer: setTimeout(() => {
            press.current = null;
            busy.current = true;
            if (!useMail.getState().checked.includes(id)) checkThread(id, "tap", []);
            haptic("tick");
          }, LONG_PRESS_MS),
        };
      }}
      onPointerMove={(e) => {
        const p = press.current;
        if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) cancelPress();
      }}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onContextMenu={(e) => e.preventDefault()}
      // The click that ends a long-press or a drag isn't a tap.
      onClickCapture={(e) => {
        if (!busy.current) return;
        busy.current = false;
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      <div className={cn("absolute inset-0 flex overflow-hidden", desktop && "rounded-[12px]")}>
        {right && (
          <motion.div style={{ opacity: rightOpacity }} className={cn("flex flex-1 items-center pl-6", right.tone)}>
            <motion.span style={{ scale: rightScale }} className="flex flex-col items-center gap-0.5 text-[11px] font-medium">
              <right.icon size={20} />
              {right.label}
            </motion.span>
          </motion.div>
        )}
        {left && (
          <motion.div style={{ opacity: leftOpacity }} className={cn("flex flex-1 items-center justify-end pr-6", left.tone)}>
            <motion.span style={{ scale: leftScale }} className="flex flex-col items-center gap-0.5 text-[11px] font-medium">
              <left.icon size={20} />
              {left.label}
            </motion.span>
          </motion.div>
        )}
      </div>
      <motion.div
        drag={selecting || (!left && !right) ? false : "x"}
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: left ? 0.9 : 0, right: right ? 0.6 : 0 }}
        // Back into place quickly and without wobbling when let go short of the threshold.
        dragTransition={{ bounceStiffness: 620, bounceDamping: 42 }}
        _dragY={ignoredY}
        style={{ x }}
        onDragStart={() => {
          cancelPress();
          busy.current = true;
        }}
        onDragEnd={(_, info) => {
          setTimeout(() => (busy.current = false), 60);
          const action = info.offset.x < -THRESHOLD || info.velocity.x < -800 ? left : info.offset.x > THRESHOLD ? right : null;
          if (!action) return;
          if (action.leaves) {
            const out = info.offset.x < 0 ? -window.innerWidth : window.innerWidth;
            // It carries on at the finger's speed: a flick flies off fast, a slow pull glides out.
            const speed = Math.max(Math.abs(info.velocity.x), 1400);
            const duration = Math.min(0.24, Math.max(0.12, Math.abs(out - x.get()) / speed));
            void animate(x, out, { duration, ease: [0.25, 0.6, 0.4, 1] }).then(() => {
              action.run();
              // It leaves the list now. If it's still here a moment later (the action failed), it slides back.
              setTimeout(() => present.current && void animate(x, 0, { type: "spring", stiffness: 420, damping: 38 }), 400);
            });
          } else {
            // Pin and read stay in the list with no toast: the tap tells the finger it happened.
            haptic("soft");
            action.run();
          }
          useMail.getState().markTried("swipe");
          track("swipe");
        }}
        className={cn("relative", desktop ? "rounded-[12px]" : cn("px-1.5 py-0.5", face))}
      >
        {desktop && <motion.div style={{ opacity: faceOpacity }} className="absolute inset-0 rounded-[12px] bg-solid" />}
        <div className="relative">{children}</div>
      </motion.div>
    </div>
  );
}

/* ------------------------------ Snooze sheet ------------------------------- */

const useSnoozeSheet = create<{ ids: string[] | null }>(() => ({ ids: null }));

/** Snooze from a swipe or the touch selection bar: a sheet with the usual times. */
export function openSnoozeSheet(ids: string[]) {
  useSnoozeSheet.setState({ ids });
}

export function closeSnoozeSheet() {
  useSnoozeSheet.setState({ ids: null });
}

export function SnoozeSheetHost() {
  const ids = useSnoozeSheet((s) => s.ids);
  const close = () => useSnoozeSheet.setState({ ids: null });
  const pick = (at: number) => {
    if (!ids) return;
    const s = useMail.getState();
    if (ids.length === 1) s.snooze(ids[0], at, null);
    else s.snoozeMany(ids, at);
    close();
  };
  return (
    <AnimatePresence>
      {ids && (
        <>
          <motion.div
            key="snooze-scrim"
            className="fixed inset-0 z-50 bg-black/25"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
          />
          <motion.div
            key="snooze-sheet"
            className="glass-strong fixed inset-x-2 bottom-2 z-50 mx-auto max-w-[420px] rounded-[26px] p-2 pb-[max(8px,var(--safe-bottom))]"
            initial={{ y: "110%" }}
            animate={{ y: 0 }}
            exit={{ y: "110%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38, mass: 0.9 }}
          >
            <div className="px-3 pt-1 pb-2 text-[12.5px] font-semibold text-ink-3">
              {ids.length > 1 ? tn(ids.length, "Snooze {n} conversation", "Snooze {n} conversations") : t("Snooze until")}
            </div>
            {snoozePresets().map((p) => (
              <button
                key={p.id}
                onClick={() => pick(p.at)}
                className="press flex h-12 w-full items-center justify-between rounded-[14px] px-3 text-[15px] [--press-scale:0.98] active:bg-hover"
              >
                {p.label}
                <span className="text-[13px] text-ink-3">{formatFuture(p.at)}</span>
              </button>
            ))}
            <button onClick={close} className="press mt-1 h-12 w-full rounded-[14px] bg-hover text-[15px] font-medium text-ink-2 [--press-scale:0.98] active:bg-selected">
              {t("Cancel")}
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
