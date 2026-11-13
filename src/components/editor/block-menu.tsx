"use client";

import type { Editor } from "@tiptap/react";
import { Plus } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useEffect, useRef, useState, type ReactElement, type RefObject } from "react";
import { t } from "@/lib/i18n";
import { keepTypingMenu } from "@/lib/keyboard";
import { cn } from "@/lib/utils";
import { Tooltip, menuContentClass } from "../ui";
import { blocksFor } from "./slash-command";

/** Put the cursor in an empty paragraph where the new block should go: reuse an empty line, otherwise add one below. */
function prepareTarget(editor: Editor, blockStart?: number) {
  const { doc } = editor.state;
  let start = blockStart;
  if (start === undefined) {
    const $from = editor.state.selection.$from;
    start = $from.depth >= 1 ? $from.before(1) : $from.pos;
  }
  const node = doc.nodeAt(start);
  if (!node) return;
  if (node.type.name === "paragraph" && node.content.size === 0) {
    editor.chain().focus().setTextSelection(start + 1).run();
    return;
  }
  const end = start + node.nodeSize;
  editor.chain().focus().insertContentAt(end, { type: "paragraph" }).setTextSelection(end + 1).run();
}

export function BlockMenu({
  editor,
  children,
  getTarget,
  onOpenChange,
  tooltip,
  side = "bottom",
  align = "start",
}: {
  editor: Editor;
  children: ReactElement;
  getTarget?: () => number | undefined;
  onOpenChange?: (open: boolean) => void;
  tooltip?: { label: string; shortcut?: string };
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
}) {
  const target = useRef<number | undefined>(undefined);
  const trigger = <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>;
  return (
    <DropdownMenu.Root
      modal={false}
      onOpenChange={(open) => {
        if (open) target.current = getTarget?.();
        onOpenChange?.(open);
      }}
    >
      {tooltip ? (
        <Tooltip label={tooltip.label} shortcut={tooltip.shortcut} side="top">
          {trigger}
        </Tooltip>
      ) : (
        trigger
      )}
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side={side}
          align={align}
          sideOffset={6}
          // Opened while typing on a phone: the keyboard stays up.
          {...keepTypingMenu}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className={cn(menuContentClass, "max-h-[min(360px,60vh)] w-[264px] overflow-y-auto")}
        >
          <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-ink-3">{t("Insert block")}</div>
          {blocksFor(editor).map((item) => (
            <DropdownMenu.Item
              key={item.title}
              onSelect={() => {
                prepareTarget(editor, target.current);
                const at = editor.state.selection.from;
                item.run(editor, { from: at, to: at });
              }}
              className="group flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-on-accent"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-solid text-ink shadow-[inset_0_0_0_0.5px_var(--line)] group-data-[highlighted]:bg-white/15 group-data-[highlighted]:text-on-accent group-data-[highlighted]:shadow-none">
                <item.icon size={16} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">{t(item.title)}</span>
                <span className="block truncate text-[11.5px] text-ink-3 group-data-[highlighted]:text-on-accent/75">{t(item.hint)}</span>
              </span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Notion-style "+" in the left gutter, next to the hovered (or focused) block. Desktop only. */
export function BlockGutter({ editor, containerRef }: { editor: Editor; containerRef: RefObject<HTMLDivElement | null> }) {
  const [spot, setSpot] = useState<{ top: number; start: number } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuOpenRef = useRef(false);
  useEffect(() => {
    menuOpenRef.current = menuOpen;
  }, [menuOpen]);

  useEffect(() => {
    const root = editor.view.dom as HTMLElement;
    const place = (el: Element | null) => {
      const container = containerRef.current;
      if (!el || !container || menuOpenRef.current) return;
      const block = el.closest(".ProseMirror > *");
      if (!(block instanceof HTMLElement) || !root.contains(block)) return;
      let pos: number;
      try {
        pos = editor.view.posAtDOM(block, 0);
      } catch {
        return;
      }
      const $pos = editor.state.doc.resolve(pos);
      const start = $pos.depth >= 1 ? $pos.before(1) : pos;
      const lineHeight = parseFloat(getComputedStyle(block).lineHeight) || 24;
      const top = block.getBoundingClientRect().top - container.getBoundingClientRect().top + Math.min(lineHeight, block.offsetHeight) / 2;
      setSpot({ top, start });
    };
    const onMove = (e: MouseEvent) => place(e.target as Element);
    const onSelection = () => {
      if (!editor.isFocused) return;
      const { node } = editor.view.domAtPos(editor.state.selection.from);
      place(node instanceof Element ? node : node.parentElement);
    };
    root.addEventListener("mousemove", onMove);
    editor.on("selectionUpdate", onSelection);
    editor.on("focus", onSelection);
    return () => {
      root.removeEventListener("mousemove", onMove);
      editor.off("selectionUpdate", onSelection);
      editor.off("focus", onSelection);
    };
  }, [editor, containerRef]);

  if (!spot) return null;
  return (
    <div
      className={cn(
        "absolute -left-8 hidden transition-[top,opacity] duration-150 md:block",
        menuOpen ? "opacity-100" : "opacity-0 group-focus-within/editor:opacity-100 group-hover/editor:opacity-100",
      )}
      style={{ top: spot.top - 12 }}
    >
      <BlockMenu editor={editor} getTarget={() => spot.start} onOpenChange={setMenuOpen} tooltip={{ label: t("Add a block"), shortcut: "/" }}>
        <button
          aria-label={t("Add a block")}
          className="flex size-6 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-hover hover:text-ink data-[state=open]:bg-hover data-[state=open]:text-ink"
        >
          <Plus size={16} />
        </button>
      </BlockMenu>
    </div>
  );
}
