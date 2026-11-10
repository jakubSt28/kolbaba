"use client";

import { StickyNote, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { t } from "@/lib/i18n";
import { useMail } from "@/lib/store";
import type { Thread } from "@/lib/types";
import { cn } from "@/lib/utils";
import { spring } from "./ui";

/** Which conversation's note is being written (N, or "Add note" in the menu). */
const useEditing = create<{ id: string | null }>(() => ({ id: null }));

export function openNote(threadId: string) {
  useEditing.setState({ id: threadId });
}

const NOTE_MAX = 2000;

/**
 * The user's private note on a conversation, like a sticky note on a letter: "Called him on the 15th,
 * he promised the price by Friday." Only in Kolbaba (never sent, not at the provider), and agents
 * connected over MCP see it with the conversation.
 */
export function ThreadNote({ thread }: { thread: Thread }) {
  const editing = useEditing((s) => s.id === thread.id);
  const saveNote = useMail((s) => s.saveNote);
  const note = thread.note ?? "";
  if (!note && !editing) return null;
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {editing ? (
        <NoteEditor key="edit" initial={note} onDone={(text) => {
          useEditing.setState({ id: null });
          if (text !== null) void saveNote(thread.id, text);
        }} />
      ) : (
        <motion.button
          key="show"
          layout
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
          onClick={() => openNote(thread.id)}
          title={t("Edit note")}
          className="mb-4 flex w-full items-start gap-2.5 rounded-xl bg-pin-soft px-3.5 py-2.5 text-left text-[13.5px] leading-relaxed text-ink shadow-[inset_0_0_0_1px_var(--pin-line)] transition-[filter] hover:brightness-[0.98]"
        >
          <StickyNote size={15} className="mt-[3px] shrink-0 text-pin" />
          <span className="min-w-0 flex-1 whitespace-pre-wrap">{note}</span>
        </motion.button>
      )}
    </AnimatePresence>
  );
}

function NoteEditor({ initial, onDone }: { initial: string; onDone: (text: string | null) => void }) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(value);
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // Grows with what's written, like a note would.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -4, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring}
      className="mb-4 rounded-xl bg-pin-soft px-3.5 pt-2.5 pb-2 shadow-[inset_0_0_0_1px_var(--pin-line),0_0_0_3px_color-mix(in_srgb,var(--pin)_18%,transparent)]"
    >
      <div className="flex items-start gap-2.5">
        <StickyNote size={15} className="mt-[3px] shrink-0 text-pin" />
        <textarea
          ref={ref}
          value={text}
          maxLength={NOTE_MAX}
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => finish(text)}
          onKeyDown={(e) => {
            // The app's single-key shortcuts must not fire while writing here.
            e.stopPropagation();
            if (e.key === "Escape") {
              e.preventDefault();
              finish(null);
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              finish(text);
            }
          }}
          placeholder={t("A note only you see: what was agreed, what to do next…")}
          className="min-h-[44px] w-full flex-1 resize-none bg-transparent text-[16px] leading-relaxed text-ink outline-none placeholder:text-ink-3 md:text-[13.5px]"
        />
      </div>
      <div className="mt-1 flex items-center gap-2 pl-[25px] text-[11.5px] text-ink-3">
        <span className="min-w-0 flex-1 truncate">{t("Only you see this. Not sent, not in your other email apps.")}</span>
        {initial && (
          <button
            // Before the blur saves what's typed: mousedown runs first.
            onMouseDown={(e) => {
              e.preventDefault();
              finish("");
            }}
            className="flex h-7 items-center gap-1 rounded-lg px-2 font-medium text-ink-2 hover:bg-hover hover:text-danger"
          >
            <Trash2 size={12} /> {t("Remove")}
          </button>
        )}
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            finish(text);
          }}
          className={cn("h-7 rounded-lg px-2.5 font-medium text-on-accent", "bg-accent hover:bg-accent-hover")}
        >
          {t("Done")}
        </button>
      </div>
    </motion.div>
  );
}
