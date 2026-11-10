"use client";

import { useEffect } from "react";
import { neighbourOf, visibleOrder } from "@/components/message-list";
import { askDeleteForever } from "@/components/thread-actions";
import { undoLatest } from "@/components/toaster";
import { printThread } from "@/components/print";
import { openNote } from "@/components/thread-note";
import { isBin, useMail } from "./store";
import { track } from "./usage";
import { isTypingTarget, snoozePresets } from "./utils";

/** Superhuman-style single-key shortcuts for the desktop layout. */
export function useShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let pendingG = false;
    let gTimer: ReturnType<typeof setTimeout> | undefined;

    const onKey = (e: KeyboardEvent) => {
      // A confirmation is asking something; it handles its own keys.
      if (document.querySelector("[role=alertdialog]")) return;
      const s = useMail.getState();
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        s.setPaletteOpen(!s.paletteOpen);
        return;
      }
      if (mod && e.key === ",") {
        e.preventDefault();
        s.setPaletteOpen(false);
        s.setSettingsOpen(true);
        return;
      }
      if (s.settingsOpen || s.shortcutsOpen) return;
      if (s.paletteOpen) {
        // Close even if focus wandered outside the palette.
        if (e.key === "Escape") s.setPaletteOpen(false);
        return;
      }
      if (mod && e.key.toLowerCase() === "a" && !isTypingTarget(e.target) && !window.getSelection()?.toString()) {
        const ids = visibleOrder(s).map((i) => i.id);
        if (ids.length) {
          e.preventDefault();
          s.checkAll(ids);
        }
        return;
      }
      const activeTab = s.tabs.find((t) => t.id === s.activeTabId);
      const currentId = activeTab?.kind === "thread" ? activeTab.threadId : null;
      // ⌘P with a conversation open prints that, not the whole app.
      if (mod && e.key.toLowerCase() === "p" && currentId && s.threads[currentId]?.folder !== "scheduled") {
        e.preventDefault();
        void printThread(currentId);
        return;
      }
      if (isTypingTarget(e.target) || mod || e.altKey) return;
      if (document.querySelector("[data-radix-popper-content-wrapper]")) return;

      const move = (delta: number) => {
        if (s.checked.length) s.clearChecked();
        const items = visibleOrder(s);
        if (!items.length) return;
        const idx = items.findIndex((i) => i.id === s.selectedId);
        const next = items[idx < 0 ? 0 : Math.min(items.length - 1, Math.max(0, idx + delta))];
        if (next.type === "thread") s.openThread(next.id);
        else s.openDraft(next.id);
        requestAnimationFrame(() =>
          document.querySelector(`[data-thread-id="${next.id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
        );
      };

      if (pendingG) {
        pendingG = false;
        clearTimeout(gTimer);
        const map: Record<string, () => void> = {
          i: () => {
            s.setScope("all");
            s.setFolder("inbox");
          },
          p: () => s.setFolder("pinned"),
          r: () => s.setFolder("unanswered"),
          s: () => s.setFolder("sent"),
          d: () => s.setFolder("drafts"),
          a: () => s.setFolder("archive"),
          h: () => s.setFolder("snoozed"),
          t: () => s.setFolder("trash"),
          "!": () => s.setFolder("spam"),
        };
        if (map[e.key]) {
          e.preventDefault();
          map[e.key]();
        }
        return;
      }

      const handlers: Record<string, () => void> = {
        j: () => move(1),
        ArrowDown: () => move(1),
        k: () => move(-1),
        ArrowUp: () => move(-1),
        c: () => s.compose(),
        "/": () => document.getElementById("list-search")?.focus(),
        "[": () => s.cycleTab(-1),
        "]": () => s.cycleTab(1),
        z: () => void undoLatest(),
        g: () => {
          pendingG = true;
          gTimer = setTimeout(() => (pendingG = false), 900);
        },
        U: () => s.toggleUnreadOnly(),
        "?": () => s.setShortcutsOpen(true),
      };
      // A multi-selection takes over the conversation keys; Escape ends it.
      const checked = s.checked.filter((id) => s.threads[id]);
      const checkedDrafts = s.checked.filter((id) => s.drafts[id]);
      // Delete (#, like Gmail, or the Delete key): to Trash; in Trash or Spam it deletes for good, after asking.
      const remove = (ids: string[], one?: () => void) => () =>
        ids.every((id) => isBin(s.threads[id].folder)) ? askDeleteForever(ids) : one ? one() : s.trashMany(ids);
      if (checked.length) {
        const threads = checked.map((id) => s.threads[id]);
        const bin = threads.every((t) => isBin(t.folder));
        Object.assign(handlers, {
          "#": remove(checked),
          Backspace: remove(checked),
          Delete: remove(checked),
          "!": () => !bin && s.spamMany(checked),
          e: () => (bin ? undefined : threads.every((t) => t.folder === "archive") ? s.moveManyToInbox(checked) : s.archiveMany(checked)),
          p: () => s.setPinnedMany(checked, !threads.every((t) => t.pinned)),
          u: () => s.setUnreadMany(checked, !threads.some((t) => t.unread)),
          h: () => {
            const preset = snoozePresets()[0];
            if (preset) s.snoozeMany(checked, preset.at);
          },
          Escape: () => s.clearChecked(),
        });
      } else if (checkedDrafts.length) {
        const discard = () => s.discardDrafts(checkedDrafts);
        Object.assign(handlers, { "#": discard, Backspace: discard, Delete: discard, Escape: () => s.clearChecked() });
      } else if (currentId) {
        const t = s.threads[currentId];
        const trashOne = remove([currentId], () => s.trash(currentId, neighbourOf(currentId)));
        Object.assign(handlers, {
          "#": trashOne,
          Backspace: trashOne,
          Delete: trashOne,
          "!": () => t.folder !== "spam" && s.spam(currentId, neighbourOf(currentId)),
          e: () => (isBin(t.folder) ? undefined : t.folder === "archive" ? s.moveToInbox(currentId) : s.archive(currentId, neighbourOf(currentId))),
          p: () => s.togglePin(currentId),
          u: () => s.setUnread(currentId, !t.unread),
          m: () => !isBin(t.folder) && t.folder !== "scheduled" && s.setMuted(currentId, !t.muted, neighbourOf(currentId)),
          n: () => t.folder !== "scheduled" && openNote(currentId),
          r: () => {
            s.reply(currentId);
            setTimeout(() => document.querySelector(".editor .ProseMirror")?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
          },
          R: () => s.reply(currentId, "replyAll"),
          f: () => s.reply(currentId, "forward"),
          h: () => {
            const preset = snoozePresets()[0];
            if (preset) s.snooze(currentId, preset.at, neighbourOf(currentId));
          },
          Escape: () => activeTab && s.closeTab(activeTab.id),
        });
      }

      const handler = handlers[e.key];
      if (handler) {
        e.preventDefault();
        handler();
        s.markTried("shortcuts");
        track("shortcuts");
      }
    };

    // Capture phase: we see the key before menus close themselves, so an Escape that
    // dismisses a menu (or the palette) never also closes the open tab.
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      clearTimeout(gTimer);
    };
  }, [enabled]);
}
