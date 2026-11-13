"use client";

import { TaskItem, TaskList as TaskListExtension } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { ArchiveRestore, CalendarDays, ChevronLeft, Ellipsis, MousePointerClick, Trash2 } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { intlLocale, t } from "@/lib/i18n";
import { dayFrom, isOverdue, longDueLabel, priorityLabel } from "@/lib/tasks/logic";
import { useTasks } from "@/lib/tasks/store";
import { TRASH_DAYS, type Task } from "@/lib/tasks/types";
import { useNow } from "@/lib/use-now";
import { track } from "@/lib/usage";
import { cn } from "@/lib/utils";
import { BlockGutter } from "../editor/block-menu";
import { FormatBubble } from "../editor/composer";
import { settle } from "../editor/settle";
import { SlashCommand } from "../editor/slash-command";
import { menuContentClass, menuItemClass } from "../ui";
import { DatePicker, PriorityFlag, PriorityMenu, TaskCheck } from "./task-bits";

const formatDate = (ms: number) => new Intl.DateTimeFormat(intlLocale(), { day: "numeric", month: "long", year: "numeric" }).format(new Date(ms));

/** The open task: ticked off, its day and priority on top; its title, and its description written like a Notion page. */
export function TaskDetails({ mobile, onBack }: { mobile?: boolean; onBack?: () => void }) {
  const task = useTasks((s) => s.tasks.find((x) => x.id === s.selectedId));
  if (!task) return mobile ? null : <Nothing />;
  // A fresh editor for each task: its own text and its own undo.
  return <Details key={task.id} task={task} mobile={mobile} onBack={onBack} />;
}

function Nothing() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center text-ink-3">
      <MousePointerClick size={28} strokeWidth={1.5} className="mb-3 opacity-60" />
      <p className="max-w-[240px] text-[13.5px] leading-relaxed">{t("Click a task to see its details and write a description.")}</p>
    </div>
  );
}

function Details({ task, mobile, onBack }: { task: Task; mobile?: boolean; onBack?: () => void }) {
  const now = new Date(useNow());
  const { update, complete, remove, restore, destroy } = useTasks.getState();
  const trashed = task.deletedAt !== null;
  const done = task.completedAt !== null;
  const overdue = isOverdue(task, now);
  const notesRef = useRef<{ focus: () => void } | null>(null);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn("flex shrink-0 items-center gap-2 border-b border-line", mobile ? "h-14 px-2 pt-[env(safe-area-inset-top)]" : "h-14 px-4")}>
        {mobile && (
          <button onClick={onBack} aria-label={t("Back")} className="press flex size-10 shrink-0 items-center justify-center rounded-full text-ink [--press-scale:0.9]">
            <ChevronLeft size={22} />
          </button>
        )}
        <TaskCheck task={task} size={18} disabled={trashed} onToggle={() => complete(task.id, !done)} />
        <span className="mx-1 h-4 w-px shrink-0 bg-line" />
        <DatePicker value={{ due: task.due, time: task.time }} onChange={(v) => update(task.id, { due: v.due, time: v.due ? v.time : null })}>
          <button
            disabled={trashed}
            className={cn(
              "flex h-8 min-w-0 items-center gap-1.5 rounded-[9px] px-2 text-[13.5px] transition-colors hover:bg-hover data-[state=open]:bg-hover disabled:pointer-events-none",
              !task.due ? "text-ink-3" : done ? "text-ink-2" : overdue ? "text-danger" : task.due === dayFrom(now, 0) ? "text-accent-text" : "text-ink-2",
            )}
          >
            <CalendarDays size={16} className="shrink-0" />
            <span className="truncate">{task.due ? longDueLabel(task, now) : t("Date")}</span>
          </button>
        </DatePicker>
        <span className="flex-1" />
        <PriorityMenu value={task.priority} onChange={(p) => update(task.id, { priority: p })}>
          <button disabled={trashed} aria-label={priorityLabel(task.priority)} title={priorityLabel(task.priority)} className="flex size-8 shrink-0 items-center justify-center rounded-[9px] transition-colors hover:bg-hover data-[state=open]:bg-hover disabled:opacity-50">
            <PriorityFlag priority={task.priority} size={17} />
          </button>
        </PriorityMenu>
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger aria-label={t("More")} className="flex size-8 shrink-0 items-center justify-center rounded-[9px] text-ink-3 outline-none transition-colors hover:bg-hover hover:text-ink data-[state=open]:bg-hover">
            <Ellipsis size={17} />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={6} collisionPadding={8} className={menuContentClass}>
              {trashed ? (
                <>
                  <DropdownMenu.Item className={menuItemClass} onSelect={() => restore(task.id)}>
                    <ArchiveRestore size={14} /> {t("Restore")}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item className={menuItemClass} onSelect={() => destroy(task.id)}>
                    <Trash2 size={14} /> {t("Delete forever")}
                  </DropdownMenu.Item>
                </>
              ) : (
                <DropdownMenu.Item
                  className={menuItemClass}
                  onSelect={() => {
                    remove(task.id);
                    onBack?.();
                  }}
                >
                  <Trash2 size={14} /> {t("Delete")}
                </DropdownMenu.Item>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      {trashed && (
        <div className="mx-4 mt-3 flex shrink-0 items-center gap-3 rounded-[12px] bg-hover px-3 py-2.5 text-[13px] text-ink-2">
          <Trash2 size={15} className="shrink-0 text-ink-3" />
          <span className="flex-1">{t("In Trash. It's deleted for good on {date}.", { date: formatDate(task.deletedAt! + TRASH_DAYS * 86_400_000) })}</span>
          <button onClick={() => restore(task.id)} className="h-7 shrink-0 rounded-[8px] px-2.5 text-[12.5px] font-medium text-accent-text hover:bg-selected">
            {t("Restore")}
          </button>
        </div>
      )}

      <div className={cn("min-h-0 flex-1 overflow-y-auto pt-4 pb-16", mobile ? "px-5" : "pr-6 pl-10")}>
        <Title task={task} readOnly={trashed} onEnter={() => notesRef.current?.focus()} />
        <Notes task={task} readOnly={trashed} focusRef={notesRef} />
      </div>

      <div className={cn("shrink-0 border-t border-line px-5 py-2.5 text-[12px] text-ink-3", mobile && "pb-[max(10px,var(--safe-bottom))]")}>
        {done ? t("Completed on {date}", { date: formatDate(task.completedAt!) }) : t("Created on {date}", { date: formatDate(task.createdAt) })}
      </div>
    </div>
  );
}

