"use client";

import { Extension, type Editor, type Range } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import {
  CodeXml,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Quote,
  TextQuote,
  Type,
  type LucideIcon,
} from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t, tk } from "@/lib/i18n";
import { useMail } from "@/lib/store";
import { track } from "@/lib/usage";
import { cn, htmlToText } from "@/lib/utils";

export interface SlashItem {
  title: string;
  hint: string;
  keywords: string;
  icon: LucideIcon;
  run: (editor: Editor, range: Range) => void;
  /** A saved snippet: shown under "Snippets", its name and text as they are (not translated). */
  snippet?: string;
}

export const SLASH_ITEMS: SlashItem[] = [
  { title: tk("Text"), hint: tk("Plain paragraph"), keywords: "paragraph text p odstavec", icon: Type, run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
  { title: tk("Heading 1"), hint: tk("Big section title"), keywords: "h1 title heading nadpis", icon: Heading1, run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run() },
  { title: tk("Heading 2"), hint: tk("Medium title"), keywords: "h2 subtitle heading nadpis podnadpis", icon: Heading2, run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run() },
  { title: tk("Heading 3"), hint: tk("Small title"), keywords: "h3 heading nadpis", icon: Heading3, run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run() },
  { title: tk("Bulleted list"), hint: tk("Simple list"), keywords: "ul bullet list unordered - seznam odrazky", icon: List, run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { title: tk("Numbered list"), hint: tk("Ordered steps"), keywords: "ol numbered ordered 1. seznam cislovany", icon: ListOrdered, run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { title: tk("To-do list"), hint: tk("Checkboxes"), keywords: "todo task check checklist [] seznam ukoly", icon: ListTodo, run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  { title: tk("Quote"), hint: tk("Highlight a passage"), keywords: "quote blockquote citace >", icon: Quote, run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { title: tk("Divider"), hint: tk("Separate sections"), keywords: "hr divider line separator --- oddelovac cara", icon: Minus, run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
  { title: tk("Code"), hint: tk("Monospaced block"), keywords: "code snippet pre ``` kod", icon: CodeXml, run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  {
    title: tk("Image"),
    hint: tk("Upload from your device"),
    keywords: "image picture photo obrazek fotka",
    icon: ImageIcon,
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        // The composer uploads it to the draft; without one (the demo), a local preview has to do.
        const insert = e.storage.attachments?.insertImage;
        if (insert) insert(file);
        else e.chain().focus().setImage({ src: URL.createObjectURL(file), alt: file.name }).run();
      };
      input.click();
    },
  },
];

/** Lowercase without diacritics, so "obrazek" finds "Obrázek". */
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

/** The user's snippets first (they're what "/" is mostly for once there are some), then blocks. */
function filterItems(query: string) {
  const q = fold(query.trim());
  const snippets: SlashItem[] = useMail
    .getState()
    .snippets.map((s) => ({
      title: s.name,
      hint: htmlToText(s.html).replace(/\s+/g, " ").slice(0, 80),
      keywords: "",
      icon: TextQuote,
      snippet: s.id,
      // A one-paragraph snippet continues the sentence instead of starting a new paragraph.
      run: (e: Editor, r: Range) => {
        track("snippet");
        e.chain().focus().deleteRange(r).insertContent(/^<p>(?:(?!<p>)[\s\S])*<\/p>$/.test(s.html) ? s.html.slice(3, -4) : s.html).run();
      },
    }))
    .filter((i) => !q || fold(`${i.title} ${i.hint}`).includes(q));
  // No snippets yet: one entry that says where they come from.
  const intro: SlashItem[] =
    !useMail.getState().snippets.length && (!q || fold(`snippet template ${t("Snippets")} sablona uryvek`).includes(q))
      ? [
          {
            title: tk("Snippets"),
            hint: tk("Save text you write often"),
            keywords: "",
            icon: TextQuote,
            run: (e: Editor, r: Range) => {
              e.chain().focus().deleteRange(r).run();
              useMail.getState().setSettingsOpen(true, "mail");
            },
          },
        ]
      : [];
  // English title and keywords always match; the shown (translated) title too.
  const blocks = q ? SLASH_ITEMS.filter((i) => fold(`${i.title} ${t(i.title)} ${i.keywords}`).includes(q)) : SLASH_ITEMS;
  return [...snippets.slice(0, 8), ...blocks, ...intro];
}

interface MenuHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

interface MenuProps {
  items: SlashItem[];
  command: (item: SlashItem) => void;
  clientRect?: (() => DOMRect | null) | null;
}

const SlashMenu = forwardRef<MenuHandle, MenuProps>(function SlashMenu({ items, command, clientRect }, ref) {
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const [prevItems, setPrevItems] = useState(items);
  if (prevItems !== items) {
    setPrevItems(items);
    setIndex(0);
  }

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (!items.length) return false;
      if (event.key === "ArrowDown") {
        setIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setIndex((i) => (i - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        command(items[index]);
        return true;
      }
      return false;
    },
  }));

  const rect = clientRect?.();
  if (!rect || !items.length) return null;
  const below = rect.bottom + 300 < window.innerHeight;

  return createPortal(
    <div
      ref={listRef}
      style={{
        position: "fixed",
        left: Math.min(rect.left, window.innerWidth - 268),
        top: below ? rect.bottom + 8 : undefined,
        bottom: below ? undefined : window.innerHeight - rect.top + 8,
      }}
      className="glass-strong z-50 max-h-[300px] w-[256px] overflow-y-auto rounded-xl p-1 animate-[menu-in_120ms_ease-out]"
    >
      {items.map((item, i) => {
        const header =
          i === 0 || !!items[i - 1].snippet !== !!item.snippet ? (
            <div key={`h-${i}`} className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-ink-3">
              {item.snippet ? t("Snippets") : t("Blocks")}
            </div>
          ) : null;
        return [
          header,
          <button
            key={item.snippet ?? item.title}
            data-index={i}
            onMouseEnter={() => setIndex(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              command(item);
            }}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left",
              i === index ? "bg-accent text-on-accent" : "text-ink",
            )}
          >
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-lg shadow-[inset_0_0_0_0.5px_var(--line)]",
                i === index ? "bg-white/15 shadow-none" : "bg-solid",
              )}
            >
              <item.icon size={16} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium">{item.snippet ? item.title : t(item.title)}</span>
              <span className={cn("block truncate text-[11.5px]", i === index ? "text-on-accent/75" : "text-ink-3")}>{item.snippet ? item.hint : t(item.hint)}</span>
            </span>
          </button>,
        ];
      })}
    </div>,
    document.body,
  );
});

export const SlashCommand = Extension.create({
  name: "slashCommand",
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        char: "/",
        startOfLine: false,
        allowSpaces: false,
        items: ({ query }) => filterItems(query),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => {
          let renderer: ReactRenderer<MenuHandle, MenuProps> | null = null;
          return {
            onStart: (props: SuggestionProps<SlashItem, SlashItem>) => {
              renderer = new ReactRenderer(SlashMenu, {
                props: { items: props.items, command: props.command, clientRect: props.clientRect },
                editor: props.editor,
              });
            },
            onUpdate: (props: SuggestionProps<SlashItem, SlashItem>) => {
              renderer?.updateProps({ items: props.items, command: props.command, clientRect: props.clientRect });
            },
            onKeyDown: (props: SuggestionKeyDownProps) => {
              if (props.event.key === "Escape") {
                renderer?.destroy();
                renderer = null;
                return true;
              }
              return renderer?.ref?.onKeyDown(props) ?? false;
            },
            onExit: () => {
              renderer?.destroy();
              renderer = null;
            },
          };
        },
      }),
    ];
  },
});
