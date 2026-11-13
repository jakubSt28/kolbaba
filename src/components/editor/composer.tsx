"use client";

import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { getHTMLFromFragment } from "@tiptap/core";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import {
  BellRing,
  Bold,
  ChevronDown,
  Code,
  Eye,
  EyeOff,
  ImageIcon,
  Italic,
  Link as LinkIcon,
  LoaderCircle,
  Paperclip,
  Plus,
  Send,
  Strikethrough,
  TextQuote,
  Trash,
  Underline as UnderlineIcon,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { DropdownMenu } from "radix-ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { intlLocale, t, tn } from "@/lib/i18n";
import { LIVE, loadContacts, saveDraftNow } from "@/lib/live";
import { opensInBrowser } from "@/lib/attachment-inline";
import { forwardCopy } from "@/lib/forward-files";
import { attachmentPreviewUrl, deleteAttachment, formatSize, MAX_ATTACHMENTS_BYTES, shrinkPhoto, uploadAttachment } from "@/lib/uploads";
import { getContacts, useMail } from "@/lib/store";
import type { Draft, DraftAttachment, Person } from "@/lib/types";
import { alignAboveKeyboard, keepTyping, onKeyboard } from "@/lib/keyboard";
import { cn } from "@/lib/utils";
import { AgentLogo } from "../activity";
import { ScheduleMenu } from "../menus";
import { IconButton, MailboxBadge, Tooltip, menuContentClass, menuItemClass, spring } from "../ui";
import { Attachments } from "./attachments-extension";
import { BlockGutter, BlockMenu } from "./block-menu";
import { SlashCommand } from "./slash-command";
import { Mention } from "./mention";
import { settle } from "./settle";
import { mentionsAttachment } from "@/lib/attachment-reminder";
import { track as countUse } from "@/lib/usage";
import { confirmChoice } from "../confirm";

const FOLLOW_UP_STEPS = [0, 1, 3, 7];

export function Composer({ draftId, variant = "full", onClose }: { draftId: string; variant?: "full" | "inline" | "sheet"; onClose?: () => void }) {
  const draft = useMail((s) => s.drafts[draftId]);
  if (!draft) return null;
  return <ComposerInner draft={draft} variant={variant} onClose={onClose} />;
}

function ComposerInner({ draft, variant, onClose }: { draft: Draft; variant: "full" | "inline" | "sheet"; onClose?: () => void }) {
  const accounts = useMail((s) => s.accounts);
  const updateDraft = useMail((s) => s.updateDraft);
  const sendDraft = useMail((s) => s.sendDraft);
  const discardDraft = useMail((s) => s.discardDraft);
  const account = accounts.find((a) => a.id === draft.accountId) ?? accounts[0];
  const [showCc, setShowCc] = useState(!!draft.cc);
  const [followUp, setFollowUp] = useState(0);
  const [track, setTrack] = useState(() => useMail.getState().trackByDefault);
  /** Files on their way to the server; finished ones live on the draft (draft.attachments). */
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const isReply = !!draft.threadId;
  const agent = useMail((s) => s.agents.find((a) => a.id === draft.agentId));
  const toRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Image,
      Placeholder.configure({
        placeholder: ({ node }) => (node.type.name === "heading" ? t("Heading") : isReply ? t("Write a reply, or press / for blocks…") : t("Write something, or press / for blocks…")),
      }),
      SlashCommand,
      Mention,
      Attachments,
    ],
    content: draft.html,
    onMount: settle,
    editorProps: {
      attributes: { class: "editor-root", spellcheck: "true" },
      // A reply on a phone keeps Send on top of the keyboard (below): the line being typed stays above it.
      scrollMargin: variant === "inline" ? { top: 5, right: 5, bottom: 72, left: 5 } : 5,
      // Pasted or dropped files: pictures go into the text, anything else becomes an attachment.
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])];
        if (!files.length) return false;
        attachRef.current(files);
        return true;
      },
      handleDrop: (_view, event, _slice, moved) => {
        const files = [...((event as DragEvent).dataTransfer?.files ?? [])];
        if (moved || !files.length) return false;
        event.preventDefault();
        event.stopPropagation();
        attachRef.current(files);
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => updateDraft(draft.id, { html: editor.isEmpty ? "" : editor.getHTML() }), 250);
    },
  });

  useEffect(() => {
    if (!editor) return;
    // A new email starts with who it's for; a reply, or one already addressed, with the text.
    if (variant === "inline" || draft.to) editor.commands.focus("end");
    // Without preventScroll iOS slides the page to put it in the middle of the screen (src/lib/keyboard.ts).
    else toRef.current?.focus({ preventScroll: true });
    // Focus only once, when the editor is ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Phone: once the keyboard is up (or changes height), what's being typed in comes back into view above it.
  useEffect(() => {
    if (!editor) return;
    return onKeyboard(() => {
      const root = rootRef.current;
      if (!root?.contains(document.activeElement)) return;
      // A reply sits at the end of the conversation: all of it on top of the keyboard, Send included.
      if (variant === "inline") alignAboveKeyboard(root);
      if (editor.isFocused) editor.commands.scrollIntoView();
    });
  }, [editor, variant]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  /** Swap an image's src everywhere in the text (a local preview → the uploaded file), or remove it. */
  const replaceImage = (from: string, to: string | null) => {
    if (!editor || editor.isDestroyed) return;
    const found: { pos: number; size: number; attrs: Record<string, unknown> }[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "image" && node.attrs.src === from) found.push({ pos, size: node.nodeSize, attrs: node.attrs });
    });
    if (!found.length) return;
    const tr = editor.state.tr;
    for (const f of found.reverse()) {
      if (to) tr.setNodeMarkup(f.pos, undefined, { ...f.attrs, src: to });
      else tr.delete(f.pos, f.pos + f.size);
    }
    editor.view.dispatch(tr);
  };

  const attach = async (picked: File[], opts: { inline?: boolean } = {}) => {
    if (!picked.length) return;
    setError(null);
    const isImage = (f: File) => /^image\/(png|jpe?g|gif|webp|heic|heif)$/.test(f.type);
    const inlineFiles = opts.inline === false ? [] : picked.filter((f) => opts.inline || isImage(f));
    const files = await Promise.all(picked.map((f) => (inlineFiles.includes(f) ? shrinkPhoto(f) : f)));
    const inline = new Set(files.filter((_, i) => inlineFiles.includes(picked[i])));
    if (!LIVE) {
      // The demo has no server: pictures show from memory, files as chips.
      for (const f of files) {
        if (inline.has(f)) editor?.chain().focus().setImage({ src: URL.createObjectURL(f), alt: f.name }).run();
      }
      const local = files.filter((f) => !inline.has(f)).map((f) => ({ id: `local_${Math.random().toString(36).slice(2)}`, name: f.name, size: f.size, mime: f.type }));
      updateDraft(draft.id, { attachments: [...(currentDraft()?.attachments ?? []), ...local] });
      return;
    }
    const used = (currentDraft()?.attachments ?? []).reduce((n, a) => n + a.size, 0) + uploads.reduce((n, u) => n + u.size, 0);
    if (used + files.reduce((n, f) => n + f.size, 0) > MAX_ATTACHMENTS_BYTES) {
      setError(t("Attachments can be at most {mb} MB per email.", { mb: MAX_ATTACHMENTS_BYTES / 1024 / 1024 }));
      return;
    }
    flush();
    const latest = currentDraft();
    if (latest) await saveDraftNow(latest).catch(() => {});
    await Promise.all(
      files.map(async (file) => {
        const key = Math.random().toString(36).slice(2);
        const preview = inline.has(file) ? URL.createObjectURL(file) : null;
        if (preview) editor?.chain().focus().setImage({ src: preview, alt: file.name }).run();
        setUploads((u) => [...u, { key, name: file.name, size: file.size, inline: !!preview, progress: 0 }]);
        try {
          const done = await uploadAttachment(draft.id, file, {
            name: file.name,
            inline: !!preview,
            onProgress: (progress) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, progress } : x))),
          });
          if (preview) replaceImage(preview, attachmentPreviewUrl(draft.id, done.id));
          updateDraft(draft.id, { attachments: [...(currentDraft()?.attachments ?? []), done] });
          setUploads((u) => u.filter((x) => x.key !== key));
        } catch (err) {
          if (preview) replaceImage(preview, null);
          setUploads((u) => u.map((x) => (x.key === key ? { ...x, error: t((err as Error).message) } : x)));
        } finally {
          if (preview) setTimeout(() => URL.revokeObjectURL(preview), 30_000);
        }
      }),
    );
  };
  const currentDraft = () => useMail.getState().drafts[draft.id];

  // A forward: the forwarded email's files are being copied into this draft (src/lib/forward-files.ts).
  useEffect(() => {
    if (!editor) return;
    const copy = forwardCopy(draft.id);
    if (!copy) return;
    let live = true;
    const keys = copy.files.map((f) => ({ key: Math.random().toString(36).slice(2), name: f.name }));
    setUploads((u) => [...u, ...keys.map(({ key, name }) => ({ key, name, size: 0, inline: false, progress: 0, waiting: true }))]);
    const mine = new Set(keys.map((k) => k.key));
    copy.done.then(
      (copied) => {
        if (!live) return;
        for (const [from, to] of Object.entries(copied.images)) replaceImage(from, to);
        const failed = copied.failed.map((f) => ({
          key: Math.random().toString(36).slice(2),
          name: f.name,
          size: 0,
          inline: false,
          progress: 0,
          error:
            f.reason === "too_large"
              ? t("Attachments can be at most {mb} MB per email.", { mb: MAX_ATTACHMENTS_BYTES / 1024 / 1024 })
              : t("Couldn't get this file from the mail server"),
        }));
        setUploads((u) => [...u.filter((x) => !mine.has(x.key)), ...failed]);
      },
      (err) => {
        if (!live) return;
        setUploads((u) => u.map((x) => (mine.has(x.key) ? { ...x, waiting: false, error: t((err as Error).message) } : x)));
      },
    );
    return () => {
      live = false;
      setUploads((u) => u.filter((x) => !mine.has(x.key)));
    };
    // Once per draft, when the editor is ready; replaceImage reads the editor at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, draft.id]);

  // Editor handlers are set up once; they always call the latest attach().
  const attachRef = useRef<(files: File[]) => void>(() => {});
  attachRef.current = (files: File[]) => void attach(files);
  useEffect(() => {
    if (!editor) return;
    editor.storage.attachments.insertImage = (file) => void attachRef.current([file]);
    // "@Petra" in the text: Petra goes into To, or into Cc when To has someone already.
    editor.storage.mention.onPick = (person) => {
      const d = currentDraft();
      if (!d) return;
      const has = (list: string) => list.split(/[,;]/).some((x) => x.trim().toLowerCase() === person.email.toLowerCase());
      if (has(d.to) || has(d.cc)) return;
      const add = (list: string) => [...list.split(",").map((x) => x.trim()).filter(Boolean), person.email].join(", ");
      if (!d.to.trim()) updateDraft(d.id, { to: add(d.to) });
      else {
        updateDraft(d.id, { cc: add(d.cc) });
        setShowCc(true);
      }
    };
    return () => {
      if (!editor.isDestroyed) {
        editor.storage.attachments.insertImage = null;
        editor.storage.mention.onPick = null;
      }
    };
    // updateDraft is a stable store action; the draft is read fresh when a person is picked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const removeFile = (a: DraftAttachment) => {
    updateDraft(draft.id, { attachments: (currentDraft()?.attachments ?? []).filter((x) => x.id !== a.id) });
    if (LIVE && !a.id.startsWith("local_")) void deleteAttachment(draft.id, a.id);
  };

  const flush = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (editor) updateDraft(draft.id, { html: editor.isEmpty ? "" : editor.getHTML() });
  };

  const send = (scheduleAt?: number) => {
    if (uploads.some((u) => !u.error) || forwardCopy(draft.id)) {
      setError(t("Wait a moment, the attachments are still uploading"));
      return;
    }
    if (!draft.to.trim()) {
      // A letter to nobody: even Kolbaba couldn't deliver it (and there's a hidden stamp for trying).
      useMail.getState().earnStamps(["no-address"]);
      setError(t("Add at least one recipient"));
      toRef.current?.focus({ preventScroll: true });
      return;
    }
    flush();
    const go = () =>
      // Let the flushed HTML land in the store before sending.
      queueMicrotask(() => {
        sendDraft(draft.id, { scheduleAt, followUpDays: FOLLOW_UP_STEPS[followUp] || undefined, track });
        onClose?.();
      });
    // "V příloze posílám…" and nothing attached: one question before it's gone.
    const html = editor && !editor.isEmpty ? editor.getHTML() : (currentDraft()?.html ?? "");
    const attached = (currentDraft()?.attachments ?? []).some((a) => !a.inline);
    if (!attached && mentionsAttachment(html)) {
      countUse("attachmentReminder");
      confirmChoice({
        title: t("Forgot the attachment?"),
        message: t("The email says something is attached, but nothing is."),
        choices: [
          { label: t("Attach a file"), run: () => fileInput.current?.click(), tone: "accent" },
          { label: t("Send without it"), run: go },
        ],
        cancelLabel: t("Back to the email"),
      });
      return;
    }
    go();
  };
  const fileInput = useRef<HTMLInputElement>(null);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      send();
    }
    if (e.key === "Escape" && variant === "inline") {
      e.preventDefault();
      flush();
      onClose?.();
    }
  };

  const fields = (
    <div className={cn("flex flex-col", variant === "inline" ? "gap-0" : "gap-0.5")}>
      {variant !== "inline" && (
        <FieldRow label={t("From")}>
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger asChild>
              <button className="-ml-1 flex h-7 items-center gap-2 rounded-lg px-1.5 text-[13.5px] transition-colors hover:bg-hover data-[state=open]:bg-hover">
                <MailboxBadge icon={account.icon} hue={account.hue} image={account.image} size={18} className="rounded-[6px]" />
                <span className="font-medium">{account.name}</span>
                <span className="text-ink-3">{account.email}</span>
                <ChevronDown size={13} className="text-ink-3" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="start" sideOffset={4} className={menuContentClass}>
                {accounts.map((a) => (
                  <DropdownMenu.Item key={a.id} className={menuItemClass} onSelect={() => updateDraft(draft.id, { accountId: a.id })}>
                    <MailboxBadge icon={a.icon} hue={a.hue} image={a.image} size={18} className="rounded-[6px]" />
                    <span className="font-medium">{a.name}</span>
                    <span className="opacity-60">{a.email}</span>
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </FieldRow>
      )}
      <FieldRow label={t("To")} error={error}>
        <RecipientInput
          inputRef={toRef}
          value={draft.to}
          onChange={(to) => {
            setError(null);
            updateDraft(draft.id, { to });
          }}
        />
        {!showCc && (
          <button onClick={() => setShowCc(true)} className="shrink-0 rounded-md px-1.5 text-[12.5px] text-ink-3 hover:bg-hover hover:text-ink">
            {t("Cc")}
          </button>
        )}
      </FieldRow>
      {showCc && (
        <FieldRow label={t("Cc")}>
          <RecipientInput value={draft.cc} onChange={(cc) => updateDraft(draft.id, { cc })} autoFocus={!draft.cc} />
        </FieldRow>
      )}
      {variant !== "inline" && (
        <input
          value={draft.subject}
          onChange={(e) => updateDraft(draft.id, { subject: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && editor) {
              e.preventDefault();
              editor.view.focus();
              editor.commands.focus("start");
            }
          }}
          placeholder={t("Subject")}
          className="mt-3 w-full bg-transparent text-[22px] font-semibold tracking-[-0.02em] text-ink outline-none placeholder:text-ink-3/70"
        />
      )}
    </div>
  );

  const body = (
    <div ref={bodyRef} className="editor group/editor relative">
      {editor && variant !== "inline" && <BlockGutter editor={editor} containerRef={bodyRef} />}
      <EditorContent editor={editor} />
      {editor && <FormatBubble editor={editor} />}
      {account.signature ? (
        <div
          className="mt-5 border-t border-dashed border-line pt-3 text-[13.5px] leading-relaxed text-ink-3 [&_img]:max-h-20 [&_img]:w-auto [&_strong]:font-medium [&_strong]:text-ink-2"
          dangerouslySetInnerHTML={{ __html: account.signature }}
        />
      ) : (
        variant !== "inline" && (
          // No signature yet for this mailbox: where to write one, quietly.
          <button
            onClick={() => useMail.getState().setSettingsOpen(true, "mailboxes")}
            className="mt-5 -ml-1 flex h-7 items-center rounded-md px-1 text-[12.5px] text-ink-3 transition-colors hover:bg-hover hover:text-ink"
          >
            {t("Add a signature for {mailbox}", { mailbox: account.email })}
          </button>
        )
      )}
      <AttachmentChips
        attachments={(draft.attachments ?? []).filter((a) => !a.inline)}
        uploads={uploads}
        draftId={draft.id}
        onRemove={removeFile}
        onDismiss={(key) => setUploads((u) => u.filter((x) => x.key !== key))}
      />
    </div>
  );

  const footer = (
    // Typing on a phone, a tap on these keeps the keyboard up.
    <div className="flex items-center gap-1.5" onMouseDown={keepTyping}>
      <div className="press flex items-center rounded-[11px] bg-accent text-on-accent shadow-[0_1px_2px_rgb(0_0_0/0.12),inset_0_1px_0_rgb(255_255_255/0.18)] [--press-scale:0.96]">
        <Tooltip label={t("Send")} shortcut="⌘↵" side="top">
          <button onClick={() => send()} className="flex h-9 items-center gap-2 rounded-l-[11px] pr-3 pl-3.5 text-[13.5px] font-medium transition-colors hover:bg-accent-hover active:bg-accent-hover">
            <Send size={14} strokeWidth={2.2} /> {t("Send")}
          </button>
        </Tooltip>
        <span className="h-5 w-px bg-white/25" />
        <ScheduleMenu onPick={(ts) => send(ts)}>
          <button aria-label={t("Schedule send")} className="flex h-9 w-8 items-center justify-center rounded-r-[11px] transition-colors hover:bg-accent-hover data-[state=open]:bg-accent-hover">
            <ChevronDown size={15} />
          </button>
        </ScheduleMenu>
      </div>
      <Tooltip label={t("Remind me if nobody replies")} side="top">
        <button
          onClick={() => setFollowUp((i) => (i + 1) % FOLLOW_UP_STEPS.length)}
          className={cn(
            "flex h-9 items-center gap-1.5 rounded-[11px] px-2.5 text-[12.5px] transition-colors",
            followUp ? "bg-warning/15 font-medium text-ink" : "text-ink-3 hover:bg-hover hover:text-ink",
          )}
        >
          <BellRing size={14} className={followUp ? "text-warning" : ""} />
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={followUp} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={spring}>
              {followUp ? tn(FOLLOW_UP_STEPS[followUp], "{n}d", "{n}d") : <span className="hidden sm:inline">{t("Remind")}</span>}
            </motion.span>
          </AnimatePresence>
        </button>
      </Tooltip>
      <Tooltip label={track ? t("You'll see when it's opened") : t("Read tracking is off")} side="top">
        <button
          onClick={() => setTrack((v) => !v)}
          aria-pressed={track}
          className={cn(
            "flex h-9 items-center gap-1.5 rounded-[11px] px-2.5 text-[12.5px] transition-colors",
            track ? "bg-accent-soft font-medium text-accent-text" : "text-ink-3 hover:bg-hover hover:text-ink",
          )}
        >
          {track ? <Eye size={14} /> : <EyeOff size={14} />}
          <span className="hidden sm:inline">{track ? t("Tracked") : t("Track")}</span>
        </button>
      </Tooltip>
      {editor && (
        <BlockMenu editor={editor} side="top" tooltip={{ label: t("Insert block"), shortcut: "/" }}>
          <button
            aria-label={t("Insert block")}
            className="flex size-9 items-center justify-center rounded-[11px] text-ink-2 transition-colors hover:bg-hover hover:text-ink data-[state=open]:bg-hover data-[state=open]:text-ink"
          >
            <Plus size={16} />
          </button>
        </BlockMenu>
      )}
      <AttachButton inputRef={fileInput} onFiles={(f) => void attach(f, { inline: false })} />
      <div className="ml-auto flex items-center gap-1">
        {variant === "inline" && <span className="mr-1 hidden text-[11.5px] text-ink-3 sm:inline">{t("Esc to collapse")}</span>}
        <IconButton label={t("Discard draft")} onClick={() => discardDraft(draft.id)} tooltipSide="top">
          <Trash size={15} />
        </IconButton>
      </div>
    </div>
  );

  if (variant === "inline") {
    return (
      <motion.div
        ref={rootRef}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring}
        onKeyDown={onKeyDown}
        className="rounded-2xl bg-solid p-4 shadow-[var(--shadow-panel)]"
      >
        {agent ? (
          <div className="mb-3 flex items-center gap-2 rounded-xl bg-accent-soft px-3 py-2 text-[12.5px] text-ink-2">
            <AgentLogo agent={agent} size={18} />
            <span>
              <span className="font-medium text-ink">{t("Drafted by {app}", { app: agent.app })}</span> · {t("review it before sending")}
            </span>
          </div>
        ) : (
          <div className="mb-2 flex items-center gap-2 text-[12.5px] text-ink-3">
            <MailboxBadge icon={account.icon} hue={account.hue} image={account.image} size={16} className="rounded-[5px]" />
            {t("Replying from {name}", { name: account.name })}
          </div>
        )}
        {fields}
        {/* With the phone keyboard up, the whole reply fits above it (the conversation's header takes ~100px). */}
        <div className="mt-2 max-h-[50vh] overflow-y-auto keyboard:max-h-[max(6rem,calc(var(--visible-height)-17.5rem))]">{body}</div>
        {/* With the phone keyboard up, Send stays on top of it even when the reply grows past the screen. */}
        <div className="mt-4 keyboard:sticky keyboard:bottom-0 keyboard:z-10 keyboard:-mx-4 keyboard:mt-2 keyboard:border-t keyboard:border-line keyboard:bg-solid keyboard:px-4 keyboard:py-2">
          {footer}
        </div>
      </motion.div>
    );
  }

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col" onKeyDown={onKeyDown}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn("mx-auto w-full max-w-[720px] px-5 pt-5 pb-10 md:px-8 md:pt-7")}>
          {fields}
          <div className="mt-4">{body}</div>
        </div>
      </div>
      <div className="shrink-0 border-t border-line px-4 py-3 md:px-6 pb-[max(12px,var(--safe-bottom))]">
        <div className="mx-auto max-w-[720px]">{footer}</div>
      </div>
    </div>
  );
}