/** The title, saved as it's typed; Enter goes on to the description. */
function Title({ task, readOnly, onEnter }: { task: Task; readOnly: boolean; onEnter: () => void }) {
  const [value, setValue] = useState(task.title);
  const ref = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saved = useRef(task.title);
  const valueRef = useRef(value);
  const id = task.id;
  const save = useCallback(
    (text: string) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      const title = text.replace(/\s+/g, " ").trim();
      if (title === saved.current) return;
      saved.current = title;
      useTasks.getState().update(id, { title });
    },
    [id],
  );

  // Unsaved words go with the task when another one opens.
  useEffect(() => () => save(valueRef.current), [save]);

  // As tall as what's written.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  // A new task opened from the list with nothing in it yet: straight to writing.
  useEffect(() => {
    if (!task.title && !readOnly) ref.current?.focus({ preventScroll: true });
    // Only on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      readOnly={readOnly}
      placeholder={t("What needs doing?")}
      aria-label={t("Title")}
      onChange={(e) => {
        const text = e.target.value;
        setValue(text);
        valueRef.current = text;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => save(text), 500);
      }}
      onBlur={() => save(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
          e.preventDefault();
          save(value);
          onEnter();
        }
      }}
      className="block w-full resize-none overflow-hidden bg-transparent text-[20px] leading-snug font-semibold tracking-[-0.015em] text-ink outline-none placeholder:text-ink-3/70"
    />
  );
}

/** The description: the same editor as an email, with / for headings, lists and to-dos. Saved as it's written. */
function Notes({ task, readOnly, focusRef }: { task: Task; readOnly: boolean; focusRef: React.RefObject<{ focus: () => void } | null> }) {
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);
  const counted = useRef(false);
  const id = task.id;

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current === null) return;
    const notes = pending.current;
    pending.current = null;
    useTasks.getState().update(id, { notes });
  }, [id]);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      }),
      TaskListExtension,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({
        placeholder: ({ node }) => (node.type.name === "heading" ? t("Heading") : t("Add a description, or press / for blocks…")),
      }),
      SlashCommand.configure({ blocksOnly: true }),
    ],
    content: task.notes,
    onMount: settle,
    editorProps: { attributes: { class: "editor-root min-h-[160px] outline-none", spellcheck: "true" } },
    onUpdate: ({ editor }) => {
      pending.current = editor.isEmpty ? "" : editor.getHTML();
      if (!counted.current) {
        counted.current = true;
        track("taskNotes");
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 600);
    },
    onBlur: flush,
  });

  useEffect(() => {
    focusRef.current = { focus: () => editor?.commands.focus("start") };
  }, [editor, focusRef]);

  // What's written goes with the task when another one opens (or the window closes).
  useEffect(() => {
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);

  return (
    <div ref={box} className="editor group/editor relative mt-3 text-[14.5px]">
      {editor && !readOnly && <BlockGutter editor={editor} containerRef={box} />}
      <EditorContent editor={editor} />
      {editor && !readOnly && <FormatBubble editor={editor} snippets={false} />}
    </div>
  );
}