function FieldRow({ label, children, error }: { label: string; children: React.ReactNode; error?: string | null }) {
  return (
    <div className="relative flex min-h-9 items-center gap-3 border-b border-line">
      <span className="w-10 shrink-0 text-[13px] text-ink-3">{label}</span>
      {children}
      {error && <span className="absolute right-0 text-[12px] text-danger">{error}</span>}
    </div>
  );
}

function RecipientInput({
  value,
  onChange,
  inputRef,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  autoFocus?: boolean;
}) {
  const threads = useMail((s) => s.threads);
  const accounts = useMail((s) => s.accounts);
  const [remote, setRemote] = useState<Person[]>([]);
  useEffect(() => {
    if (LIVE) void loadContacts().then(setRemote);
  }, []);
  const contacts = useMemo(() => {
    // Server list first (ranked by how often you write to them), then anyone in the loaded mail.
    const seen = new Set(remote.map((c) => c.email.toLowerCase()));
    return [...remote, ...getContacts(threads, accounts).filter((c) => !seen.has(c.email.toLowerCase()))];
  }, [remote, threads, accounts]);
  const [focused, setFocused] = useState(false);
  const [index, setIndex] = useState(0);
  const token = value.split(",").pop()?.trim().toLowerCase() ?? "";
  const matches = token
    ? contacts.filter((c) => `${c.name} ${c.email}`.toLowerCase().includes(token)).slice(0, 5)
    : [];
  const open = focused && matches.length > 0;
  const ownRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? ownRef;
  // Not the autoFocus attribute: without preventScroll iOS slides the page (src/lib/keyboard.ts).
  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true });
    // Once, when it appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (email: string) => {
    const parts = value.split(",").map((s) => s.trim());
    parts[parts.length - 1] = email;
    onChange(parts.filter(Boolean).join(", ") + ", ");
    setIndex(0);
  };

  return (
    <div className="relative min-w-0 flex-1">
      <input
        ref={ref}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setIndex(0);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 120)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setIndex((i) => (i + 1) % matches.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setIndex((i) => (i - 1 + matches.length) % matches.length);
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            pick(matches[index].email);
          }
        }}
        placeholder="name@example.com"
        className="h-9 w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-ink-3/60 md:text-[13.5px]"
      />
      <div
        data-open={open || undefined}
        className="glass-strong pointer-events-none absolute top-full left-0 z-30 mt-1 w-[300px] origin-top -translate-y-1 scale-[0.98] rounded-xl p-1 opacity-0 transition-[opacity,translate,scale] duration-150 data-[open]:pointer-events-auto data-[open]:translate-y-0 data-[open]:scale-100 data-[open]:opacity-100"
      >
        {matches.map((c, i) => (
          <button
            key={c.email}
            tabIndex={-1}
            onMouseDown={(e) => {
              e.preventDefault();
              pick(c.email);
            }}
            onMouseEnter={() => setIndex(i)}
            className={cn("flex w-full flex-col rounded-lg px-2.5 py-1.5 text-left", i === index && "bg-accent text-on-accent")}
          >
            <span className="text-[13px] font-medium">{c.name}</span>
            <span className={cn("text-[12px]", i === index ? "text-on-accent/75" : "text-ink-3")}>{c.email}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

interface Upload {
  key: string;
  name: string;
  size: number;
  inline: boolean;
  progress: number;
  error?: string;
  /** Being copied on the server (a forward's files): no progress to show. */
  waiting?: boolean;
}

function AttachmentChips({
  attachments,
  uploads,
  draftId,
  onRemove,
  onDismiss,
}: {
  attachments: DraftAttachment[];
  uploads: Upload[];
  draftId: string;
  onRemove: (a: DraftAttachment) => void;
  onDismiss: (key: string) => void;
}) {
  const chip = "relative flex h-8 max-w-full items-center gap-2 overflow-hidden rounded-lg bg-hover pr-1 pl-2.5 text-[12.5px]";
  const x = "flex size-6 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-selected hover:text-ink";
  return (
    <AnimatePresence initial={false}>
      {(attachments.length > 0 || uploads.length > 0) && (
        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 flex flex-wrap gap-2">
          {attachments.map((a) => (
            <span key={a.id} className={chip}>
              <Paperclip size={13} className="shrink-0 text-ink-3" />
              {a.id.startsWith("local_") ? (
                <span className="truncate">{a.name}</span>
              ) : (
                <a
                  href={attachmentPreviewUrl(draftId, a.id)}
                  {...(opensInBrowser(a.mime) ? { target: "_blank", rel: "noreferrer" } : { download: a.name })}
                  className="truncate hover:underline"
                >
                  {a.name}
                </a>
              )}
              <span className="shrink-0 text-ink-3">{formatSize(a.size, intlLocale())}</span>
              <button onClick={() => onRemove(a)} className={x} aria-label={t("Remove {name}", { name: a.name })}>
                <X size={13} />
              </button>
            </span>
          ))}
          {uploads.map((u) => (
            <span key={u.key} className={cn(chip, u.error && "bg-danger/10 text-danger")} title={u.error}>
              {u.error ? null : u.inline ? (
                <ImageIcon size={13} className="shrink-0 text-ink-3" />
              ) : (
                <LoaderCircle size={13} className="shrink-0 animate-spin text-ink-3" />
              )}
              <span className="truncate">{u.error ? t("{name} didn't upload", { name: u.name }) : u.name}</span>
              {!u.error && !u.waiting && <span className="shrink-0 text-ink-3 tabular-nums">{Math.round(u.progress * 100)} %</span>}
              {u.error ? (
                <button onClick={() => onDismiss(u.key)} className={x} aria-label={t("Dismiss")}>
                  <X size={13} />
                </button>
              ) : (
                <span className="w-1" />
              )}
              {!u.error && !u.waiting && (
                <motion.span
                  aria-hidden
                  className="absolute bottom-0 left-0 h-[2px] bg-accent"
                  initial={false}
                  animate={{ width: `${Math.max(4, u.progress * 100)}%` }}
                  transition={spring}
                />
              )}
            </span>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function AttachButton({ onFiles, inputRef }: { onFiles: (files: File[]) => void; inputRef?: React.RefObject<HTMLInputElement | null> }) {
  const own = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? own;
  return (
    <>
      <IconButton label={t("Attach files")} onClick={() => ref.current?.click()} className="size-9 rounded-[11px]" tooltipSide="top">
        <Paperclip size={15} />
      </IconButton>
      <input
        ref={ref}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
    </>
  );
}

/** The selected text becomes a snippet named after its first words; it can be renamed in Settings. */
async function saveSelectionAsSnippet(editor: Editor) {
  const { from, to } = editor.state.selection;
  const html = getHTMLFromFragment(editor.state.doc.slice(from, to).content, editor.schema);
  const text = editor.state.doc.textBetween(from, to, " ").replace(/\s+/g, " ").trim();
  if (!text) return;
  const words = text.split(" ");
  const name = words.slice(0, 5).join(" ") + (words.length > 5 ? "…" : "");
  const { saveSnippet, pushToast, setSettingsOpen } = useMail.getState();
  try {
    await saveSnippet({ name: name.slice(0, 80), html });
    pushToast({ message: t("Saved as snippet “{name}”. Type / to use it.", { name }), action: { label: t("Edit"), run: () => setSettingsOpen(true, "mail") } });
  } catch (err) {
    pushToast({ message: (err as Error).message });
  }
}

/** Bold, italic, a link… over selected text; `snippets: false` where there are none to save (a task's description). */
export function FormatBubble({ editor, snippets = true }: { editor: Editor; snippets?: boolean }) {
  const btn = (active: boolean) =>
    cn("flex size-7 items-center justify-center rounded-md transition-colors", active ? "bg-accent text-on-accent" : "text-ink-2 hover:bg-hover hover:text-ink");
  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: "top", offset: 8 }}
      shouldShow={({ editor, from, to }) => from !== to && !editor.isActive("image") && !editor.isActive("codeBlock")}
      className="glass-strong z-40 flex items-center gap-0.5 rounded-xl p-1"
    >
      <button onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleBold().run()} className={btn(editor.isActive("bold"))} aria-label={t("Bold")}>
        <Bold size={14} strokeWidth={2.4} />
      </button>
      <button onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleItalic().run()} className={btn(editor.isActive("italic"))} aria-label={t("Italic")}>
        <Italic size={14} />
      </button>
      <button onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleUnderline().run()} className={btn(editor.isActive("underline"))} aria-label={t("Underline")}>
        <UnderlineIcon size={14} />
      </button>
      <button onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleStrike().run()} className={btn(editor.isActive("strike"))} aria-label={t("Strikethrough")}>
        <Strikethrough size={14} />
      </button>
      <button onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleCode().run()} className={btn(editor.isActive("code"))} aria-label={t("Inline code")}>
        <Code size={14} />
      </button>
      <span className="mx-0.5 h-4 w-px bg-line" />
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (editor.isActive("link")) return editor.chain().focus().unsetLink().run();
          const url = window.prompt(t("Link URL"));
          if (url) editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
        }}
        className={btn(editor.isActive("link"))}
        aria-label={t("Link")}
      >
        <LinkIcon size={14} />
      </button>
      {snippets && (
        <>
          <span className="mx-0.5 h-4 w-px bg-line" />
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => void saveSelectionAsSnippet(editor)} className={btn(false)} aria-label={t("Save as snippet")} title={t("Save as snippet")}>
            <TextQuote size={14} />
          </button>
        </>
      )}
    </BubbleMenu>
  );
}

